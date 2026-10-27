import type { Receipt, ReceivingDocumentDetail, ReceivingItem, ReceivingStatus } from '../api/types';

export const DOC_ID = '20000000-0000-4000-8000-000000000001';
const siti = { id: '00000000-0000-4000-8000-000000000001', fullName: 'Siti Supervisor' };
const budi = { id: '00000000-0000-4000-8000-000000000002', fullName: 'Budi Operator' };

export function makeItem(sku: string, expectedQuantity: number, receivedQuantity = 0): ReceivingItem {
  return {
    id: `item-${sku}`,
    product: { id: `product-${sku}`, sku, name: `Product ${sku}`, unitOfMeasure: 'CTN' },
    expectedQuantity,
    receivedQuantity,
    remainingQuantity: expectedQuantity - receivedQuantity,
    isFullyReceived: receivedQuantity === expectedQuantity,
  };
}

export function makeReceipt(id: string, item: ReceivingItem, quantity: number, reversed = false): Receipt {
  return {
    id,
    receivingItemId: item.id,
    productSku: item.product.sku,
    quantity,
    receivedAt: '2026-10-28T02:00:00.000Z',
    receivedBy: budi,
    reversal: reversed ? { id: `rev-${id}`, reason: 'Typo: counted 10', reversedAt: '2026-10-28T03:00:00.000Z', reversedBy: siti } : null,
  };
}

/** A document in `status` with the given lines; status fields are filled the way the API fills them. */
export function makeDocument(status: ReceivingStatus, items: ReceivingItem[] = [makeItem('FRZ-CHK-001', 100)], receipts: Receipt[] = []): ReceivingDocumentDetail {
  const at = '2026-10-28T01:00:00.000Z';
  return {
    id: DOC_ID,
    documentNumber: 'RCV-2026-000001',
    supplierName: 'PT Sumber Beku Nusantara',
    referenceNumber: 'SJ-2026-10-0042',
    expectedDate: '2026-10-28',
    status,
    itemCount: items.length,
    totalExpectedQuantity: items.reduce((sum, i) => sum + i.expectedQuantity, 0),
    totalReceivedQuantity: items.reduce((sum, i) => sum + i.receivedQuantity, 0),
    createdAt: at,
    createdBy: siti,
    notes: null,
    allItemsReceived: items.length > 0 && items.every((i) => i.isFullyReceived),
    items,
    receipts,
    openedAt: status === 'DRAFT' ? null : at,
    openedBy: status === 'DRAFT' ? null : siti,
    completedAt: status === 'COMPLETED' ? at : null,
    completedBy: status === 'COMPLETED' ? siti : null,
    closedShortAt: status === 'CLOSED_SHORT' ? at : null,
    closedShortBy: status === 'CLOSED_SHORT' ? siti : null,
    closeShortReason: status === 'CLOSED_SHORT' ? 'Supplier out of stock' : null,
    cancelledAt: status === 'CANCELLED' ? at : null,
    cancelledBy: status === 'CANCELLED' ? siti : null,
    cancelReason: status === 'CANCELLED' ? 'Supplier cancelled shipment' : null,
    updatedAt: at,
  };
}
