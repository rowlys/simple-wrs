import { Alert, Anchor, Badge, Button, Group, Loader, NumberInput, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { addItem, getDocument, removeItem, reverseReceipt, updateItem } from '../api/endpoints';
import { useDocumentMutation } from '../api/query-client';
import type { Receipt, ReceivingDocumentDetail, ReceivingItem, UserRef } from '../api/types';
import { useCurrentUser } from '../auth/AuthProvider';
import { canOnDocument } from '../auth/permissions';
import { DocumentActions } from '../components/DocumentActions';
import { ErrorAlert, errorMessage } from '../components/ErrorAlert';
import { ProductSelect } from '../components/ProductSelect';
import { ReasonModal } from '../components/ReasonModal';
import { ReceiveForm } from '../components/ReceiveForm';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../format';

// FR-23: header, status history, lines and receipts of one document.
export function DocumentDetailPage() {
  const { id } = useParams() as { id: string };
  const document = useQuery({ queryKey: ['document', id], queryFn: () => getDocument(id) });

  if (!document.data) return document.error ? <ErrorAlert error={document.error} /> : <Loader />;
  const d = document.data;

  return (
    <Stack>
      <Anchor component={Link} to="/receiving" size="sm">
        ← Receiving documents
      </Anchor>
      {/* A failed refresh keeps the last loaded copy on screen */}
      <ErrorAlert error={document.error} />
      <Group justify="space-between">
        <Group>
          <Title order={2} ff="monospace">
            {d.documentNumber}
          </Title>
          <StatusBadge status={d.status} />
        </Group>
        <DocumentActions document={d} />
      </Group>
      {d.status === 'IN_PROGRESS' && d.allItemsReceived && <Alert color="green">All items received — ready to complete</Alert>}
      <Header document={d} />
      <Group justify="space-between">
        <Title order={4}>Lines</Title>
        {/* FR-34: document level */}
        <Text size="sm" c="dimmed">
          {d.items.filter((i) => i.isFullyReceived).length} of {d.items.length} lines fully received
        </Text>
      </Group>
      <Lines document={d} />
      <Title order={4}>Receipts</Title>
      <Receipts document={d} />
    </Stack>
  );
}

const by = (at: string | null, user: UserRef | null) => (at ? `${formatDateTime(at)} by ${user?.fullName ?? '—'}` : null);

function Header({ document: d }: { document: ReceivingDocumentDetail }) {
  const fields: [string, ReactNode][] = [
    ['Supplier', d.supplierName],
    ['Reference number', d.referenceNumber],
    ['Expected date', d.expectedDate],
    ['Notes', d.notes],
    ['Created', by(d.createdAt, d.createdBy)],
    ['Opened', by(d.openedAt, d.openedBy)],
    ['Completed', by(d.completedAt, d.completedBy)],
    ['Closed short', d.closedShortAt && `${by(d.closedShortAt, d.closedShortBy)}: ${d.closeShortReason}`],
    ['Cancelled', d.cancelledAt && `${by(d.cancelledAt, d.cancelledBy)}: ${d.cancelReason}`],
  ];
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
      {fields
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text size="sm">{value}</Text>
          </div>
        ))}
    </SimpleGrid>
  );
}

function Lines({ document: d }: { document: ReceivingDocumentDetail }) {
  const { role } = useCurrentUser();
  const canEdit = canOnDocument(role, 'EDIT_ITEMS', d.status);
  const canReceive = canOnDocument(role, 'RECEIVE', d.status);
  const short = d.status === 'CLOSED_SHORT';

  return (
    <>
      <Table.ScrollContainer minWidth={720}>
        <Table aria-label="Lines" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Product</Table.Th>
              <Table.Th>Unit</Table.Th>
              <Table.Th ta="right">Expected</Table.Th>
              <Table.Th ta="right">Received</Table.Th>
              {/* FR-35: once closed short, what is left is the shortage */}
              <Table.Th ta="right">{short ? 'Shortage' : 'Remaining'}</Table.Th>
              <Table.Th />
              {(canEdit || canReceive) && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td ff="monospace">{item.product.sku}</Table.Td>
                <Table.Td>{item.product.name}</Table.Td>
                <Table.Td>{item.product.unitOfMeasure}</Table.Td>
                <Table.Td ta="right">{canEdit ? <ExpectedQuantityForm documentId={d.id} item={item} /> : item.expectedQuantity}</Table.Td>
                <Table.Td ta="right">{item.receivedQuantity}</Table.Td>
                <Table.Td ta="right">{item.remainingQuantity}</Table.Td>
                <Table.Td>
                  {item.isFullyReceived && <Badge color="green">Fully received</Badge>}
                  {short && !item.isFullyReceived && <Badge color="orange">Short</Badge>}
                </Table.Td>
                {canEdit && (
                  <Table.Td>
                    <RemoveLineButton documentId={d.id} item={item} />
                  </Table.Td>
                )}
                {canReceive && <Table.Td>{!item.isFullyReceived && <ReceiveForm documentId={d.id} item={item} />}</Table.Td>}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {d.items.length === 0 && (
        <Text size="sm" c="dimmed">
          No lines yet{canEdit ? '; add at least one before opening the document.' : '.'}
        </Text>
      )}
      {canEdit && <AddLineForm documentId={d.id} />}
    </>
  );
}

const notifyError = (error: Error) => notifications.show({ color: 'red', message: errorMessage(error) });

function ExpectedQuantityForm({ documentId, item }: { documentId: string; item: ReceivingItem }) {
  const [quantity, setQuantity] = useState<number | ''>(item.expectedQuantity);
  const update = useDocumentMutation((q: number) => updateItem(documentId, item.id, q), { onError: notifyError });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (quantity !== '') update.mutate(quantity);
  };
  return (
    <form onSubmit={submit}>
      <Group gap="xs" justify="end" wrap="nowrap">
        <NumberInput
          aria-label={`Expected quantity for ${item.product.sku}`}
          value={quantity}
          onChange={(v) => setQuantity(typeof v === 'number' ? v : '')}
          min={1}
          max={1_000_000}
          allowDecimal={false}
          allowNegative={false}
          w={110}
        />
        <Button type="submit" variant="default" size="xs" disabled={quantity === '' || quantity === item.expectedQuantity} loading={update.isPending}>
          Save
        </Button>
      </Group>
    </form>
  );
}

function RemoveLineButton({ documentId, item }: { documentId: string; item: ReceivingItem }) {
  // 204: no document comes back, so the detail is refetched with the rest.
  const remove = useDocumentMutation(() => removeItem(documentId, item.id), { onError: notifyError });
  return (
    <Button variant="subtle" color="red" size="xs" onClick={() => remove.mutate(undefined)} loading={remove.isPending}>
      Remove
    </Button>
  );
}

function AddLineForm({ documentId }: { documentId: string }) {
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const add = useDocumentMutation(() => addItem(documentId, productId!, quantity as number), {
    onSuccess: () => {
      setProductId(null);
      setQuantity('');
    },
    onError: notifyError,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (productId && quantity !== '') add.mutate(undefined);
  };
  return (
    <form onSubmit={submit}>
      <Group align="end" wrap="nowrap">
        <ProductSelect label="Product" value={productId} onChange={setProductId} style={{ flex: 1 }} />
        <NumberInput label="Expected quantity" value={quantity} onChange={(v) => setQuantity(typeof v === 'number' ? v : '')} min={1} max={1_000_000} allowDecimal={false} allowNegative={false} w={160} />
        <Button type="submit" variant="default" disabled={!productId || quantity === ''} loading={add.isPending}>
          Add line
        </Button>
      </Group>
    </form>
  );
}

function Receipts({ document: d }: { document: ReceivingDocumentDetail }) {
  const { role } = useCurrentUser();
  const canReverse = canOnDocument(role, 'REVERSE', d.status);
  const [reversing, setReversing] = useState<Receipt | null>(null);

  if (d.receipts.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No receipts yet.
      </Text>
    );
  }
  return (
    <>
      <Table.ScrollContainer minWidth={720}>
        <Table aria-label="Receipts" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Received</Table.Th>
              <Table.Th>SKU</Table.Th>
              <Table.Th ta="right">Quantity</Table.Th>
              <Table.Th>Received by</Table.Th>
              <Table.Th>Reversal</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.receipts.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{formatDateTime(r.receivedAt)}</Table.Td>
                <Table.Td ff="monospace">{r.productSku}</Table.Td>
                <Table.Td ta="right" td={r.reversal ? 'line-through' : undefined}>
                  {r.quantity}
                </Table.Td>
                <Table.Td>{r.receivedBy.fullName}</Table.Td>
                <Table.Td>
                  {r.reversal ? (
                    <Text size="sm">
                      Reversed {by(r.reversal.reversedAt, r.reversal.reversedBy)}: {r.reversal.reason}
                    </Text>
                  ) : (
                    canReverse && (
                      <Button variant="subtle" color="red" size="xs" onClick={() => setReversing(r)}>
                        Reverse
                      </Button>
                    )
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {reversing && (
        // FR-36: whole receipt only; the reason is mandatory (BR-17).
        <ReasonModal
          title={`Reverse the receipt of ${reversing.quantity} × ${reversing.productSku}`}
          confirmLabel="Reverse receipt"
          submit={(reason) => reverseReceipt(d.id, reversing.id, reason)}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}
