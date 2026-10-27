import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/auth/jwt-auth.guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCan } from './document-state';
import { ReceiptResult } from './dto/receiving-document.dto';
import { allReceived, DETAIL_INCLUDE, lockDocument, RECEIPT_INCLUDE, toItem, toReceipt, TX_OPTIONS } from './receiving-documents.service';

type Tx = Prisma.TransactionClient;

interface ReceiptRequest {
  documentId: string;
  itemId: string;
  quantity: number;
  idempotencyKey: string;
}

// The receipt as in the document detail, plus its line, document and on-hand for the spec §6 step 16 response.
const RESULT_INCLUDE = {
  ...RECEIPT_INCLUDE,
  receivingItem: {
    include: {
      product: { select: { ...DETAIL_INCLUDE.items.include.product.select, balance: { select: { quantityOnHand: true } } } },
      receivingDocument: {
        select: { id: true, documentNumber: true, status: true, items: { select: { expectedQuantity: true, receivedQuantity: true } } },
      },
    },
  },
} satisfies Prisma.ReceiptInclude;

async function receiptResult(db: Tx, receiptId: string): Promise<ReceiptResult> {
  const receipt = await db.receipt.findUniqueOrThrow({ where: { id: receiptId }, include: RESULT_INCLUDE });
  const { receivingDocument: doc, product, ...item } = receipt.receivingItem;
  const { balance, ...productRef } = product;
  return {
    receipt: toReceipt(receipt),
    item: toItem({ ...item, product: productRef }),
    document: { id: doc.id, documentNumber: doc.documentNumber, status: doc.status, allItemsReceived: allReceived(doc.items) },
    inventory: { productId: product.id, quantityOnHand: balance!.quantityOnHand },
  };
}

// Spec §6 step 5 (BR-09): the id of the receipt already recorded with this key for this same request, or null
// when the key is new. A key used for another line or quantity is 409 (D-21: the line must be on this document).
async function replayedReceipt(db: Tx, { documentId, itemId, quantity, idempotencyKey }: ReceiptRequest): Promise<string | null> {
  const earlier = await db.receipt.findUnique({
    where: { idempotencyKey },
    select: { id: true, quantity: true, receivingItemId: true, receivingItem: { select: { receivingDocumentId: true } } },
  });
  if (!earlier) return null;
  if (earlier.receivingItemId !== itemId || earlier.quantity !== quantity || earlier.receivingItem.receivingDocumentId !== documentId) {
    throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'This Idempotency-Key was already used for a different receipt.');
  }
  return earlier.id;
}

// The only code that changes stock (spec §5): FR-31 receipts. Reversals (FR-37) come with their own instruction.
@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordReceipt(request: ReceiptRequest, user: AuthUser): Promise<{ result: ReceiptResult; replayed: boolean }> {
    let replayId: string;
    try {
      const outcome = await this.prisma.$transaction((tx) => this.receive(tx, request, user), TX_OPTIONS);
      if (typeof outcome !== 'string') return { result: outcome, replayed: false };
      replayId = outcome;
    } catch (e) {
      // Step 15: the unique key rejected the insert because the same key was committed meanwhile under another
      // document's lock. The failed transaction is rolled back; step 5 runs once more and now sees that receipt.
      if (uniqueViolation(e) !== 'Receipt:idempotency_key') throw e;
      const id = await replayedReceipt(this.prisma, request);
      if (!id) throw e;
      replayId = id;
    }
    // One snapshot, so the line, document and on-hand in the replay agree with each other (D-22: as they are now).
    const result = await this.prisma.$transaction((tx) => receiptResult(tx, replayId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    return { result, replayed: true };
  }

  // Spec §6 steps 5–14; returns the new receipt's result, or the id of the receipt this request replays.
  // Lock order document → item → balance (BR-14).
  private async receive(tx: Tx, request: ReceiptRequest, user: AuthUser): Promise<ReceiptResult | string> {
    const { documentId, itemId, quantity, idempotencyKey } = request;
    const { status, now } = await lockDocument(tx, documentId);

    // Step 5 runs after the document lock (D-24): a duplicate that waited for the lock must see the receipt its
    // twin just committed, before the remaining or status checks below would reject it.
    const replayId = await replayedReceipt(tx, request);
    if (replayId) return replayId;
    assertCan('RECEIVE', status);

    const [item] = await tx.$queryRaw<{ productId: string; expected: number; received: number; sku: string }[]>`
      SELECT ri.product_id AS "productId", ri.expected_quantity AS expected, ri.received_quantity AS received, p.sku
      FROM receiving_items ri JOIN products p ON p.id = ri.product_id
      WHERE ri.id = ${itemId}::uuid AND ri.receiving_document_id = ${documentId}::uuid
      FOR UPDATE OF ri`;
    if (!item) throw new AppError(ErrorCode.NOT_FOUND, 'Line not found on this document.');

    // BR-07: checked against the quantity read under the line lock, so a parallel receipt cannot slip past it.
    const remaining = item.expected - item.received;
    if (quantity > remaining) {
      throw new AppError(
        ErrorCode.QUANTITY_EXCEEDS_REMAINING,
        `Cannot receive ${quantity} units; only ${remaining} remaining for ${item.sku}.`,
        { remainingQuantity: remaining, requestedQuantity: quantity },
      );
    }

    // Prisma client, not raw SQL, so a duplicate key arrives as P2002 with its meta (D-04).
    const receipt = await tx.receipt.create({
      data: { receivingItemId: itemId, quantity, idempotencyKey, receivedById: user.id, receivedAt: now },
    });
    await tx.receivingItem.update({ where: { id: itemId }, data: { receivedQuantity: { increment: quantity }, updatedAt: now } });
    const { quantityOnHand } = await tx.inventoryBalance.update({
      where: { productId: item.productId },
      data: { quantityOnHand: { increment: quantity }, updatedAt: now },
    });
    await tx.inventoryTransaction.create({
      data: {
        productId: item.productId,
        type: 'RECEIPT',
        quantityChange: quantity,
        balanceAfter: quantityOnHand,
        receiptId: receipt.id,
        receivingDocumentId: documentId,
        createdById: user.id,
        createdAt: now,
      },
    });
    if (status === 'OPEN') {
      await tx.receivingDocument.update({ where: { id: documentId }, data: { status: 'IN_PROGRESS', updatedAt: now } });
    }
    return receiptResult(tx, receipt.id);
  }
}
