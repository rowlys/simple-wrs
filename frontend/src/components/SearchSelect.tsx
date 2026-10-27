import { Select, type ComboboxItem, type SelectProps } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listDocuments, listProducts } from '../api/endpoints';

type Props = Omit<SelectProps, 'data' | 'value' | 'onChange' | 'searchable' | 'searchValue' | 'onSearchChange'> & {
  value: string | null;
  onChange: (id: string | null) => void;
};

/** A select whose options are searched on the server (lists can be large, NFR-04). */
function SearchSelect({ value, onChange, optionsKey, load, ...props }: Props & { optionsKey: string; load: (search: string) => Promise<ComboboxItem[]> }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ComboboxItem | null>(null);
  const selected = value === null ? null : picked; // the parent cleared the value, e.g. after adding a line
  // After a pick the input shows the option's label; that is not a search.
  const [query] = useDebouncedValue(search === selected?.label ? '' : search, 300);

  const options = useQuery({ queryKey: [optionsKey, query], queryFn: () => load(query), placeholderData: keepPreviousData }).data ?? [];
  // Keep the chosen option selectable when a later search no longer returns it.
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
    />
  );
}

export const ProductSelect = (props: Props) => (
  <SearchSelect
    {...props}
    optionsKey="product-options"
    load={(search) => listProducts({ search }).then((page) => page.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })))}
    nothingFoundMessage="No products found"
  />
);

export const DocumentSelect = (props: Props) => (
  <SearchSelect
    {...props}
    optionsKey="document-options"
    load={(search) => listDocuments({ search }).then((page) => page.data.map((d) => ({ value: d.id, label: `${d.documentNumber} — ${d.supplierName}` })))}
    nothingFoundMessage="No documents found"
  />
);
