import { ensureNextTouch } from './cadence.ts';
import {
  PIPELINE_LABEL,
  SOURCE_LABEL,
  type Contact,
  type LeadSource,
  type PipelineStage,
} from './contact.ts';
import { isMailingReady } from './mailer.ts';
import { buildTriage, summarise, type BucketTone } from './triage.ts';

export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = [
  'new',
  'contacted',
  'appointment-set',
  'active',
  'under-contract',
  'closed',
  'lost',
];

export const LEAD_SOURCE_ORDER: readonly LeadSource[] = [
  'cold-call',
  'open-house',
  'referral',
  'social-media',
  'website',
  'mailer',
  'other',
];

export interface PipelineColumn {
  stage: PipelineStage;
  label: string;
  contacts: Contact[];
}

export interface CountedLabel<T extends string> {
  id: T;
  label: string;
  count: number;
}

export interface DataReadiness {
  withPhone: number;
  withEmail: number;
  mailReady: number;
  withNextTouch: number;
  noDirectChannel: number;
}

export interface OmnixRecommendation {
  id: 'first-contact' | 'overdue' | 'address' | 'celebrations' | 'pipeline-risk';
  title: string;
  detail: string;
  evidence: string;
  count: number;
  contactIds: string[];
  href: string;
  tone: BucketTone;
}

export interface WorkspaceSnapshot {
  totalContacts: number;
  needsAttentionNow: number;
  pipeline: CountedLabel<PipelineStage>[];
  sources: CountedLabel<LeadSource>[];
  readiness: DataReadiness;
  recommendations: OmnixRecommendation[];
}

/** Stable pipeline view; every source contact appears in exactly one column. */
export function buildPipeline(contacts: readonly Contact[]): PipelineColumn[] {
  return PIPELINE_STAGE_ORDER.map((stage) => ({
    stage,
    label: PIPELINE_LABEL[stage],
    contacts: contacts.filter((contact) => contact.pipelineStage === stage),
  }));
}

function ids(contacts: readonly Contact[]): string[] {
  return contacts.map((contact) => contact.id);
}

/**
 * Explainable organization summary. It is intentionally deterministic: no model,
 * provider, autonomous action, revenue estimate, or market claim is hidden here.
 */
export function buildWorkspaceSnapshot(
  contacts: readonly Contact[],
  now: Date = new Date(),
  historicalImportContactIds: ReadonlySet<string> = new Set(),
): WorkspaceSnapshot {
  const prepared = contacts.map((contact) => ensureNextTouch(contact, now));
  const triage = buildTriage(prepared, now, { historicalImportContactIds });
  const triageSummary = summarise(triage);
  const bucket = (id: string) => triage.find((item) => item.id === id)?.entries ?? [];

  const firstContact = bucket('needs-first-contact').map((entry) => entry.contact);
  const overdue = bucket('overdue').map((entry) => entry.contact);
  const celebrations = bucket('celebrations').map((entry) => entry.contact);
  const missingAddress = prepared.filter((contact) => !isMailingReady(contact));
  const pipelineRisk = contacts.filter((contact) =>
    ['active', 'under-contract'].includes(contact.pipelineStage) && !contact.nextTouchAt);
  const noDirectChannel = prepared.filter((contact) => !contact.phone && !contact.email);

  const recommendations: OmnixRecommendation[] = [
    {
      id: 'first-contact',
      title: 'Reach new leads first',
      detail: 'They have no recorded conversation yet, so response time matters most.',
      evidence: 'No last-contact timestamp on an active contact.',
      count: firstContact.length,
      contactIds: ids(firstContact),
      href: '/',
      tone: 'hot',
    },
    {
      id: 'overdue',
      title: 'Recover overdue follow-ups',
      detail: 'Work the oldest missed promises before planning new outreach.',
      evidence: 'Next-touch date is earlier than today.',
      count: overdue.length,
      contactIds: ids(overdue),
      href: '/',
      tone: 'warm',
    },
    {
      id: 'address',
      title: 'Repair mailing records',
      detail: 'Complete these addresses before the next postcard campaign.',
      evidence: 'Street, city, state, or ZIP is blank.',
      count: missingAddress.length,
      contactIds: ids(missingAddress),
      href: '/mailers',
      tone: 'neutral',
    },
    {
      id: 'celebrations',
      title: 'Use relationship moments',
      detail: 'Birthdays and home anniversaries are timely reasons to reconnect.',
      evidence: 'An important date falls inside the configured reminder window.',
      count: celebrations.length,
      contactIds: ids(celebrations),
      href: '/',
      tone: 'nurture',
    },
    {
      id: 'pipeline-risk',
      title: 'Protect active deals',
      detail: 'Active or under-contract contacts should always have a next step.',
      evidence: 'Pipeline is active or under contract with no explicit next-touch date.',
      count: pipelineRisk.length,
      contactIds: ids(pipelineRisk),
      href: '/pipeline',
      tone: 'accent',
    },
  ];

  return {
    totalContacts: prepared.length,
    needsAttentionNow: triageSummary.needsAttentionNow,
    pipeline: buildPipeline(prepared).map((column) => ({
      id: column.stage,
      label: column.label,
      count: column.contacts.length,
    })),
    sources: LEAD_SOURCE_ORDER.map((source) => ({
      id: source,
      label: SOURCE_LABEL[source],
      count: prepared.filter((contact) => contact.source === source).length,
    })),
    readiness: {
      withPhone: prepared.filter((contact) => Boolean(contact.phone)).length,
      withEmail: prepared.filter((contact) => Boolean(contact.email)).length,
      mailReady: prepared.filter(isMailingReady).length,
      withNextTouch: prepared.filter((contact) => Boolean(contact.nextTouchAt)).length,
      noDirectChannel: noDirectChannel.length,
    },
    recommendations,
  };
}
