'use client';

import { useFormStatus } from 'react-dom';
import { CheckCircle2, Undo2 } from 'lucide-react';

function UndoButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ox-undo-button" disabled={pending}>
      <Undo2 className="size-4" aria-hidden /> {pending ? 'Restoring…' : 'Undo'}
    </button>
  );
}

/** Confirmation after an archive with a one-tap way back. */
export function UndoArchiveNotice({ message, contactId, returnContext, action }: {
  message: string;
  contactId: string;
  returnContext?: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <div role="status" className="ox-undo-notice">
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{message}</p>
      <form action={action}>
        <input type="hidden" name="contactId" value={contactId} />
        {returnContext ? <input type="hidden" name="returnContext" value={returnContext} /> : null}
        <UndoButton />
      </form>
    </div>
  );
}
