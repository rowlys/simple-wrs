import { Anchor, Badge, SimpleGrid, Stack, Table, TextInput, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { listTransactions } from '../api/endpoints';
import { ErrorAlert } from '../components/ErrorAlert';
import { Pagination, usePage } from '../components/Pagination';
import { DocumentSelect, ProductSelect } from '../components/SearchSelect';
import { formatDateTime } from '../format';

// D-31: the date filters are calendar days in the browser's time zone (A-10), both inclusive. The API takes
// offset date-times with `to` exclusive (D-25), so `to` is the start of the day after the last chosen day.
// setFullYear, not new Date(y, m, d), which reads years 0–99 as 19xx; undefined for a year Date cannot hold.
const startOfLocalDay = (date: string, addDays = 0): string | undefined => {
  const [year, month, day] = date.split('-').map(Number);
  const start = new Date(0);
  start.setFullYear(year, month - 1, day + addDays);
  start.setHours(0, 0, 0, 0);
  return Number.isNaN(start.getTime()) ? undefined : start.toISOString();
};

// FR-41: the ledger, newest first, by product, receiving document and date range.
export function TransactionsPage() {
  const [productId, setProductId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const filters = {
    productId: productId ?? undefined,
    receivingDocumentId: documentId ?? undefined,
    from: fromDate ? startOfLocalDay(fromDate) : undefined,
    to: toDate ? startOfLocalDay(toDate, 1) : undefined,
  };
  const [page, setPage] = usePage(filters);
  // The API answers a reversed range with an empty page (D-25); say why instead.
  const reversed = Boolean(fromDate && toDate && fromDate > toDate);

  const transactions = useQuery({
    queryKey: ['transactions', { ...filters, page }],
    queryFn: () => listTransactions({ ...filters, page }),
    placeholderData: keepPreviousData,
    enabled: !reversed,
  });

  return (
    <Stack>
      <Title order={2}>Inventory transactions</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <ProductSelect label="Product" placeholder="All products" value={productId} onChange={setProductId} clearable />
        <DocumentSelect label="Receiving document" placeholder="All documents" value={documentId} onChange={setDocumentId} clearable />
        <TextInput label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.currentTarget.value)} />
        <TextInput
          label="To"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.currentTarget.value)}
          error={reversed && 'To must be on or after From'}
        />
      </SimpleGrid>
      <ErrorAlert error={transactions.error} />
      <Table.ScrollContainer minWidth={800}>
        <Table striped opacity={transactions.isPlaceholderData ? 0.5 : 1}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date / time</Table.Th>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Product</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th ta="right">Change</Table.Th>
              <Table.Th ta="right">Balance after</Table.Th>
              <Table.Th>Document</Table.Th>
              <Table.Th>By</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {transactions.data?.data.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{formatDateTime(t.createdAt)}</Table.Td>
                <Table.Td ff="monospace">{t.product.sku}</Table.Td>
                <Table.Td>{t.product.name}</Table.Td>
                <Table.Td>
                  {t.type === 'RECEIPT' ? <Badge color="green">Receipt</Badge> : <Badge color="red">Reversal</Badge>}
                </Table.Td>
                <Table.Td ta="right">{t.quantityChange > 0 ? `+${t.quantityChange}` : `−${-t.quantityChange}`}</Table.Td>
                <Table.Td ta="right">{t.balanceAfter}</Table.Td>
                <Table.Td>
                  {t.receivingDocument && (
                    <Anchor component={Link} to={`/receiving/${t.receivingDocument.id}`} ff="monospace">
                      {t.receivingDocument.documentNumber}
                    </Anchor>
                  )}
                </Table.Td>
                <Table.Td>{t.createdBy.fullName}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Pagination meta={transactions.data?.meta} onChange={setPage} />
    </Stack>
  );
}
