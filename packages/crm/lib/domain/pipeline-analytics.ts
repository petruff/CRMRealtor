import { PIPELINE_LABEL, type Contact, type PipelineStage } from './contact.ts';
import type { ActivityEvent } from './activity.ts';

export interface PipelineStageMetric {
  readonly stage: PipelineStage;
  readonly label: string;
  readonly count: number;
  readonly averageDaysInStage: number | null;
  readonly evidenceCount: number;
}

export interface PipelineConversionMetric {
  readonly status: 'available' | 'insufficient-evidence';
  readonly numerator: number;
  readonly denominator: number;
  readonly percentage: number | null;
  readonly definition: string;
}

export interface PipelineAnalyticsReport {
  readonly schemaVersion: 'pipeline-analytics.v1';
  readonly from: string;
  readonly to: string;
  readonly contactCount: number;
  readonly stageMetrics: readonly PipelineStageMetric[];
  readonly sourceCounts: readonly { source: Contact['source']; count: number }[];
  readonly conversion: PipelineConversionMetric;
  readonly evidence: { readonly transitionEvents: number; readonly boundedAt: number };
}

function transition(event: ActivityEvent): { from: PipelineStage; to: PipelineStage } | undefined {
  if (event.type !== 'pipeline-stage-changed') return undefined;
  const from = event.metadata?.fromStage;
  const to = event.metadata?.toStage;
  if (typeof from !== 'string' || typeof to !== 'string' || !(from in PIPELINE_LABEL) || !(to in PIPELINE_LABEL)) return undefined;
  return { from: from as PipelineStage, to: to as PipelineStage };
}

export function buildPipelineAnalytics(input: {
  contacts: readonly Contact[];
  events: readonly ActivityEvent[];
  from: string;
  to: string;
  boundedAt?: number;
}): PipelineAnalyticsReport {
  const inWindow = input.events.filter((event) => event.occurredAt >= input.from && event.occurredAt <= input.to)
    .map((event) => ({ event, transition: transition(event) }))
    .filter((item): item is { event: ActivityEvent; transition: { from: PipelineStage; to: PipelineStage } } => Boolean(item.transition));
  const latestByContact = new Map<string, ActivityEvent>();
  for (const event of input.events) {
    if (!event.contactId || !transition(event)) continue;
    const known = latestByContact.get(event.contactId);
    if (!known || event.occurredAt > known.occurredAt) latestByContact.set(event.contactId, event);
  }
  const toMs = new Date(input.to).getTime();
  const stageMetrics = (Object.keys(PIPELINE_LABEL) as PipelineStage[]).map((stage): PipelineStageMetric => {
    const contacts = input.contacts.filter((contact) => contact.pipelineStage === stage);
    const durations = contacts.map((contact) => latestByContact.get(contact.id))
      .filter((event): event is ActivityEvent => Boolean(event))
      .map((event) => Math.max(0, (toMs - new Date(event.occurredAt).getTime()) / 86_400_000));
    return {
      stage, label: PIPELINE_LABEL[stage], count: contacts.length,
      averageDaysInStage: durations.length ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null,
      evidenceCount: durations.length,
    };
  });
  const numerator = inWindow.filter((item) => item.transition.to === 'closed').length;
  const denominator = inWindow.filter((item) => item.transition.from === 'new').length;
  const sourceCounts = Array.from(new Set(input.contacts.map((contact) => contact.source))).sort()
    .map((source) => ({ source, count: input.contacts.filter((contact) => contact.source === source).length }));
  return {
    schemaVersion: 'pipeline-analytics.v1', from: input.from, to: input.to,
    contactCount: input.contacts.length, stageMetrics, sourceCounts,
    conversion: {
      status: denominator ? 'available' : 'insufficient-evidence', numerator, denominator,
      percentage: denominator ? Math.round((numerator / denominator) * 1000) / 10 : null,
      definition: 'Closed-stage entries divided by moves out of New during the selected window.',
    },
    evidence: { transitionEvents: inWindow.length, boundedAt: input.boundedAt ?? 500 },
  };
}
