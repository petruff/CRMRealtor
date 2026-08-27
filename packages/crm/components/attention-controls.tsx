'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Clock3, Eye } from 'lucide-react';
import {
  transitionAttentionAction,
  type AttentionActionState,
} from '@/app/alerts/actions';
import type { AttentionItem } from '@/lib/domain/attention';

function SubmitButton({
  label,
  pendingLabel,
  icon,
  value,
}: {
  readonly label: string;
  readonly pendingLabel: string;
  readonly icon: React.ReactNode;
  readonly value: 'acknowledge' | 'snooze' | 'complete';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="transition"
      value={value}
      disabled={pending}
      className="sk-secondary-button text-xs"
    >
      {icon}{pending ? pendingLabel : label}
    </button>
  );
}

export function AttentionControls({ item }: { readonly item: AttentionItem }) {
  const initialState: AttentionActionState = { status: 'idle' };
  const [state, action] = useActionState(transitionAttentionAction, initialState);
  const keyBase = `attention:${item.id}:${item.version}`;
  return (
    <form action={action} className="mt-3 border-t border-current/10 pt-3">
      <input type="hidden" name="attentionId" value={item.id} />
      <input type="hidden" name="expectedVersion" value={item.version} />
      <input type="hidden" name="idempotencyKey" value={keyBase} />
      <div className="flex flex-wrap gap-2" aria-label="Priority actions">
        {item.state === 'open' ? (
          <SubmitButton label="I'm on it" pendingLabel="Saving…" value="acknowledge" icon={<Eye className="size-3.5" aria-hidden />} />
        ) : null}
        <SubmitButton label="Tomorrow" pendingLabel="Saving…" value="snooze" icon={<Clock3 className="size-3.5" aria-hidden />} />
        <SubmitButton label="Done" pendingLabel="Saving…" value="complete" icon={<Check className="size-3.5" aria-hidden />} />
      </div>
      {state.message ? (
        <p role={state.status === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${state.status === 'error' ? 'text-hot' : 'text-muted'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
