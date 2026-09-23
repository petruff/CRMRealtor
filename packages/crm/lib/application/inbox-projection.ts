import type { CrmTask } from '../domain/activity.ts';
import type { OmnixCopilotAlert } from '../domain/omnix-copilot.ts';
import type { OmnixActionProposal } from '../domain/omnix-operational-brain.ts';
import type { InboundResponseSignal } from '../domain/operational-signal.ts';
import type { ReadinessGap } from '../domain/florida-readiness.ts';

/**
 * Inbox = everything that is waiting on the realtor's decision, as opposed to
 * Today, which is who she should reach out to. Follow-up and celebration
 * alerts therefore stay on Today and are excluded here so nothing is counted
 * twice.
 */

export type InboxKind = 'reply' | 'approval' | 'task' | 'alert';

export interface InboxItem {
  readonly id: string;
  readonly kind: InboxKind;
  readonly title: string;
  readonly detail?: string;
  readonly href: string;
  /** ISO instant or date used for ordering and display. */
  readonly at?: string;
  readonly urgent: boolean;
  readonly contactId?: string;
}

export interface InboxSection {
  readonly kind: InboxKind;
  readonly label: string;
  readonly emptyLabel: string;
  readonly href: string;
  readonly total: number;
  readonly items: readonly InboxItem[];
  readonly available: boolean;
}

export interface InboxProjection {
  readonly total: number;
  readonly urgent: number;
  readonly sections: readonly InboxSection[];
}

export interface InboxSources {
  readonly replies?: readonly InboundResponseSignal[];
  readonly proposals?: readonly OmnixActionProposal[];
  readonly tasks?: readonly CrmTask[];
  readonly alerts?: readonly OmnixCopilotAlert[];
  /** Florida disclosures not yet on file for active deals. */
  readonly readiness?: readonly ReadinessGap[];
  readonly contactNames?: Readonly<Record<string, string>>;
}

// Follow-ups and celebrations live on Today; task alerts are already the Tasks section.
const TODAY_OWNED_ALERTS = new Set(['follow-up', 'celebration', 'task']);

/** Human copy for rules that are usually many small fixes of the same kind. */
const GROUP_COPY: Readonly<Record<string, { title: (count: number) => string; detail: string; href: string }>> = {
  'mailer-missing-address': {
    title: (count) => `${count} mailing ${count === 1 ? 'address is' : 'addresses are'} incomplete`,
    detail: 'Complete them before your next postcard mailer',
    href: '/mailers',
  },
  'pipeline-missing-next-touch': {
    title: (count) => `${count} active ${count === 1 ? 'deal has' : 'deals have'} no next follow-up`,
    detail: 'Set a next touch so nothing stalls',
    href: '/pipeline',
  },
};
const SECTION_LIMIT = 5;
const GROUP_THRESHOLD = 3;

function endOfDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);
}

function section(
  kind: InboxKind, label: string, emptyLabel: string, href: string,
  items: readonly InboxItem[] | undefined,
): InboxSection {
  return {
    kind, label, emptyLabel, href,
    total: items?.length ?? 0,
    items: (items ?? []).slice(0, SECTION_LIMIT),
    available: items !== undefined,
  };
}

export function buildInboxProjection(sources: InboxSources, now: Date): InboxProjection {
  const names = sources.contactNames ?? {};
  const replies = sources.replies
    ?.filter((reply) => !reply.acknowledgedAt)
    .map((reply): InboxItem => ({
      id: `reply:${reply.id}`,
      kind: 'reply',
      title: reply.contactName || names[reply.contactId] || 'A contact',
      detail: reply.summary ?? 'Sent you a reply',
      href: `/contacts/${encodeURIComponent(reply.contactId)}`,
      at: reply.receivedAt,
      urgent: reply.urgency === 'high' || reply.urgency === 'urgent',
      contactId: reply.contactId,
    }))
    .sort((left, right) => Number(right.urgent) - Number(left.urgent) || (right.at ?? '').localeCompare(left.at ?? ''));

  const approvals = sources.proposals
    ?.filter((proposal) => proposal.state === 'pending' && Date.parse(proposal.expiresAt) > now.getTime())
    .map((proposal): InboxItem => ({
      id: `approval:${proposal.id}`,
      kind: 'approval',
      title: proposal.title,
      detail: proposal.contactId && names[proposal.contactId] ? `For ${names[proposal.contactId]}` : proposal.rationale,
      href: '/approvals',
      at: proposal.dueAt ?? proposal.createdAt,
      urgent: proposal.priority === 'p0' || proposal.priority === 'p1',
      ...(proposal.contactId ? { contactId: proposal.contactId } : {}),
    }))
    .sort((left, right) => Number(right.urgent) - Number(left.urgent) || (left.at ?? '').localeCompare(right.at ?? ''));

  const dayEnd = endOfDay(now);
  const tasks = sources.tasks
    ?.filter((task) => task.status === 'open' && !task.archivedAt && Date.parse(task.dueAt) <= dayEnd)
    .map((task): InboxItem => ({
      id: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      detail: task.contactId && names[task.contactId] ? names[task.contactId] : task.description,
      href: '/activities',
      at: task.dueAt,
      urgent: Date.parse(task.dueAt) < now.getTime(),
      ...(task.contactId ? { contactId: task.contactId } : {}),
    }))
    .sort((left, right) => (left.at ?? '').localeCompare(right.at ?? ''));

  // Several alerts from the same rule (e.g. nine incomplete mailing addresses)
  // are one decision, not nine: collapse them into a single grouped row.
  const relevantAlerts = sources.alerts?.filter((alert) => !TODAY_OWNED_ALERTS.has(alert.category));
  const byRule = new Map<string, OmnixCopilotAlert[]>();
  for (const alert of relevantAlerts ?? []) byRule.set(alert.rule, [...(byRule.get(alert.rule) ?? []), alert]);
  const alerts = relevantAlerts === undefined ? undefined : Array.from(byRule.values())
    .flatMap((group): InboxItem[] => {
      const [first] = group;
      if (!first) return [];
      if (group.length >= GROUP_THRESHOLD) {
        const copy = GROUP_COPY[first.rule];
        return [{
          id: `alert-group:${first.rule}`,
          kind: 'alert',
          title: copy ? copy.title(group.length) : first.reason.replace(/[.\s]+$/u, ''),
          detail: copy ? copy.detail : `${group.length} records · review together`,
          href: copy?.href ?? '/alerts',
          urgent: group.some((alert) => alert.priority === 'urgent'),
        }];
      }
      return group.map((alert): InboxItem => ({
        id: `alert:${alert.id}`,
        kind: 'alert',
        title: names[alert.recordId] ? `${names[alert.recordId]} · ${alert.reason}` : alert.reason,
        href: alert.href,
        ...(alert.dueAt ? { at: alert.dueAt } : {}),
        urgent: alert.priority === 'urgent',
      }));
    })
    .sort((left, right) => Number(right.urgent) - Number(left.urgent));
  const readiness = (sources.readiness ?? []).map((gap): InboxItem => ({
    id: `readiness:${gap.transactionId}:${gap.key}`,
    kind: 'alert',
    title: `${gap.title} · ${gap.transactionTitle}`,
    detail: gap.detail,
    href: `/transactions#transaction-${gap.transactionId}`,
    urgent: gap.tone === 'urgent',
    contactId: gap.contactId,
  }));
  const dealAlerts = alerts === undefined && !readiness.length ? undefined
    : [...readiness, ...(alerts ?? [])].sort((left, right) => Number(right.urgent) - Number(left.urgent));

  const sections = [
    section('reply', 'Replies waiting', 'No one is waiting on a reply.', '/activities', replies),
    section('approval', 'Needs your approval', 'Nothing to approve.', '/approvals', approvals),
    section('task', 'Tasks due', 'No tasks due today.', '/activities', tasks),
    section('alert', 'Deal and mailer alerts', 'No deal or mailer alerts.', '/alerts', dealAlerts),
  ];
  const all = [replies, approvals, tasks, dealAlerts].flatMap((items) => items ?? []);
  return { total: all.length, urgent: all.filter((item) => item.urgent).length, sections };
}
