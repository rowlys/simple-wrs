import { Select, type ComboboxItem, type SelectProps } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listProducts } from '../api/endpoints';

type Props = Omit<SelectProps, 'data' | 'value' | 'onChange' | 'searchable' | 'searchValue' | 'onSearchChange'> & {
  value: string | null;
  onChange: (productId: string | null) => void;
};

/** Picks a product by SKU or name, searching on the server (the catalogue can be large, NFR-04). */
export function ProductSelect({ value, onChange, ...props }: Props) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ComboboxItem | null>(null);
  const selected = value === null ? null : picked; // the parent cleared the value, e.g. after adding a line
  // After a pick the input shows the option's label; that is not a search.
  const [query] = useDebouncedValue(search === selected?.label ? '' : search, 300);

  const products = useQuery({
    queryKey: ['product-options', query],
    queryFn: () => listProducts({ search: query }),
    placeholderData: keepPreviousData,
  });
  const options = products.data?.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })) ?? [];
  // Keep the chosen product selectable when a later search no longer returns it.
  const data = selected && !options.some((o) => o.value === selected.value) ? [selected, ...options] : options;

  return (
    <Select
      {...props}
      data={data}
      value={value}
      onChange={(id, option) => {
        setPicked(id ? option : null);
        onChange(id);
      }}
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options} // already filtered by the server
      nothingFoundMessage="No products found"
    />
  );
}
