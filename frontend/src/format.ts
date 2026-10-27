// A-10: timestamps are stored in UTC and shown in the browser's time zone.
export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
