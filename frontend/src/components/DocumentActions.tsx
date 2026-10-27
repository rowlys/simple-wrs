import { Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { cancelDocument, closeShortDocument, completeDocument, openDocument } from '../api/endpoints';
import { useDocumentMutation } from '../api/query-client';
import type { ReceivingDocumentDetail } from '../api/types';
import { useCurrentUser } from '../auth/AuthProvider';
import { canOnDocument, type DocumentAction } from '../auth/permissions';
import { errorMessage } from './ErrorAlert';
import { ReasonModal } from './ReasonModal';

/**
 * The status changes of PRD §9 the current user may trigger now (FR-04). D-30: Complete is offered on every
 * IN_PROGRESS document (A-06: it can be attempted and is blocked, naming the lines still open); Close short is
 * hidden once every line is fully received, where it can only fail with NOTHING_SHORT.
 */
export function DocumentActions({ document }: { document: ReceivingDocumentDetail }) {
  const { role } = useCurrentUser();
  const [asking, setAsking] = useState<'close-short' | 'cancel' | null>(null);
  const allowed = (action: DocumentAction) => canOnDocument(role, action, document.status);

  const transition = useDocumentMutation((send: (id: string) => Promise<ReceivingDocumentDetail>) => send(document.id), {
    onError: (error) => notifications.show({ color: 'red', message: errorMessage(error) }),
  });

  return (
    <Group>
      {allowed('OPEN') && (
        <Button onClick={() => transition.mutate(openDocument)} loading={transition.isPending}>
          Open for receiving
        </Button>
      )}
      {allowed('COMPLETE') && (
        <Button color="green" onClick={() => transition.mutate(completeDocument)} loading={transition.isPending}>
          Complete
        </Button>
      )}
      {allowed('CLOSE_SHORT') && !document.allItemsReceived && (
        <Button variant="default" onClick={() => setAsking('close-short')}>
          Close short
        </Button>
      )}
      {allowed('CANCEL') && (
        <Button variant="default" color="red" onClick={() => setAsking('cancel')}>
          Cancel document
        </Button>
      )}
      {asking === 'close-short' && (
        <ReasonModal
          title={`Close ${document.documentNumber} short`}
          confirmLabel="Close short"
          submit={(reason) => closeShortDocument(document.id, reason)}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === 'cancel' && (
        <ReasonModal
          title={`Cancel ${document.documentNumber}`}
          confirmLabel="Cancel document"
          submit={(reason) => cancelDocument(document.id, reason)}
          onClose={() => setAsking(null)}
        />
      )}
    </Group>
  );
}
