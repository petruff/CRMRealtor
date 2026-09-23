import 'server-only';
import { loadOmnixAlerts } from '@/lib/application/omnix-alert-loader';
import { buildInboxProjection, type InboxProjection } from '@/lib/application/inbox-projection';
import { getRepository } from '@/lib/data';
import { displayName } from '@/lib/domain/contact';

async function optional<T>(read: Promise<readonly T[]>): Promise<readonly T[] | undefined> {
  return read.catch(() => undefined);
}

export interface LoadedInbox {
  readonly projection: InboxProjection;
  readonly asOf: string;
  readonly timeZone: string;
}

/** Workspace-scoped, fail-soft read: an unavailable source is reported, never shown as zero. */
export async function loadInbox(): Promise<LoadedInbox> {
  const alerts = await loadOmnixAlerts();
  const context = await getRepository();
  const scope = context.workspaceScope;
  const now = new Date(alerts.asOf);
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
  const [contacts, replies, proposals, tasks] = await Promise.all([
    context.repository.list().catch(() => []),
    optional(context.operationalSignalRepository.listInbound(scope, { unacknowledgedOnly: true, limit: 200 })),
    optional(context.omnixProposalRepository.list(scope, { state: 'pending', limit: 200 })),
    optional(context.activityRepository.listTasks(scope, { status: 'open', dueTo: dayEnd, limit: 200 })),
  ]);
  const contactNames = Object.fromEntries(contacts.map((contact) => [contact.id, displayName(contact)]));
  return {
    projection: buildInboxProjection({
      replies, proposals, tasks, contactNames,
      alerts: alerts.availability === 'unavailable' ? undefined : alerts.alerts,
    }, now),
    asOf: alerts.asOf,
    timeZone: alerts.timeZone,
  };
}
