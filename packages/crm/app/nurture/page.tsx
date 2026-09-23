import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CirclePause, CirclePlay, ExternalLink, MoonStar, ShieldCheck, StopCircle } from 'lucide-react';
import { getRepository } from '@/lib/data';
import type { NurturePlan } from '@/lib/domain/nurture-plan';
import { transitionNurturePlanAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Nurture Plans' };

const STATE = {
  active: ['Active', 'bg-nurture-soft text-nurture border-nurture-border'],
  paused: ['Paused', 'bg-warm-soft text-warm border-warm-border'],
  snoozed: ['Snoozed', 'bg-accent-soft text-accent border-line-strong'],
  stopped: ['Stopped', 'bg-surface-2 text-muted border-line'],
  completed: ['Completed', 'bg-nurture-soft text-nurture border-nurture-border'],
} as const;

function date(value?: string): string {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No next step';
}

function PlanActions({ plan }: { plan: NurturePlan }) {
  if (plan.state === 'stopped' || plan.state === 'completed') return null;
  return (
    <div className="mt-5 grid gap-2 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
      {plan.state === 'active' || plan.state === 'snoozed' ? (
        <form action={transitionNurturePlanAction}>
          <input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="version" value={plan.version} />
          <button name="action" value="pause" className="sk-secondary-button w-full justify-center"><CirclePause className="size-4" aria-hidden />Pause</button>
        </form>
      ) : null}
      {plan.state === 'paused' || plan.state === 'snoozed' ? (
        <form action={transitionNurturePlanAction}>
          <input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="version" value={plan.version} />
          <button name="action" value="resume" className="sk-button-primary w-full justify-center"><CirclePlay className="size-4" aria-hidden />Resume</button>
        </form>
      ) : null}
      {plan.state === 'active' ? (
        <form action={transitionNurturePlanAction} className="flex gap-2">
          <input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="version" value={plan.version} />
          <select name="days" aria-label="Snooze duration" className="min-h-11 min-w-0 flex-1 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3 text-sm">
            <option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option>
          </select>
          <button name="action" value="snooze" className="sk-secondary-button justify-center"><MoonStar className="size-4" aria-hidden />Snooze</button>
        </form>
      ) : null}
      <form action={transitionNurturePlanAction} className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="version" value={plan.version} />
        <input name="stopReason" required maxLength={240} placeholder="Reason to stop" className="min-h-11 min-w-0 flex-1 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3 text-sm" />
        <button name="action" value="stop" className="sk-secondary-button justify-center"><StopCircle className="size-4" aria-hidden />Stop</button>
      </form>
    </div>
  );
}

export default async function NurturePage() {
  const context = await getRepository();
  const plans = await context.nurturePlanRepository.list(context.workspaceScope, { limit: 100 });
  const contacts = new Map((await context.repository.list()).map((contact) => [contact.id, contact]));
  const current = plans.filter((plan) => ['active', 'paused', 'snoozed'].includes(plan.state)).length;
  return (
    <div>
      <header className="mb-8 md:mb-10">
        <p className="eyebrow">Relationship automation</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.02] text-ink sm:text-5xl md:text-[3.6rem]">Nurture with <span className="text-muted">control.</span></h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">Keep every relationship moving while retaining a visible pause, snooze and stop control. Omnix prepares each step for review; it never sends automatically.</p>
      </header>
      <section className="mb-6 grid overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-line sm:grid-cols-2">
        <article className="flex min-h-28 items-end justify-between bg-surface p-5"><div><strong className="font-display text-4xl text-ink">{current}</strong><p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-muted">Current plans</p></div><CalendarClock className="size-5 text-accent" aria-hidden /></article>
        <article className="flex min-h-28 items-end justify-between bg-surface p-5"><div><strong className="font-display text-4xl text-ink">{plans.length}</strong><p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-muted">Plan history</p></div><ShieldCheck className="size-5 text-nurture" aria-hidden /></article>
      </section>
      {plans.length ? <section className="grid gap-4" aria-label="Nurture plans">{plans.map((plan) => {
        const contact = contacts.get(plan.contactId);
        const name = contact ? `${contact.preferredName || contact.firstName} ${contact.lastName}`.trim() : 'Contact';
        const [label, tone] = STATE[plan.state];
        return <article id={`plan-${plan.id}`} key={plan.id} className="scroll-mt-24 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tone}`}>{label}</span><h2 className="mt-3 font-display text-2xl text-ink">{name}</h2><p className="mt-1 text-sm text-muted">Every {plan.cadenceDays} days · Step {plan.currentStep + 1} of {plan.maximumSteps}</p></div><Link href={`/contacts/${plan.contactId}`} className="sk-secondary-button">Open contact <ExternalLink className="size-4" aria-hidden /></Link></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-[var(--sk-control-radius)] bg-surface-2 p-4"><p className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">Next review</p><p className="mt-1 text-sm font-medium text-ink">{date(plan.state === 'snoozed' ? plan.snoozedUntil : plan.nextStepAt)}</p></div><div className="rounded-[var(--sk-control-radius)] bg-surface-2 p-4"><p className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">Version</p><p className="mt-1 text-sm font-medium text-ink">{plan.version} · history preserved</p></div></div>
          {plan.stopReason ? <p className="mt-4 text-sm text-muted">Stopped because: {plan.stopReason}</p> : null}
          <PlanActions plan={plan} />
        </article>;
      })}</section> : <section className="rounded-[var(--sk-card-radius)] border border-line bg-surface px-6 py-14 text-center"><CalendarClock className="mx-auto size-8 text-accent" aria-hidden /><h2 className="mt-4 font-display text-2xl text-ink">No nurture plans yet.</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted">Ask Omnix to propose a relationship plan, then review the exact cadence in Approvals.</p><Link href="/omnix" className="sk-button-primary mt-5 inline-flex">Ask Omnix</Link></section>}
    </div>
  );
}
