'use client';

import { useActionState } from 'react';
import { configureWebsiteIntakeAction } from '@/app/data/actions';
import { INITIAL_WEBSITE_INTAKE_ACTION_STATE } from '@/app/data/website-intake-action-state';

export function WebsiteIntakeSetupForm({
  bindingReady,
  isOwner,
  defaults,
}: {
  readonly bindingReady: boolean;
  readonly isOwner: boolean;
  readonly defaults?: {
    readonly displayName: string;
    readonly allowedOrigins: readonly string[];
    readonly rateLimitPerMinute: number;
    readonly responseSlaMinutes: number;
  };
}) {
  const [state, action, pending] = useActionState(configureWebsiteIntakeAction, INITIAL_WEBSITE_INTAKE_ACTION_STATE);
  const enabled = bindingReady && isOwner && !pending;
  return <form action={action} className="mt-5 grid gap-4">
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium text-ink">Connection name
        <input className="sk-input mt-1 w-full" name="displayName" required maxLength={120} defaultValue={defaults?.displayName ?? 'Judith website'} disabled={!isOwner}/>
      </label>
      <label className="text-sm font-medium text-ink">Response target
        <select className="sk-input mt-1 w-full" name="responseSlaMinutes" defaultValue={defaults?.responseSlaMinutes ?? 5} disabled={!isOwner}>
          <option value="5">Within 5 minutes</option><option value="10">Within 10 minutes</option><option value="15">Within 15 minutes</option><option value="30">Within 30 minutes</option><option value="60">Within 1 hour</option>
        </select>
      </label>
    </div>
    <label className="text-sm font-medium text-ink">Approved website address
      <textarea className="sk-input mt-1 min-h-24 w-full resize-y" name="allowedOrigins" required defaultValue={defaults?.allowedOrigins.join('\n') ?? ''} placeholder="https://www.yourwebsite.com" disabled={!isOwner}/>
      <span className="mt-1 block text-xs font-normal text-muted">One HTTPS website origin per line. Paths and form data are not entered here.</span>
    </label>
    <label className="text-sm font-medium text-ink">Safety limit per minute
      <input className="sk-input mt-1 w-full md:max-w-48" type="number" name="rateLimitPerMinute" min={1} max={60} required defaultValue={defaults?.rateLimitPerMinute ?? 20} disabled={!isOwner}/>
    </label>
    {!bindingReady ? <p role="status" className="rounded-xl border border-warm-border bg-warm-soft p-3 text-sm text-warm">Developer setup is not complete yet. No website should send leads until the secure server binding is active.</p> : null}
    {!isOwner ? <p role="status" className="text-sm text-muted">Only the workspace owner can change this connection. You can still review its lead activity below.</p> : null}
    {state.message ? <p role="status" className={`rounded-xl p-3 text-sm ${state.status === 'success' ? 'bg-nurture-soft text-nurture' : 'bg-hot-soft text-hot'}`}>{state.message}</p> : null}
    <button className="sk-button-primary justify-center sm:justify-self-start" disabled={!enabled}>{pending ? 'Saving…' : defaults ? 'Update website connection' : 'Connect website leads'}</button>
  </form>;
}
