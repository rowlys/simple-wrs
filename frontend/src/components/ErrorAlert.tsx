import { Alert, List } from '@mantine/core';
import { ApiError } from '../api/client';

/** NFR-06: shows the API's plain-language message, and for VALIDATION_ERROR each field's message. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
  const fields =
    error instanceof ApiError && error.code === 'VALIDATION_ERROR'
      ? ((error.details?.fields as { field: string; message: string }[] | undefined) ?? [])
      : [];
  return (
    <Alert color="red" title={message}>
      {fields.length > 0 && (
        <List size="sm">
          {fields.map(({ field, message }) => (
            <List.Item key={field + message}>{message}</List.Item>
          ))}
        </List>
      )}
    </Alert>
  );
}
