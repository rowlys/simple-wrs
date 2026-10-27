// Shapes mirror docs/openapi.yaml (schemas of the same name). Timestamps are ISO 8601 strings in UTC.

export type Role = 'OPERATOR' | 'SUPERVISOR';
export type ReceivingStatus = 'DRAFT' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED_SHORT' | 'CANCELLED';

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface UserRef {
  id: string;
  fullName: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  description: string | null;
  quantityOnHand: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductRequest {
  sku: string;
  name: string;
  unitOfMeasure: string;
  description?: string | null;
}

export interface ReceivingItemInput {
  productId: string;
  expectedQuantity: number;
}

export interface CreateReceivingDocumentRequest {
  supplierName: string;
  referenceNumber?: string | null;
  /** YYYY-MM-DD */
  expectedDate?: string | null;
  notes?: string | null;
  items?: ReceivingItemInput[];
}

export interface ReceivingDocumentSummary {
  id: string;
  documentNumber: string;
  supplierName: string;
  referenceNumber: string | null;
  /** YYYY-MM-DD, a calendar date with no time zone */
  expectedDate: string | null;
  status: ReceivingStatus;
  itemCount: number;
  totalExpectedQuantity: number;
  totalReceivedQuantity: number;
  createdAt: string;
  createdBy: UserRef;
}

export interface ReceivingItem {
  id: string;
  product: { id: string; sku: string; name: string; unitOfMeasure: string };
  expectedQuantity: number;
  receivedQuantity: number;
  /** The shortage once the document is CLOSED_SHORT */
  remainingQuantity: number;
  isFullyReceived: boolean;
}

export interface ReceiptReversal {
  id: string;
  reason: string;
  reversedAt: string;
  reversedBy: UserRef;
}

export interface Receipt {
  id: string;
  receivingItemId: string;
  productSku: string;
  quantity: number;
  receivedAt: string;
  receivedBy: UserRef;
  reversal: ReceiptReversal | null;
}

export interface ReceivingDocumentDetail extends ReceivingDocumentSummary {
  notes: string | null;
  allItemsReceived: boolean;
  items: ReceivingItem[];
  /** Oldest first */
  receipts: Receipt[];
  openedAt: string | null;
  openedBy: UserRef | null;
  completedAt: string | null;
  completedBy: UserRef | null;
  closedShortAt: string | null;
  closedShortBy: UserRef | null;
  closeShortReason: string | null;
  cancelledAt: string | null;
  cancelledBy: UserRef | null;
  cancelReason: string | null;
  updatedAt: string;
}

export interface ReceiptResult {
  receipt: Receipt;
  item: ReceivingItem;
  document: { id: string; documentNumber: string; status: ReceivingStatus; allItemsReceived: boolean };
  inventory: { productId: string; quantityOnHand: number };
}

export interface InventoryBalance {
  productId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  quantityOnHand: number;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  type: 'RECEIPT' | 'RECEIPT_REVERSAL';
  product: { id: string; sku: string; name: string };
  quantityChange: number;
  balanceAfter: number;
  receiptId: string | null;
  receiptReversalId: string | null;
  receivingDocument: { id: string; documentNumber: string } | null;
  createdBy: UserRef;
  createdAt: string;
}
