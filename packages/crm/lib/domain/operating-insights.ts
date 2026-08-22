import type { ActivityEvent, CrmTask } from './activity.ts';
import {
  INTENT_LABEL,
  LEAD_TYPE_LABEL,
  PIPELINE_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  type Contact,
  type LeadSource,
  type PipelineStage,
} from './contact.ts';
import { buildWorkspaceSnapshot } from './workspace-intelligence.ts';
import { buildPipelineAnalytics, type PipelineAnalyticsReport } from './pipeline-analytics.ts';
import type { WorkspaceMembership, WorkspaceRole } from './workspace.ts';
import { ensureNextTouch } from './cadence.ts';
import { buildTriage } from './triage.ts';
import { isMailingReady } from './mailer.ts';

const DAY_MS = 86_400_000;
const DEFAULT_BOUND = 500;
const PROGRESSION_STAGES: ReadonlySet<PipelineStage> = new Set([
  'appointment-set',
  'active',
  'under-contract',
  'closed',
]);

export const OPERATING_INSIGHT_PERIODS = [30, 90, 365] as const;
export type OperatingInsightPeriod = (typeof OPERATING_INSIGHT_PERIODS)[number];
export type InsightAvailability = 'available' | 'possibly-truncated' | 'unavailable';
export type InsightCoverageStatus = 'complete' | 'possibly-truncated' | 'unavailable';

export interface OperatingInsightWindow {
  readonly from: string;
  readonly to: string;
}

export interface OperatingInsightCoverage {
  readonly status: InsightCoverageStatus;
  readonly rows: number | null;
  readonly boundedAt: number | null;
  readonly truncated: boolean;
}

export interface TaskRhythmPeriod {
  readonly created: number | null;
  readonly completed: number | null;
  readonly sameCohortCompleted: number | null;
  readonly sameCohortCompletionPercentage: number | null;
  readonly createdTaskIds: readonly string[];
  readonly completedTaskIds: readonly string[];
  readonly sameCohortCompletedTaskIds: readonly string[];
}

export interface TaskWorkloadSnapshot {
  readonly open: number | null;
  readonly overdue: number | null;
  readonly dueSoon: number | null;
  readonly completedInPeriod: number | null;
  readonly dueWorkCompletionPercentage: number | null;
  readonly onTimeCompletionPercentage: number | null;
  readonly openTaskIds: readonly string[];
  readonly overdueTaskIds: readonly string[];
  readonly dueSoonTaskIds: readonly string[];
  readonly completedInPeriodTaskIds: readonly string[];
}

export interface OperatingInsightsReport {
  readonly schemaVersion: 'operating-insights.v1';
  readonly mode: 'live' | 'sample';
  readonly periodDays: OperatingInsightPeriod;
  readonly currentWindow: OperatingInsightWindow;
  readonly previousWindow: OperatingInsightWindow;
  readonly pipeline: {
    readonly status: InsightAvailability;
    readonly current: PipelineAnalyticsReport;
    readonly previous: Pick<PipelineAnalyticsReport, 'from' | 'to' | 'conversion' | 'evidence'>;
    readonly conversionPercentagePointChange: number | null;
  };
  readonly portfolio: {
    readonly status: InsightAvailability;
    readonly totalContacts: number | null;
    readonly leadTypes: readonly {
      leadType: Contact['leadType'];
      label: string;
      count: number;
      contactIds: readonly string[];
    }[];
    readonly health: {
      readonly needsAttention: number | null;
      readonly overdue: number | null;
      readonly neverContacted: number | null;
      readonly needsQualification: number | null;
      readonly progressing: number | null;
      readonly underContract: number | null;
    };
    readonly readiness: {
      readonly withPhone: number | null;
      readonly withEmail: number | null;
      readonly mailReady: number | null;
      readonly withNextTouch: number | null;
    };
    readonly contributors: {
      readonly allContactIds: readonly string[];
      readonly needsAttentionContactIds: readonly string[];
      readonly overdueContactIds: readonly string[];
      readonly neverContactedContactIds: readonly string[];
      readonly needsQualificationContactIds: readonly string[];
      readonly progressingContactIds: readonly string[];
      readonly underContractContactIds: readonly string[];
      readonly withPhoneContactIds: readonly string[];
      readonly withEmailContactIds: readonly string[];
      readonly mailReadyContactIds: readonly string[];
      readonly withNextTouchContactIds: readonly string[];
    };
    readonly relationships: readonly {
      relationship: Contact['relationship'];
      label: string;
      count: number;
    }[];
    readonly intents: readonly {
      intent: Contact['intent'];
      label: string;
      count: number;
    }[];
    readonly stages: readonly {
      stage: PipelineStage;
      label: string;
      count: number;
    }[];
  };
  readonly sourceProgression: {
    readonly status: InsightAvailability;
    readonly sources: readonly {
      source: LeadSource;
      label: string;
      contactCount: number;
      current: {
        readonly progressedContacts: number;
        readonly closedContacts: number;
        readonly progressedContactIds: readonly string[];
        readonly closedContactIds: readonly string[];
      };
      previous: {
        readonly progressedContacts: number;
        readonly closedContacts: number;
        readonly progressedContactIds: readonly string[];
        readonly closedContactIds: readonly string[];
      };
      progressedContactChange: number;
    }[];
  };
  readonly taskRhythm: {
    readonly status: InsightAvailability;
    readonly current: TaskRhythmPeriod;
    readonly previous: TaskRhythmPeriod;
    readonly workload: TaskWorkloadSnapshot;
    readonly change: {
      readonly created: number | null;
      readonly completed: number | null;
      readonly completionPercentagePoints: number | null;
    };
  };
  readonly ownerAssistant: {
    readonly status: InsightAvailability;
    readonly roles: readonly {
      membershipId?: string;
      role: WorkspaceRole | null;
      attribution: 'active-member' | 'unassigned' | 'inactive-or-unknown';
      label: string;
      createdTasks: number | null;
      completedTasks: number | null;
      openAssignedTasks: number | null;
      overdueAssignedTasks: number | null;
    }[];
    readonly unattributedTaskEvents: number | null;
    readonly unassignedOpenTasks: number | null;
    readonly inactiveAssignedOpenTasks: number | null;
  };
  readonly finance: {
    readonly status: 'unavailable';
    readonly reason: string;
  };
  readonly coverage: {
    readonly status: InsightCoverageStatus;
    readonly truncated: boolean;
    readonly contacts: OperatingInsightCoverage;
    readonly events: OperatingInsightCoverage;
    readonly tasks: OperatingInsightCoverage;
    readonly memberships: OperatingInsightCoverage;
  };
}

export function parseOperatingInsightPeriod(value: unknown): OperatingInsightPeriod {
  const period = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!OPERATING_INSIGHT_PERIODS.includes(period as OperatingInsightPeriod)) {
    throw new Error('Analytics period must be 30, 90, or 365 days.');
  }
  return period as OperatingInsightPeriod;
}

export function operatingInsightWindows(
  periodDays: OperatingInsightPeriod,
  now = new Date(),
): { current: OperatingInsightWindow; previous: OperatingInsightWindow } {
  if (!Number.isFinite(now.getTime())) throw new Error('Analytics date is invalid.');
  const toMs = now.getTime();
  const currentFromMs = toMs - periodDays * DAY_MS;
  return {
    current: {
      from: new Date(currentFromMs).toISOString(),
      to: now.toISOString(),
    },
    previous: {
      from: new Date(currentFromMs - periodDays * DAY_MS).toISOString(),
      to: new Date(currentFromMs - 1).toISOString(),
    },
  };
}

function inWindow(occurredAt: string, window: OperatingInsightWindow): boolean {
  return occurredAt >= window.from && occurredAt <= window.to;
}

function unavailableRhythm(): TaskRhythmPeriod {
  return {
    created: null,
    completed: null,
    sameCohortCompleted: null,
    sameCohortCompletionPercentage: null,
    createdTaskIds: [],
    completedTaskIds: [],
    sameCohortCompletedTaskIds: [],
  };
}

function taskRhythm(events: readonly ActivityEvent[], window: OperatingInsightWindow): TaskRhythmPeriod {
  const created = events.filter((event) => event.type === 'task-created' && event.taskId && inWindow(event.occurredAt, window));
  const completed = events.filter((event) => event.type === 'task-completed' && event.taskId && inWindow(event.occurredAt, window));
  const completedTaskIds = new Set(completed.map((event) => event.taskId!));
  const createdAt = new Map<string, string>();
  for (const event of created) {
    const known = createdAt.get(event.taskId!);
    if (!known || event.occurredAt < known) createdAt.set(event.taskId!, event.occurredAt);
  }
  const completedCohort = new Set(completed
    .filter((event) => {
      const taskCreatedAt = createdAt.get(event.taskId!);
      return taskCreatedAt !== undefined && event.occurredAt >= taskCreatedAt;
    })
    .map((event) => event.taskId!));
  const denominator = createdAt.size;
  return {
    created: denominator,
    completed: completedTaskIds.size,
    sameCohortCompleted: completedCohort.size,
    sameCohortCompletionPercentage: denominator
      ? Math.round((completedCohort.size / denominator) * 1_000) / 10
      : null,
    createdTaskIds: [...createdAt.keys()].sort(),
    completedTaskIds: [...completedTaskIds].sort(),
    sameCohortCompletedTaskIds: [...completedCohort].sort(),
  };
}

function taskWorkload(
  tasks: readonly CrmTask[] | undefined,
  window: OperatingInsightWindow,
): TaskWorkloadSnapshot {
  if (tasks === undefined) {
    return {
      open: null,
      overdue: null,
      dueSoon: null,
      completedInPeriod: null,
      dueWorkCompletionPercentage: null,
      onTimeCompletionPercentage: null,
      openTaskIds: [],
      overdueTaskIds: [],
      dueSoonTaskIds: [],
      completedInPeriodTaskIds: [],
    };
  }
  const active = tasks.filter((task) => task.status !== 'archived');
  const open = active.filter((task) => task.status === 'open');
  const dueSoonTo = new Date(new Date(window.to).getTime() + 7 * DAY_MS).toISOString();
  const completedInPeriod = active.filter((task) => (
    task.status === 'completed'
    && task.completedAt !== undefined
    && inWindow(task.completedAt, window)
  ));
  const dueInPeriod = active.filter((task) => inWindow(task.dueAt, window));
  const dueCompleted = dueInPeriod.filter((task) => (
    task.status === 'completed'
    && task.completedAt !== undefined
    && task.completedAt <= window.to
  ));
  const onTime = completedInPeriod.filter((task) => task.completedAt! <= task.dueAt);
  const overdue = open.filter((task) => task.dueAt < window.to);
  const dueSoon = open.filter((task) => task.dueAt >= window.to && task.dueAt <= dueSoonTo);
  return {
    open: open.length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    completedInPeriod: completedInPeriod.length,
    dueWorkCompletionPercentage: dueInPeriod.length
      ? Math.round((dueCompleted.length / dueInPeriod.length) * 1_000) / 10
      : null,
    onTimeCompletionPercentage: completedInPeriod.length
      ? Math.round((onTime.length / completedInPeriod.length) * 1_000) / 10
      : null,
    openTaskIds: open.map((task) => task.id).sort(),
    overdueTaskIds: overdue.map((task) => task.id).sort(),
    dueSoonTaskIds: dueSoon.map((task) => task.id).sort(),
    completedInPeriodTaskIds: completedInPeriod.map((task) => task.id).sort(),
  };
}

function percentagePointChange(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;
}

function coverage(
  rows: readonly unknown[] | undefined,
  boundedAt: number | null,
  explicitlyTruncated?: boolean,
): OperatingInsightCoverage {
  if (rows === undefined) return { status: 'unavailable', rows: null, boundedAt, truncated: false };
  const truncated = explicitlyTruncated ?? (boundedAt !== null && rows.length >= boundedAt);
  return {
    status: truncated ? 'possibly-truncated' : 'complete',
    rows: rows.length,
    boundedAt,
    truncated,
  };
}

function sortedContactIds(contacts: readonly Contact[]): string[] {
  return contacts.map((contact) => contact.id).sort();
}

function progressionForSource(
  contactIds: ReadonlySet<string>,
  events: readonly ActivityEvent[],
  window: OperatingInsightWindow,
): {
  progressedContacts: number;
  closedContacts: number;
  progressedContactIds: readonly string[];
  closedContactIds: readonly string[];
} {
  const progressed = new Set<string>();
  const closed = new Set<string>();
  for (const event of events) {
    if (
      event.type !== 'pipeline-stage-changed'
      || !event.contactId
      || !contactIds.has(event.contactId)
      || !inWindow(event.occurredAt, window)
    ) continue;
    const from = event.metadata?.fromStage;
    const to = event.metadata?.toStage;
    if (typeof from !== 'string' || typeof to !== 'string' || !(from in PIPELINE_LABEL) || !(to in PIPELINE_LABEL)) continue;
    if (from !== to && PROGRESSION_STAGES.has(to as PipelineStage)) progressed.add(event.contactId);
    if (to === 'closed') closed.add(event.contactId);
  }
  return {
    progressedContacts: progressed.size,
    closedContacts: closed.size,
    progressedContactIds: [...progressed].sort(),
    closedContactIds: [...closed].sort(),
  };
}

function buildOwnerAssistant(
  events: readonly ActivityEvent[] | undefined,
  tasks: readonly CrmTask[] | undefined,
  memberships: readonly WorkspaceMembership[] | undefined,
  currentWindow: OperatingInsightWindow,
): OperatingInsightsReport['ownerAssistant'] {
  if (events === undefined || tasks === undefined || memberships === undefined) {
    return {
      status: 'unavailable',
      roles: ([
        { role: 'owner', attribution: 'active-member', label: 'Owner' },
        { role: 'assistant', attribution: 'active-member', label: 'Assistant' },
        { role: null, attribution: 'unassigned', label: 'Unassigned' },
        { role: null, attribution: 'inactive-or-unknown', label: 'Inactive / unknown' },
      ] as const).map((entry) => ({
        ...entry,
        createdTasks: null,
        completedTasks: null,
        openAssignedTasks: null,
        overdueAssignedTasks: null,
      })),
      unattributedTaskEvents: null,
      unassignedOpenTasks: null,
      inactiveAssignedOpenTasks: null,
    };
  }
  const roleByMembership = new Map(memberships
    .filter((membership) => membership.status === 'active')
    .map((membership) => [membership.id, membership.role] as const));
  const activeMemberships = memberships.filter((membership) => membership.status === 'active');
  const taskEvents = events.filter((event) => (
    (event.type === 'task-created' || event.type === 'task-completed')
    && inWindow(event.occurredAt, currentWindow)
  ));
  const roles: Array<OperatingInsightsReport['ownerAssistant']['roles'][number]> = activeMemberships.map((membership) => ({
    membershipId: membership.id,
    role: membership.role,
    attribution: 'active-member' as const,
    label: membership.role === 'owner' ? 'Owner' : 'Assistant',
    createdTasks: new Set(taskEvents.filter((event) => event.type === 'task-created' && event.actorMembershipId === membership.id).map((event) => event.taskId)).size,
    completedTasks: new Set(taskEvents.filter((event) => event.type === 'task-completed' && event.actorMembershipId === membership.id).map((event) => event.taskId)).size,
    openAssignedTasks: tasks.filter((task) => task.status === 'open' && task.assigneeMembershipId === membership.id).length,
    overdueAssignedTasks: tasks.filter((task) => (
        task.status === 'open'
        && task.dueAt < currentWindow.to
        && task.assigneeMembershipId === membership.id
      )).length,
  }));
  const unassignedTasks = tasks.filter((task) => task.status === 'open' && !task.assigneeMembershipId);
  const inactiveOrUnknownTasks = tasks.filter((task) => (
    task.status === 'open'
    && Boolean(task.assigneeMembershipId)
    && !roleByMembership.has(task.assigneeMembershipId)
  ));
  const inactiveOrUnknownEvents = taskEvents.filter((event) => !roleByMembership.has(event.actorMembershipId));
  roles.push(
    {
      role: null,
      attribution: 'unassigned',
      label: 'Unassigned',
      createdTasks: 0,
      completedTasks: 0,
      openAssignedTasks: unassignedTasks.length,
      overdueAssignedTasks: unassignedTasks.filter((task) => task.dueAt < currentWindow.to).length,
    },
    {
      role: null,
      attribution: 'inactive-or-unknown',
      label: 'Inactive / unknown',
      createdTasks: new Set(inactiveOrUnknownEvents.filter((event) => event.type === 'task-created').map((event) => event.taskId)).size,
      completedTasks: new Set(inactiveOrUnknownEvents.filter((event) => event.type === 'task-completed').map((event) => event.taskId)).size,
      openAssignedTasks: inactiveOrUnknownTasks.length,
      overdueAssignedTasks: inactiveOrUnknownTasks.filter((task) => task.dueAt < currentWindow.to).length,
    },
  );
  return {
    status: 'available',
    roles,
    unattributedTaskEvents: inactiveOrUnknownEvents.length,
    unassignedOpenTasks: unassignedTasks.length,
    inactiveAssignedOpenTasks: inactiveOrUnknownTasks.length,
  };
}

export function buildOperatingInsights(input: {
  periodDays: OperatingInsightPeriod;
  mode?: 'live' | 'sample';
  currentWindow: OperatingInsightWindow;
  previousWindow: OperatingInsightWindow;
  contacts?: readonly Contact[];
  events?: readonly ActivityEvent[];
  tasks?: readonly CrmTask[];
  memberships?: readonly WorkspaceMembership[];
  contactBoundedAt?: number;
  transitionEventBoundedAt?: number;
  eventBoundedAt?: number;
  taskBoundedAt?: number;
  contactsTruncated?: boolean;
  eventsTruncated?: boolean;
  tasksTruncated?: boolean;
}): OperatingInsightsReport {
  const contacts = input.contacts ?? [];
  const events = input.events ?? [];
  const transitionEvents = events.filter((event) => event.type === 'pipeline-stage-changed');
  const eventBoundedAt = input.eventBoundedAt ?? DEFAULT_BOUND;
  const transitionEventBoundedAt = input.transitionEventBoundedAt ?? eventBoundedAt;
  const taskBoundedAt = input.taskBoundedAt ?? DEFAULT_BOUND;
  const pipelineAvailable = input.contacts !== undefined && input.events !== undefined;
  const currentPipeline = buildPipelineAnalytics({
    contacts,
    events: transitionEvents,
    ...input.currentWindow,
    boundedAt: transitionEventBoundedAt,
    truncated: input.eventsTruncated,
  });
  const previousPipeline = buildPipelineAnalytics({
    contacts,
    events: transitionEvents,
    ...input.previousWindow,
    boundedAt: transitionEventBoundedAt,
    truncated: input.eventsTruncated,
  });

  const portfolioAvailable = input.contacts !== undefined;
  const asOf = new Date(input.currentWindow.to);
  const snapshot = portfolioAvailable ? buildWorkspaceSnapshot(contacts, asOf) : undefined;
  const preparedContacts = portfolioAvailable ? contacts.map((contact) => ensureNextTouch(contact, asOf)) : [];
  const attentionIds = new Set(portfolioAvailable
    ? buildTriage(preparedContacts, asOf)
      .filter((bucket) => ['needs-first-contact', 'overdue', 'due-today'].includes(bucket.id))
      .flatMap((bucket) => bucket.entries.map((entry) => entry.contact.id))
    : []);
  const overdueIds = new Set(snapshot?.recommendations.find((item) => item.id === 'overdue')?.contactIds ?? []);
  const leadTypeKeys = Object.keys(LEAD_TYPE_LABEL) as Contact['leadType'][];
  const relationshipKeys = Object.keys(RELATIONSHIP_LABEL) as Contact['relationship'][];
  const intentKeys = Object.keys(INTENT_LABEL) as Contact['intent'][];
  const stageKeys = Object.keys(PIPELINE_LABEL) as PipelineStage[];

  const sources = portfolioAvailable && input.events !== undefined
    ? (Object.keys(SOURCE_LABEL) as LeadSource[])
      .map((source) => {
        const sourceContacts = contacts.filter((contact) => contact.source === source);
        if (!sourceContacts.length) return undefined;
        const contactIds = new Set(sourceContacts.map((contact) => contact.id));
        const current = progressionForSource(contactIds, events, input.currentWindow);
        const previous = progressionForSource(contactIds, events, input.previousWindow);
        return {
          source,
          label: SOURCE_LABEL[source],
          contactCount: sourceContacts.length,
          current,
          previous,
          progressedContactChange: current.progressedContacts - previous.progressedContacts,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const rhythmAvailable = input.events !== undefined;
  const currentRhythm = rhythmAvailable ? taskRhythm(events, input.currentWindow) : unavailableRhythm();
  const previousRhythm = rhythmAvailable ? taskRhythm(events, input.previousWindow) : unavailableRhythm();

  const contactCoverage = coverage(
    input.contacts,
    input.contactBoundedAt ?? DEFAULT_BOUND,
    input.contactsTruncated,
  );
  const eventCoverage = coverage(input.events, eventBoundedAt, input.eventsTruncated);
  const taskCoverage = coverage(input.tasks, taskBoundedAt, input.tasksTruncated);
  const membershipCoverage = coverage(input.memberships, null);
  const coverages = [contactCoverage, eventCoverage, taskCoverage, membershipCoverage];
  const anyUnavailable = coverages.some((item) => item.status === 'unavailable');
  const anyTruncated = coverages.some((item) => item.truncated);
  const pipelineStatus: InsightAvailability = !pipelineAvailable
    ? 'unavailable'
    : contactCoverage.truncated || eventCoverage.truncated ? 'possibly-truncated' : 'available';
  const portfolioStatus: InsightAvailability = !portfolioAvailable
    ? 'unavailable'
    : contactCoverage.truncated ? 'possibly-truncated' : 'available';
  const sourceStatus: InsightAvailability = !portfolioAvailable || input.events === undefined
    ? 'unavailable'
    : contactCoverage.truncated || eventCoverage.truncated ? 'possibly-truncated' : 'available';
  const taskStatus: InsightAvailability = input.events === undefined || input.tasks === undefined
    ? 'unavailable'
    : eventCoverage.truncated || taskCoverage.truncated ? 'possibly-truncated' : 'available';
  const ownerAssistant = buildOwnerAssistant(input.events, input.tasks, input.memberships, input.currentWindow);
  const ownerAssistantStatus: InsightAvailability = ownerAssistant.status === 'unavailable'
    ? 'unavailable'
    : eventCoverage.truncated || taskCoverage.truncated ? 'possibly-truncated' : 'available';

  return {
    schemaVersion: 'operating-insights.v1',
    mode: input.mode ?? 'sample',
    periodDays: input.periodDays,
    currentWindow: input.currentWindow,
    previousWindow: input.previousWindow,
    pipeline: {
      status: pipelineStatus,
      current: currentPipeline,
      previous: {
        from: previousPipeline.from,
        to: previousPipeline.to,
        conversion: previousPipeline.conversion,
        evidence: previousPipeline.evidence,
      },
      conversionPercentagePointChange: pipelineAvailable
        ? percentagePointChange(currentPipeline.conversion.percentage, previousPipeline.conversion.percentage)
        : null,
    },
    portfolio: {
      status: portfolioStatus,
      totalContacts: portfolioAvailable ? contacts.length : null,
      leadTypes: portfolioAvailable
        ? leadTypeKeys.map((leadType) => ({
          leadType, label: LEAD_TYPE_LABEL[leadType],
          count: contacts.filter((contact) => contact.leadType === leadType).length,
          contactIds: sortedContactIds(contacts.filter((contact) => contact.leadType === leadType)),
        }))
        : [],
      health: {
        needsAttention: snapshot?.needsAttentionNow ?? null,
        overdue: snapshot?.recommendations.find((item) => item.id === 'overdue')?.count ?? null,
        neverContacted: portfolioAvailable
          ? contacts.filter((contact) => !contact.lastContactedAt && !['closed', 'lost'].includes(contact.pipelineStage)).length
          : null,
        needsQualification: portfolioAvailable
          ? contacts.filter((contact) => contact.qualificationStatus === 'needs-qualification').length
          : null,
        progressing: portfolioAvailable
          ? contacts.filter((contact) => ['appointment-set', 'active', 'under-contract'].includes(contact.pipelineStage)).length
          : null,
        underContract: portfolioAvailable
          ? contacts.filter((contact) => contact.pipelineStage === 'under-contract').length
          : null,
      },
      readiness: {
        withPhone: snapshot?.readiness.withPhone ?? null,
        withEmail: snapshot?.readiness.withEmail ?? null,
        mailReady: snapshot?.readiness.mailReady ?? null,
        withNextTouch: snapshot?.readiness.withNextTouch ?? null,
      },
      contributors: {
        allContactIds: portfolioAvailable ? sortedContactIds(contacts) : [],
        needsAttentionContactIds: portfolioAvailable ? [...attentionIds].sort() : [],
        overdueContactIds: portfolioAvailable ? [...overdueIds].sort() : [],
        neverContactedContactIds: portfolioAvailable
          ? sortedContactIds(contacts.filter((contact) => !contact.lastContactedAt && !['closed', 'lost'].includes(contact.pipelineStage)))
          : [],
        needsQualificationContactIds: portfolioAvailable
          ? sortedContactIds(contacts.filter((contact) => contact.qualificationStatus === 'needs-qualification'))
          : [],
        progressingContactIds: portfolioAvailable
          ? sortedContactIds(contacts.filter((contact) => ['appointment-set', 'active', 'under-contract'].includes(contact.pipelineStage)))
          : [],
        underContractContactIds: portfolioAvailable
          ? sortedContactIds(contacts.filter((contact) => contact.pipelineStage === 'under-contract'))
          : [],
        withPhoneContactIds: portfolioAvailable ? sortedContactIds(contacts.filter((contact) => Boolean(contact.phone))) : [],
        withEmailContactIds: portfolioAvailable ? sortedContactIds(contacts.filter((contact) => Boolean(contact.email))) : [],
        mailReadyContactIds: portfolioAvailable ? sortedContactIds(contacts.filter(isMailingReady)) : [],
        withNextTouchContactIds: portfolioAvailable ? sortedContactIds(preparedContacts.filter((contact) => Boolean(contact.nextTouchAt))) : [],
      },
      relationships: portfolioAvailable
        ? relationshipKeys.map((relationship) => ({
          relationship,
          label: RELATIONSHIP_LABEL[relationship],
          count: contacts.filter((contact) => contact.relationship === relationship).length,
        }))
        : [],
      intents: portfolioAvailable
        ? intentKeys.map((intent) => ({
          intent,
          label: INTENT_LABEL[intent],
          count: contacts.filter((contact) => contact.intent === intent).length,
        }))
        : [],
      stages: portfolioAvailable
        ? stageKeys.map((stage) => ({
          stage,
          label: PIPELINE_LABEL[stage],
          count: contacts.filter((contact) => contact.pipelineStage === stage).length,
        }))
        : [],
    },
    sourceProgression: {
      status: sourceStatus,
      sources,
    },
    taskRhythm: {
      status: taskStatus,
      current: currentRhythm,
      previous: previousRhythm,
      workload: taskWorkload(input.tasks, input.currentWindow),
      change: {
        created: rhythmAvailable ? currentRhythm.created! - previousRhythm.created! : null,
        completed: rhythmAvailable ? currentRhythm.completed! - previousRhythm.completed! : null,
        completionPercentagePoints: rhythmAvailable
          ? percentagePointChange(
            currentRhythm.sameCohortCompletionPercentage,
            previousRhythm.sameCohortCompletionPercentage,
          )
          : null,
      },
    },
    ownerAssistant: { ...ownerAssistant, status: ownerAssistantStatus },
    finance: {
      status: 'unavailable',
      reason: 'Verified deal, transaction, commission, and expense authorities do not exist yet.',
    },
    coverage: {
      status: anyUnavailable ? 'unavailable' : anyTruncated ? 'possibly-truncated' : 'complete',
      truncated: anyTruncated,
      contacts: contactCoverage,
      events: eventCoverage,
      tasks: taskCoverage,
      memberships: membershipCoverage,
    },
  };
}
