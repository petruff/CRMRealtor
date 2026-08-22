import type { RepositoryContext } from '../data/index.ts';
import { listActivityEventsCommand } from './activity-commands.ts';
import { buildPipelineAnalytics } from '../domain/pipeline-analytics.ts';

export type PipelineAnalyticsContext = Pick<RepositoryContext, 'repository' | 'activityRepository' | 'workspaceScope'>;

function date(value: unknown, fallback: Date): Date {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Analytics date is invalid.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Analytics date is invalid.');
  return parsed;
}

export async function getPipelineAnalytics(
  context: PipelineAnalyticsContext,
  input: { from?: unknown; to?: unknown } = {},
  now = new Date(),
) {
  const to = date(input.to, now);
  const from = date(input.from, new Date(to.getTime() - 90 * 86_400_000));
  if (from > to) throw new Error('Analytics from date must not be after to date.');
  const [contacts, events] = await Promise.all([
    context.repository.list(),
    listActivityEventsCommand(context.activityRepository, context.workspaceScope, {
      from: from.toISOString(), to: to.toISOString(), limit: 500,
    }),
  ]);
  return buildPipelineAnalytics({ contacts, events, from: from.toISOString(), to: to.toISOString(), boundedAt: 500 });
}
