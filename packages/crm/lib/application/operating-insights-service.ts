import type { RepositoryContext } from '../data/index.ts';
import { listActivityEventsCommand, listTasksCommand } from './activity-commands.ts';
import {
  buildOperatingInsights,
  operatingInsightWindows,
  parseOperatingInsightPeriod,
} from '../domain/operating-insights.ts';
import type { ActivityEvent } from '../domain/activity.ts';
import { displayName } from '../domain/contact.ts';

const OPERATING_INSIGHTS_BOUND = 500;

export type OperatingInsightsContext = Pick<
  RepositoryContext,
  'repository' | 'activityRepository' | 'workspaceRepository' | 'workspaceScope'
>;

function mergeEvents(transitionEvents: readonly ActivityEvent[], periodEvents: readonly ActivityEvent[]) {
  const byId = new Map<string, ActivityEvent>();
  for (const event of [...transitionEvents, ...periodEvents]) byId.set(event.id, event);
  return [...byId.values()];
}

export async function getOperatingInsights(
  context: OperatingInsightsContext,
  input: { period?: unknown } = {},
  now = new Date(),
) {
  const periodDays = input.period === undefined ? 90 : parseOperatingInsightPeriod(input.period);
  const windows = operatingInsightWindows(periodDays, now);
  const [contacts, transitionEvents, periodEvents, tasks, memberships] = await Promise.all([
    context.repository.list(),
    listActivityEventsCommand(context.activityRepository, context.workspaceScope, {
      type: 'pipeline-stage-changed', to: windows.current.to, limit: OPERATING_INSIGHTS_BOUND,
    }),
    listActivityEventsCommand(context.activityRepository, context.workspaceScope, {
      from: windows.previous.from, to: windows.current.to, limit: OPERATING_INSIGHTS_BOUND,
    }),
    listTasksCommand(context.activityRepository, context.workspaceScope, { status: 'all', limit: OPERATING_INSIGHTS_BOUND }),
    context.workspaceRepository.listMemberships(context.workspaceScope),
  ]);
  const events = mergeEvents(transitionEvents, periodEvents);
  const report = buildOperatingInsights({
    periodDays, mode: context.workspaceScope.mode, currentWindow: windows.current, previousWindow: windows.previous,
    contacts, events, tasks, memberships,
    contactBoundedAt: OPERATING_INSIGHTS_BOUND,
    transitionEventBoundedAt: OPERATING_INSIGHTS_BOUND,
    eventBoundedAt: OPERATING_INSIGHTS_BOUND * 2,
    taskBoundedAt: OPERATING_INSIGHTS_BOUND,
    contactsTruncated: contacts.length === OPERATING_INSIGHTS_BOUND,
    eventsTruncated: transitionEvents.length === OPERATING_INSIGHTS_BOUND || periodEvents.length === OPERATING_INSIGHTS_BOUND,
    tasksTruncated: tasks.length === OPERATING_INSIGHTS_BOUND,
  });
  return {
    ...report,
    contactDisplayNames: new Map(contacts.map((contact) => [contact.id, displayName(contact)] as const)),
    taskDisplayNames: new Map(tasks.map((task) => [task.id, task.title] as const)),
  };
}
