import { Group, Pagination as MantinePagination, Text } from '@mantine/core';
import { useState } from 'react';
import type { PageMeta } from '../api/types';

/** Total and page buttons under a list (spec §4.4 meta). */
export function Pagination({ meta, onChange }: { meta: PageMeta | undefined; onChange: (page: number) => void }) {
  if (!meta) return null;
  return (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">
        {meta.totalItems} {meta.totalItems === 1 ? 'item' : 'items'}
      </Text>
      {meta.totalPages > 1 && <MantinePagination total={meta.totalPages} value={meta.page} onChange={onChange} />}
    </Group>
  );
}

/** The page number of a list; back to 1 as soon as the (debounced) filters it was chosen for change. */
export function usePage(filters: unknown): [number, (page: number) => void] {
  const key = JSON.stringify(filters);
  const [chosen, setChosen] = useState({ key, page: 1 });
  return [chosen.key === key ? chosen.page : 1, (page) => setChosen({ key, page })];
}
