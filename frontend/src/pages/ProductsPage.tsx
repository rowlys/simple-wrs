import { Button, Group, Modal, Stack, Table, Textarea, TextInput, Title } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { createProduct, listProducts } from '../api/endpoints';
import { useCurrentUser } from '../auth/AuthProvider';
import { can } from '../auth/permissions';
import { ErrorAlert } from '../components/ErrorAlert';
import { Pagination, usePage } from '../components/Pagination';
import { formatDateTime } from '../format';

// FR-10, FR-11, AC-02.5
export function ProductsPage() {
  const user = useCurrentUser();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [page, setPage] = usePage(debouncedSearch);
  const [creating, { open, close }] = useDisclosure();

  const products = useQuery({
    queryKey: ['products', { search: debouncedSearch, page }],
    queryFn: () => listProducts({ search: debouncedSearch, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Products</Title>
        {can(user.role, 'CREATE_PRODUCT') && <Button onClick={open}>New product</Button>}
      </Group>
      <TextInput
        placeholder="Search SKU or name"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        maxLength={100}
      />
      <ErrorAlert error={products.error} />
      <Table.ScrollContainer minWidth={600}>
        <Table striped opacity={products.isPlaceholderData ? 0.5 : 1}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Unit</Table.Th>
              <Table.Th ta="right">On hand</Table.Th>
              <Table.Th>Created</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {products.data?.data.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td ff="monospace">{p.sku}</Table.Td>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>{p.unitOfMeasure}</Table.Td>
                <Table.Td ta="right">{p.quantityOnHand}</Table.Td>
                <Table.Td>{formatDateTime(p.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Pagination meta={products.data?.meta} onChange={setPage} />
      <Modal opened={creating} onClose={close} title="New product">
        <CreateProductForm onCreated={close} />
      </Modal>
    </Stack>
  );
}

function CreateProductForm({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ sku: '', name: '', unitOfMeasure: '', description: '' });
  const set = (field: keyof typeof form) => (e: { currentTarget: { value: string } }) => setForm({ ...form, [field]: e.currentTarget.value });

  const create = useMutation({
    // The server trims, upper-cases the SKU and turns a blank description into null (BR-01, D-12).
    mutationFn: () => createProduct({ ...form, description: form.description || null }),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] }); // FR-12: the new balance of 0
      notifications.show({ color: 'green', message: `Product ${product.sku} created` });
      onCreated();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <ErrorAlert error={create.error} />
        <TextInput label="SKU" description="Letters, digits and hyphens, e.g. FRZ-CHK-001" value={form.sku} onChange={set('sku')} required minLength={3} maxLength={50} />
        <TextInput label="Name" value={form.name} onChange={set('name')} required maxLength={200} />
        <TextInput label="Unit of measure" description="e.g. PCS, KG, CTN" value={form.unitOfMeasure} onChange={set('unitOfMeasure')} required maxLength={20} />
        <Textarea label="Description" value={form.description} onChange={set('description')} maxLength={1000} autosize minRows={2} />
        <Button type="submit" loading={create.isPending}>
          Create
        </Button>
      </Stack>
    </form>
  );
}
