import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight,
  BrainCircuit,
  CalendarHeart,
  CircleAlert,
  ListChecks,
  MapPinned,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getRepository } from '@/lib/data';
import { buildWorkspaceSnapshot } from '@/lib/domain/workspace-intelligence';
import { readWorkspaceAiCapabilityStatus } from '@/lib/application/workspace-ai-settings';
import { OmnixCopilot } from '@/components/omnix-copilot';
import { askOmnixCopilotAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Omnix AI' };

const ICONS = {
  'first-contact': CircleAlert,
  overdue: ListChecks,
  address: MapPinned,
  celebrations: CalendarHeart,
  'pipeline-risk': ShieldCheck,
} as const;

const TONES = {
  hot: 'border-hot-border bg-hot-soft text-hot',
  warm: 'border-warm-border bg-warm-soft text-warm',
  nurture: 'border-nurture-border bg-nurture-soft text-nurture',
  accent: 'border-line-strong bg-surface-2 text-accent',
  neutral: 'border-line bg-surface-2 text-muted',
} as const;

export default async function OmnixPage() {
  const { repository, workspaceScope } = await getRepository();
  const snapshot = buildWorkspaceSnapshot(await repository.list());
  const actionable = snapshot.recommendations.filter((item) => item.count > 0);
  const aiCapability = await readWorkspaceAiCapabilityStatus(workspaceScope)
    .catch(() => ({ state: 'failed' as const }));
  const aiCopy = aiCapability.state === 'available'
    ? 'Gemini is available for grounded summaries and safe, reviewable recommendations. Nothing is sent, changed, or scheduled without your approval.'
    : aiCapability.state === 'failed'
      ? 'Your deterministic CRM brief is available, but Omnix could not confirm the AI connection. Review AI setup before relying on generated summaries.'
      : 'Your deterministic CRM brief is ready. The workspace owner can connect Gemini in Settings for grounded summaries and reviewable recommendations.';

  return (
    <div>
      <header className="mb-9 md:mb-12">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Omnix Intelligence</p>
          <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {aiCapability.state === 'available' ? 'Gemini ready' : aiCapability.state === 'failed' ? 'AI needs attention' : 'AI setup available'}
          </span>
        </div>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Your business, <br /><span className="text-muted">already organized.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
          {aiCopy}
        </p>
        {aiCapability.state !== 'available' ? (
          <Link href="/settings#ai" className="sk-secondary-button mt-4 inline-flex">Review AI setup <ArrowUpRight className="size-4" aria-hidden /></Link>
        ) : null}
      </header>

      <section aria-labelledby="brief-title">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-accent text-white"><Sparkles className="size-[18px]" aria-hidden /></span>
          <div>
            <h2 id="brief-title" className="font-display text-2xl text-ink">Today’s brief</h2>
            <p className="text-sm text-muted">Every recommendation includes the rule that produced it.</p>
          </div>
        </div>

        {actionable.length ? (
          <div className="sk-group grid gap-px lg:grid-cols-2">
            {actionable.map((item) => {
              const Icon = ICONS[item.id];
              return (
                <article key={item.id} className="flex min-w-0 flex-col bg-surface p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-2xl border ${TONES[item.tone]}`}><Icon className="size-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-display text-xl leading-tight text-ink">{item.title}</h3>
                        <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{item.count}</span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{item.detail}</p>
                    </div>
                  </div>
                  <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-subtle"><span className="font-medium text-muted">Evidence:</span> {item.evidence}</p>
                  <Link href={item.href} className="sk-secondary-button mt-3 self-start">Review records <ArrowUpRight className="size-4" aria-hidden /></Link>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="rounded-[var(--sk-card-radius)] bg-surface-2 px-6 py-10 text-center text-sm text-muted">No current recommendation needs attention.</p>
        )}
      </section>

      <OmnixCopilot action={askOmnixCopilotAction} />

      <section className="mt-8 rounded-[var(--sk-card-radius)] bg-surface-2 p-5 sm:p-6" aria-labelledby="contract-title">
        <div className="flex items-start gap-3">
          <BrainCircuit className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden />
          <div>
            <h2 id="contract-title" className="font-display text-2xl text-ink">How Omnix keeps you in control</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              Omnix bases recommendations on your CRM records. You review client messages, calendar changes, and pipeline updates before anything is sent or changed.
            </p>
          </div>
        </div>
        <ul className="mt-5 grid gap-px overflow-hidden rounded-[var(--sk-control-radius)] bg-line sm:grid-cols-3">
          {[
            ['Use your CRM', 'Base answers on the records available to your account.'],
            ['Ask before acting', 'Preview important changes before they happen.'],
            ['Keep a history', 'Show what changed and whether it completed.'],
          ].map(([title, detail]) => (
            <li key={title} className="bg-surface p-4">
              <p className="text-sm font-medium text-ink">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
