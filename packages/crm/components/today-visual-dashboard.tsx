import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  ArrowUpRight,
  Flame,
  Handshake,
  Radar,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import {
  PIPELINE_LABEL,
  type Contact,
  type LeadType,
  type PipelineStage,
} from '@/lib/domain/contact';
import type { TriageSummary } from '@/lib/domain/triage';

const PIPELINE_STAGES: readonly PipelineStage[] = [
  'new',
  'contacted',
  'appointment-set',
  'active',
  'under-contract',
  'closed',
  'lost',
];

const PIPELINE_SHORT_LABEL: Record<PipelineStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  'appointment-set': 'Appointment',
  active: 'Active',
  'under-contract': 'Contract',
  closed: 'Closed',
  lost: 'Lost',
};

const LEAD_LABEL: Record<LeadType, string> = {
  hot: 'Hot',
  warm: 'Warm',
  nurture: 'Nurture',
};

type VisualStyle = CSSProperties & Record<`--${string}`, string | number>;

function activeContacts(contacts: readonly Contact[]): Contact[] {
  return contacts.filter((contact) => !contact.archivedAt);
}

function leadCounts(contacts: readonly Contact[]): Record<LeadType, number> {
  return contacts.reduce<Record<LeadType, number>>((counts, contact) => {
    counts[contact.leadType] += 1;
    return counts;
  }, { hot: 0, warm: 0, nurture: 0 });
}

function stageCounts(contacts: readonly Contact[]): Record<PipelineStage, number> {
  return contacts.reduce<Record<PipelineStage, number>>((counts, contact) => {
    counts[contact.pipelineStage] += 1;
    return counts;
  }, {
    new: 0,
    contacted: 0,
    'appointment-set': 0,
    active: 0,
    'under-contract': 0,
    closed: 0,
    lost: 0,
  });
}

export function TodayMetricLedger({
  contacts: storedContacts,
  summary,
}: {
  contacts: readonly Contact[];
  summary: TriageSummary;
}) {
  const contacts = activeContacts(storedContacts);
  const leads = leadCounts(contacts);
  const activelyProgressing = contacts.filter((contact) => (
    contact.pipelineStage === 'appointment-set'
    || contact.pipelineStage === 'active'
    || contact.pipelineStage === 'under-contract'
  )).length;
  const metrics = [
    {
      label: 'Relationship book',
      value: contacts.length,
      detail: 'stored contacts',
      href: '/contacts',
      icon: UsersRound,
      tone: 'accent',
    },
    {
      label: 'Need attention',
      value: summary.needsAttentionNow,
      detail: 'first touch or follow-up',
      href: '/alerts',
      icon: Radar,
      tone: 'hot',
    },
    {
      label: 'Hot relationships',
      value: leads.hot,
      detail: 'highest priority',
      href: '/contacts',
      icon: Flame,
      tone: 'warm',
    },
    {
      label: 'Active pipeline',
      value: activelyProgressing,
      detail: 'appointment through contract',
      href: '/pipeline',
      icon: Handshake,
      tone: 'nurture',
    },
  ] as const;

  return (
    <section className="today-metric-ledger" aria-label="Today at a glance">
      {metrics.map(({ label, value, detail, href, icon: Icon, tone }, index) => (
        <Link
          key={label}
          href={href}
          className={`today-ledger-item today-ledger-${tone}`}
          style={{ '--today-ledger-delay': `${80 + index * 70}ms` } as VisualStyle}
          aria-label={`${label}: ${value}. ${detail}`}
        >
          <span className="today-ledger-icon"><Icon className="size-[18px]" aria-hidden /></span>
          <span className="min-w-0">
            <span className="today-ledger-label">{label}</span>
            <span className="today-ledger-detail">{detail}</span>
          </span>
          <strong className="today-ledger-value">{value}</strong>
          <ArrowUpRight className="today-ledger-arrow size-4" aria-hidden />
        </Link>
      ))}
    </section>
  );
}

export function TodayVisualDashboard({ contacts: storedContacts }: { contacts: readonly Contact[] }) {
  const contacts = activeContacts(storedContacts);
  const leads = leadCounts(contacts);
  const stages = stageCounts(contacts);
  const total = contacts.length;
  const hotEnd = total ? (leads.hot / total) * 100 : 0;
  const warmEnd = total ? hotEnd + (leads.warm / total) * 100 : 0;
  const maxStage = Math.max(1, ...PIPELINE_STAGES.map((stage) => stages[stage]));
  const orbitStyle = {
    '--today-hot-end': `${hotEnd}%`,
    '--today-warm-end': `${warmEnd}%`,
  } as VisualStyle;

  return (
    <section className="today-visual-dashboard" aria-labelledby="today-business-pulse-title">
      <div className="today-visual-heading">
        <div>
          <p className="eyebrow">Business pulse</p>
          <h2 id="today-business-pulse-title">The shape of your business, at a glance.</h2>
          <p>Live composition of the contact temperatures and pipeline stages already stored in Omnix.</p>
        </div>
        <Link href="/insights" className="today-visual-heading-link">
          Open insights <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="today-visual-grid">
        <article className="today-orbit-card" aria-labelledby="today-orbit-title">
          <div className="today-visual-card-heading">
            <span className="today-visual-card-icon"><Sparkles className="size-[18px]" aria-hidden /></span>
            <div>
              <p>Relationship orbit</p>
              <h3 id="today-orbit-title">Attention by temperature</h3>
            </div>
          </div>

          <div className="today-orbit-stage">
            <div
              className={`today-orbit ${total === 0 ? 'today-orbit-empty' : ''}`}
              style={orbitStyle}
              role="img"
              aria-label={`${leads.hot} Hot, ${leads.warm} Warm, and ${leads.nurture} Nurture contacts`}
            >
              <span className="today-orbit-glint" aria-hidden />
              <span className="today-orbit-core">
                <strong>{total}</strong>
                <small>relationships</small>
              </span>
            </div>
          </div>

          <dl className="today-orbit-legend">
            {(['hot', 'warm', 'nurture'] as const).map((leadType) => (
              <div key={leadType} className={`today-orbit-legend-${leadType}`}>
                <dt><span aria-hidden />{LEAD_LABEL[leadType]}</dt>
                <dd>{leads[leadType]}</dd>
              </div>
            ))}
          </dl>
        </article>

        <article className="today-pipeline-card" aria-labelledby="today-pipeline-title">
          <div className="today-visual-card-heading">
            <span className="today-visual-card-icon"><Radar className="size-[18px]" aria-hidden /></span>
            <div>
              <p>Pipeline panorama</p>
              <h3 id="today-pipeline-title">Where every relationship stands</h3>
            </div>
          </div>

          <ol className="today-pipeline-chart" aria-label="Contact count by pipeline stage">
            {PIPELINE_STAGES.map((stage, index) => {
              const count = stages[stage];
              const height = count === 0 ? 0 : Math.max(8, Math.round((count / maxStage) * 100));
              const style = {
                '--today-bar-height': `${height}%`,
                '--today-bar-delay': `${180 + index * 85}ms`,
              } as VisualStyle;
              return (
                <li key={stage} aria-label={`${PIPELINE_LABEL[stage]}: ${count}`}>
                  <strong>{count}</strong>
                  <span className="today-pipeline-bar" aria-hidden>
                    <span className={`today-pipeline-bar-fill today-pipeline-bar-${stage}`} style={style} />
                  </span>
                  <span>{PIPELINE_SHORT_LABEL[stage]}</span>
                </li>
              );
            })}
          </ol>

          <div className="today-pipeline-footnote">
            <span>Stored stages only</span>
            <Link href="/pipeline">Open pipeline <ArrowUpRight className="size-4" aria-hidden /></Link>
          </div>
        </article>
      </div>
    </section>
  );
}
