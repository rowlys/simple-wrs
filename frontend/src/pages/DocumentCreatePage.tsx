import { ActionIcon, Button, Group, NumberInput, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { createDocument } from '../api/endpoints';
import { useDocumentMutation } from '../api/query-client';
import { useCurrentUser } from '../auth/AuthProvider';
import { can } from '../auth/permissions';
import { ErrorAlert } from '../components/ErrorAlert';
import { ProductSelect } from '../components/SearchSelect';

interface Line {
  key: number;
  productId: string | null;
  expectedQuantity: number | '';
}

let nextLineKey = 0; // React keys for the line rows; unique for the page's lifetime

// FR-21: a DRAFT with header fields and optional lines; the server assigns the number (FR-22).
export function DocumentCreatePage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [header, setHeader] = useState({ supplierName: '', referenceNumber: '', expectedDate: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [incomplete, setIncomplete] = useState(false);
  const setField = (field: keyof typeof header) => (e: { currentTarget: { value: string } }) => setHeader({ ...header, [field]: e.currentTarget.value });
  const setLine = (key: number, change: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const create = useDocumentMutation(
    () =>
      createDocument({
        supplierName: header.supplierName,
        referenceNumber: header.referenceNumber || null,
        expectedDate: header.expectedDate || null,
        notes: header.notes || null,
        items: lines.map((l) => ({ productId: l.productId!, expectedQuantity: l.expectedQuantity as number })),
      }),
    { onSuccess: (document) => document && navigate(`/receiving/${document.id}`) },
  );

  if (!can(user.role, 'CREATE_DOCUMENT')) return <Navigate to="/receiving" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const missing = lines.some((l) => !l.productId || l.expectedQuantity === '');
    setIncomplete(missing);
    if (!missing) create.mutate(undefined);
  };

  return (
    <form onSubmit={submit}>
      <Stack maw={720}>
        <Title order={2}>New receiving document</Title>
        <ErrorAlert error={create.error} />
        <TextInput label="Supplier name" value={header.supplierName} onChange={setField('supplierName')} required maxLength={200} />
        <Group grow align="start">
          <TextInput label="Reference number" description="Supplier's delivery note number" value={header.referenceNumber} onChange={setField('referenceNumber')} maxLength={100} />
          <TextInput label="Expected date" type="date" value={header.expectedDate} onChange={setField('expectedDate')} />
        </Group>
        <Textarea label="Notes" value={header.notes} onChange={setField('notes')} maxLength={1000} autosize minRows={2} />

        <Title order={4}>Lines</Title>
        {lines.map((line, index) => (
          <Group key={line.key} align="end" wrap="nowrap">
            <ProductSelect
              label={`Product for line ${index + 1}`}
              value={line.productId}
              onChange={(productId) => setLine(line.key, { productId })}
              style={{ flex: 1 }}
            />
            <NumberInput
              label={`Expected quantity for line ${index + 1}`}
              value={line.expectedQuantity}
              onChange={(v) => setLine(line.key, { expectedQuantity: typeof v === 'number' ? v : '' })}
              min={1}
              max={1_000_000}
              allowDecimal={false}
              allowNegative={false}
              w={180}
            />
            <ActionIcon variant="subtle" color="red" size="lg" mb={4} aria-label={`Remove line ${index + 1}`} onClick={() => setLines(lines.filter((l) => l.key !== line.key))}>
              ✕
            </ActionIcon>
          </Group>
        ))}
        {incomplete && (
          <Text c="red" size="sm">
            Each line needs a product and an expected quantity.
          </Text>
        )}
        <Group>
          <Button variant="default" onClick={() => setLines([...lines, { key: nextLineKey++, productId: null, expectedQuantity: '' }])}>
            Add line
          </Button>
        </Group>
        <Group justify="end">
          <Button type="submit" loading={create.isPending}>
            Create draft
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
