import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { ActivityEvent, CrmTask } from '@/lib/domain/activity';
import type { Contact } from '@/lib/domain/contact';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { listActivityEventsCommand, listTasksCommand } from './activity-commands';

export interface PipelineNextStep {
  readonly kind: 'task' | 'contact-next-touch';
  readonly date: string;
  readonly label: string;
  readonly source: string;
  readonly href: string;
}

export interface PipelineActivityEvidence {
  readonly type: ActivityEvent['type'];
  readonly occurredAt: string;
  readonly source: 'CRM activity history';
  readonly href: string;
}

export interface PipelineContactEvidence {
  readonly nextStep?: PipelineNextStep;
  readonly latestActivity?: PipelineActivityEvidence;
}

export interface PipelineEvidenceResult {
  readonly availability: 'available' | 'unavailable';
  readonly byContactId: Readonly<Record<string, PipelineContactEvidence>>;
}

function earliestOpenTask(tasks: readonly CrmTask[]): CrmTask | undefined {
  return [...tasks]
    .filter((task) => task.status === 'open')
    .sort((left, right) => (
      left.dueAt.localeCompare(right.dueAt)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))[0];
}

function latestEvent(events: readonly ActivityEvent[]): ActivityEvent | undefined {
  return [...events].sort((left, right) => (
    right.occurredAt.localeCompare(left.occurredAt)
    || left.id.localeCompare(right.id)
  ))[0];
}

/**
 * Build a presentation projection only from already-authorized repository rows.
 * Tasks are the strongest explicit next-step authority; the contact next-touch
 * date remains the fallback accepted by the cadence domain.
 */
export function buildPipelineEvidence(
  contacts: readonly Contact[],
  tasks: readonly CrmTask[],
  events: readonly ActivityEvent[],
): PipelineEvidenceResult {
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const byContactId: Record<string, PipelineContactEvidence> = {};

  for (const contact of contacts) {
    const task = earliestOpenTask(tasks.filter((item) => item.contactId === contact.id));
    const activity = latestEvent(events.filter((item) => item.contactId === contact.id));
    const nextStep: PipelineNextStep | undefined = task
      ? {
          kind: 'task',
          date: task.dueAt,
          label: task.title,
          source: 'Open CRM task',
          href: `/activities?contactId=${encodeURIComponent(contact.id)}`,
        }
      : contact.nextTouchAt
        ? {
            kind: 'contact-next-touch',
            date: contact.nextTouchAt,
            label: 'Follow up',
            source: 'Contact next-touch date',
            href: `/contacts/${encodeURIComponent(contact.id)}`,
          }
        : undefined;

    byContactId[contact.id] = {
      ...(nextStep ? { nextStep } : {}),
      ...(activity ? {
        latestActivity: {
          type: activity.type,
          occurredAt: activity.occurredAt,
          source: 'CRM activity history',
          href: `/contacts/${encodeURIComponent(contact.id)}`,
        },
      } : {}),
    };
  }

  // Defense in depth: ignore any row that did not correspond to the authorized
  // contact set supplied by the scoped contact repository.
  for (const id of Object.keys(byContactId)) {
    if (!contactIds.has(id)) delete byContactId[id];
  }

  return { availability: 'available', byContactId };
}

export async function loadPipelineEvidence(
  repository: ActivityRepository,
  scope: WorkspaceScope,
  contacts: readonly Contact[],
): Promise<PipelineEvidenceResult> {
  try {
    const [tasks, events] = await Promise.all([
      listTasksCommand(repository, scope, { status: 'open', limit: 500 }),
      listActivityEventsCommand(repository, scope, { limit: 500 }),
    ]);
    return buildPipelineEvidence(contacts, tasks, events);
  } catch {
    return { availability: 'unavailable', byContactId: {} };
  }
}
