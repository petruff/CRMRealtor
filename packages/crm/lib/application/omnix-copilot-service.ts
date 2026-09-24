import { createHash } from 'node:crypto';
import type { ActivityRepository } from '../data/activity-repository.ts';
import type { RepositoryContext } from '../data/index.ts';
import type { MailerRepository } from '../data/mailer-repository.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import type { RichContactRepository } from '../data/rich-contact-repository.ts';
import { listActivityEventsCommand, listTasksCommand } from './activity-commands.ts';
import type { ContactRepository } from '../data/repository.ts';
import { queryContacts } from './contact-query.ts';
import { ensureNextTouch } from '../domain/cadence.ts';
import {
  sortTasksForWorkQueue,
  type ActivityEvent,
  type CrmTask,
} from '../domain/activity.ts';
import {
  displayName,
  LEAD_TYPE_LABEL,
  INTENT_LABEL,
  PIPELINE_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  type Contact,
  type PipelineStage,
} from '../domain/contact.ts';
import {
  addDays,
  daysUntilAnniversary,
  formatDateOnly,
  parseDateOnly,
} from '../domain/dates.ts';
import {
  isMailingReady,
  type MailerCampaign,
  type MailingAddressField,
} from '../domain/mailer.ts';
import {
  createOmnixCopilotAlert,
  createOmnixCopilotCitation,
  createOmnixCopilotSuccessResponse,
  OmnixCopilotError,
  type OmnixCopilotAlert,
  type OmnixCopilotAlertRule,
  type OmnixCopilotAnswerBlock,
  type OmnixCopilotAnswerItem,
  type OmnixCopilotCitation,
  type OmnixCopilotExecutor,
  type OmnixCopilotIntent,
  type OmnixCopilotRequest,
  type OmnixCopilotSuggestion,
  type OmnixCopilotSuccessResponse,
  type OmnixCopilotWarning,
} from '../domain/omnix-copilot.ts';
import { buildTriage } from '../domain/triage.ts';
import { buildWorkspaceSnapshot } from '../domain/workspace-intelligence.ts';
import type { ConnectorConnection, ConnectorDefinition } from '../domain/connector.ts';
import type { ConnectorLifecycleProjection } from '../domain/connector-lifecycle.ts';
import { readConnectorLifecycleSnapshot } from './connector-lifecycle-orchestrator.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import {
  defaultOmnixCopilotTelemetrySink,
  emitOmnixCopilotTelemetry,
  omnixCopilotTelemetryErrorCategory,
  type OmnixCopilotTelemetrySink,
} from '../observability/omnix-copilot-telemetry.ts';
import { activityEventLabel } from '../presentation/activity-feed.ts';
import { applySegment, describeSegment, type OmnixSegmentFilter } from '../domain/omnix-segment.ts';
import { extractMemoryFacts, MEMORY_KIND_LABEL } from '../domain/relationship-memory.ts';
import { readOmnixModules, OMNIX_MODULE_INTENTS, type OmnixModuleRepositories } from './omnix-copilot-module-reads.ts';

export const OMNIX_COPILOT_RESULT_MAX = 500;
const UPCOMING_DAYS = 7;

function attentionFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function attentionDateInstant(value: string | undefined): string | undefined {
  return value ? new Date(`${value}T12:00:00.000Z`).toISOString() : undefined;
}

type ContactFactKey = Extract<keyof Contact, string>;
type TaskFactKey = Extract<keyof CrmTask, string>;

const CONTACT_NAME_FACT_KEYS = ['firstName', 'preferredName', 'lastName'] as const satisfies readonly ContactFactKey[];
const CONTACT_SEARCH_FACT_KEYS = [
  ...CONTACT_NAME_FACT_KEYS,
  'email',
  'phone',
  'secondaryPhone',
  'city',
  'postalCode',
  'tags',
  'leadType',
  'relationship',
] as const satisfies readonly ContactFactKey[];
const TASK_SCHEDULE_FACT_KEYS = ['status', 'dueAt', 'createdAt'] as const satisfies readonly TaskFactKey[];
const TASK_LIST_FACT_KEYS = [...TASK_SCHEDULE_FACT_KEYS, 'title'] as const satisfies readonly TaskFactKey[];

const FOLLOW_UP_FACT_KEYS = {
  'needs-first-contact': ['pipelineStage', 'lastContactedAt', 'createdAt', 'leadType', 'source'],
  overdue: ['pipelineStage', 'lastContactedAt', 'nextTouchAt', 'leadType'],
  'due-today': ['pipelineStage', 'lastContactedAt', 'nextTouchAt', 'leadType'],
  'coming-up': ['pipelineStage', 'lastContactedAt', 'nextTouchAt', 'leadType'],
} as const satisfies Readonly<Record<string, readonly ContactFactKey[]>>;
const DERIVED_FOLLOW_UP_FACT_KEYS = [
  'pipelineStage',
  'nextTouchAt',
  'touchDateOverridden',
  'lastContactedAt',
  'createdAt',
  'leadType',
] as const satisfies readonly ContactFactKey[];

const RECOMMENDATION_FACT_KEYS = {
  'first-contact': FOLLOW_UP_FACT_KEYS['needs-first-contact'],
  overdue: FOLLOW_UP_FACT_KEYS.overdue,
  address: ['mailingAddress', 'city', 'state', 'postalCode'],
  celebrations: ['pipelineStage', 'birthdate', 'homePurchaseDate'],
  'pipeline-risk': ['pipelineStage', 'nextTouchAt'],
} as const satisfies Readonly<Record<string, readonly ContactFactKey[]>>;

function followUpFactKeys(
  bucketId: 'needs-first-contact' | 'overdue' | 'due-today' | 'coming-up',
  storedContact: Contact,
): readonly ContactFactKey[] {
  if ((bucketId === 'due-today' || bucketId === 'coming-up') && !storedContact.nextTouchAt) {
    return DERIVED_FOLLOW_UP_FACT_KEYS;
  }
  return FOLLOW_UP_FACT_KEYS[bucketId];
}

export interface OmnixCopilotRepositoryContext
  extends Pick<RepositoryContext, 'repository' | 'workspaceScope' | 'isLive'>, Omit<OmnixModuleRepositories, 'repository'> {
  readonly activityRepository?: ActivityRepository;
  readonly mailerRepository?: MailerRepository;
  readonly connectorRepository?: ConnectorRepository;
  readonly richContactRepository?: RichContactRepository;
}

export interface OmnixCopilotServiceDependencies {
  readonly getRepository: () => Promise<OmnixCopilotRepositoryContext>;
  /** Defaults to OMNIX_TIME_ZONE, then to documented local-process calendar behavior. */
  readonly timeZone?: string;
  readonly telemetry?: OmnixCopilotTelemetrySink;
  readonly monotonicNow?: () => number;
}

interface ReadResult {
  readonly answerBlocks: readonly OmnixCopilotAnswerBlock[];
  readonly suggestions?: readonly OmnixCopilotSuggestion[];
  readonly warnings?: readonly OmnixCopilotWarning[];
  readonly alerts?: readonly OmnixCopilotAlert[];
}

interface TaskGroups {
  readonly overdue: readonly CrmTask[];
  readonly today: readonly CrmTask[];
  readonly upcoming: readonly CrmTask[];
}

export interface OmnixAlertBuildInput {
  readonly contacts: readonly Contact[];
  readonly tasks: readonly CrmTask[];
  readonly today: string;
  readonly asOf: string;
  readonly timeZone?: string;
  readonly bounded?: boolean;
  readonly taskCapabilityAvailable?: boolean;
  readonly historicalImportContactIds?: ReadonlySet<string>;
}

export interface OmnixAlertBuildResult {
  readonly alerts: readonly OmnixCopilotAlert[];
  readonly warnings: readonly OmnixCopilotWarning[];
  readonly availability: 'available' | 'partial';
}

function identifierTarget(kind: 'contact' | 'task', id: string): string {
  return kind === 'contact' ? `/contacts/${encodeURIComponent(id)}` : `/activities?task=${encodeURIComponent(id)}`;
}

function calendarDateAt(instant: Date, timeZone?: string): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new OmnixCopilotError('invalid-input', 'Copilot as-of time is invalid.');
  }
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value;
      const year = value('year');
      const month = value('month');
      const day = value('day');
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      throw new OmnixCopilotError('invalid-input', 'Configured CRM time zone is invalid.');
    }
  }
  const year = instant.getFullYear();
  const month = String(instant.getMonth() + 1).padStart(2, '0');
  const day = String(instant.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDate(value: string | undefined, fallback: string): string {
  return value && value !== 'today' ? value : fallback;
}

function asCalendarDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function makeCitation(input: {
  entityType: OmnixCopilotCitation['entityType'];
  recordId: string;
  factKeys: readonly string[];
  responseAsOf: string;
  target: string;
  sourceTimestamp?: string;
  rule?: string;
}): OmnixCopilotCitation {
  return createOmnixCopilotCitation({
    entityType: input.entityType,
    recordId: input.recordId,
    factKeys: input.factKeys,
    ...(input.sourceTimestamp ? { sourceTimestamp: input.sourceTimestamp } : {}),
    responseAsOf: input.responseAsOf,
    target: input.target,
    ...(input.rule ? { rule: input.rule } : {}),
  });
}

function contactCitation(
  contact: Contact,
  factKeys: readonly string[],
  asOf: string,
  rule?: string,
): OmnixCopilotCitation {
  return makeCitation({
    entityType: 'contact',
    recordId: contact.id,
    factKeys,
    sourceTimestamp: contact.createdAt,
    responseAsOf: asOf,
    target: identifierTarget('contact', contact.id),
    ...(rule ? { rule } : {}),
  });
}

function taskCitation(
  task: CrmTask,
  factKeys: readonly TaskFactKey[],
  asOf: string,
  rule?: string,
): OmnixCopilotCitation {
  return makeCitation({
    entityType: 'task',
    recordId: task.id,
    factKeys,
    sourceTimestamp: task.updatedAt,
    responseAsOf: asOf,
    target: identifierTarget('task', task.id),
    ...(rule ? { rule } : {}),
  });
}

function activityCitation(event: ActivityEvent, asOf: string): OmnixCopilotCitation {
  return makeCitation({
    entityType: 'activity',
    recordId: event.id,
    factKeys: ['type', 'occurredAt', 'contactId'],
    sourceTimestamp: event.occurredAt,
    responseAsOf: asOf,
    target: event.contactId ? identifierTarget('contact', event.contactId) : '/activities',
  });
}

function mailerCitation(campaign: MailerCampaign, asOf: string): OmnixCopilotCitation {
  return makeCitation({
    entityType: 'mailer',
    recordId: campaign.id,
    factKeys: ['name', 'createdAt'],
    sourceTimestamp: campaign.createdAt,
    responseAsOf: asOf,
    target: '/mailers',
  });
}

function mailerSendCitations(campaign: MailerCampaign, asOf: string): OmnixCopilotCitation[] {
  return campaign.sends.slice(0, OMNIX_COPILOT_RESULT_MAX).map((send) => makeCitation({
    entityType: 'mailer-send',
    recordId: `mailer-send-${createHash('sha256')
      .update(send.mailerId)
      .update('\0')
      .update(send.contactId)
      .digest('hex')}`,
    factKeys: ['mailerId', 'contactId', 'sentOn'],
    responseAsOf: asOf,
    target: '/mailers',
  }));
}

function connectorCitation(connection: ConnectorConnection, asOf: string): OmnixCopilotCitation {
  return makeCitation({
    entityType: 'connector',
    recordId: connection.id,
    factKeys: ['provider', 'status', 'connectedAt', 'updatedAt'],
    sourceTimestamp: connection.updatedAt,
    responseAsOf: asOf,
    target: '/connections',
    rule: 'connection-status',
  });
}

function uniqueCitations(citations: readonly OmnixCopilotCitation[]): OmnixCopilotCitation[] {
  return [...new Map(citations.map((citation) => [citation.id, citation])).values()];
}

function block(
  id: string,
  kind: OmnixCopilotAnswerBlock['kind'],
  title: string,
  detail: string,
  items: OmnixCopilotAnswerBlock['items'] = [],
): OmnixCopilotAnswerBlock {
  return {
    id,
    kind,
    title,
    detail,
    items,
    citations: uniqueCitations(items.flatMap((item) => item.citations)),
  };
}

function reviewSuggestion(
  id: string,
  title: string,
  detail: string,
  href: string,
  citations: readonly OmnixCopilotCitation[] = [],
): OmnixCopilotSuggestion {
  return { id, kind: 'review-link', title, detail, href, readOnly: true, citations };
}

function unavailable(
  capability: string,
  detail: string,
  href: string,
): ReadResult {
  return {
    answerBlocks: [block(`${capability}-unavailable`, 'capability', `${capability} unavailable`, detail)],
    warnings: [{ code: 'capability-unavailable', message: detail }],
    suggestions: [reviewSuggestion(`review-${capability}`, `Review ${capability}`, detail, href)],
  };
}

function contextMode(context: OmnixCopilotRepositoryContext): 'sample' | 'live' {
  return context.isLive ? 'live' : 'sample';
}

async function boundedContacts(
  repository: ContactRepository,
): Promise<{ contacts: Contact[]; bounded: boolean }> {
  const loaded = await repository.list();
  return {
    contacts: loaded.slice(0, OMNIX_COPILOT_RESULT_MAX),
    bounded: loaded.length > OMNIX_COPILOT_RESULT_MAX,
  };
}

async function openTasks(
  repository: ActivityRepository,
  scope: WorkspaceScope,
  asOf: Date,
): Promise<readonly CrmTask[]> {
  const tasks = await listTasksCommand(repository, scope, {
    status: 'open',
    limit: OMNIX_COPILOT_RESULT_MAX,
  });
  return sortTasksForWorkQueue(tasks, asOf);
}

function groupTasks(
  tasks: readonly CrmTask[],
  today: string,
  timeZone?: string,
): TaskGroups {
  const upcomingThrough = formatDateOnly(addDays(parseDateOnly(today), UPCOMING_DAYS));
  const groups: { overdue: CrmTask[]; today: CrmTask[]; upcoming: CrmTask[] } = {
    overdue: [],
    today: [],
    upcoming: [],
  };
  for (const task of tasks) {
    const dueDate = calendarDateAt(new Date(task.dueAt), timeZone);
    if (dueDate < today) groups.overdue.push(task);
    else if (dueDate === today) groups.today.push(task);
    else if (dueDate <= upcomingThrough) groups.upcoming.push(task);
  }
  return groups;
}

function boundedWarning(bounded: boolean): OmnixCopilotWarning[] {
  return bounded
    ? [{ code: 'result-limit', message: `Results are limited to ${OMNIX_COPILOT_RESULT_MAX} authorized records.` }]
    : [];
}

function buildAlerts(
  contacts: readonly Contact[],
  tasks: readonly CrmTask[],
  today: string,
  asOf: string,
  timeZone?: string,
  historicalImportContactIds: ReadonlySet<string> = new Set(),
): OmnixCopilotAlert[] {
  const prepared = contacts.map((contact) => ensureNextTouch(contact, asCalendarDate(today)));
  const triage = buildTriage(prepared, asCalendarDate(today), { historicalImportContactIds });
  const alerts: OmnixCopilotAlert[] = [];
  const seen = new Set<string>();
  let order = 0;

  const add = (input: Omit<OmnixCopilotAlert, 'id' | 'order' | 'asOf'>) => {
    const key = `${input.rule}:${input.recordId}:${today}`;
    if (seen.has(key)) return;
    seen.add(key);
    order += 1;
    const created = createOmnixCopilotAlert({
      ...input,
      order,
      asOf,
    });
    alerts.push(Object.freeze({ ...created, id: `alert:${input.rule}:${input.recordId}:${today}` }));
  };

  const followUpRules: Readonly<Record<string, {
    rule: OmnixCopilotAlertRule;
    priority: OmnixCopilotAlert['priority'];
  }>> = {
    'needs-first-contact': {
      rule: 'needs-first-contact',
      priority: 'urgent',
    },
    overdue: { rule: 'overdue-follow-up', priority: 'urgent' },
    'due-today': {
      rule: 'due-today-follow-up',
      priority: 'high',
    },
    'coming-up': {
      rule: 'upcoming-follow-up',
      priority: 'normal',
    },
  };
  for (const bucket of triage) {
    const mapped = followUpRules[bucket.id];
    if (!mapped) continue;
    for (const entry of bucket.entries) {
      const storedContact = contacts.find((contact) => contact.id === entry.contact.id) ?? entry.contact;
      const citation = contactCitation(
        entry.contact,
        followUpFactKeys(bucket.id as 'needs-first-contact' | 'overdue' | 'due-today' | 'coming-up', storedContact),
        asOf,
        mapped.rule,
      );
      add({
        rule: mapped.rule,
        category: 'follow-up',
        priority: mapped.priority,
        reason: entry.reason,
        recordId: entry.contact.id,
        href: identifierTarget('contact', entry.contact.id),
        citations: [citation],
        occurrenceKey: `follow-up:${entry.contact.id}`,
        sourceFingerprint: attentionFingerprint({
          kind: 'follow-up', contactId: entry.contact.id,
          createdAt: storedContact.createdAt,
          lastContactedAt: storedContact.lastContactedAt ?? null,
          nextTouchAt: entry.contact.nextTouchAt ?? null,
          leadType: storedContact.leadType,
          pipelineStage: storedContact.pipelineStage,
        }),
        ...(entry.contact.nextTouchAt ? { dueAt: attentionDateInstant(entry.contact.nextTouchAt) } : {}),
        dismissAllowed: false,
      });
    }
  }

  for (const entry of triage.find((bucket) => bucket.id === 'celebrations')?.entries ?? []) {
    const birthday = entry.reason.includes('Birthday');
    const rule: OmnixCopilotAlertRule = birthday ? 'birthday' : 'homeaversary';
    const citation = contactCitation(
      entry.contact,
      ['pipelineStage', birthday ? 'birthdate' : 'homePurchaseDate'],
      asOf,
      rule,
    );
    add({
      rule,
      category: 'celebration',
      priority: 'normal',
      reason: entry.reason,
      recordId: entry.contact.id,
      href: identifierTarget('contact', entry.contact.id),
      citations: [citation],
      occurrenceKey: `${rule}:${entry.contact.id}`,
      sourceFingerprint: attentionFingerprint({
        rule, contactId: entry.contact.id,
        anniversaryYear: today.slice(0, 4),
        date: birthday ? entry.contact.birthdate : entry.contact.homePurchaseDate,
      }),
      dismissAllowed: true,
    });
  }

  for (const contact of contacts) {
    if (['active', 'under-contract'].includes(contact.pipelineStage) && !contact.nextTouchAt) {
      const rule: OmnixCopilotAlertRule = 'pipeline-missing-next-touch';
      add({
        rule,
        category: 'pipeline',
        priority: 'high',
        reason: 'Active or under-contract contact has no explicit next-touch date.',
        recordId: contact.id,
        href: identifierTarget('contact', contact.id),
        citations: [contactCitation(contact, ['pipelineStage', 'nextTouchAt'], asOf, rule)],
        occurrenceKey: `${rule}:${contact.id}`,
        sourceFingerprint: attentionFingerprint({
          rule, contactId: contact.id, pipelineStage: contact.pipelineStage,
          nextTouchAt: contact.nextTouchAt ?? null,
        }),
        dismissAllowed: false,
      });
    }
    if (!isMailingReady(contact)) {
      const rule: OmnixCopilotAlertRule = 'mailer-missing-address';
      const addressFields: MailingAddressField[] = ['mailingAddress', 'city', 'state', 'postalCode'];
      add({
        rule,
        category: 'mailer',
        priority: 'normal',
        reason: 'Street, city, state, or ZIP is blank.',
        recordId: contact.id,
        href: `${identifierTarget('contact', contact.id)}/edit`,
        citations: [contactCitation(contact, addressFields, asOf, rule)],
        occurrenceKey: `${rule}:${contact.id}`,
        sourceFingerprint: attentionFingerprint({
          rule, contactId: contact.id, mailingAddress: contact.mailingAddress ?? null,
          city: contact.city ?? null, state: contact.state ?? null,
          postalCode: contact.postalCode ?? null,
        }),
        dismissAllowed: true,
      });
    }
  }

  const grouped = groupTasks(tasks, today, timeZone);
  for (const task of grouped.overdue) {
    const rule: OmnixCopilotAlertRule = 'task-overdue';
    add({
      rule,
      category: 'task',
      priority: 'urgent',
      reason: 'Open task is due before the configured CRM day.',
      recordId: task.id,
      href: identifierTarget('task', task.id),
      citations: [taskCitation(task, TASK_SCHEDULE_FACT_KEYS, asOf, rule)],
      occurrenceKey: `task-due:${task.id}`,
      sourceFingerprint: attentionFingerprint({
        kind: 'task-due', taskId: task.id, dueAt: task.dueAt, status: task.status,
        taskVersion: task.taskVersion ?? null,
      }),
      dueAt: task.dueAt,
      dismissAllowed: false,
    });
  }
  for (const task of grouped.today) {
    const rule: OmnixCopilotAlertRule = 'task-due-today';
    add({
      rule,
      category: 'task',
      priority: 'high',
      reason: 'Open task is due on the configured CRM day.',
      recordId: task.id,
      href: identifierTarget('task', task.id),
      citations: [taskCitation(task, TASK_SCHEDULE_FACT_KEYS, asOf, rule)],
      occurrenceKey: `task-due:${task.id}`,
      sourceFingerprint: attentionFingerprint({
        kind: 'task-due', taskId: task.id, dueAt: task.dueAt, status: task.status,
        taskVersion: task.taskVersion ?? null,
      }),
      dueAt: task.dueAt,
      dismissAllowed: false,
    });
  }
  return alerts;
}

/**
 * Canonical, read-only projection of the deterministic alert catalog.
 * Callers supply records that have already passed repository scope checks;
 * the function performs no reads or writes and preserves the CLI ordering.
 */
export function buildOmnixAlertResult(input: OmnixAlertBuildInput): OmnixAlertBuildResult {
  const alerts = buildAlerts(
    input.contacts,
    input.tasks,
    input.today,
    input.asOf,
    input.timeZone,
    input.historicalImportContactIds,
  );
  const warnings = boundedWarning(Boolean(input.bounded));
  const taskCapabilityAvailable = input.taskCapabilityAvailable ?? true;
  if (!taskCapabilityAvailable) {
    warnings.push({ code: 'capability-unavailable', message: 'Workspace task alerts are unavailable.' });
  }
  return Object.freeze({
    alerts: Object.freeze([...alerts]),
    warnings: Object.freeze([...warnings]),
    availability: taskCapabilityAvailable ? 'available' : 'partial',
  });
}

function briefResult(
  contacts: readonly Contact[],
  tasks: readonly CrmTask[],
  today: string,
  asOf: string,
  timeZone: string | undefined,
  bounded: boolean,
  taskCapabilityAvailable: boolean,
  historicalImportContactIds: ReadonlySet<string> = new Set(),
): ReadResult {
  const snapshot = buildWorkspaceSnapshot(contacts, asCalendarDate(today), historicalImportContactIds);
  const attentionCitations = buildTriage(
    contacts.map((contact) => ensureNextTouch(contact, asCalendarDate(today))),
    asCalendarDate(today),
    { historicalImportContactIds },
  ).flatMap((bucket) => {
    if (bucket.id === 'needs-first-contact') {
      return bucket.entries.map((entry) => contactCitation(
        entry.contact,
        followUpFactKeys('needs-first-contact', contacts.find((contact) => contact.id === entry.contact.id) ?? entry.contact),
        asOf,
        bucket.id,
      ));
    }
    if (bucket.id === 'overdue') {
      return bucket.entries.map((entry) => contactCitation(
        entry.contact,
        followUpFactKeys('overdue', contacts.find((contact) => contact.id === entry.contact.id) ?? entry.contact),
        asOf,
        bucket.id,
      ));
    }
    if (bucket.id === 'due-today') {
      return bucket.entries.map((entry) => contactCitation(
        entry.contact,
        followUpFactKeys('due-today', contacts.find((contact) => contact.id === entry.contact.id) ?? entry.contact),
        asOf,
        bucket.id,
      ));
    }
    return [];
  });
  const contactCitations = contacts.map((contact) => contactCitation(contact, ['id'], asOf, 'workspace-snapshot'));
  const recommendationItems = snapshot.recommendations.map((recommendation) => {
    const citations = recommendation.contactIds.flatMap((id) => {
      const contact = contacts.find((candidate) => candidate.id === id);
      return contact
        ? [contactCitation(contact, RECOMMENDATION_FACT_KEYS[recommendation.id], asOf, recommendation.id)]
        : [];
    });
    return {
      id: `recommendation-${recommendation.id}`,
      label: recommendation.title,
      detail: recommendation.evidence,
      value: recommendation.count,
      href: recommendation.href,
      citations,
    };
  });
  const summary = block(
    'daily-brief',
    'summary',
    `Omnix brief for ${today}`,
    'Deterministic CRM snapshot; counts and ordering are derived only from authorized records.',
    [
      {
        id: 'total-contacts',
        label: 'Authorized contacts',
        value: snapshot.totalContacts,
        citations: contactCitations,
      },
      {
        id: 'needs-attention-now',
        label: 'Needs attention now',
        value: snapshot.needsAttentionNow,
        citations: attentionCitations,
      },
      ...recommendationItems,
    ],
  );
  const groups = groupTasks(tasks, today, timeZone);
  const taskItems = [
    { id: 'tasks-overdue', label: 'Overdue tasks', value: groups.overdue.length, citations: groups.overdue.map((task) => taskCitation(task, TASK_SCHEDULE_FACT_KEYS, asOf, 'task-overdue')) },
    { id: 'tasks-today', label: 'Tasks due today', value: groups.today.length, citations: groups.today.map((task) => taskCitation(task, TASK_SCHEDULE_FACT_KEYS, asOf, 'task-due-today')) },
    { id: 'tasks-upcoming', label: 'Tasks due in the next 7 days', value: groups.upcoming.length, citations: groups.upcoming.map((task) => taskCitation(task, TASK_SCHEDULE_FACT_KEYS, asOf, 'task-upcoming')) },
  ];
  const warnings = boundedWarning(bounded);
  if (!taskCapabilityAvailable) {
    warnings.push({
      code: 'capability-unavailable',
      message: 'Workspace task data is unavailable; contact-based brief facts remain complete.',
    });
  }
  return {
    answerBlocks: [summary, block(
      'task-groups',
      taskCapabilityAvailable ? 'metric' : 'capability',
      'Open task groups',
      taskCapabilityAvailable
        ? 'Open tasks are grouped by the configured CRM calendar day.'
        : 'Workspace task data is unavailable.',
      taskCapabilityAvailable ? taskItems : [],
    )],
    warnings,
    alerts: buildAlerts(contacts, tasks, today, asOf, timeZone, historicalImportContactIds),
    suggestions: [reviewSuggestion('review-work-queue', 'Review the work queue', 'Open the existing task and contact command surface.', '/activities', summary.citations)],
  };
}

function alertsResult(
  contacts: readonly Contact[],
  tasks: readonly CrmTask[],
  today: string,
  asOf: string,
  timeZone: string | undefined,
  bounded: boolean,
  taskCapabilityAvailable: boolean,
  historicalImportContactIds: ReadonlySet<string> = new Set(),
): ReadResult {
  const { alerts, warnings } = buildOmnixAlertResult({
    contacts,
    tasks,
    today,
    asOf,
    timeZone,
    bounded,
    taskCapabilityAvailable,
    historicalImportContactIds,
  });

  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const attentionItem = (alert: OmnixCopilotAlert): OmnixCopilotAnswerItem => {
    const task = alert.category === 'task' ? tasksById.get(alert.recordId) : undefined;
    if (task) {
      const relatedContact = task.contactId ? contactsById.get(task.contactId) : undefined;
      return {
        id: alert.id,
        label: task.title,
        detail: [
          alert.reason,
          relatedContact ? `For ${displayName(relatedContact)}` : undefined,
        ].filter(Boolean).join(' · '),
        value: 'Task',
        href: alert.href,
        citations: alert.citations,
      };
    }

    const contact = contactsById.get(alert.recordId);
    if (contact) {
      return {
        id: alert.id,
        label: displayName(contact),
        detail: [
          alert.reason,
          RELATIONSHIP_LABEL[contact.relationship],
          PIPELINE_LABEL[contact.pipelineStage],
          SOURCE_LABEL[contact.source],
        ].join(' · '),
        value: LEAD_TYPE_LABEL[contact.leadType],
        href: alert.href,
        citations: alert.citations,
      };
    }

    return {
      id: alert.id,
      label: alert.category === 'task' ? 'CRM task' : 'CRM follow-up',
      detail: alert.reason,
      href: alert.href,
      citations: alert.citations,
    };
  };

  const bucketDefinitions = [
    {
      id: 'attention-overdue',
      title: 'Act now',
      detail: 'Start with overdue follow-up and first-contact work.',
      rules: new Set<OmnixCopilotAlertRule>(['needs-first-contact', 'overdue-follow-up']),
    },
    {
      id: 'attention-today',
      title: 'Due today',
      detail: 'These relationships and tasks are due on the CRM calendar today.',
      rules: new Set<OmnixCopilotAlertRule>(['due-today-follow-up']),
    },
    {
      id: 'attention-upcoming',
      title: 'Coming up',
      detail: 'Prepare these next touches before they become urgent.',
      rules: new Set<OmnixCopilotAlertRule>(['upcoming-follow-up']),
    },
  ] as const;
  const bucketedRules = new Set(bucketDefinitions.flatMap((definition) => [...definition.rules]));
  const groupedBlocks = bucketDefinitions.map((definition) => {
    const items = alerts.filter((alert) => definition.rules.has(alert.rule)).map(attentionItem);
    return block(definition.id, 'list', definition.title, definition.detail, items);
  });
  const reminderItems = alerts
    .filter((alert) => alert.category !== 'task' && !bucketedRules.has(alert.rule))
    .map(attentionItem);
  if (reminderItems.length) {
    groupedBlocks.push(block(
      'attention-reminders',
      'list',
      'Relationship reminders',
      'Celebrations, pipeline gaps and mailing details worth reviewing.',
      reminderItems,
    ));
  }
  const taskItems = alerts.filter((alert) => alert.category === 'task').map(attentionItem);
  if (taskItems.length) {
    groupedBlocks.push(block(
      'attention-tasks',
      'list',
      'Open tasks',
      'Task deadlines stay in the fixed CRM alert order.',
      taskItems,
    ));
  }

  const contactCount = new Set(alerts
    .filter((alert) => alert.category !== 'task' && contactsById.has(alert.recordId))
    .map((alert) => alert.recordId)).size;
  const taskCount = new Set(alerts
    .filter((alert) => alert.category === 'task')
    .map((alert) => alert.recordId)).size;
  const countRules = (...rules: OmnixCopilotAlertRule[]) => alerts
    .filter((alert) => rules.includes(alert.rule)).length;

  if (!alerts.length) {
    return {
      answerBlocks: [block(
        'alerts-empty',
        'empty',
        "You're caught up",
        'No follow-up, task or relationship reminder needs attention right now.',
      )],
      alerts,
      warnings,
      suggestions: [reviewSuggestion('review-alerts', 'Open the alert center', 'See the complete CRM attention queue.', '/alerts')],
    };
  }

  const summary = block(
    'attention-summary',
    'metric',
    `${alerts.length} attention ${alerts.length === 1 ? 'item' : 'items'}`,
    `${contactCount} ${contactCount === 1 ? 'person' : 'people'} and ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} need review. Start with Act now.`,
    [
      { id: 'attention-people-count', label: 'People', value: contactCount, citations: [] },
      { id: 'attention-task-count', label: 'Tasks', value: taskCount, citations: [] },
      { id: 'attention-overdue-count', label: 'Act now', value: countRules('needs-first-contact', 'overdue-follow-up', 'task-overdue'), citations: [] },
      { id: 'attention-today-count', label: 'Due today', value: countRules('due-today-follow-up', 'task-due-today'), citations: [] },
      { id: 'attention-upcoming-count', label: 'Coming up', value: countRules('upcoming-follow-up'), citations: [] },
      { id: 'attention-reminder-count', label: 'Reminders', value: reminderItems.length, citations: [] },
    ],
  );

  return {
    answerBlocks: [summary, ...groupedBlocks.filter((item) => item.items.length)],
    alerts,
    warnings,
    suggestions: [reviewSuggestion(
      'review-alerts',
      'View the complete alert center',
      'Open every current alert with the same CRM evidence and ordering.',
      '/alerts',
      alerts.flatMap((alert) => alert.citations),
    )],
  };
}

function findContactResult(contacts: readonly Contact[], query: string, asOf: string, bounded: boolean): ReadResult {
  const matches = queryContacts(contacts, { query, scope: 'all' }).slice(0, OMNIX_COPILOT_RESULT_MAX);
  const items = matches.map((contact) => {
    const citation = contactCitation(contact, CONTACT_SEARCH_FACT_KEYS, asOf, 'find-contact');
    return {
      id: contact.id,
      label: displayName(contact),
      detail: `${contact.leadType} · ${contact.relationship}`,
      href: identifierTarget('contact', contact.id),
      citations: [citation],
    };
  });
  return {
    answerBlocks: [block(
      matches.length ? 'contact-results' : 'contact-results-empty',
      matches.length ? 'list' : 'empty',
      'Contact results',
      matches.length
        ? `People matching “${query}”.`
        : `No one matches “${query}”. Try a first or last name.`,
      items,
    )],
    warnings: boundedWarning(bounded),
    suggestions: matches[0]
      ? [reviewSuggestion('review-contact', 'Review contact', 'Open the authorized contact record.', identifierTarget('contact', matches[0].id), items[0]?.citations)]
      : [],
  };
}

async function contactProfileResult(
  context: OmnixCopilotRepositoryContext,
  contacts: readonly Contact[],
  query: string,
  asOf: string,
  bounded: boolean,
): Promise<ReadResult> {
  const exact = contacts.find((contact) => contact.id === query && !contact.archivedAt);
  const matches = exact ? [exact] : queryContacts(contacts, { query, scope: 'all' }).slice(0, 6);
  if (matches.length !== 1) {
    const base = findContactResult(contacts, query, asOf, bounded);
    return {
      ...base,
      warnings: [
        ...(base.warnings ?? []),
        { code: 'profile-requires-one-contact', message: matches.length
          ? 'More than one contact matched. Refine the name before requesting a full profile.'
          : 'No contact matched the requested profile.' },
      ],
    };
  }

  const contact = matches[0]!;
  const citation = contactCitation(contact, [
    ...CONTACT_SEARCH_FACT_KEYS,
    'intent', 'source', 'pipelineStage', 'mailingAddress', 'state', 'birthdate',
    'homePurchaseDate', 'buyer', 'seller', 'nextTouchAt', 'lastContactedAt', 'emailSubscribed',
  ], asOf, 'contact-profile');
  const today = asOf.slice(0, 10);
  const coreItems = [
    ['Relationship', `${LEAD_TYPE_LABEL[contact.leadType]} · ${RELATIONSHIP_LABEL[contact.relationship]} · ${INTENT_LABEL[contact.intent]}`],
    ['Pipeline', `${PIPELINE_LABEL[contact.pipelineStage]} · from ${SOURCE_LABEL[contact.source]}`],
    ['Phone & email', [contact.phone, contact.secondaryPhone, contact.email].filter(Boolean).join(' · ') || 'No phone or email saved'],
    ['Address', [contact.mailingAddress, contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ') || 'No address saved'],
    ['Follow-up', `${contact.lastContactedAt ? `Last talked ${friendlyDay(contact.lastContactedAt, today)}` : 'Never contacted'} · ${contact.nextTouchAt ? `next follow-up ${friendlyDay(contact.nextTouchAt, today)}` : 'no follow-up set'}`],
    ['Dates', [contact.birthdate ? `Birthday ${friendlyMonthDay(contact.birthdate)}` : undefined, contact.homePurchaseDate ? `Home anniversary ${friendlyMonthDay(contact.homePurchaseDate)}` : undefined].filter(Boolean).join(' · ') || 'No birthday or home anniversary saved'],
    ['Looking for', criteriaSummary(contact) || 'No home criteria saved'],
    ...(contact.tags.length ? [['Tags', contact.tags.join(', ')]] : []),
  ].map(([label, detail], index) => ({
    id: `profile-core-${index}`, label: label!, detail, href: identifierTarget('contact', contact.id), citations: [citation],
    ...(index === 0 ? { contact: personOf(contact) } : {}),
  }));

  const [notes, points, relationships, assignments, definitions, values, events, tasks] = await Promise.all([
    context.repository.notesFor(contact.id),
    context.richContactRepository?.listContactPoints(context.workspaceScope, contact.id, false) ?? [],
    context.richContactRepository?.listRelationships(context.workspaceScope, contact.id, false) ?? [],
    context.richContactRepository?.listAssignments(context.workspaceScope, contact.id, false) ?? [],
    context.richContactRepository?.listCustomFieldDefinitions(context.workspaceScope, false) ?? [],
    context.richContactRepository?.listCustomFieldValues(context.workspaceScope, contact.id) ?? [],
    context.activityRepository?.listEvents(context.workspaceScope, { contactId: contact.id, limit: 20 }) ?? [],
    context.activityRepository?.listTasks(context.workspaceScope, { contactId: contact.id, status: 'all', limit: 20 }) ?? [],
  ]);
  const valueNames = new Map(definitions.map((definition) => [definition.id, definition.name]));
  const relatedCitation = contactCitation(contact, ['notes', 'contactPoints', 'relationships', 'assignments', 'customFields'], asOf, 'contact-profile-related');
  const relatedItems = [
    ...points.map((point) => ({ id: `point-${point.id}`, label: `${point.type} · ${point.label}`, detail: point.displayValue, citations: [relatedCitation] })),
    ...relationships.map((relationship) => ({ id: `relationship-${relationship.id}`, label: `Relationship · ${relationship.label ?? relationship.kind}`, detail: relationship.firstContactId === contact.id ? relationship.secondContactId : relationship.firstContactId, citations: [relatedCitation] })),
    ...assignments.map((assignment) => ({ id: `assignment-${assignment.id}`, label: 'Assigned member', detail: assignment.assigneeMembershipId, citations: [relatedCitation] })),
    ...values.map((value) => ({ id: `custom-${value.id}`, label: valueNames.get(value.definitionId) ?? 'Custom field', detail: String(value.value), citations: [relatedCitation] })),
  ].slice(0, 40);
  const memoryItems = extractMemoryFacts(notes).map((fact, index) => ({ id: `memory-${index}`, label: fact.text, detail: `${MEMORY_KIND_LABEL[fact.kind]} · noted ${friendlyDay(fact.noteDate, today)}`, citations: [relatedCitation] }));
  const noteItems = notes.slice(0, 20).map((note) => ({ id: note.id, label: note.body, detail: friendlyDay(note.createdAt, today), citations: [relatedCitation] }));
  const activityItems = [
    ...tasks.map((task) => ({ id: task.id, label: `Follow-up · ${task.title}`, detail: `${task.status === 'open' ? 'Open' : task.status === 'completed' ? 'Done' : task.status} · due ${friendlyDay(task.dueAt, today)}`, href: identifierTarget('task', task.id), citations: [taskCitation(task, TASK_LIST_FACT_KEYS, asOf)] })),
    ...events.map((event) => ({ id: event.id, label: activityEventLabel(event.type), detail: friendlyDay(event.occurredAt, today), href: identifierTarget('contact', contact.id), citations: [activityCitation(event, asOf)] })),
  ].slice(0, 40);

  return {
    answerBlocks: [
      block('contact-profile', 'list', displayName(contact), 'What’s saved in your CRM. Missing details are marked, never guessed.', coreItems),
      ...(memoryItems.length ? [block('contact-profile-memory', 'list', `What matters to ${contact.preferredName ?? contact.firstName}`, 'Personal details from your notes.', memoryItems)] : []),
      ...(relatedItems.length ? [block('contact-profile-related', 'list', 'More contact details', 'Extra numbers, emails, relationships and custom fields.', relatedItems)] : []),
      block(noteItems.length ? 'contact-profile-notes' : 'contact-profile-notes-empty', noteItems.length ? 'list' : 'empty', 'Notes', noteItems.length ? 'Latest notes first.' : 'No notes yet.', noteItems),
      block(activityItems.length ? 'contact-profile-work' : 'contact-profile-work-empty', activityItems.length ? 'list' : 'empty', 'Follow-ups and activity', activityItems.length ? 'Latest follow-ups and activity.' : 'No follow-ups or activity yet.', activityItems),
    ],
    warnings: boundedWarning(bounded),
    suggestions: [reviewSuggestion('review-contact-profile', 'Open full contact record', 'See everything and make changes.', identifierTarget('contact', contact.id), [citation])],
  };
}

function pipelineResult(contacts: readonly Contact[], asOf: string, bounded: boolean): ReadResult {
  const stages: readonly PipelineStage[] = ['new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost'];
  const items = stages.map((stage) => {
    const matches = contacts.filter((contact) => contact.pipelineStage === stage);
    return {
      id: `pipeline-${stage}`,
      label: PIPELINE_LABEL[stage],
      value: matches.length,
      href: '/pipeline',
      citations: matches.map((contact) => contactCitation(contact, ['pipelineStage'], asOf, 'pipeline-count')),
    };
  });
  return {
    answerBlocks: [block('pipeline', 'metric', 'Pipeline', 'Current contact pipelineStage counts; no transaction deadline is inferred.', items)],
    warnings: boundedWarning(bounded),
    suggestions: [reviewSuggestion('review-pipeline', 'Review pipeline', 'Open the existing pipeline view.', '/pipeline', items.flatMap((item) => item.citations))],
  };
}

function tasksResult(
  tasks: readonly CrmTask[],
  intent: Extract<OmnixCopilotIntent, { kind: 'tasks' | 'tasks-range' }>,
  today: string,
  asOf: string,
  timeZone?: string,
): ReadResult {
  const groups = groupTasks(tasks, today, timeZone);
  const selected = intent.kind === 'tasks-range'
    ? tasks.filter((task) => {
      const dueDate = calendarDateAt(new Date(task.dueAt), timeZone);
      return dueDate >= intent.from && dueDate <= intent.to;
    })
    : groups[intent.window];
  const items = selected.map((task) => {
    const citation = taskCitation(
      task,
      TASK_LIST_FACT_KEYS,
      asOf,
      `tasks-${intent.kind === 'tasks' ? intent.window : 'range'}`,
    );
    return {
      id: task.id,
      label: task.title,
      detail: task.dueAt,
      href: identifierTarget('task', task.id),
      citations: [citation],
    };
  });
  return {
    answerBlocks: [block(
      selected.length ? 'tasks' : 'tasks-empty',
      selected.length ? 'list' : 'empty',
      'Open tasks',
      selected.length ? 'Authorized open tasks in deterministic work-queue order.' : 'No authorized record matched the deterministic task window.',
      items,
    )],
    suggestions: [reviewSuggestion('review-tasks', 'Review tasks', 'Open the existing work queue; any change requires a separate explicit submission.', '/activities', items.flatMap((item) => item.citations))],
  };
}

function datesResult(contacts: readonly Contact[], window: 'today' | 'upcoming', today: string, asOf: string): ReadResult {
  const todayDate = asCalendarDate(today);
  const entries = contacts.flatMap((contact) => {
    const dates: Array<{ kind: 'birthday' | 'homeaversary'; inDays: number; field: 'birthdate' | 'homePurchaseDate' }> = [];
    if (contact.birthdate) dates.push({ kind: 'birthday', inDays: daysUntilAnniversary(contact.birthdate, todayDate), field: 'birthdate' });
    if (contact.homePurchaseDate) dates.push({ kind: 'homeaversary', inDays: daysUntilAnniversary(contact.homePurchaseDate, todayDate), field: 'homePurchaseDate' });
    return dates
      .filter((date) => window === 'today' ? date.inDays === 0 : date.inDays >= 0 && date.inDays <= (date.kind === 'birthday' ? 7 : 30))
      .map((date) => ({ contact, ...date }));
  }).sort((left, right) => left.inDays - right.inDays || left.contact.id.localeCompare(right.contact.id));
  const items = entries.map((entry) => {
    const citation = contactCitation(
      entry.contact,
      [...CONTACT_NAME_FACT_KEYS, entry.field],
      asOf,
      entry.kind,
    );
    return {
      id: `${entry.kind}-${entry.contact.id}`,
      label: `${displayName(entry.contact)} · ${entry.kind}`,
      detail: entry.inDays === 0 ? 'Today' : `In ${entry.inDays} days`,
      href: identifierTarget('contact', entry.contact.id),
      citations: [citation],
    };
  });
  return {
    answerBlocks: [block(
      entries.length ? 'dates' : 'dates-empty',
      entries.length ? 'list' : 'empty',
      window === 'today' ? 'Dates today' : 'Upcoming dates',
      entries.length ? 'Authorized birthdays and home-purchase anniversaries in the fixed reminder windows.' : 'No authorized record matched the deterministic date window.',
      items,
    )],
    suggestions: [reviewSuggestion('review-dates', 'Review contacts', 'Open the CRM triage view.', '/', items.flatMap((item) => item.citations))],
  };
}

function mailersResult(campaigns: readonly MailerCampaign[], campaignId: string | undefined, asOf: string): ReadResult {
  const selected = campaigns
    .filter((campaign) => !campaignId || campaign.id === campaignId)
    .slice(0, OMNIX_COPILOT_RESULT_MAX);
  const items = selected.map((campaign) => {
    const citations = [mailerCitation(campaign, asOf), ...mailerSendCitations(campaign, asOf)];
    return {
      id: campaign.id,
      label: campaign.name,
      detail: 'Physical postcard/letter campaign.',
      value: Math.min(campaign.sends.length, OMNIX_COPILOT_RESULT_MAX),
      href: '/mailers',
      citations,
    };
  });
  return {
    answerBlocks: [block(
      selected.length ? 'mailers' : 'mailers-empty',
      selected.length ? 'list' : 'empty',
      'Physical mailers',
      selected.length ? 'Persisted postcard/letter campaign facts; no send state was changed.' : 'Applied deterministic mailer lookup; no authorized record matched.',
      items,
    )],
    warnings: campaigns.length > OMNIX_COPILOT_RESULT_MAX
      || selected.some((campaign) => campaign.sends.length > OMNIX_COPILOT_RESULT_MAX)
      ? boundedWarning(true)
      : [],
    suggestions: [reviewSuggestion('review-mailers', 'Review physical mailers', 'Open the existing physical-mailer campaign surface.', '/mailers', items.flatMap((item) => item.citations))],
  };
}

export function connectionsResult(
  definitions: readonly ConnectorDefinition[],
  connections: readonly ConnectorConnection[],
  lifecycles: readonly ConnectorLifecycleProjection[],
  asOf: string,
): ReadResult {
  const lifecycleLabel = (lifecycle: ConnectorLifecycleProjection | undefined): string | undefined => {
    if (!lifecycle) return undefined;
    if (lifecycle.state === 'ready') return 'Ready';
    if (lifecycle.state === 'disconnected') return 'Not connected';
    if (lifecycle.state === 'not-configured') return 'Unavailable';
    if (lifecycle.state === 'reconnect-required') return 'Reconnect needed';
    if (lifecycle.state === 'disconnect-pending') return 'Disconnecting';
    if (['owner-consent-pending', 'scope-pending', 'webhook-pending', 'baseline-pending'].includes(lifecycle.state)) {
      return 'Setup needed';
    }
    if (lifecycle.state === 'baseline-running') return 'Updating';
    return 'Needs attention';
  };
  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
  const lifecycleByProvider = new Map(lifecycles.map((lifecycle) => [lifecycle.provider, lifecycle]));
  const items = definitions.map((definition) => {
    const connection = byProvider.get(definition.provider);
    const lifecycle = lifecycleByProvider.get(definition.provider as ConnectorLifecycleProjection['provider']);
    const citation = connection ? connectorCitation(connection, asOf) : undefined;
    return {
      id: `connector-${definition.provider}`,
      label: definition.label,
      detail: lifecycle?.safeSummary ?? (connection ? 'This connection needs review.' : 'This service is not connected.'),
      value: lifecycleLabel(lifecycle) ?? (connection ? 'Needs attention' : 'Not connected'),
      href: '/connections',
      citations: citation ? [citation] : [],
    };
  });
  return {
    answerBlocks: [block(
      'connections',
      'list',
      'Connections',
      'A safe summary of the services available to this workspace.',
      items,
    )],
    suggestions: [reviewSuggestion(
      'review-connections',
      'Review connections',
      'Open the governed connection control surface.',
      '/connections',
      items.flatMap((item) => item.citations),
    )],
  };
}

async function activityResult(
  repository: ActivityRepository,
  contacts: ContactRepository,
  scope: WorkspaceScope,
  contactId: string,
  asOf: string,
): Promise<ReadResult> {
  const contact = await contacts.get(contactId);
  if (!contact) {
    return { answerBlocks: [block('activity-empty', 'empty', 'Recent activity', `Applied deterministic activity lookup for ${contactId}; no authorized record matched.`)] };
  }
  const events = await listActivityEventsCommand(repository, scope, {
    contactId,
    limit: OMNIX_COPILOT_RESULT_MAX,
  });
  const items = events.map((event) => {
    const citation = activityCitation(event, asOf);
    return {
      id: event.id,
      label: activityEventLabel(event.type),
      detail: event.occurredAt,
      href: identifierTarget('contact', contactId),
      citations: [citation],
    };
  });
  return {
    answerBlocks: [block(
      items.length ? 'activity' : 'activity-empty',
      items.length ? 'list' : 'empty',
      `Recent activity for ${displayName(contact)}`,
      items.length ? 'Authorized append-only CRM activity, newest first.' : 'No authorized activity record matched.',
      items,
    )],
    suggestions: [reviewSuggestion('review-activity-contact', 'Review contact', 'Open the authorized contact record.', identifierTarget('contact', contactId), items.flatMap((item) => item.citations))],
  };
}

function helpResult(): ReadResult {
  const examples = [
    'brief today',
    'alerts today',
    'find contact <query>',
    'contact profile <query>',
    'pipeline',
    'tasks overdue',
    'tasks today',
    'tasks upcoming',
    'tasks from <YYYY-MM-DD> to <YYYY-MM-DD>',
    'dates today',
    'dates upcoming',
    'mailers [<campaign-id>]',
    'activity <contact-id>',
    'connections',
    'email campaigns',
    'help',
  ];
  return {
    answerBlocks: [block('help', 'list', 'Supported deterministic questions', 'One invocation resolves at most one documented intent.', examples.map((example, index) => ({
      id: `example-${index + 1}`,
      label: example,
      citations: [],
    })))],
  };
}

async function dispatch(
  request: OmnixCopilotRequest,
  context: OmnixCopilotRepositoryContext,
  timeZone: string | undefined,
): Promise<ReadResult> {
  const scope = validateWorkspaceScope(context.workspaceScope);
  if (contextMode(context) !== request.dataMode || scope.mode !== request.dataMode) {
    throw new OmnixCopilotError('forbidden', 'Requested data mode does not match authenticated workspace authority.');
  }
  const asOfDate = new Date(request.asOf);
  const configuredToday = calendarDateAt(asOfDate, timeZone);
  const intent = request.intent;

  if (intent.kind === 'help') return helpResult();
  if ((OMNIX_MODULE_INTENTS as readonly string[]).includes(intent.kind)) return readOmnixModules(context, scope, intent, request.asOf);
  if (intent.kind === 'campaigns') {
    return {
      answerBlocks: [block(
        'email-campaigns', 'capability', 'Email campaigns',
        'Prepare a message for all subscribed contacts or one Hot, Warm, or Nurture segment. Omnix excludes unsubscribed contacts, and only the workspace owner can approve the final send.',
        [{ id: 'open-email-campaigns', label: 'Create or review a campaign', href: '/campaigns', citations: [] }],
      )],
      suggestions: [{ id: 'review-email-campaigns', kind: 'review-link', title: 'Open email campaigns',
        detail: 'Review the audience count and prepare a governed Mailchimp campaign.', href: '/campaigns', readOnly: true, citations: [] }],
    };
  }
  if (intent.kind === 'connections') {
    if (!context.connectorRepository) {
      return unavailable('Connections', 'Workspace connection data is unavailable in this context.', '/connections');
    }
    const snapshot = await readConnectorLifecycleSnapshot({
      connectorRepository: context.connectorRepository,
      workspaceScope: scope,
      isLive: context.isLive,
      observedAt: asOfDate,
    });
    return connectionsResult(snapshot.definitions, snapshot.connections, snapshot.lifecycles, request.asOf);
  }
  if (intent.kind === 'mailers') {
    if (!context.mailerRepository) return unavailable('Physical mailers', 'Physical-mailer data is unavailable in this workspace context.', '/mailers');
    return mailersResult(await context.mailerRepository.list(), intent.campaignId, request.asOf);
  }
  if (intent.kind === 'activity') {
    if (!context.activityRepository) return unavailable('Activity', 'Workspace activity data is unavailable in this workspace context.', '/activities');
    return activityResult(context.activityRepository, context.repository, scope, intent.contactId, request.asOf);
  }

  if (intent.kind === 'tasks' || intent.kind === 'tasks-range') {
    if (!context.activityRepository) return unavailable('Tasks', 'Workspace task data is unavailable in this workspace context.', '/activities');
    const tasks = await openTasks(context.activityRepository, scope, asOfDate);
    return tasksResult(tasks, intent, configuredToday, request.asOf, timeZone);
  }
  const { contacts, bounded } = await boundedContacts(context.repository);
  if (intent.kind === 'find-contact') return findContactResult(contacts, intent.query, request.asOf, bounded);
  if (intent.kind === 'contact-profile') return contactProfileResult(context, contacts, intent.query, request.asOf, bounded);
  if (intent.kind === 'pipeline') return pipelineResult(contacts, request.asOf, bounded);
  if (intent.kind === 'dates') return datesResult(contacts, intent.window, configuredToday, request.asOf);
  if (intent.kind === 'segment') return segmentResult(contacts, intent.filter, configuredToday, request.asOf, bounded);
  if (intent.kind === 'recap') return recapResult(context, scope, contacts, intent.window, configuredToday, request.asOf, timeZone);
  const tasks = context.activityRepository
    ? await openTasks(context.activityRepository, scope, asOfDate)
    : [];
  const importedEvents = context.activityRepository
    ? await listActivityEventsCommand(context.activityRepository, scope, {
        type: 'contact-imported',
        limit: OMNIX_COPILOT_RESULT_MAX,
      })
    : [];
  const historicalImportContactIds = new Set(
    importedEvents.flatMap((event) => event.contactId ? [event.contactId] : []),
  );
  if (intent.kind === 'brief') {
    const today = calendarDate(intent.date, configuredToday);
    return briefResult(
      contacts,
      tasks,
      today,
      request.asOf,
      timeZone,
      bounded,
      Boolean(context.activityRepository),
      historicalImportContactIds,
    );
  }
  if (intent.kind === 'alerts') {
    const today = calendarDate(intent.date, configuredToday);
    return alertsResult(
      contacts,
      tasks,
      today,
      request.asOf,
      timeZone,
      bounded,
      Boolean(context.activityRepository),
      historicalImportContactIds,
    );
  }
  throw new OmnixCopilotError('unsupported-intent', 'The resolved copilot intent is unsupported.');
}



function friendlyDay(value: string, today: string): string {
  const time = Date.parse(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(time)) return value;
  const day = new Date(time).toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  if (diff === 0) return `today (${label})`;
  if (diff === -1) return `yesterday (${label})`;
  if (diff === 1) return `tomorrow (${label})`;
  return diff < 0 ? `${label} (${-diff} days ago)` : `${label} (in ${diff} days)`;
}

function friendlyMonthDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function money(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `$${Math.round(value).toLocaleString('en-US')}`;
}

function criteriaSummary(contact: Contact): string {
  const buyer = contact.buyer;
  const seller = contact.seller;
  const parts = [
    buyer ? [
      buyer.priceMin || buyer.priceMax ? `Budget ${[money(buyer.priceMin), money(buyer.priceMax)].filter(Boolean).join('–')}` : undefined,
      buyer.areas?.length ? `in ${buyer.areas.join(', ')}` : undefined,
      buyer.beds ? `${buyer.beds}+ beds` : undefined,
      buyer.baths ? `${buyer.baths}+ baths` : undefined,
      buyer.desiredPropertyType,
      buyer.preApproved ? 'pre-approved' : buyer.preApproved === false ? 'not pre-approved yet' : undefined,
      buyer.timeline ? `timeline ${buyer.timeline}` : undefined,
    ].filter(Boolean).join(', ') : undefined,
    seller ? [
      seller.propertyAddress ? `Selling ${seller.propertyAddress}` : 'Selling',
      money(seller.targetPrice) ? `target ${money(seller.targetPrice)}` : undefined,
      seller.timeline ? `timeline ${seller.timeline}` : undefined,
      seller.motivation,
    ].filter(Boolean).join(', ') : undefined,
  ].filter((part): part is string => Boolean(part && part !== 'Selling'));
  return parts.join(' · ');
}

const SEGMENT_RESULT_LIMIT = 50;

function personOf(contact: Contact): NonNullable<OmnixCopilotAnswerItem['contact']> {
  const firstName = (contact.preferredName ?? contact.firstName).trim() || displayName(contact);
  return { id: contact.id, name: displayName(contact), firstName, ...(contact.phone ? { phone: contact.phone } : {}) };
}

function segmentResult(contacts: readonly Contact[], filter: OmnixSegmentFilter, today: string, asOf: string, bounded: boolean): ReadResult {
  const matches = applySegment(contacts, filter, today);
  const described = describeSegment(filter);
  const shown = matches.slice(0, SEGMENT_RESULT_LIMIT);
  const items = shown.map(({ contact, reasons }) => ({
    id: `segment-${contact.id}`,
    label: displayName(contact),
    detail: [...reasons, LEAD_TYPE_LABEL[contact.leadType], contact.city].filter(Boolean).join(' · '),
    href: identifierTarget('contact', contact.id),
    contact: personOf(contact),
    citations: [contactCitation(contact, ['leadType', 'relationship', 'intent', 'pipelineStage', 'source', 'city', 'lastContactedAt', 'birthdate', 'homePurchaseDate', 'nextTouchAt'], asOf, 'segment')],
  }));
  const count = matches.length;
  const headline = count === 0
    ? `No ${described} right now.`
    : `You have ${count} ${count === 1 ? described.replace(/^(.*?)(leads|buyers|sellers|investors|renters|clients|contacts|people)\b/u, (_all, before: string, noun: string) => `${before}${({ leads: 'lead', buyers: 'buyer', sellers: 'seller', investors: 'investor', renters: 'renter', clients: 'client', contacts: 'contact', people: 'person' } as Record<string, string>)[noun] ?? noun}`) : described}${count > shown.length ? ` — here are the first ${shown.length}` : ''}.`;
  return {
    answerBlocks: [block(
      count ? 'segment-results' : 'segment-results-empty',
      count ? 'list' : 'empty',
      count === 1 ? '1 match' : `${count} matches`,
      headline,
      items,
    )],
    warnings: boundedWarning(bounded),
    suggestions: count ? [reviewSuggestion('review-people', 'Open People', 'Work through them in your People list.', '/contacts', items.slice(0, 12).flatMap((item) => item.citations))] : [],
  };
}

const RECAP_DAYS: Record<'today' | 'yesterday' | 'week' | 'month', readonly [number, number]> = {
  today: [0, 0], yesterday: [1, 1], week: [6, 0], month: [29, 0],
};

async function recapResult(
  context: OmnixCopilotRepositoryContext,
  scope: WorkspaceScope,
  contacts: readonly Contact[],
  window: 'today' | 'yesterday' | 'week' | 'month',
  today: string,
  asOf: string,
  timeZone: string | undefined,
): Promise<ReadResult> {
  const [startBack, endBack] = RECAP_DAYS[window];
  const shift = (days: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
  const fromDay = shift(startBack); const toDay = shift(endBack);
  const inWindow = (instant: string | undefined) => {
    if (!instant) return false;
    const day = calendarDateAt(new Date(instant), timeZone);
    return day >= fromDay && day <= toDay;
  };
  const events = context.activityRepository
    ? await listActivityEventsCommand(context.activityRepository, scope, {
      from: new Date(Date.parse(`${fromDay}T00:00:00Z`) - 86_400_000).toISOString(),
      to: new Date(Date.parse(`${toDay}T23:59:59Z`) + 86_400_000).toISOString(),
      limit: OMNIX_COPILOT_RESULT_MAX,
    }).then((list) => list.filter((event) => inWindow(event.occurredAt)))
    : [];
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const added = contacts.filter((contact) => !contact.archivedAt && inWindow(contact.createdAt));
  const talked = contacts.filter((contact) => inWindow(contact.lastContactedAt));
  const count = (types: readonly string[]) => events.filter((event) => types.includes(event.type)).length;
  const label = window === 'today' ? 'Today' : window === 'yesterday' ? 'Yesterday' : window === 'week' ? 'Last 7 days' : 'Last 30 days';
  const metrics = [
    { id: 'recap-new', label: 'New contacts', value: added.length },
    { id: 'recap-conversations', label: 'Conversations', value: Math.max(talked.length, count(['touch-recorded'])) },
    { id: 'recap-notes', label: 'Notes', value: count(['note-added']) },
    { id: 'recap-done', label: 'Follow-ups done', value: count(['task-completed']) },
    { id: 'recap-created', label: 'Follow-ups set', value: count(['task-created']) },
    { id: 'recap-stage', label: 'Stage moves', value: count(['pipeline-stage-changed']) },
  ].map((item) => ({ ...item, citations: [] as OmnixCopilotCitation[] }));
  const people = [...new Map([...added, ...talked].map((contact) => [contact.id, contact])).values()].slice(0, 12).map((contact) => ({
    id: `recap-person-${contact.id}`,
    label: displayName(contact),
    detail: [inWindow(contact.createdAt) ? 'New' : undefined, inWindow(contact.lastContactedAt) ? 'Talked' : undefined, LEAD_TYPE_LABEL[contact.leadType]].filter(Boolean).join(' · '),
    href: identifierTarget('contact', contact.id),
    contact: personOf(contact),
    citations: [contactCitation(contact, ['createdAt', 'lastContactedAt'], asOf, 'recap')],
  }));
  const moved = events.filter((event) => event.type === 'pipeline-stage-changed' && event.contactId && byId.has(event.contactId)).slice(0, 8).map((event) => {
    const contact = byId.get(event.contactId!)!;
    return {
      id: `recap-move-${event.id}`,
      label: displayName(contact),
      detail: `Moved to ${String(event.metadata?.pipelineStage ?? event.metadata?.toStage ?? 'a new stage').replaceAll('-', ' ')}`,
      href: identifierTarget('contact', contact.id),
      citations: [activityCitation(event, asOf)],
    };
  });
  const total = metrics.reduce((sum, item) => sum + Number(item.value), 0);
  return {
    answerBlocks: [
      block('recap-metrics', 'metric', label, total ? `Here’s what moved ${window === 'today' ? 'today' : window === 'yesterday' ? 'yesterday' : `in the ${label.toLowerCase()}`}.` : 'Quiet stretch — nothing was recorded in this window.', metrics),
      ...(people.length ? [block('recap-people', 'list', 'People you worked with', 'New contacts and conversations in this window.', people)] : []),
      ...(moved.length ? [block('recap-moves', 'list', 'Pipeline moves', 'Stage changes recorded in this window.', moved)] : []),
    ],
    suggestions: [reviewSuggestion('review-activity', 'Open activity', 'See every recorded step.', '/activities', people.flatMap((item) => item.citations))],
  };
}

function responseCitations(result: ReadResult): OmnixCopilotCitation[] {
  return uniqueCitations([
    ...result.answerBlocks.flatMap((item) => item.citations),
    ...(result.alerts ?? []).flatMap((item) => item.citations),
    ...(result.suggestions ?? []).flatMap((item) => item.citations),
  ]);
}

export async function executeOmnixCopilot(
  request: OmnixCopilotRequest,
  dependencies: OmnixCopilotServiceDependencies,
): Promise<OmnixCopilotSuccessResponse> {
  const startedAt = (dependencies.monotonicNow ?? Date.now)();
  const telemetry = dependencies.telemetry ?? defaultOmnixCopilotTelemetrySink;
  let workspaceId = 'unresolved';
  let membershipId = 'unresolved';
  try {
    const context = await dependencies.getRepository();
    const scope = validateWorkspaceScope(context.workspaceScope);
    workspaceId = scope.workspaceId;
    membershipId = scope.membershipId;
    const timeZone = dependencies.timeZone ?? process.env.OMNIX_TIME_ZONE;
    const result = await dispatch(request, context, timeZone);
    const citations = responseCitations(result);
    const response = createOmnixCopilotSuccessResponse(request, {
      ...result,
      citations,
    });
    await emitOmnixCopilotTelemetry(telemetry, {
      correlationId: request.correlationId,
      workspaceId,
      membershipId,
      resolvedIntent: request.intent.kind,
      mode: request.dataMode,
      asOf: request.asOf,
      outcome: 'success',
      resultCount: response.answerBlocks.reduce((total, item) => total + item.items.length, 0),
      citationCount: response.citations.length,
      durationMs: (dependencies.monotonicNow ?? Date.now)() - startedAt,
    });
    return response;
  } catch (error) {
    await emitOmnixCopilotTelemetry(telemetry, {
      correlationId: request.correlationId,
      workspaceId,
      membershipId,
      resolvedIntent: request.intent.kind,
      mode: request.dataMode,
      asOf: request.asOf,
      outcome: 'failure',
      errorCategory: omnixCopilotTelemetryErrorCategory(error),
      resultCount: 0,
      citationCount: 0,
      durationMs: (dependencies.monotonicNow ?? Date.now)() - startedAt,
    });
    throw error;
  }
}

export function createOmnixCopilotExecutor(
  dependencies: OmnixCopilotServiceDependencies,
): OmnixCopilotExecutor {
  return (request) => executeOmnixCopilot(request, dependencies);
}
