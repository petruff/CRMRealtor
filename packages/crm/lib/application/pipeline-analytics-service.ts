import type { RepositoryContext } from '../data/index.ts';
import { listActivityEventsCommand } from './activity-commands.ts';
import { buildPipelineAnalytics } from '../domain/pipeline-analytics.ts';
import { parseOperatingInsightPeriod } from '../domain/operating-insights.ts';

export type PipelineAnalyticsContext = Pick<RepositoryContext, 'repository' | 'activityRepository' | 'workspaceScope'>;

const PIPELINE_ANALYTICS_BOUND = 500;

function date(value: unknown, fallback: Date): Date {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Analytics date is invalid.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Analytics date is invalid.');
  return parsed;
}

export async function getPipelineAnalytics(
  context: PipelineAnalyticsContext,
  input: { from?: unknown; to?: unknown; period?: unknown } = {},
  now = new Date(),
) {
  const to = date(input.to, now);
  const period = input.period === undefined ? 90 : parseOperatingInsightPeriod(input.period);
  const from = date(input.from, new Date(to.getTime() - period * 86_400_000));
  if (from > to) throw new Error('Analytics from date must not be after to date.');
  const [contacts, events] = await Promise.all([
    context.repository.list(),
    listActivityEventsCommand(context.activityRepository, context.workspaceScope, {
      type: 'pipeline-stage-changed',
      to: to.toISOString(),
      limit: PIPELINE_ANALYTICS_BOUND,
    }),
  ]);
  return buildPipelineAnalytics({
    contacts,
    events,
    from: from.toISOString(),
    to: to.toISOString(),
    boundedAt: PIPELINE_ANALYTICS_BOUND,
    truncated: events.length >= PIPELINE_ANALYTICS_BOUND,
  });
}
