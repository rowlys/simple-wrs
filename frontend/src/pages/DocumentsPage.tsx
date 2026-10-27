import { Anchor, Button, Group, Select, Stack, Table, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { listDocuments } from '../api/endpoints';
import type { ReceivingStatus } from '../api/types';
import { useCurrentUser } from '../auth/AuthProvider';
import { can } from '../auth/permissions';
import { ErrorAlert } from '../components/ErrorAlert';
import { Pagination, usePage } from '../components/Pagination';
import { STATUS_LABELS, StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../format';

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

// FR-20: newest first, filter by status, search by number, supplier or reference.
export function DocumentsPage() {
  const user = useCurrentUser();
  const [status, setStatus] = useState<ReceivingStatus | undefined>();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const filters = { status, search: debouncedSearch };
  const [page, setPage] = usePage(filters);

  const documents = useQuery({
    queryKey: ['documents', { ...filters, page }],
    queryFn: () => listDocuments({ ...filters, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Receiving documents</Title>
        {can(user.role, 'CREATE_DOCUMENT') && (
          <Button component={Link} to="/receiving/new">
            New document
          </Button>
        )}
      </Group>
      <Group grow align="end">
        <Select
          label="Status"
          placeholder="All statuses"
          data={STATUS_OPTIONS}
          value={status ?? null}
          onChange={(value) => setStatus((value as ReceivingStatus | null) ?? undefined)}
          clearable
        />
        <TextInput
          label="Search"
          placeholder="Search number, supplier or reference"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          maxLength={100}
        />
      </Group>
      <ErrorAlert error={documents.error} />
      <Table.ScrollContainer minWidth={720}>
        <Table striped highlightOnHover opacity={documents.isPlaceholderData ? 0.5 : 1}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Number</Table.Th>
              <Table.Th>Supplier</Table.Th>
              <Table.Th>Reference</Table.Th>
              <Table.Th>Expected</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th ta="right">Lines</Table.Th>
              <Table.Th ta="right">Received / expected</Table.Th>
              <Table.Th>Created</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {documents.data?.data.map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/receiving/${d.id}`} ff="monospace">
                    {d.documentNumber}
                  </Anchor>
                </Table.Td>
                <Table.Td>{d.supplierName}</Table.Td>
                <Table.Td>{d.referenceNumber}</Table.Td>
                <Table.Td>{d.expectedDate}</Table.Td>
                <Table.Td>
                  <StatusBadge status={d.status} />
                </Table.Td>
                <Table.Td ta="right">{d.itemCount}</Table.Td>
                <Table.Td ta="right">
                  {d.totalReceivedQuantity} / {d.totalExpectedQuantity}
                </Table.Td>
                <Table.Td>{formatDateTime(d.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Pagination meta={documents.data?.meta} onChange={setPage} />
    </Stack>
  );
}
