import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, Database, ShieldCheck } from 'lucide-react';
import { GroupedSurface, StatTile } from '@/components/ui';
import { getRepository } from '@/lib/data';
import { buildWorkspaceSnapshot } from '@/lib/domain/workspace-intelligence';
import { getPipelineAnalytics } from '@/lib/application/pipeline-analytics-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Insights' };

function percent(value: number, total: number): number {
  return total ? Math.round((value / total) * 100) : 0;
}

export default async function InsightsPage() {
  const context = await getRepository();
  const snapshot = buildWorkspaceSnapshot(await context.repository.list());
  const analytics = await getPipelineAnalytics(context);
  const readiness = [
    { label: 'Phone available', value: snapshot.readiness.withPhone },
    { label: 'Email available', value: snapshot.readiness.withEmail },
    { label: 'Complete mailing address', value: snapshot.readiness.mailReady },
    { label: 'Next touch scheduled', value: snapshot.readiness.withNextTouch },
  ];
  const sources = snapshot.sources.filter((source) => source.count > 0);

  return (
    <div>
      <header className="mb-9 md:mb-12">
        <p className="eyebrow">Business health</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Useful numbers.<br /><span className="text-muted">Nothing invented.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
          These insights come only from stored contacts and follow-up facts. Revenue, conversion and market metrics stay absent until Omnix has a real transaction source.
        </p>
      </header>

      <GroupedSurface className="mb-8 grid grid-cols-2 gap-px sm:grid-cols-4">
        <StatTile value={snapshot.totalContacts} label="Contacts" />
        <StatTile value={snapshot.needsAttentionNow} label="Need attention now" tone="hot" />
        <StatTile value={snapshot.pipeline.find((item) => item.id === 'active')?.count ?? 0} label="Actively working" tone="accent" />
        <StatTile value={snapshot.pipeline.find((item) => item.id === 'under-contract')?.count ?? 0} label="Under contract" tone="warm" />
      </GroupedSurface>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="sk-group bg-surface p-5 sm:p-6" aria-labelledby="readiness-title">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-accent"><Database className="size-5" aria-hidden /></span>
            <div>
              <h2 id="readiness-title" className="font-display text-2xl text-ink">Contact readiness</h2>
              <p className="mt-1 text-sm text-muted">What Omnix can safely use today.</p>
            </div>
          </div>
          <ul className="mt-6 grid gap-5">
            {readiness.map((item) => {
              const percentage = percent(item.value, snapshot.totalContacts);
              return (
                <li key={item.label}>
                  <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                    <span className="text-ink">{item.label}</span>
                    <span className="tabular font-medium text-muted">{item.value}/{snapshot.totalContacts} · {percentage}%</span>
                  </div>
                  <progress value={item.value} max={Math.max(1, snapshot.totalContacts)} className="h-2 w-full accent-accent" aria-label={`${item.label}: ${percentage}%`} />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sk-group bg-surface p-5 sm:p-6" aria-labelledby="sources-title">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-accent"><BarChart3 className="size-5" aria-hidden /></span>
            <div>
              <h2 id="sources-title" className="font-display text-2xl text-ink">Lead sources</h2>
              <p className="mt-1 text-sm text-muted">Where the current database says relationships began.</p>
            </div>
          </div>
          <ul className="mt-6 grid gap-px overflow-hidden rounded-[var(--sk-control-radius)] bg-line">
            {sources.map((source) => (
              <li key={source.id} className="flex min-h-12 items-center gap-3 bg-surface px-4">
                <span className="min-w-0 flex-1 text-sm text-ink">{source.label}</span>
                <span className="tabular text-sm font-medium text-muted">{source.count}</span>
                <span className="w-12 text-right text-xs text-subtle">{percent(source.count, snapshot.totalContacts)}%</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-5 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="funnel-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="funnel-title" className="font-display text-2xl text-ink">Stored pipeline evidence</h2><p className="mt-1 text-sm text-muted">Current stage counts plus immutable moves in the last 90 days.</p></div>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{analytics.evidence.transitionEvents}/500 transition events</span>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {analytics.stageMetrics.map((metric) => (
            <article key={metric.stage} className="min-w-0 rounded-[var(--sk-control-radius)] border border-line bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-xs font-semibold uppercase tracking-[0.08em] text-subtle">{metric.label}</p>
                <span className="tabular rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">{metric.evidenceCount} moves</span>
              </div>
              <p className="mt-4 font-display text-4xl leading-none text-ink">{metric.count}</p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                {metric.averageDaysInStage === null ? 'Waiting for enough transition history' : `${metric.averageDaysInStage} average days in stage`}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-5 grid gap-4 rounded-[var(--sk-control-radius)] border border-line bg-surface-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">90-day stage conversion</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">{analytics.conversion.definition} Window: {analytics.from.slice(0, 10)}–{analytics.to.slice(0, 10)}.</p>
          </div>
          <div className="sm:text-right">
            <p className="font-display text-3xl leading-none text-ink">{analytics.conversion.percentage === null ? 'Not enough history' : `${analytics.conversion.percentage}%`}</p>
            <p className="mt-2 text-xs text-subtle">{analytics.conversion.numerator} converted · {analytics.conversion.denominator} eligible</p>
          </div>
        </div>
      </section>

      <div className="mt-5 flex flex-col gap-4 rounded-[var(--sk-card-radius)] bg-surface-2 p-5 sm:flex-row sm:items-center sm:p-6">
        <ShieldCheck className="size-6 shrink-0 text-nurture" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-medium text-ink">Evidence boundary intact</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">Financial reporting begins only after deals, commission and expenses have a verified source of truth.</p>
        </div>
        <Link href="/pipeline" className="sk-secondary-button shrink-0">Open pipeline <ArrowUpRight className="size-4" aria-hidden /></Link>
      </div>
    </div>
  );
}
