import { Badge } from '@mantine/core';
import type { ReceivingStatus } from '../api/types';

export const STATUS_LABELS: Record<ReceivingStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CLOSED_SHORT: 'Closed short',
  CANCELLED: 'Cancelled',
};

const COLORS: Record<ReceivingStatus, string> = {
  DRAFT: 'gray',
  OPEN: 'blue',
  IN_PROGRESS: 'yellow',
  COMPLETED: 'green',
  CLOSED_SHORT: 'orange',
  CANCELLED: 'red',
};

export function StatusBadge({ status }: { status: ReceivingStatus }) {
  return <Badge color={COLORS[status]}>{STATUS_LABELS[status]}</Badge>;
}
