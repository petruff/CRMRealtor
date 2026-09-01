import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  ArrowUpRight, BriefcaseBusiness, CalendarClock, CheckCircle2, CircleDollarSign,
  Database, Gauge, HeartHandshake, ShieldCheck, Sparkles, UsersRound,
} from 'lucide-react';
import { createTransactionAction } from '@/app/insights/actions';
import type { RealEstateTransaction, TransactionMetrics } from '@/lib/domain/transaction';
import type { FinancialPortfolioMetrics } from '@/lib/domain/transaction-finance';
import {
  InsightsContributorExplorer,
  type InsightsDrilldownView,
} from '@/components/insights-contributor-explorer';

export type { InsightsContributorView, InsightsDrilldownView } from '@/components/insights-contributor-explorer';

type VisualStyle = CSSProperties & Record<`--${string}`, string | number>;
type DisplayStatus = 'available' | 'possibly-truncated' | 'insufficient-evidence';

export interface InsightsStageView {
  stage: string; label: string; count: number; averageDaysInStage: number | null;
  evidenceCount: number; detailId: string;
}

export interface InsightsSourceView {
  id: string; label: string; count: number; progressed: number;
  progressionPercentage: number | null; progressedChange: number; detailId: string;
}

export interface InsightsMemberView {
  id: string; label: string; role: 'owner' | 'assistant' | null;
  attribution: 'active-member' | 'unassigned' | 'inactive-or-unknown';
  open: number | null; overdue: number | null; completed: number | null;
}

export interface InsightsDashboardModel {
  periodDays: 30 | 90 | 365;
  generatedAt: string;
  isLive: boolean;
  portfolioStatus: DisplayStatus;
  pipelineStatus: DisplayStatus;
  sourceStatus: DisplayStatus;
  totalContacts: number | null;
  needsAttention: number | null;
  progressing: number | null;
  underContract: number | null;
  portfolio: {
    hot: number | null; warm: number | null; nurture: number | null;
    overdue: number | null; neverContacted: number | null; needsQualification: number | null;
  };
  pipeline: readonly InsightsStageView[];
  conversion: {
    status: 'available' | 'insufficient-evidence'; numerator: number; denominator: number;
    percentage: number | null; definition: string;
  };
  conversionChange: number | null;
  previousTransitionEvents: number;
  transitionEvents: number;
  sources: readonly InsightsSourceView[];
  work: {
    status: DisplayStatus;
    open: number | null; overdue: number | null; dueSoon: number | null;
    completed: number | null; previousCompleted: number | null;
    completionRate: number | null; onTimeRate: number | null;
    members: readonly InsightsMemberView[];
  };
  readiness: readonly { label: string; value: number | null; detailId: string }[];
  drilldowns: readonly InsightsDrilldownView[];
  selectedDrilldownId: string;
  transactionStatus: DisplayStatus;
  transactionMessage?: string;
  transactionMetrics: TransactionMetrics | null;
  financialMetrics: FinancialPortfolioMetrics | null;
  transactions: readonly RealEstateTransaction[];
  transactionContacts: readonly { id: string; label: string }[];
  coverage: {
    contactBoundedAt: number; contactPossiblyTruncated: boolean;
    transitionBoundedAt: number; transitionPossiblyTruncated: boolean;
    eventBoundedAt: number;
    taskBoundedAt: number; taskPossiblyTruncated: boolean;
    schemaVersion: string; currentFrom: string; currentTo: string;
    previousFrom: string; previousTo: string;
    contactRows: number | null; transitionRows: number | null;
    taskRows: number | null; membershipRows: number | null;
    mode: 'live' | 'sample';
  };
}

function percent(value: number | null, total: number | null): number | null {
  return value === null || total === null || total === 0 ? null : Math.round((value / total) * 100);
}

function delta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'Prior-period comparison unavailable';
  const difference = current - previous;
  if (difference === 0) return 'No change vs prior period';
  return `${difference > 0 ? '+' : ''}${difference} vs prior period`;
}

function friendlyDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function detailHref(model: InsightsDashboardModel, detailId: string): string {
  return `/insights?period=${model.periodDays}&detail=${encodeURIComponent(detailId)}#contributor-details`;
}

function displayed(value: number | null): string {
  return value === null ? '—' : String(value);
}

function currency(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusNote({ status }: { status: DisplayStatus }) {
  if (status === 'available') return null;
  return <p className="insights-definition" role="status">{status === 'possibly-truncated'
    ? 'Incomplete result — the contributing read reached a configured cap.'
    : 'Insufficient evidence — this metric is unavailable, not zero.'}</p>;
}

export function InsightsDashboard({ model }: { model: InsightsDashboardModel }) {
  const transactionIdempotencyKey = randomUUID();
  const maxStage = Math.max(1, ...model.pipeline.map((stage) => stage.count));
  const leadValues = [model.portfolio.hot, model.portfolio.warm, model.portfolio.nurture];
  const totalLeadTypes = leadValues.every((value) => value !== null)
    ? leadValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const hotEnd = percent(model.portfolio.hot, totalLeadTypes) ?? 0;
  const warmEnd = hotEnd + (percent(model.portfolio.warm, totalLeadTypes) ?? 0);
  const dataWarnings = [
    model.coverage.contactPossiblyTruncated ? `Contact view reached its ${model.coverage.contactBoundedAt}-record read boundary.` : null,
    model.coverage.transitionPossiblyTruncated ? `Relevant activity history reached a ${model.coverage.transitionBoundedAt}-record per-type read boundary.` : null,
    model.coverage.taskPossiblyTruncated ? `Task history reached its ${model.coverage.taskBoundedAt}-task read boundary.` : null,
  ].filter((warning): warning is string => Boolean(warning));

  return <div className="insights-studio">
    <header className="insights-header">
      <div><p className="eyebrow">Operating intelligence</p><h1>See the business move.</h1><p>Relationship health, pipeline momentum, and team follow-through — grounded in what Omnix can prove.</p></div>
      <div className="insights-header-controls">
        <nav className="insights-period-control" aria-label="Insights period">{([30, 90, 365] as const).map((days) => <Link key={days} href={`/insights?period=${days}`} aria-current={model.periodDays === days ? 'page' : undefined}>{days === 365 ? '1 year' : `${days} days`}</Link>)}</nav>
        <p>As of <time dateTime={model.generatedAt}>{friendlyDate(model.generatedAt)}</time></p>
      </div>
    </header>

    {!model.isLive ? <p className="insights-mode-note" role="status"><ShieldCheck className="size-4" aria-hidden /> Preview data — these figures do not come from Judith’s account.</p> : null}

    <section className="insights-command-strip" aria-label="Business command metrics">
      <Link href={detailHref(model, 'portfolio-all')} className="insights-command-metric"><span><UsersRound className="size-4" aria-hidden /> Relationship book</span><strong>{displayed(model.totalContacts)}</strong><small>exact stored contributors</small><ArrowUpRight className="insights-command-arrow size-4" aria-hidden /></Link>
      <Link href={detailHref(model, 'portfolio-attention')} className="insights-command-metric insights-command-urgent"><span><CalendarClock className="size-4" aria-hidden /> Need attention</span><strong>{displayed(model.needsAttention)}</strong><small>ready for action now</small><ArrowUpRight className="insights-command-arrow size-4" aria-hidden /></Link>
      <Link href={detailHref(model, 'portfolio-progressing')} className="insights-command-metric"><span><BriefcaseBusiness className="size-4" aria-hidden /> Progressing</span><strong>{displayed(model.progressing)}</strong><small>appointment through contract</small><ArrowUpRight className="insights-command-arrow size-4" aria-hidden /></Link>
      <Link href={detailHref(model, 'conversion-eligible')} className="insights-command-metric"><span><Gauge className="size-4" aria-hidden /> Cohort conversion</span><strong>{model.conversion.percentage === null ? '—' : `${model.conversion.percentage}%`}</strong><small>{model.conversion.status === 'insufficient-evidence' ? 'waiting for linked stage history' : `${model.conversion.numerator} of ${model.conversion.denominator} contacts`}</small><ArrowUpRight className="insights-command-arrow size-4" aria-hidden /></Link>
    </section>
    <StatusNote status={model.portfolioStatus} />

    <section className="insights-current" aria-labelledby="operating-current-title">
      <div className="insights-section-heading"><div><p className="eyebrow">Operating current</p><h2 id="operating-current-title">Where relationships are gathering momentum.</h2></div><p>Current distribution, not a historical funnel. {delta(model.transitionEvents, model.previousTransitionEvents)}.</p></div>
      <div className="insights-current-rail" aria-label="Exact pipeline stage contributors">{model.pipeline.map((stage, index) => {
        const size = Math.max(8, Math.round((stage.count / maxStage) * 100));
        return <Link key={stage.stage} href={detailHref(model, stage.detailId)} className="insights-current-stop" style={{ '--insight-size': `${size}%`, '--insight-delay': `${100 + index * 70}ms` } as VisualStyle}><span className="insights-current-value">{model.pipelineStatus === 'insufficient-evidence' ? '—' : stage.count}</span><span className="insights-current-pulse" aria-hidden /><span className="insights-current-label">{stage.label}</span></Link>;
      })}</div>
    </section>

    <div className="insights-primary-grid">
      <section className="insights-panel insights-relationship-panel" aria-labelledby="relationship-health-title">
        <div className="insights-panel-heading"><span><HeartHandshake className="size-5" aria-hidden /></span><div><p className="eyebrow">Portfolio health</p><h2 id="relationship-health-title">Attention by relationship temperature</h2></div></div>
        <StatusNote status={model.portfolioStatus} />
        <div className="insights-temperature-visual">
          <div className="insights-temperature-ring" style={{ '--insight-hot-end': `${hotEnd}%`, '--insight-warm-end': `${warmEnd}%` } as VisualStyle} role="img" aria-label={`${displayed(model.portfolio.hot)} Hot, ${displayed(model.portfolio.warm)} Warm, ${displayed(model.portfolio.nurture)} Nurture`}><span><strong>{displayed(model.totalContacts)}</strong><small>relationships</small></span></div>
          <dl className="insights-temperature-legend"><div className="is-hot"><dt><Link href={detailHref(model, 'portfolio-hot')}>Hot</Link></dt><dd>{displayed(model.portfolio.hot)}</dd></div><div className="is-warm"><dt><Link href={detailHref(model, 'portfolio-warm')}>Warm</Link></dt><dd>{displayed(model.portfolio.warm)}</dd></div><div className="is-nurture"><dt><Link href={detailHref(model, 'portfolio-nurture')}>Nurture</Link></dt><dd>{displayed(model.portfolio.nurture)}</dd></div></dl>
        </div>
        <div className="insights-action-queues"><Link href={detailHref(model, 'portfolio-overdue')}><span>Overdue follow-ups</span><strong>{displayed(model.portfolio.overdue)}</strong><ArrowUpRight className="size-4" aria-hidden /></Link><Link href={detailHref(model, 'portfolio-needs-qualification')}><span>Needs qualification</span><strong>{displayed(model.portfolio.needsQualification)}</strong><ArrowUpRight className="size-4" aria-hidden /></Link><Link href={detailHref(model, 'portfolio-never-contacted')}><span>Never contacted</span><strong>{displayed(model.portfolio.neverContacted)}</strong><ArrowUpRight className="size-4" aria-hidden /></Link></div>
      </section>

      <section className="insights-panel" aria-labelledby="pipeline-evidence-title">
        <div className="insights-panel-heading"><span><Gauge className="size-5" aria-hidden /></span><div><p className="eyebrow">Pipeline evidence</p><h2 id="pipeline-evidence-title">Stage shape and aging</h2></div></div>
        <StatusNote status={model.pipelineStatus} />
        {model.pipelineStatus === 'insufficient-evidence' ? <p className="insights-empty-copy">Pipeline evidence is unavailable.</p> : <ol className="insights-stage-chart">{model.pipeline.map((stage, index) => <li key={stage.stage}><Link href={detailHref(model, stage.detailId)}><div><span>{stage.label}</span><strong>{stage.count}</strong></div><span className="insights-stage-track" aria-hidden><span style={{ '--insight-width': `${Math.max(stage.count ? 4 : 0, Math.round((stage.count / maxStage) * 100))}%`, '--insight-delay': `${160 + index * 65}ms` } as VisualStyle} /></span><small>{stage.averageDaysInStage === null ? 'Aging unavailable' : `${stage.averageDaysInStage} avg days`} · {stage.evidenceCount} evidenced</small></Link></li>)}</ol>}
        <Link href={detailHref(model, 'conversion-eligible')} id="conversion" className="insights-conversion-card"><div><p>Cohort conversion</p><span>{model.conversion.definition}</span></div><strong>{model.conversion.percentage === null ? 'Not enough history' : `${model.conversion.percentage}%`}</strong><small>{model.conversion.status === 'insufficient-evidence' ? 'Eligible cohort unavailable' : `${model.conversion.numerator} closed · ${model.conversion.denominator} eligible${model.conversionChange === null ? '' : ` · ${model.conversionChange > 0 ? '+' : ''}${model.conversionChange} pts`}`}</small></Link>
      </section>
    </div>

    <div className="insights-secondary-grid">
      <section className="insights-panel" aria-labelledby="work-rhythm-title">
        <div className="insights-panel-heading"><span><CheckCircle2 className="size-5" aria-hidden /></span><div><p className="eyebrow">Work rhythm</p><h2 id="work-rhythm-title">Follow-through, not activity theater</h2></div></div>
        <StatusNote status={model.work.status} />
        {model.work.status === 'insufficient-evidence' ? <p className="insights-empty-copy">Task evidence is unavailable. Counts are withheld rather than shown as zero.</p> : <>
          <div className="insights-work-stats"><Link href={detailHref(model, 'tasks-open')}><span>Open</span><strong>{displayed(model.work.open)}</strong></Link><Link href={detailHref(model, 'tasks-overdue')} className="is-urgent"><span>Overdue</span><strong>{displayed(model.work.overdue)}</strong></Link><Link href={detailHref(model, 'tasks-due-soon')}><span>Due next 7 days</span><strong>{displayed(model.work.dueSoon)}</strong></Link><Link href={detailHref(model, 'tasks-completed')}><span>Completed</span><strong>{displayed(model.work.completed)}</strong><small>{delta(model.work.completed, model.work.previousCompleted)}</small></Link></div>
          <div className="insights-rate-pair"><div><span>Due-work completion</span><strong>{model.work.completionRate === null ? '—' : `${model.work.completionRate}%`}</strong></div><div><span>Completed on time</span><strong>{model.work.onTimeRate === null ? '—' : `${model.work.onTimeRate}%`}</strong></div></div>
          <div className="insights-team-list">{model.work.members.map((member) => <article key={member.id}><span className="insights-team-avatar">{member.attribution === 'unassigned' ? 'UN' : member.attribution === 'inactive-or-unknown' ? '??' : member.role === 'owner' ? 'OW' : 'AS'}</span><div><strong>{member.label}</strong><small>{member.attribution === 'active-member' ? member.role === 'owner' ? 'Owner' : 'Assistant' : member.attribution === 'unassigned' ? 'No assignee' : 'Revoked or unknown membership'} · {displayed(member.open)} open</small></div><span className={member.overdue ? 'is-urgent' : ''}>{displayed(member.overdue)} overdue</span><span>{displayed(member.completed)} done</span></article>)}</div>
        </>}
      </section>

      <section className="insights-panel" aria-labelledby="source-performance-title">
        <div className="insights-panel-heading"><span><Sparkles className="size-5" aria-hidden /></span><div><p className="eyebrow">Source quality</p><h2 id="source-performance-title">Origins that reach meaningful stages</h2></div></div>
        <p className="insights-definition">Progressed means appointment set, actively working, under contract, or closed. It is not ROI.</p><StatusNote status={model.sourceStatus} />
        {model.sourceStatus === 'insufficient-evidence' ? <p className="insights-empty-copy">Source progression evidence is unavailable.</p> : <ol className="insights-source-list">{model.sources.map((source) => <li key={source.id}><Link href={detailHref(model, source.detailId)} aria-label={`Review exact ${source.label} progression contributors for ${model.periodDays} days`}><div><strong>{source.label}</strong><span>{source.count} source contacts</span></div><span className="insights-source-track" aria-hidden><span style={{ '--insight-width': `${source.progressionPercentage ?? 0}%` } as VisualStyle} /></span><div><strong>{source.progressionPercentage === null ? '—' : `${source.progressionPercentage}%`}</strong><span>{source.progressed} progressed · {source.progressedChange > 0 ? '+' : ''}{source.progressedChange}</span></div></Link></li>)}</ol>}
        {model.sourceStatus !== 'insufficient-evidence' && !model.sources.length ? <p className="insights-empty-copy">No stored source has a current-period progression contributor.</p> : null}
      </section>
    </div>

    <section id="contributor-details" className="insights-foundation scroll-mt-24" aria-labelledby="contributor-details-title">
      <div className="insights-foundation-heading"><span><Database className="size-5" aria-hidden /></span><div><p className="eyebrow">Exact contributors</p><h2 id="contributor-details-title">Inspect the records behind one metric</h2></div></div>
      <InsightsContributorExplorer
        periodDays={model.periodDays}
        currentFrom={model.coverage.currentFrom}
        currentTo={model.coverage.currentTo}
        drilldowns={model.drilldowns}
        selectedDrilldownId={model.selectedDrilldownId}
      />
    </section>

    <section className="insights-foundation" aria-labelledby="data-foundation-title">
      <div className="insights-foundation-heading"><span><Database className="size-5" aria-hidden /></span><div><p className="eyebrow">Data foundation</p><h2 id="data-foundation-title">What the CRM can act on safely</h2></div></div>
      <div className="insights-readiness-grid">{model.readiness.map((item) => { const readinessPercentage = percent(item.value, model.totalContacts); return <Link key={item.label} href={detailHref(model, item.detailId)}><span>{item.label}</span><strong>{readinessPercentage === null ? '—' : `${readinessPercentage}%`}</strong>{item.value === null || model.totalContacts === null ? <span className="text-xs text-muted">Insufficient evidence</span> : <><progress value={item.value} max={Math.max(1, model.totalContacts)} aria-label={`${item.label}: ${item.value} of ${model.totalContacts}`} /><small>{item.value} of {model.totalContacts}</small></>}</Link>; })}</div>
      {dataWarnings.length ? <div className="insights-coverage-warning" role="status"><ShieldCheck className="size-5" aria-hidden /><div><strong>Coverage boundary reached — affected metrics are incomplete</strong><ul>{dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div> : <p className="insights-coverage-ok"><ShieldCheck className="size-4" aria-hidden /> This view remained inside every current read boundary.</p>}
      <details className="insights-evidence-details"><summary>How this report was calculated</summary><dl><div><dt>Data source</dt><dd>{model.coverage.mode === 'live' ? 'Judith’s current CRM records' : 'Preview data'}</dd></div><div><dt>Current period</dt><dd>{model.coverage.currentFrom.slice(0, 10)} to {model.coverage.currentTo.slice(0, 10)}</dd></div><div><dt>Comparison period</dt><dd>{model.coverage.previousFrom.slice(0, 10)} to {model.coverage.previousTo.slice(0, 10)}</dd></div><div><dt>Records included</dt><dd>{displayed(model.coverage.contactRows)} contacts · {displayed(model.coverage.transitionRows)} relevant updates · {displayed(model.coverage.taskRows)} tasks</dd></div><div><dt>Included activity</dt><dd>Active contacts, pipeline changes, and created or completed tasks. Archived contacts are excluded.</dd></div></dl></details>
    </section>

    <section id="transaction-intelligence" className="insights-transactions" aria-labelledby="transaction-intelligence-title">
      <div className="insights-section-heading"><div><p className="eyebrow">Transaction intelligence</p><h2 id="transaction-intelligence-title">The financial pulse of the business.</h2></div><p><CircleDollarSign className="size-4" aria-hidden /> Live workspace ledger · selected {model.periodDays}-day close period</p></div>
      {model.transactionMessage ? <p className={model.transactionStatus === 'available' ? 'insights-transaction-message' : 'insights-coverage-warning'} role="status">{model.transactionMessage}</p> : null}
      {model.transactionStatus === 'insufficient-evidence' || !model.transactionMetrics || !model.financialMetrics ? <div className="insights-coverage-warning" role="status"><ShieldCheck className="size-5" aria-hidden /><div><strong>Financial ledger needs its database update</strong><p>Metrics remain withheld until the sourced financial authority is available in this workspace.</p></div></div> : <>
        <div className="insights-financial-grid" aria-label="Verified financial metrics">
          <article className="is-primary"><span>Verified closed volume</span><strong>{currency(model.financialMetrics.booked.volumeCents)}</strong><small>{model.financialMetrics.booked.deals} complete booked {model.financialMetrics.booked.deals === 1 ? 'deal' : 'deals'}</small></article>
          <article><span>Verified GCI</span><strong>{currency(model.financialMetrics.booked.gciCents)}</strong><small>Closed, in-period, sourced records only</small></article>
          <article><span>Verified net commission</span><strong>{currency(model.financialMetrics.booked.netCommissionCents)}</strong><small>Separate from brokerage split and referral fee</small></article>
          <article><span>Tracked expenses</span><strong>{currency(model.financialMetrics.booked.expensesCents)}</strong><small>Marketing + other sourced costs</small></article>
          <article className={model.financialMetrics.booked.netIncomeCents < 0 ? 'is-negative' : 'is-positive'}><span>Net income</span><strong>{currency(model.financialMetrics.booked.netIncomeCents)}</strong><small>Operational view, not tax or accounting advice</small></article>
          <article><span>Active GCI forecast</span><strong>{currency(model.financialMetrics.activeForecast.gciCents)}</strong><small>{model.financialMetrics.activeForecast.deals} active · unweighted verified GCI</small></article>
        </div>
        {(model.financialMetrics.excluded.incomplete || model.financialMetrics.excluded.unverified || model.financialMetrics.excluded.contradictory) ? <div className="insights-coverage-warning" role="status"><ShieldCheck className="size-5" aria-hidden/><div><strong>Some financial records are excluded from booked truth</strong><p>{model.financialMetrics.excluded.incomplete} incomplete · {model.financialMetrics.excluded.unverified} unverified · {model.financialMetrics.excluded.contradictory} contradictory. Open Transactions to reconcile the exact source.</p></div></div> : null}
        <div className="insights-transaction-grid">
          <div className="insights-transaction-ledger">
            <div className="insights-panel-heading"><span><BriefcaseBusiness className="size-5" aria-hidden /></span><div><p className="eyebrow">Deal ledger</p><h3>Recent transactions</h3></div></div>
            {model.transactions.length ? <div className="insights-deal-list">{model.transactions.map((transaction) => <article key={transaction.id}><div><strong>{transaction.title}</strong><span>{transaction.contactName} · {transaction.propertyAddress}</span></div><div><span className={`insights-deal-status is-${transaction.status}`}>{titleCase(transaction.status)}</span><strong>{currency(transaction.salePriceCents)}</strong><small>{transaction.kindVerified ? titleCase(transaction.kind) : 'Type needs review'} · {titleCase(transaction.side)} · {titleCase(transaction.source)}</small></div></article>)}</div> : <div className="insights-empty-deals"><CircleDollarSign className="size-7" aria-hidden /><strong>No transactions recorded yet</strong><p>Add the first transaction. Verified zeroes are already live; every saved transaction updates this view immediately.</p></div>}
            {model.financialMetrics.contributors.length ? <div className="insights-source-roi"><h3>Exact financial contributors</h3>{model.financialMetrics.contributors.slice(0, 12).map((row) => <article key={row.transactionId}><div><strong>{row.transactionTitle}</strong><span>{titleCase(row.status)} · {titleCase(row.source)} · {row.effectiveDate}</span></div><div><strong>{row.netIncomeCents === undefined ? 'Net income unknown' : currency(row.netIncomeCents)}</strong><span>{row.verificationState}{row.missing.length ? ` · ${row.missing.length} fields missing` : ' · complete'}</span></div></article>)}</div> : null}
          </div>
          <form action={createTransactionAction} className="insights-deal-form">
            <div><p className="eyebrow">Verified entry</p><h3>Add a transaction</h3><p>Amounts are stored as exact USD cents. Transaction status stays separate from the contact relationship and Pipeline.</p></div>
            <input type="hidden" name="period" value={model.periodDays} />
            <input type="hidden" name="idempotencyKey" value={transactionIdempotencyKey} />
            <label>Contact<select className="sk-input" name="contactId" required defaultValue=""><option value="" disabled>Select a contact</option>{model.transactionContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.label}</option>)}</select></label>
            <label>Transaction name<input className="sk-input" name="title" maxLength={120} required placeholder="Joan's Palm City purchase" /></label>
            <div className="insights-deal-form-row"><label>Type<select className="sk-input" name="kind" defaultValue="buyer"><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="listing">Listing</option><option value="lease">Lease</option><option value="referral">Referral</option></select></label><label>Status<select className="sk-input" name="status" defaultValue="under-contract"><option value="pending">Pending</option><option value="under-contract">Under contract</option><option value="closed">Closed</option><option value="lost">Lost</option><option value="cancelled">Cancelled</option></select></label></div>
            <label>Representation side<select className="sk-input" name="side" defaultValue="buyer"><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="dual">Dual</option><option value="referral">Referral</option></select></label>
            <label>Property address<input className="sk-input" name="propertyAddress" maxLength={240} required placeholder="123 Main Street, City, State" /></label>
            <div className="insights-deal-form-row"><label>Expected close<input className="sk-input" type="date" name="expectedCloseDate" /></label><label>Closed date<input className="sk-input" type="date" name="closedAt" /></label></div>
            <div className="insights-deal-form-row"><label>Sale price<input className="sk-input" inputMode="decimal" name="salePrice" placeholder="$0" /></label><label>Gross commission (GCI)<input className="sk-input" inputMode="decimal" name="grossCommission" placeholder="$0" /></label></div>
            <div className="insights-deal-form-row"><label>Net commission<input className="sk-input" inputMode="decimal" name="netCommission" placeholder="$0" /></label><label>Marketing cost<input className="sk-input" inputMode="decimal" name="marketingCost" placeholder="$0" /></label></div>
            <label>Other deal expenses<input className="sk-input" inputMode="decimal" name="expenses" placeholder="$0" /></label>
            <button className="sk-primary-button min-h-11" type="submit" disabled={!model.transactionContacts.length}>Save verified transaction</button>
          </form>
        </div>
      </>}
    </section>
  </div>;
}
