import { Button, Modal, Stack, Textarea } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useDocumentMutation } from '../api/query-client';
import type { ReceivingDocumentDetail } from '../api/types';
import { ErrorAlert } from './ErrorAlert';

interface Props {
  title: string;
  confirmLabel: string;
  /** Sends the reason; resolves with the updated document. */
  submit: (reason: string) => Promise<ReceivingDocumentDetail>;
  onClose: () => void;
}

/** Asks for the mandatory reason of a cancel, close short or reversal (BR-15, BR-17: 3–500 characters). */
export function ReasonModal({ title, confirmLabel, submit, onClose }: Props) {
  const [reason, setReason] = useState('');
  const mutation = useDocumentMutation(() => submit(reason), { onSuccess: onClose });

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(undefined);
  };

  return (
    <Modal opened onClose={onClose} title={title}>
      <form onSubmit={confirm}>
        <Stack>
          <ErrorAlert error={mutation.error} />
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} required minLength={3} maxLength={500} autosize minRows={2} data-autofocus />
          <Button type="submit" color="red" loading={mutation.isPending}>
            {confirmLabel}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
