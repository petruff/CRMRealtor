import Link from 'next/link';
import type { LeadType, Relationship } from '@/lib/domain/contact';
import { LEAD_TYPE_LABEL, RELATIONSHIP_LABEL } from '@/lib/domain/contact';
import type { BucketTone } from '@/lib/domain/triage';

/**
 * Tailwind cannot compose class names at runtime, so tone mappings are explicit
 * lookup tables rather than string interpolation.
 */

const LEAD_STYLES: Record<LeadType, string> = {
  hot: 'bg-hot-soft text-hot border-hot-border',
  warm: 'bg-warm-soft text-warm border-warm-border',
  nurture: 'bg-nurture-soft text-nurture border-nurture-border',
};

const LEAD_DOT: Record<LeadType, string> = {
  hot: 'bg-hot',
  warm: 'bg-warm',
  nurture: 'bg-nurture',
};

const TONE_ACCENT: Record<BucketTone, string> = {
  hot: 'text-hot',
  warm: 'text-warm',
  nurture: 'text-nurture',
  accent: 'text-accent',
  neutral: 'text-muted',
};

const TONE_RULE: Record<BucketTone, string> = {
  hot: 'bg-hot',
  warm: 'bg-warm',
  nurture: 'bg-nurture',
  accent: 'bg-accent',
  neutral: 'bg-line-strong',
};

export function LeadBadge({
  leadType,
  relationship,
}: {
  leadType: LeadType;
  relationship?: Relationship;
}) {
  if (relationship === 'past-client' || relationship === 'active-client') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        {RELATIONSHIP_LABEL[relationship]}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${LEAD_STYLES[leadType]}`}
    >
      <span className={`size-1.5 rounded-full ${LEAD_DOT[leadType]}`} aria-hidden />
      {LEAD_TYPE_LABEL[leadType]}
    </span>
  );
}

export function Avatar({ initials, leadType, relationship }: { initials: string; leadType: LeadType; relationship?: Relationship }) {
  const relationshipStyle = relationship === 'past-client' || relationship === 'active-client'
    ? 'border-line bg-surface-2 text-muted'
    : LEAD_STYLES[leadType];
  return (
    <span
      aria-hidden
      className={`grid size-11 shrink-0 place-items-center rounded-full border text-sm font-medium tracking-tight ${relationshipStyle}`}
    >
      {initials}
    </span>
  );
}

export function SectionHeader({
  title,
  blurb,
  count,
  tone,
}: {
  title: string;
  blurb: string;
  count: number;
  tone: BucketTone;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <span className={`size-2 rounded-full ${TONE_RULE[tone]}`} aria-hidden />
        <h2 className="font-display text-xl leading-tight text-ink md:text-2xl">{title}</h2>
        <span className={`tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold ${TONE_ACCENT[tone]}`}>
          {count}
        </span>
      </div>
      <p className="mt-1.5 pl-[18px] text-sm leading-snug text-muted">{blurb}</p>
    </div>
  );
}

export type ActionVariant = 'primary' | 'secondary' | 'text';

export function ActionLink({
  href,
  variant = 'secondary',
  children,
  className = '',
}: {
  href: string;
  variant?: ActionVariant;
  children: React.ReactNode;
  className?: string;
}) {
  const classes = `${variant === 'primary' ? 'sk-primary-button' : variant === 'secondary' ? 'sk-secondary-button' : 'sk-text-action'} ${className}`;
  return href.startsWith('/') && !href.startsWith('//')
    ? <Link href={href} className={classes}>{children}</Link>
    : <a href={href} className={classes}>{children}</a>;
}

export function EmptyState({
  message,
  title,
  action,
}: {
  message: string;
  title?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-[var(--sk-card-radius)] border border-line bg-surface-2 px-5 py-8 text-center">
      {title ? <h3 className="font-display text-xl text-ink">{title}</h3> : null}
      <p className={`${title ? 'mt-2' : ''} text-sm leading-relaxed text-muted`}>{message}</p>
      {action ? <ActionLink href={action.href} className="mt-5">{action.label}</ActionLink> : null}
    </div>
  );
}

export function StatTile({
  value,
  label,
  tone = 'neutral',
}: {
  value: number | string;
  label: string;
  tone?: BucketTone;
}) {
  return (
    <div className="min-h-24 bg-surface p-4 sm:p-5">
      <p className={`tabular font-display text-3xl font-semibold leading-none ${TONE_ACCENT[tone]}`}>{value}</p>
      <p className="mt-2 text-xs leading-tight text-muted">{label}</p>
    </div>
  );
}

export function GroupedSurface({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`sk-group ${className}`}>{children}</div>;
}

export function IconAction({
  href,
  label,
  children,
  callContact,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  /** For tel: links — lets Omnix offer to log the call afterwards. */
  callContact?: { id: string; name: string };
}) {
  return (
    <a href={href} aria-label={label} title={label} className="sk-icon-button"
      {...(callContact ? { 'data-call-contact': callContact.id, 'data-call-name': callContact.name } : {})}>
      {children}
    </a>
  );
}
