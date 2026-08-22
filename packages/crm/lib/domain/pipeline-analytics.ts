import { PIPELINE_LABEL, type Contact, type PipelineStage } from './contact.ts';
import type { ActivityEvent } from './activity.ts';

const DAY_MS = 86_400_000;

export interface PipelineStageMetric {
  readonly stage: PipelineStage;
  readonly label: string;
  readonly count: number;
  readonly averageDaysInStage: number | null;
  readonly evidenceCount: number;
  readonly contributors: readonly {
    readonly recordId: string;
    readonly href: string;
    readonly daysInStage: number | null;
  }[];
}

export interface PipelineConversionMetric {
  readonly status: 'available' | 'insufficient-evidence';
  readonly numerator: number;
  readonly denominator: number;
  readonly percentage: number | null;
  readonly definition: string;
  readonly eligibleContactIds: readonly string[];
  readonly closedContactIds: readonly string[];
}

export interface PipelineAnalyticsEvidence {
  readonly transitionEvents: number;
  readonly observedEvents: number;
  readonly boundedAt: number;
  readonly coverage: 'complete' | 'possibly-truncated';
  readonly truncated: boolean;
}

export interface PipelineAnalyticsReport {
  readonly schemaVersion: 'pipeline-analytics.v1';
  readonly from: string;
  readonly to: string;
  readonly contactCount: number;
  readonly stageMetrics: readonly PipelineStageMetric[];
  readonly sourceCounts: readonly { source: Contact['source']; count: number }[];
  readonly conversion: PipelineConversionMetric;
  readonly evidence: PipelineAnalyticsEvidence;
}

interface TransitionEvidence {
  readonly event: ActivityEvent;
  readonly contactId?: string;
  readonly from: PipelineStage;
  readonly to: PipelineStage;
}

function transition(event: ActivityEvent): TransitionEvidence | undefined {
  if (event.type !== 'pipeline-stage-changed') return undefined;
  const from = event.metadata?.fromStage;
  const to = event.metadata?.toStage;
  if (
    typeof from !== 'string'
    || typeof to !== 'string'
    || !(from in PIPELINE_LABEL)
    || !(to in PIPELINE_LABEL)
  ) return undefined;
  return {
    event,
    ...(event.contactId ? { contactId: event.contactId } : {}),
    from: from as PipelineStage,
    to: to as PipelineStage,
  };
}

function chronological(left: TransitionEvidence, right: TransitionEvidence): number {
  return left.event.occurredAt.localeCompare(right.event.occurredAt)
    || left.event.id.localeCompare(right.event.id);
}

function conversionForWindow(transitions: readonly TransitionEvidence[]): PipelineConversionMetric {
  const eligibleAtByContact = new Map<string, string>();
  const convertedContacts = new Set<string>();

  for (const item of [...transitions].sort(chronological)) {
    if (!item.contactId) continue;
    if (item.from === 'new') {
      const known = eligibleAtByContact.get(item.contactId);
      if (!known || item.event.occurredAt < known) {
        eligibleAtByContact.set(item.contactId, item.event.occurredAt);
      }
    }
    const eligibleAt = eligibleAtByContact.get(item.contactId);
    if (item.to === 'closed' && eligibleAt !== undefined && item.event.occurredAt > eligibleAt) {
      convertedContacts.add(item.contactId);
    }
  }

  const eligibleContactIds = [...eligibleAtByContact.keys()].sort();
  const closedContactIds = [...convertedContacts].sort();
  const denominator = eligibleContactIds.length;
  const numerator = convertedContacts.size;
  return {
    status: denominator ? 'available' : 'insufficient-evidence',
    numerator,
    denominator,
    percentage: denominator ? Math.round((numerator / denominator) * 1_000) / 10 : null,
    definition: 'Unique contacts reaching Closed after moving out of New during the selected window, divided by that same unique-contact cohort.',
    eligibleContactIds,
    closedContactIds,
  };
}

export function buildPipelineAnalytics(input: {
  contacts: readonly Contact[];
  events: readonly ActivityEvent[];
  from: string;
  to: string;
  boundedAt?: number;
  truncated?: boolean;
}): PipelineAnalyticsReport {
  const boundedAt = input.boundedAt ?? 500;
  const toMs = new Date(input.to).getTime();
  const transitions = input.events
    .map(transition)
    .filter((item): item is TransitionEvidence => Boolean(item))
    .filter((item) => item.event.occurredAt <= input.to);
  const inWindow = transitions.filter((item) => (
    item.event.occurredAt >= input.from && item.event.occurredAt <= input.to
  ));

  const latestEntryByContactAndStage = new Map<string, ActivityEvent>();
  for (const item of transitions) {
    if (!item.contactId) continue;
    const key = `${item.contactId}:${item.to}`;
    const known = latestEntryByContactAndStage.get(key);
    if (
      !known
      || item.event.occurredAt > known.occurredAt
      || (item.event.occurredAt === known.occurredAt && item.event.id > known.id)
    ) latestEntryByContactAndStage.set(key, item.event);
  }

  const stageMetrics = (Object.keys(PIPELINE_LABEL) as PipelineStage[]).map((stage): PipelineStageMetric => {
    const contacts = input.contacts.filter((contact) => contact.pipelineStage === stage);
    const durations = contacts
      .map((contact) => latestEntryByContactAndStage.get(`${contact.id}:${stage}`))
      .filter((event): event is ActivityEvent => Boolean(event))
      .map((event) => Math.max(0, (toMs - new Date(event.occurredAt).getTime()) / DAY_MS));
    return {
      stage,
      label: PIPELINE_LABEL[stage],
      count: contacts.length,
      averageDaysInStage: durations.length
        ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
        : null,
      evidenceCount: durations.length,
      contributors: contacts.map((contact) => {
        const entry = latestEntryByContactAndStage.get(`${contact.id}:${stage}`);
        return {
          recordId: contact.id,
          href: `/contacts/${encodeURIComponent(contact.id)}`,
          daysInStage: entry
            ? Math.round(Math.max(0, (toMs - new Date(entry.occurredAt).getTime()) / DAY_MS) * 10) / 10
            : null,
        };
      }),
    };
  });

  const sourceCounts = Array.from(new Set(input.contacts.map((contact) => contact.source)))
    .sort()
    .map((source) => ({
      source,
      count: input.contacts.filter((contact) => contact.source === source).length,
    }));
  const truncated = input.truncated ?? input.events.length >= boundedAt;

  return {
    schemaVersion: 'pipeline-analytics.v1',
    from: input.from,
    to: input.to,
    contactCount: input.contacts.length,
    stageMetrics,
    sourceCounts,
    conversion: conversionForWindow(inWindow),
    evidence: {
      transitionEvents: inWindow.length,
      observedEvents: input.events.length,
      boundedAt,
      coverage: truncated ? 'possibly-truncated' : 'complete',
      truncated,
    },
  };
}
