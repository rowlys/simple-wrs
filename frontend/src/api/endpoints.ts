import { request } from './client';
import type {
  CreateProductRequest,
  CreateReceivingDocumentRequest,
  InventoryBalance,
  InventoryTransaction,
  Page,
  PageQuery,
  Product,
  ReceiptResult,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingStatus,
} from './types';

// One function per docs/openapi.yaml operation the UI uses (operationId in the comment).

export const listProducts = (query: PageQuery) => request<Page<Product>>('GET', '/products', { query: { ...query } }); // listProducts
export const createProduct = (body: CreateProductRequest) => request<Product>('POST', '/products', { body }); // createProduct

// listReceivingDocuments
export const listDocuments = (query: PageQuery & { status?: ReceivingStatus }) =>
  request<Page<ReceivingDocumentSummary>>('GET', '/receiving-documents', { query: { ...query } });
// getReceivingDocument
export const getDocument = (id: string) => request<ReceivingDocumentDetail>('GET', `/receiving-documents/${id}`);
// createReceivingDocument
export const createDocument = (body: CreateReceivingDocumentRequest) =>
  request<ReceivingDocumentDetail>('POST', '/receiving-documents', { body });

const doc = (id: string) => `/receiving-documents/${id}`;

// addReceivingItem
export const addItem = (documentId: string, productId: string, expectedQuantity: number) =>
  request<ReceivingDocumentDetail>('POST', `${doc(documentId)}/items`, { body: { productId, expectedQuantity } });
// updateReceivingItem
export const updateItem = (documentId: string, itemId: string, expectedQuantity: number) =>
  request<ReceivingDocumentDetail>('PATCH', `${doc(documentId)}/items/${itemId}`, { body: { expectedQuantity } });
// removeReceivingItem
export const removeItem = (documentId: string, itemId: string) => request<void>('DELETE', `${doc(documentId)}/items/${itemId}`);

// openReceivingDocument, completeReceivingDocument (no body)
export const openDocument = (id: string) => request<ReceivingDocumentDetail>('POST', `${doc(id)}/open`);
export const completeDocument = (id: string) => request<ReceivingDocumentDetail>('POST', `${doc(id)}/complete`);
// closeShortReceivingDocument, cancelReceivingDocument (ReasonRequest, BR-15, BR-17)
export const closeShortDocument = (id: string, reason: string) =>
  request<ReceivingDocumentDetail>('POST', `${doc(id)}/close-short`, { body: { reason } });
export const cancelDocument = (id: string, reason: string) => request<ReceivingDocumentDetail>('POST', `${doc(id)}/cancel`, { body: { reason } });

// recordReceipt (BR-09: Idempotency-Key header)
export const recordReceipt = (documentId: string, itemId: string, quantity: number, idempotencyKey: string) =>
  request<ReceiptResult>('POST', `${doc(documentId)}/items/${itemId}/receipts`, {
    body: { quantity },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
// reverseReceipt
export const reverseReceipt = (documentId: string, receiptId: string, reason: string) =>
  request<ReceivingDocumentDetail>('POST', `${doc(documentId)}/receipts/${receiptId}/reverse`, { body: { reason } });

// listInventory
export const listInventory = (query: PageQuery) => request<Page<InventoryBalance>>('GET', '/inventory', { query: { ...query } });
// listInventoryTransactions; from (inclusive) and to (exclusive) are RFC 3339 date-times with an offset (D-25).
export const listTransactions = (query: Omit<PageQuery, 'search'> & { productId?: string; receivingDocumentId?: string; from?: string; to?: string }) =>
  request<Page<InventoryTransaction>>('GET', '/inventory/transactions', { query: { ...query } });
