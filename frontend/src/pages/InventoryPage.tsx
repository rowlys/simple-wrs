import { Stack, Table, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listInventory } from '../api/endpoints';
import { ErrorAlert } from '../components/ErrorAlert';
import { Pagination, usePage } from '../components/Pagination';
import { formatDateTime } from '../format';

// FR-40: current stock per product, sorted by SKU on the server.
export function InventoryPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [page, setPage] = usePage(debouncedSearch);

  const inventory = useQuery({
    queryKey: ['inventory', { search: debouncedSearch, page }],
    queryFn: () => listInventory({ search: debouncedSearch, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <Stack>
      <Title order={2}>Inventory</Title>
      <TextInput placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.currentTarget.value)} maxLength={100} />
      <ErrorAlert error={inventory.error} />
      <Table.ScrollContainer minWidth={600}>
        <Table striped opacity={inventory.isPlaceholderData ? 0.5 : 1}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Unit</Table.Th>
              <Table.Th ta="right">On hand</Table.Th>
              <Table.Th>Last updated</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {inventory.data?.data.map((b) => (
              <Table.Tr key={b.productId}>
                <Table.Td ff="monospace">{b.sku}</Table.Td>
                <Table.Td>{b.name}</Table.Td>
                <Table.Td>{b.unitOfMeasure}</Table.Td>
                <Table.Td ta="right">{b.quantityOnHand}</Table.Td>
                <Table.Td>{formatDateTime(b.updatedAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Pagination meta={inventory.data?.meta} onChange={setPage} />
    </Stack>
  );
}
