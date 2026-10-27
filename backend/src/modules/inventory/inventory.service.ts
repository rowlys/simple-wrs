import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { productSearch } from '../products/products.service';
import { userRef } from '../receiving/receiving-documents.service';
import { InventoryBalance, InventoryTransaction, ListInventoryQuery, ListTransactionsQuery } from './dto/inventory.dto';

// Read only: stock changes only in ReceiptsService (spec §5).
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // FR-40: one row per product, sorted by SKU (unique, so paging is stable).
  async list({ search, ...pageQuery }: ListInventoryQuery): Promise<Page<InventoryBalance>> {
    const where: Prisma.InventoryBalanceWhereInput = { product: productSearch(search) };
    const page = await paginate(
      pageQuery,
      (args) =>
        this.prisma.inventoryBalance.findMany({
          where,
          include: { product: { select: { sku: true, name: true, unitOfMeasure: true } } },
          orderBy: { product: { sku: 'asc' } },
          ...args,
        }),
      () => this.prisma.inventoryBalance.count({ where }),
    );
    return {
      ...page,
      data: page.data.map(({ productId, product, quantityOnHand, updatedAt }) => ({ productId, ...product, quantityOnHand, updatedAt })),
    };
  }

  // FR-41: newest first by ledger id, the strict insertion order (spec §2).
  async transactions({ productId, receivingDocumentId, from, to, ...pageQuery }: ListTransactionsQuery): Promise<Page<InventoryTransaction>> {
    const where: Prisma.InventoryTransactionWhereInput = {
      productId,
      receivingDocumentId,
      createdAt: { gte: from && new Date(from), lt: to && new Date(to) },
    };
    const page = await paginate(
      pageQuery,
      (args) =>
        this.prisma.inventoryTransaction.findMany({
          where,
          select: {
            id: true,
            type: true,
            product: { select: { id: true, sku: true, name: true } },
            quantityChange: true,
            balanceAfter: true,
            receiptId: true,
            receiptReversalId: true,
            receivingDocument: { select: { id: true, documentNumber: true } },
            createdBy: userRef,
            createdAt: true,
          },
          orderBy: { id: 'desc' },
          ...args,
        }),
      () => this.prisma.inventoryTransaction.count({ where }),
    );
    return { ...page, data: page.data.map(({ id, ...t }) => ({ id: String(id), ...t })) };
  }
}
