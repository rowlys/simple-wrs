import { Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { recordReceipt } from '../api/endpoints';
import { refreshAfterWrite } from '../api/query-client';
import type { ReceivingItem } from '../api/types';
import { errorMessage } from './ErrorAlert';

// D-29: crypto.randomUUID exists only in secure contexts (HTTPS, localhost); a dock tablet may open the app over
// plain HTTP on the LAN, where getRandomValues still works. 32 hex characters fit the BR-09 key pattern.
const newIdempotencyKey = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * AC-04.9, spec §6 "Frontend side": one Idempotency-Key per submission. A retry of the same quantity after a
 * failure (timeout, double click, the same number typed again) reuses the key, so the server records it once;
 * another quantity, or the next receipt after a success, gets a new key.
 */
export function ReceiveForm({ documentId, item }: { documentId: string; item: ReceivingItem }) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState<number | ''>('');
  const [attempt, setAttempt] = useState<{ quantity: number; key: string } | null>(null);

  const receive = useMutation({
    mutationFn: ({ quantity, key }: { quantity: number; key: string }) => recordReceipt(documentId, item.id, quantity, key),
    onSuccess: ({ receipt }) => {
      setQuantity('');
      setAttempt(null);
      refreshAfterWrite(queryClient); // spec §5: the document, inventory and ledger all changed
      notifications.show({ color: 'green', message: `Received ${receipt.quantity} ${item.product.unitOfMeasure} of ${receipt.productSku}` });
    },
    // Someone else may have received on the line or closed the document: show the current remaining and status.
    onError: () => void queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (quantity === '' || receive.isPending) return;
    const next = attempt?.quantity === quantity ? attempt : { quantity, key: newIdempotencyKey() };
    setAttempt(next);
    receive.mutate(next);
  };

  return (
    <form onSubmit={submit}>
      <Stack gap={4}>
        <Group gap="xs" wrap="nowrap">
          <NumberInput
            aria-label={`Quantity to receive for ${item.product.sku}`}
            placeholder={`max ${item.remainingQuantity}`}
            value={quantity}
            onChange={(value) => {
              setQuantity(typeof value === 'number' ? value : '');
              receive.reset();
            }}
            disabled={receive.isPending}
            min={1}
            max={item.remainingQuantity}
            clampBehavior="strict"
            allowDecimal={false}
            allowNegative={false}
            w={110}
          />
          <Button type="submit" disabled={quantity === '' || receive.isPending} loading={receive.isPending}>
            Receive
          </Button>
        </Group>
        {receive.error && (
          <Text c="red" size="sm">
            {errorMessage(receive.error)}
          </Text>
        )}
      </Stack>
    </form>
  );
}
