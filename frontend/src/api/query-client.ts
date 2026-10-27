import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
import type { ReceivingDocumentDetail } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx answer will not change on retry; only network failures and 5xx are retried.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * After a write: refetch what it may have changed (spec §5: documents, stock, ledger, on-hand on products).
 * Product pickers are left alone, and so is a document whose fresh copy the write already returned.
 */
export function refreshAfterWrite(client: QueryClient, freshDocumentId?: string): void {
  void client.invalidateQueries({
    predicate: ({ queryKey: [kind, id] }) => kind !== 'product-options' && !(kind === 'document' && id === freshDocumentId),
  });
}

/** A write that answers with the whole document (OpenAPI), or nothing (204): cache it, refresh the rest. */
export function useDocumentMutation<T>(
  send: (input: T) => Promise<ReceivingDocumentDetail | void>,
  { onSuccess, onError }: { onSuccess?: (document: ReceivingDocumentDetail | void) => void; onError?: (error: Error) => void } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (document) => {
      if (document) client.setQueryData(['document', document.id], document);
      refreshAfterWrite(client, document ? document.id : undefined);
      onSuccess?.(document);
    },
    onError,
  });
}
