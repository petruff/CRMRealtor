'use client';

import { useActionState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { INITIAL_AI_SETTINGS_ACTION_STATE } from '@/app/settings/action-state';
import {
  removeGeminiSettingsAction,
  saveGeminiSettingsAction,
  toggleGeminiSettingsAction,
} from '@/app/settings/actions';
import type { WorkspaceAiStatus } from '@/lib/application/workspace-ai-settings';

export function AiSettingsForm({ status }: { status: WorkspaceAiStatus }) {
  const [saveState, saveAction, saving] = useActionState(saveGeminiSettingsAction, INITIAL_AI_SETTINGS_ACTION_STATE);
  const [removeState, removeAction, removing] = useActionState(removeGeminiSettingsAction, INITIAL_AI_SETTINGS_ACTION_STATE);
  const [toggleState, toggleAction, toggling] = useActionState(toggleGeminiSettingsAction, INITIAL_AI_SETTINGS_ACTION_STATE);
  const feedback = saveState.status !== 'idle' ? saveState : removeState.status !== 'idle' ? removeState : toggleState;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
      <form action={saveAction} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <input type="hidden" name="expectedSecretVersion" value={status.secretVersion} />
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent"><KeyRound className="size-5" aria-hidden /></span>
          <div><h2 className="font-display text-2xl text-ink">Omnix AI provider</h2><p className="mt-1 text-sm leading-relaxed text-muted">Choose Gemini or Claude. The key is tested with a non-customer prompt, encrypted on the server and never displayed again.</p></div>
        </div>
        <div className="mt-6 grid gap-5">
          <label className="grid gap-2 text-sm font-medium text-ink">API key
            <input className="min-h-11 rounded-lg border border-control bg-canvas px-3 text-ink outline-none focus:ring-3 focus:ring-focus" name="apiKey" type="password" autoComplete="new-password" required minLength={20} maxLength={256} placeholder={status.configured ? 'Enter a new key to rotate the current key' : 'Paste the provider API key'} />
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">Provider
            <select className="min-h-11 rounded-lg border border-control bg-canvas px-3 text-ink outline-none focus:ring-3 focus:ring-focus" name="provider" defaultValue={status.provider ?? 'google-gemini'}>
              <option value="google-gemini">Google Gemini</option><option value="anthropic-claude">Anthropic Claude</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">Model
            <select className="min-h-11 rounded-lg border border-control bg-canvas px-3 text-ink outline-none focus:ring-3 focus:ring-focus" name="model" defaultValue={status.model}>
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite · recommended</option>
              <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4 · recommended Claude</option>
              <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku · lower cost</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 text-sm text-ink">
            <input name="enabled" type="checkbox" defaultChecked={status.enabled || !status.configured} className="size-4 accent-[var(--sk-accent)]" />
            Enable conversational routing after validation
          </label>
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-muted"><strong className="text-ink">Paid API confirmation.</strong> Claude.ai subscriptions do not include Anthropic API usage. Omnix sends only the question for routing; CRM records and responses remain inside Omnix.</div>
          <button className="sk-primary-button w-fit" type="submit" disabled={saving}>{saving ? 'Validating…' : status.configured ? 'Validate and rotate key' : 'Validate and save key'}</button>
        </div>
      </form>
      <aside className="space-y-4">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-ink"><ShieldCheck className="size-5 text-accent" aria-hidden /><h2 className="font-semibold">Security status</h2></div>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Key</dt><dd className="font-medium text-ink">{status.configured ? `•••• ${status.keyFingerprint}` : 'Not configured'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Provider</dt><dd className="font-medium text-ink">{status.provider === 'anthropic-claude' ? 'Anthropic Claude' : 'Google Gemini'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Routing</dt><dd className="font-medium text-ink">{status.enabled ? 'Enabled' : 'Disabled'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Storage</dt><dd className="font-medium text-ink">Envelope encrypted</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Policy</dt><dd className="font-medium text-ink">Paid-private</dd></div>
          </dl>
        </div>
        {status.configured ? <form action={removeAction} className="rounded-2xl border border-line bg-surface p-5">
          <input type="hidden" name="expectedSecretVersion" value={status.secretVersion} />
          <h2 className="font-semibold text-ink">Remove AI key</h2><p className="mt-2 text-sm leading-relaxed text-muted">Cryptoshreds the stored key and returns Omnix to deterministic questions only.</p>
          <button type="submit" disabled={removing} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-hot px-4 text-sm font-medium text-hot"><Trash2 className="size-4" aria-hidden />{removing ? 'Removing…' : 'Remove key'}</button>
        </form> : null}
        {status.configured ? <form action={toggleAction} className="rounded-2xl border border-line bg-surface p-5">
          <input type="hidden" name="expectedSecretVersion" value={status.secretVersion} />
          <input type="hidden" name="nextEnabled" value={String(!status.enabled)} />
          <h2 className="font-semibold text-ink">Conversational routing</h2><p className="mt-2 text-sm leading-relaxed text-muted">Temporarily {status.enabled ? 'disable' : 'enable'} the configured provider without replacing the encrypted key.</p>
          <button type="submit" disabled={toggling} className="sk-secondary-button mt-4">{toggling ? 'Updating…' : status.enabled ? 'Disable routing' : 'Enable routing'}</button>
        </form> : null}
      </aside>
      {feedback.status !== 'idle' ? <p className={`lg:col-span-2 rounded-xl p-4 text-sm ${feedback.status === 'error' ? 'bg-hot-soft text-hot' : 'bg-accent-soft text-ink'}`} role={feedback.status === 'error' ? 'alert' : 'status'}>{feedback.message}</p> : null}
    </div>
  );
}
