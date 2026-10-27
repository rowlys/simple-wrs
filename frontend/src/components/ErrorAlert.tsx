import { Alert, List } from '@mantine/core';
import { ApiError } from '../api/client';

/** NFR-06: the API's plain-language message (OpenAPI ErrorResponse), or a generic one. */
export const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Try again.';

/** NFR-06: shows the API's message, and for VALIDATION_ERROR each field's message. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const fields =
    error instanceof ApiError && error.code === 'VALIDATION_ERROR'
      ? ((error.details?.fields as { field: string; message: string }[] | undefined) ?? [])
      : [];
  return (
    <Alert color="red" title={errorMessage(error)}>
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
