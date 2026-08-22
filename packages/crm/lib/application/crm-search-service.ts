import { displayName } from '../domain/contact.ts';
import {
  CRM_SEARCH_RESULT_MAX,
  CRM_SEARCH_SCHEMA_VERSION,
  parseCrmSearchQuery,
  rankSearchCandidate,
  type CrmSearchEntityType,
  type CrmSearchResponse,
  type CrmSearchResult,
} from '../domain/crm-search.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import type { RepositoryContext } from '../data/index.ts';

export type CrmSearchContext = Pick<RepositoryContext,
  'repository' | 'activityRepository' | 'incompleteRecordRepository' | 'smartListRepository'
  | 'mailerRepository' | 'workspaceRepository' | 'workspaceScope'>;

interface Candidate {
  entityType: CrmSearchEntityType;
  recordId: string;
  label: string;
  detail: string;
  href: string;
  fields: string[];
}

function result(query: string, candidate: Candidate): CrmSearchResult | undefined {
  const rank = rankSearchCandidate(query, candidate.label, candidate.fields, candidate.recordId);
  if (!rank) return undefined;
  return {
    entityType: candidate.entityType,
    recordId: candidate.recordId,
    label: candidate.label,
    detail: candidate.detail,
    href: candidate.href,
    rank,
  };
}

export async function searchCrm(
  context: CrmSearchContext,
  untrustedQuery: unknown,
  limit = 20,
): Promise<CrmSearchResponse> {
  const query = parseCrmSearchQuery(untrustedQuery);
  const scope = validateWorkspaceScope(context.workspaceScope);
  if (!Number.isInteger(limit) || limit < 1 || limit > CRM_SEARCH_RESULT_MAX) {
    throw new Error(`Search limit must be 1–${CRM_SEARCH_RESULT_MAX}.`);
  }
  const [contacts, tasks, incomplete, smartLists, mailers, memberships] = await Promise.all([
    context.repository.list(),
    context.activityRepository.listTasks(scope, { query, status: 'all', limit: 200 }),
    context.incompleteRecordRepository.list(scope, { status: 'all', query, limit: 200 }),
    context.smartListRepository.list(scope, 'all'),
    context.mailerRepository.list(),
    context.workspaceRepository.listMemberships(scope),
  ]);
  const candidates: Candidate[] = [
    ...contacts.map((contact): Candidate => ({
      entityType: 'contact', recordId: contact.id, label: displayName(contact),
      detail: `${contact.pipelineStage} · ${contact.leadType}`,
      href: `/contacts/${encodeURIComponent(contact.id)}`,
      fields: [contact.email ?? '', contact.phone ?? '', contact.secondaryPhone ?? '', contact.city ?? '', ...contact.tags],
    })),
    ...tasks.map((task): Candidate => ({
      entityType: 'task', recordId: task.id, label: task.title,
      detail: `${task.status} · due ${task.dueAt}`, href: `/activities?task=${encodeURIComponent(task.id)}`,
      fields: [task.description ?? '', task.contactId ?? '', task.assigneeMembershipId],
    })),
    ...incomplete.map((record): Candidate => ({
      entityType: 'incomplete-record', recordId: record.id,
      label: [record.candidate.firstName, record.candidate.lastName].filter(Boolean).join(' ') || 'Incomplete contact',
      detail: `${record.status} · ${record.source}`, href: `/contacts/incomplete?q=${encodeURIComponent(record.id)}&status=all`,
      fields: [record.source, record.externalId ?? '', record.candidate.email ?? '', record.candidate.phone ?? '', ...record.reasons.map((reason) => reason.message)],
    })),
    ...smartLists.map((list): Candidate => ({
      entityType: 'smart-list', recordId: list.id, label: list.name,
      detail: `${list.status} Smart List`, href: `/contacts?smartList=${encodeURIComponent(list.id)}`,
      fields: [list.status, JSON.stringify(list.definition)],
    })),
    ...mailers.map((mailer): Candidate => ({
      entityType: 'mailer', recordId: mailer.id, label: mailer.name,
      detail: `${mailer.sends.length} sent`, href: `/mailers?mailer=${encodeURIComponent(mailer.id)}`,
      fields: [mailer.notes ?? ''],
    })),
    ...memberships.map((membership): Candidate => ({
      entityType: 'workspace-member', recordId: membership.id,
      label: membership.role === 'owner' ? 'Workspace owner' : 'Workspace assistant',
      detail: `${membership.role} · ${membership.status}`, href: '/workspace',
      fields: [membership.userId, membership.role, membership.status],
    })),
  ];
  const results = candidates.map((candidate) => result(query, candidate)).filter((item): item is CrmSearchResult => Boolean(item))
    .sort((left, right) => right.rank - left.rank || left.entityType.localeCompare(right.entityType)
      || left.label.localeCompare(right.label) || left.recordId.localeCompare(right.recordId))
    .slice(0, limit);
  return { schemaVersion: CRM_SEARCH_SCHEMA_VERSION, query, count: results.length, results };
}
