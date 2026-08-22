import Link from 'next/link';
import type { MailchimpAudience, MailchimpAudienceBinding } from '@/lib/domain/mailchimp';
import {
  approveMailchimpBackfillAction,
  previewMailchimpBackfillAction,
  reconcileMailchimpBaselineAction,
  probeMailchimpConnectionAction,
  selectMailchimpAudienceAction,
  setupMailchimpWebhookAction,
  finishMailchimpSetupAction,
} from '@/app/connections/mailchimp-actions';
import type { MailchimpOutboundBackfillRun } from '@/lib/data/mailchimp-outbound-backfill-repository';
import type { MailchimpAudienceLoadIssue } from '@/app/connections/mailchimp-presentation';
import { mailchimpConnectHref } from '@/app/connections/oauth-presentation';

export function MailchimpAudienceSelector({
  connectionId,
  audiences,
  binding,
  backfillRuns = [],
  loadIssue,
}: {
  readonly connectionId: string;
  readonly audiences: readonly MailchimpAudience[];
  readonly binding?: MailchimpAudienceBinding;
  readonly backfillRuns?: readonly MailchimpOutboundBackfillRun[];
  readonly loadIssue?: MailchimpAudienceLoadIssue;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface-2 p-4" aria-labelledby="mailchimp-audience-heading">
      <h3 id="mailchimp-audience-heading" className="text-sm font-medium text-ink">Mailchimp setup</h3>
      {binding && (
        <p className="mt-1 text-xs text-muted">
          Newsletter audience: <span className="font-medium text-ink">{binding.audienceName}</span>
        </p>
      )}
      {loadIssue && (
        <div className="mt-3 rounded-xl border border-warm-border bg-warm-soft px-3 py-3 text-xs text-warm" role="status">
          <p className="font-medium">{loadIssue.title}</p>
          <p className="mt-1 leading-relaxed">{loadIssue.message}</p>
          {loadIssue.kind === 'reconnect' ? (
            <a href={mailchimpConnectHref(connectionId)} className="sk-button-secondary mt-3 inline-flex">Reconnect Mailchimp</a>
          ) : loadIssue.kind === 'temporary' ? (
            <Link href="/connections#mailchimp-connected" className="sk-button-secondary mt-3 inline-flex">Try again</Link>
          ) : null}
        </div>
      )}
      {!loadIssue && audiences.length > 0 && (
        <>
          <form action={selectMailchimpAudienceAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="connectionId" value={connectionId} />
            <label className="sr-only" htmlFor="mailchimp-audience">Mailchimp audience</label>
            <select id="mailchimp-audience" name="audienceId" className="sk-input min-w-0 flex-1" required defaultValue={binding?.audienceId ?? ''}>
              <option value="" disabled>Select one audience</option>
              {audiences.map((audience) => (
                <option key={audience.id} value={audience.id}>
                  {audience.name}{audience.memberCount === undefined ? '' : ` · ${audience.memberCount} members`}
                </option>
              ))}
            </select>
            <button type="submit" className="sk-button-primary">{binding ? 'Change audience' : 'Use this audience'}</button>
          </form>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Changing the audience starts a fresh contact check. Your CRM history is always kept.
          </p>
        </>
      )}
      {!loadIssue && audiences.length === 0 && !binding && (
        <p className="mt-3 rounded-xl border border-line bg-surface px-3 py-3 text-xs text-muted">
          No newsletter audience was found in this Mailchimp account.
        </p>
      )}
      {binding && (binding.webhookRegistrationRequired || binding.baselineRequired) && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs leading-relaxed text-muted">One last step turns on contact matching and unsubscribe updates automatically.</p>
          <form action={finishMailchimpSetupAction} className="mt-3">
            <input type="hidden" name="connectionId" value={connectionId} />
            <button type="submit" className="sk-button-primary">Finish Mailchimp setup</button>
          </form>
          <details className="mt-3 text-[11px] text-subtle">
            <summary className="cursor-pointer">Advanced setup options</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {binding.webhookRegistrationRequired && (
                <form action={setupMailchimpWebhookAction}>
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <button type="submit" className="sk-button-secondary">Turn on Mailchimp updates</button>
                </form>
              )}
              {binding.baselineRequired && (
                <form action={reconcileMailchimpBaselineAction}>
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <button type="submit" className="sk-button-secondary">Sync contacts now</button>
                </form>
              )}
            </div>
          </details>
        </div>
      )}
      {binding && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            <form action={probeMailchimpConnectionAction}>
              <input type="hidden" name="connectionId" value={connectionId} />
              <button type="submit" className="sk-button-secondary">Check connection</button>
            </form>
            <form action={previewMailchimpBackfillAction}>
              <input type="hidden" name="connectionId" value={connectionId} />
              <button type="submit" className="sk-button-secondary">Review lead tags</button>
            </form>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Review shows how many contacts can receive Hot, Warm, or Nurture tags. Nothing changes in Mailchimp until you approve it.
          </p>
          {backfillRuns.length > 0 && (
            <div className="mt-4 space-y-2" aria-label="Mailchimp tag backfill history">
              {backfillRuns.map((run) => (
                <div key={run.id} className="rounded-xl border border-line bg-surface px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-ink">
                        {run.mode === 'backfill' ? 'Contact tag backfill' : 'Scheduled tag check'} · {run.state.replace('_', ' ')}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">
                        {run.eligibleCount} eligible · {run.jobsEnqueued} queued · mapping v{run.mappingVersion}
                      </p>
                    </div>
                    {run.state === 'previewed' && (
                      <form action={approveMailchimpBackfillAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <input type="hidden" name="snapshotHash" value={run.snapshotHash} />
                        <input type="hidden" name="mappingVersion" value={run.mappingVersion} />
                        <button type="submit" className="sk-button-primary">Approve exact snapshot</button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
