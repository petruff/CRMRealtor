'use client';

import { useActionState } from 'react';
import { ChevronDown, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { INITIAL_AI_SETTINGS_ACTION_STATE } from '@/app/settings/action-state';
import {
  removeGeminiSettingsAction,
  saveGeminiSettingsAction,
  toggleGeminiSettingsAction,
} from '@/app/settings/actions';
import type { WorkspaceAiStatus, WorkspaceAiUsageStatus } from '@/lib/application/workspace-ai-settings';

function usdFromMicrousd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(value / 1_000_000);
}

export function AiSettingsForm({ status, usage }: { status: WorkspaceAiStatus; usage?: WorkspaceAiUsageStatus }) {
  const [saveState, saveAction, saving] = useActionState(saveGeminiSettingsAction, INITIAL_AI_SETTINGS_ACTION_STATE);
  const [removeState, removeAction, removing] = useActionState(removeGeminiSettingsAction, INITIAL_AI_SETTINGS_ACTION_STATE);
  const [toggleState, toggleAction, toggling] = useActionState(toggleGeminiSettingsAction, INITIAL_AI_SETTINGS_ACTION_STATE);
  const feedback = saveState.status !== 'idle' ? saveState : removeState.status !== 'idle' ? removeState : toggleState;
  return (
    <div id="ai" className="scroll-mt-24 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
      <form action={saveAction} className="min-w-0 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <input type="hidden" name="expectedSecretVersion" value={status.secretVersion} />
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent"><KeyRound className="size-5" aria-hidden /></span>
          <div><h2 className="font-display text-2xl text-ink">Omnix AI provider</h2><p className="mt-1 text-sm leading-relaxed text-muted">Choose Gemini or Claude. The key is tested with a non-customer prompt, encrypted on the server and never displayed again.</p></div>
        </div>
        <div className="mt-6 grid gap-5">
          <label className="grid min-w-0 gap-2 text-sm font-medium text-ink">API key
            <input className="sk-input ai-settings-control" name="apiKey" type="password" autoComplete="new-password" required minLength={20} maxLength={256} placeholder={status.configured ? 'Enter a new key to rotate the current key' : 'Paste the provider API key'} />
          </label>
          <div className="min-w-0">
            <div className="grid gap-4 sm:gap-5 md:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] lg:grid-cols-1">
              <label className="grid min-w-0 gap-2 text-sm font-medium text-ink">Provider
                <span className="relative block min-w-0">
                  <select className="sk-input ai-settings-control ai-settings-select" name="provider" defaultValue={status.provider ?? 'google-gemini'} aria-describedby="ai-provider-model-help">
                    <option value="google-gemini">Google Gemini</option><option value="anthropic-claude">Anthropic Claude</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                </span>
              </label>
              <label className="grid min-w-0 gap-2 text-sm font-medium text-ink">Model
                <span className="relative block min-w-0">
                  <select className="sk-input ai-settings-control ai-settings-select" name="model" defaultValue={status.model} aria-describedby="ai-provider-model-help">
                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite · recommended</option>
                    <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                    <option value="claude-sonnet-4-20250514">Claude Sonnet 4 · recommended Claude</option>
                    <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku · lower cost</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                </span>
              </label>
            </div>
            <p id="ai-provider-model-help" className="mt-3 text-xs leading-relaxed text-muted">Choose the provider that issued your key and a matching model.</p>
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 text-sm text-ink">
            <input name="enabled" type="checkbox" defaultChecked={status.enabled || !status.configured} className="size-4 accent-[var(--sk-accent)]" />
            Enable conversational routing after validation
          </label>
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-muted"><strong className="text-ink">Paid API confirmation.</strong> Omnix sends the question and a minimized set of cited CRM facts to the selected paid API. Email addresses, phone numbers, provider credentials, and raw authorization data are excluded. Generated text remains a reviewable draft.</div>
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
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Today’s AI activity</h2>
          {usage ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Runs</dt><dd className="mt-1 text-xl font-semibold text-ink">{usage.runCount}</dd></div>
                <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Committed cost</dt><dd className="mt-1 text-xl font-semibold text-ink">{usdFromMicrousd(usage.committedMicrousd)}</dd></div>
                <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Completed</dt><dd className="mt-1 font-medium text-ink">{usage.succeeded}</dd></div>
                <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Needs attention</dt><dd className="mt-1 font-medium text-ink">{usage.failed + usage.reserved}</dd></div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-muted">Redacted operational receipts only. Omnix does not store prompts or generated responses here.</p>
            </>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted">Usage receipts will appear after the protected Story 5.1 migration is active and the first governed run completes.</p>
          )}
        </div>
        {status.configured ? <form action={removeAction} className="rounded-2xl border border-line bg-surface p-5">
          <input type="hidden" name="expectedSecretVersion" value={status.secretVersion} />
          <h2 className="font-semibold text-ink">Remove AI key</h2><p className="mt-2 text-sm leading-relaxed text-muted">Permanently removes the saved key and returns Omnix to its built-in question set.</p>
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
