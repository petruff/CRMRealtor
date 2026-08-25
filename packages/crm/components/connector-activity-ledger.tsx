import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  ShieldCheck,
} from 'lucide-react';
import type {
  ConnectorErrorCategory,
  ConnectorProvider,
  ConnectorReceipt,
  ConnectorReceiptType,
} from '@/lib/domain/connector';

const PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  'contract-test': 'Provider test',
  google: 'Google Workspace',
  mailchimp: 'Mailchimp',
  twilio: 'Texting',
  meta: 'Instagram & Facebook',
};

const EVENT_COPY: Partial<Record<ConnectorReceiptType, { title: string; detail: string }>> = {
  'oauth.started': {
    title: 'Authorization started',
    detail: 'The secure sign-in window was opened. Permissions are saved only after the provider confirms them.',
  },
  'oauth.completed': {
    title: 'Account connected',
    detail: 'The provider confirmed the account and Omnix saved the approved access securely.',
  },
  'oauth.token-refreshed': {
    title: 'Access renewed',
    detail: 'Omnix renewed the saved provider access without asking for another password.',
  },
  'audience.selected': {
    title: 'Newsletter audience selected',
    detail: 'This Mailchimp audience is now the approved destination for contact synchronization.',
  },
  'audience.replaced': {
    title: 'Newsletter audience changed',
    detail: 'A new Mailchimp audience was selected and the previous selection was preserved in history.',
  },
  'connection.probed': {
    title: 'Connection checked',
    detail: 'Omnix confirmed whether the provider can be reached with the saved permissions.',
  },
  'connection.tested': {
    title: 'Connection tested',
    detail: 'A controlled provider check completed and saved a private diagnostic reference.',
  },
  'sync.applied': {
    title: 'Contacts synchronized',
    detail: 'The approved contact updates were applied and recorded.',
  },
  'sync.reviewed': {
    title: 'Synchronization needs review',
    detail: 'Omnix paused safely because one or more records need a person to confirm the match.',
  },
  'reconciliation.started': {
    title: 'Account review started',
    detail: 'Omnix began comparing saved CRM details with the connected provider.',
  },
  'reconciliation.resolved': {
    title: 'Account review completed',
    detail: 'Provider and CRM records were compared and the final result was recorded.',
  },
  'webhook.accepted': {
    title: 'Provider update received',
    detail: 'A verified account update was accepted for processing.',
  },
  'webhook.rejected': {
    title: 'Provider update blocked',
    detail: 'An unverified or unexpected update was rejected without changing CRM data.',
  },
  'provider.failed': {
    title: 'Connected service action paused',
    detail: 'Nothing unsafe was applied. Review the connection or retry the action.',
  },
  'job.failed': {
    title: 'Automatic action paused',
    detail: 'The action stopped after its safe retry limit and now needs attention.',
  },
  'connection.disconnected': {
    title: 'Account disconnected',
    detail: 'New provider activity was stopped while CRM history remained available.',
  },
  'revocation.completed': {
    title: 'Provider access removed',
    detail: 'The saved provider access was revoked and local credentials were retired.',
  },
};

type ActivityTone = 'success' | 'progress' | 'attention';

interface GroupedReceipt {
  readonly key: string;
  readonly latest: ConnectorReceipt;
  readonly count: number;
  readonly tone: ActivityTone;
}

function humanize(value: string): string {
  const words = value.replaceAll('.', ' ').replaceAll('_', ' ').replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function eventCopy(type: ConnectorReceiptType) {
  return EVENT_COPY[type] ?? {
    title: humanize(type),
    detail: 'Omnix recorded this provider activity for safe support and auditing.',
  };
}

function toneFor(receipt: ConnectorReceipt): ActivityTone {
  if (receipt.errorCategory !== 'none'
    || ['provider.failed', 'provider.unknown', 'job.failed', 'webhook.rejected', 'sync.reviewed'].includes(receipt.type)) {
    return 'attention';
  }
  if (['oauth.started', 'attempt.started', 'job.queued', 'job.retry-scheduled', 'reconciliation.started', 'revocation.requested'].includes(receipt.type)) {
    return 'progress';
  }
  return 'success';
}

function groupReceipts(receipts: readonly ConnectorReceipt[]): readonly GroupedReceipt[] {
  const groups = new Map<string, GroupedReceipt>();
  for (const receipt of receipts.slice(0, 20)) {
    const key = [receipt.provider, receipt.type, receipt.errorCategory, receipt.providerStatus ?? ''].join(':');
    const existing = groups.get(key);
    groups.set(key, existing
      ? { ...existing, count: existing.count + 1 }
      : { key, latest: receipt, count: 1, tone: toneFor(receipt) });
  }
  return [...groups.values()];
}

function supportReference(value: string): string {
  return value.replaceAll('-', '').slice(0, 8).toUpperCase();
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function exactDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'medium',
  }).format(new Date(value));
}

function errorLabel(error: ConnectorErrorCategory): string {
  return error === 'none' ? 'No issue recorded' : humanize(error);
}

const TONE_META = {
  success: {
    label: 'Completed',
    icon: CheckCircle2,
    className: 'connector-ledger-event--success',
  },
  progress: {
    label: 'Started',
    icon: Clock3,
    className: 'connector-ledger-event--progress',
  },
  attention: {
    label: 'Needs attention',
    icon: AlertTriangle,
    className: 'connector-ledger-event--attention',
  },
} as const;

export function ConnectorActivityLedger({ receipts }: { readonly receipts: readonly ConnectorReceipt[] }) {
  const recent = receipts.slice(0, 20);
  const groups = groupReceipts(recent);
  const attentionCount = recent.filter((receipt) => toneFor(receipt) === 'attention').length;

  if (!recent.length) return null;
  const latestReceipt = recent[0]!;

  return (
    <section className="connector-ledger" aria-labelledby="connection-activity-title">
      <div className="connector-ledger-heading">
        <span className="connector-ledger-heading__icon"><History aria-hidden /></span>
        <div>
          <p className="eyebrow">Private activity record</p>
          <h3 id="connection-activity-title">Connection activity</h3>
          <p>Recent account changes, grouped into a calm history. Technical references stay available only when support needs them.</p>
        </div>
      </div>

      <dl className="connector-ledger-summary" aria-label="Connection activity summary">
        <div><dt>Recent events</dt><dd>{recent.length}</dd><small>Latest protected records</small></div>
        <div><dt>Needs attention</dt><dd>{attentionCount}</dd><small>{attentionCount ? 'Review the highlighted activity' : 'No recent provider error'}</small></div>
        <div><dt>Latest update</dt><dd className="connector-ledger-summary__date">{shortDate(latestReceipt.occurredAt)}</dd><small>{PROVIDER_LABELS[latestReceipt.provider]}</small></div>
      </dl>

      <ol className="connector-ledger-timeline" aria-label="Recent connection activity">
        {groups.map((group) => {
          const meta = TONE_META[group.tone];
          const Icon = meta.icon;
          const copy = eventCopy(group.latest.type);
          return (
            <li key={group.key} className={`connector-ledger-event ${meta.className}`}>
              <span className="connector-ledger-event__marker"><Icon aria-hidden /></span>
              <div className="connector-ledger-event__body">
                <div className="connector-ledger-event__topline">
                  <div>
                    <p className="connector-ledger-event__provider">{PROVIDER_LABELS[group.latest.provider]}</p>
                    <h4>{copy.title}{group.count > 1 ? <span> · {group.count} attempts</span> : null}</h4>
                  </div>
                  <span className="connector-ledger-event__status">{meta.label}</span>
                </div>
                <p className="connector-ledger-event__copy">{copy.detail}</p>
                <p className="connector-ledger-event__time">Most recent · {shortDate(group.latest.occurredAt)}</p>
                <details className="connector-ledger-technical">
                  <summary><ShieldCheck aria-hidden />Technical details</summary>
                  <dl>
                    <div><dt>Service result</dt><dd>{group.latest.providerStatus ?? 'Not supplied'}</dd></div>
                    <div><dt>Diagnostic</dt><dd>{errorLabel(group.latest.errorCategory)}</dd></div>
                    <div><dt>Support reference</dt><dd title={`Full support reference: ${group.latest.correlationId}`}>{supportReference(group.latest.correlationId)}</dd></div>
                    <div><dt>Recorded</dt><dd>{exactDate(group.latest.occurredAt)}</dd></div>
                  </dl>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
