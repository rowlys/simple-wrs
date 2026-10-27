import { Injectable } from '@nestjs/common';
import { Prisma, ReceivingStatus } from '@prisma/client';
import { AuthUser } from '../../common/auth/jwt-auth.guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { escapeLike, Page, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCan, DocumentAction } from './document-state';
import {
  CreateReceivingDocumentRequest,
  ListReceivingDocumentsQuery,
  Receipt,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingItem,
  ReceivingItemInput,
} from './dto/receiving-document.dto';

type Tx = Prisma.TransactionClient;

export const TX_OPTIONS = { timeout: 10_000 }; // spec §6 step 4; READ COMMITTED is the PostgreSQL default

export const userRef = { select: { id: true, fullName: true } } as const;

// shortcut: loads every line's quantities to count and sum them in JS (at most 100 documents × 200 lines);
// switch to receivingItem.groupBy for the page's ids if the list ever misses NFR-04's 500 ms.
const SUMMARY_INCLUDE = {
  createdBy: userRef,
  items: { select: { expectedQuantity: true, receivedQuantity: true } },
} satisfies Prisma.ReceivingDocumentInclude;

export const DETAIL_INCLUDE = {
  createdBy: userRef,
  openedBy: userRef,
  completedBy: userRef,
  closedShortBy: userRef,
  cancelledBy: userRef,
  items: {
    include: { product: { select: { id: true, sku: true, name: true, unitOfMeasure: true } } },
    // Lines created together share created_at, so the SKU orders them (D-16).
    orderBy: [{ createdAt: 'asc' }, { product: { sku: 'asc' } }],
  },
} satisfies Prisma.ReceivingDocumentInclude;

export const RECEIPT_INCLUDE = {
  receivedBy: userRef,
  reversal: { include: { reversedBy: userRef } },
  receivingItem: { select: { product: { select: { sku: true } } } },
} satisfies Prisma.ReceiptInclude;

type SummaryRow = Prisma.ReceivingDocumentGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailRow = Prisma.ReceivingDocumentGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

// FR-22, D-17: RCV-YYYY-NNNNNN; past 999,999 the number grows instead of being cut.
export const formatDocumentNumber = (year: number, seq: bigint) => `RCV-${year}-${String(seq).padStart(6, '0')}`;

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

// FR-34: every line fully received (a document without lines never is).
export const allReceived = (items: { expectedQuantity: number; receivedQuantity: number }[]) =>
  items.length > 0 && items.every((i) => i.receivedQuantity === i.expectedQuantity);

const toSummary = (doc: SummaryRow): ReceivingDocumentSummary => ({
  id: doc.id,
  documentNumber: doc.documentNumber,
  supplierName: doc.supplierName,
  referenceNumber: doc.referenceNumber,
  // A DATE column comes back as UTC midnight; the API returns the calendar date.
  expectedDate: doc.expectedDate && doc.expectedDate.toISOString().slice(0, 10),
  status: doc.status,
  itemCount: doc.items.length,
  totalExpectedQuantity: sum(doc.items.map((i) => i.expectedQuantity)),
  totalReceivedQuantity: sum(doc.items.map((i) => i.receivedQuantity)),
  createdAt: doc.createdAt,
  createdBy: doc.createdBy,
});

export const toReceipt = (r: ReceiptRow): Receipt => ({
  id: r.id,
  receivingItemId: r.receivingItemId,
  productSku: r.receivingItem.product.sku,
  quantity: r.quantity,
  receivedAt: r.receivedAt,
  receivedBy: r.receivedBy,
  reversal: r.reversal && {
    id: r.reversal.id,
    reason: r.reversal.reason,
    reversedAt: r.reversal.reversedAt,
    reversedBy: r.reversal.reversedBy,
  },
});

export const toItem = ({ id, product, expectedQuantity, receivedQuantity }: DetailRow['items'][number]): ReceivingItem => ({
  id,
  product,
  expectedQuantity,
  receivedQuantity,
  remainingQuantity: expectedQuantity - receivedQuantity,
  isFullyReceived: receivedQuantity === expectedQuantity,
});

const toDetail = (doc: DetailRow, receipts: ReceiptRow[]): ReceivingDocumentDetail => {
  const items = doc.items.map(toItem);
  return {
    ...toSummary(doc),
    notes: doc.notes,
    allItemsReceived: allReceived(doc.items),
    items,
    receipts: receipts.map(toReceipt),
    openedAt: doc.openedAt,
    openedBy: doc.openedBy,
    completedAt: doc.completedAt,
    completedBy: doc.completedBy,
    closedShortAt: doc.closedShortAt,
    closedShortBy: doc.closedShortBy,
    closeShortReason: doc.closeShortReason,
    cancelledAt: doc.cancelledAt,
    cancelledBy: doc.cancelledBy,
    cancelReason: doc.cancelReason,
    updatedAt: doc.updatedAt,
  };
};

// BR-16
async function assertProductsExist(tx: Tx, productIds: string[]): Promise<void> {
  if ((await tx.product.count({ where: { id: { in: productIds } } })) < productIds.length) {
    throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, 'A product on this document does not exist.');
  }
}

// Locks the document row (spec §6: always the first lock, so every change to one document is serialized)
// and returns its status with the transaction's database time, used for every timestamp it writes.
export async function lockDocument(tx: Tx, id: string): Promise<{ status: ReceivingStatus; now: Date }> {
  const [doc] = await tx.$queryRaw<{ status: ReceivingStatus; now: Date }[]>`
    SELECT status, now() AS now FROM receiving_documents WHERE id = ${id}::uuid FOR UPDATE`;
  if (!doc) throw new AppError(ErrorCode.NOT_FOUND, 'Receiving document not found.');
  return doc;
}

async function incompleteItems(tx: Tx, documentId: string) {
  const items = await tx.receivingItem.findMany({
    where: { receivingDocumentId: documentId },
    select: { id: true, expectedQuantity: true, receivedQuantity: true },
    orderBy: DETAIL_INCLUDE.items.orderBy,
  });
  return { total: items.length, incomplete: items.filter((i) => i.receivedQuantity < i.expectedQuantity).map((i) => i.id) };
}

@Injectable()
export class ReceivingDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ status, search, ...pageQuery }: ListReceivingDocumentsQuery): Promise<Page<ReceivingDocumentSummary>> {
    const text = search && escapeLike(search);
    const where: Prisma.ReceivingDocumentWhereInput = {
      status,
      ...(text && {
        OR: [
          { documentNumber: { contains: text, mode: 'insensitive' } },
          { supplierName: { contains: text, mode: 'insensitive' } },
          { referenceNumber: { contains: text, mode: 'insensitive' } },
        ],
      }),
    };
    const page = await paginate(
      pageQuery,
      (args) =>
        this.prisma.receivingDocument.findMany({
          where,
          include: SUMMARY_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id breaks ties, as for products (D-13)
          ...args,
        }),
      () => this.prisma.receivingDocument.count({ where }),
    );
    return { ...page, data: page.data.map(toSummary) };
  }

  // One snapshot for the document and its receipts, so a receipt committed in between cannot show up
  // in one read and not the other.
  get(id: string): Promise<ReceivingDocumentDetail> {
    return this.prisma.$transaction((tx) => this.detail(tx, id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  // FR-21, FR-22: the number, the document and its lines in one transaction.
  create({ items, expectedDate, ...header }: CreateReceivingDocumentRequest, user: AuthUser): Promise<ReceivingDocumentDetail> {
    const productIds = items.map((i) => i.productId);
    if (new Set(productIds).size < productIds.length) {
      throw new AppError(ErrorCode.DUPLICATE_PRODUCT_IN_DOCUMENT, 'A product may appear only once on a document; use one line per product.');
    }
    return this.prisma.$transaction(async (tx) => {
      await assertProductsExist(tx, productIds);
      // The year of the transaction's time in UTC, like created_at (D-17).
      const [{ seq, year }] = await tx.$queryRaw<{ seq: bigint; year: number }[]>`
        SELECT nextval('receiving_document_number_seq') AS seq, extract(year FROM now() AT TIME ZONE 'UTC')::int AS year`;
      const { id } = await tx.receivingDocument.create({
        data: {
          ...header,
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          documentNumber: formatDocumentNumber(year, seq),
          createdById: user.id,
          items: { create: items },
        },
      });
      return this.detail(tx, id);
    }, TX_OPTIONS);
  }

  // FR-24: a duplicate product fails on ri_document_product_uq (409 DUPLICATE_PRODUCT_IN_DOCUMENT in the filter).
  addItem(documentId: string, item: ReceivingItemInput): Promise<ReceivingDocumentDetail> {
    return this.editItems(documentId, async (tx) => {
      await assertProductsExist(tx, [item.productId]);
      await tx.receivingItem.create({ data: { ...item, receivingDocumentId: documentId } });
    });
  }

  // FR-25
  updateItem(documentId: string, itemId: string, expectedQuantity: number): Promise<ReceivingDocumentDetail> {
    return this.editItems(documentId, async (tx, now) => {
      const { count } = await tx.receivingItem.updateMany({
        where: { id: itemId, receivingDocumentId: documentId },
        data: { expectedQuantity, updatedAt: now },
      });
      if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Line not found on this document.');
    });
  }

  // FR-26, BR-10: answers 204, so it skips the detail read and holds the lock only for the delete.
  async removeItem(documentId: string, itemId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      assertCan('EDIT_ITEMS', (await lockDocument(tx, documentId)).status);
      const { count } = await tx.receivingItem.deleteMany({ where: { id: itemId, receivingDocumentId: documentId } });
      if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Line not found on this document.');
    }, TX_OPTIONS);
  }

  // FR-27, BR-11
  open(id: string, user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.transition(id, 'OPEN', async (tx, now) => {
      if (!(await tx.receivingItem.count({ where: { receivingDocumentId: id } }))) {
        throw new AppError(ErrorCode.DOCUMENT_HAS_NO_ITEMS, 'Add at least one line before opening the document.');
      }
      return { status: 'OPEN', openedAt: now, openedById: user.id };
    });
  }

  // FR-28, BR-11
  complete(id: string, user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.transition(id, 'COMPLETE', async (tx, now) => {
      const { total, incomplete } = await incompleteItems(tx, id);
      if (incomplete.length) {
        throw new AppError(ErrorCode.ITEMS_NOT_FULLY_RECEIVED, `${incomplete.length} of ${total} items are not fully received.`, {
          incompleteItemIds: incomplete,
        });
      }
      return { status: 'COMPLETED', completedAt: now, completedById: user.id };
    });
  }

  // FR-35, BR-11: no stock change and expected quantities are kept, so each line's shortage stays visible.
  closeShort(id: string, reason: string, user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.transition(id, 'CLOSE_SHORT', async (tx, now) => {
      if (!(await incompleteItems(tx, id)).incomplete.length) {
        throw new AppError(ErrorCode.NOTHING_SHORT, 'Every line is fully received; complete the document instead.');
      }
      return { status: 'CLOSED_SHORT', closedShortAt: now, closedShortById: user.id, closeShortReason: reason };
    });
  }

  // FR-29, BR-15
  cancel(id: string, reason: string, user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.transition(id, 'CANCEL', async (_tx, now) => ({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledById: user.id,
      cancelReason: reason,
    }));
  }

  private async detail(db: Tx, id: string): Promise<ReceivingDocumentDetail> {
    const doc = await db.receivingDocument.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!doc) throw new AppError(ErrorCode.NOT_FOUND, 'Receiving document not found.');
    const receipts = await db.receipt.findMany({
      where: { receivingItem: { receivingDocumentId: id } },
      include: RECEIPT_INCLUDE,
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    return toDetail(doc, receipts);
  }

  // BR-10: lines change only while the document is DRAFT, under the document lock.
  private editItems(documentId: string, write: (tx: Tx, now: Date) => Promise<void>): Promise<ReceivingDocumentDetail> {
    return this.prisma.$transaction(async (tx) => {
      const { status, now } = await lockDocument(tx, documentId);
      assertCan('EDIT_ITEMS', status);
      await write(tx, now);
      return this.detail(tx, documentId);
    }, TX_OPTIONS);
  }

  // BR-11, BR-14: lock, check the state machine, run the action's own guard, then write the new status.
  private transition(
    id: string,
    action: DocumentAction,
    guard: (tx: Tx, now: Date) => Promise<Prisma.ReceivingDocumentUncheckedUpdateInput>,
  ): Promise<ReceivingDocumentDetail> {
    return this.prisma.$transaction(async (tx) => {
      const { status, now } = await lockDocument(tx, id);
      assertCan(action, status);
      await tx.receivingDocument.update({ where: { id }, data: { ...(await guard(tx, now)), updatedAt: now } });
      return this.detail(tx, id);
    }, TX_OPTIONS);
  }
}
