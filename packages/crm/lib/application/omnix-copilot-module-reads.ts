import type { ContactRepository } from '../data/repository.ts';
import type { ContactIdentityMap } from '../data/contact-identity-map.ts';
import type { ActivityRepository } from '../data/activity-repository.ts';
import type { TransactionRepository } from '../data/transaction-repository.ts';
import type { PropertyRepository } from '../data/property-repository.ts';
import type { NurturePlanRepository } from '../data/nurture-plan-repository.ts';
import type { OmnixProposalRepository } from '../data/omnix-proposal-repository.ts';
import type { CaptureOutcomeRepository } from '../data/capture-outcome-repository.ts';
import { displayName, type Contact } from '../domain/contact.ts';
import { propertyFactCanDisplay } from '../domain/property.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createOmnixCopilotCitation, type OmnixCopilotAnswerBlock, type OmnixCopilotAnswerItem, type OmnixCopilotCitation, type OmnixCopilotEntityType, type OmnixCopilotIntent, type OmnixCopilotSuggestion, type OmnixCopilotWarning } from '../domain/omnix-copilot.ts';
import { queryContacts } from './contact-query.ts';

export const OMNIX_MODULE_READ_LIMIT = 20;
export interface OmnixModuleRepositories {
  readonly repository: ContactRepository;
  readonly contactIdentityMap?: ContactIdentityMap;
  readonly activityRepository?: ActivityRepository;
  readonly transactionRepository?: TransactionRepository;
  readonly propertyRepository?: PropertyRepository;
  readonly nurturePlanRepository?: NurturePlanRepository;
  readonly omnixProposalRepository?: OmnixProposalRepository;
  readonly captureOutcomeRepository?: CaptureOutcomeRepository;
}
export interface OmnixModuleReadResult {
  readonly answerBlocks: readonly OmnixCopilotAnswerBlock[];
  readonly warnings: readonly OmnixCopilotWarning[];
  readonly suggestions: readonly OmnixCopilotSuggestion[];
}
export const OMNIX_MODULE_INTENTS = ['workspace-overview', 'organization', 'client-status', 'transactions', 'properties', 'nurture', 'finances', 'proposals'] as const;
type Module = 'contacts' | 'tasks' | 'transactions' | 'properties' | 'nurture' | 'finances' | 'proposals' | 'capture';
const titles: Record<Module, string> = { contacts: 'Clients', tasks: 'Tasks', transactions: 'Transactions', properties: 'Properties', nurture: 'Follow-up plans', finances: 'Recorded finances', proposals: 'Action reviews', capture: 'Saved outcome reviews' };
const route = (kind: Module) => ({ contacts: '/contacts', tasks: '/activities', transactions: '/transactions', properties: '/properties', nurture: '/contacts', finances: '/transactions', proposals: '/approvals', capture: '/contacts' })[kind];
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 240);
function block(id: string, title: string, detail: string, items: readonly OmnixCopilotAnswerItem[], unavailable = false): OmnixCopilotAnswerBlock {
  return { id, title, detail, kind: unavailable ? 'capability' : items.length ? 'list' : 'empty', items, citations: [...new Map(items.flatMap((item) => item.citations).map((item) => [item.id, item])).values()] };
}
function cite(type: OmnixCopilotEntityType, id: string, fields: readonly string[], asOf: string, href: string, updatedAt?: string): OmnixCopilotCitation {
  return createOmnixCopilotCitation({ entityType: type, recordId: id, factKeys: fields, responseAsOf: asOf, target: href, ...(updatedAt && Number.isFinite(Date.parse(updatedAt)) ? { sourceTimestamp: updatedAt } : {}) });
}
const scoped = <T extends { workspaceId: string }>(items: readonly T[], scope: WorkspaceScope) => items.filter((item) => item.workspaceId === scope.workspaceId);
const money = (cents: number | undefined) => Number.isSafeInteger(cents) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents! / 100) : 'not recorded';

/** Only canonical contact reads resolve identities. Ambiguous matches never fan out into private area reads. */
async function resolveContact(repository: ContactRepository, query: string) {
  const direct = /^[a-z0-9_-]{1,128}$/iu.test(query) ? await repository.get(query) : undefined;
  if (direct && !direct.archivedAt) return { contacts: [direct], partial: false };
  if (repository.listPage) {
    const page = await repository.listPage({ query, scope: 'all', offset: 0, limit: 6 });
    return { contacts: page.items.filter((item) => !item.archivedAt), partial: page.total > page.items.length };
  }
  const stored = await repository.list();
  const matches = queryContacts(stored.filter((item) => !item.archivedAt).slice(0, 500), { query, scope: 'all' });
  return { contacts: matches.slice(0, 6), partial: stored.length > 500 || matches.length > 6 };
}

export async function readOmnixModules(context: OmnixModuleRepositories, scope: WorkspaceScope, intent: OmnixCopilotIntent, asOf: string): Promise<OmnixModuleReadResult> {
  const answerBlocks: OmnixCopilotAnswerBlock[] = [], warnings: OmnixCopilotWarning[] = [], suggestions: OmnixCopilotSuggestion[] = [];
  let contact: Contact | undefined;
  if ('query' in intent && intent.query) {
    const resolution = await resolveContact(context.repository, intent.query);
    if (resolution.contacts.length !== 1 || resolution.partial) {
      const items = resolution.contacts.map((item) => ({ id: item.id, label: displayName(item), href: `/contacts/${encodeURIComponent(item.id)}`, citations: [cite('contact', item.id, ['firstName', 'lastName'], asOf, `/contacts/${encodeURIComponent(item.id)}`, item.updatedAt ?? item.createdAt)] }));
      return { answerBlocks: [block('client-resolution', 'Choose a client', items.length ? 'More than one possible match or a partial search. Use an exact client name or select the contact.' : 'No authorized active client matched. No related area records were read.', items)], warnings: resolution.partial ? [{ code: 'contact-search-partial', message: 'Client resolution is bounded; select an exact record.' }] : [], suggestions: [] };
    }
    contact = resolution.contacts[0];
  }
  let contactIds = contact ? [contact.id] : [];
  if (contact && context.contactIdentityMap) {
    try {
      const group = await context.contactIdentityMap.listGroupMembers(scope, contact.id);
      if (group.canonicalContactId !== contact.id || group.requestedContactId !== contact.id || !group.memberContactIds.includes(contact.id)) throw new Error('Invalid contact group');
      contactIds = [...new Set([contact.id, ...group.memberContactIds])].slice(0, 20);
      const resolved = await context.contactIdentityMap.resolvePage(scope, contactIds);
      if (contactIds.some((id) => resolved.get(id) !== contact.id)) throw new Error('Unverified contact group');
      if (group.memberContactIds.length > 20) warnings.push({ code: 'contact-group-truncated', message: 'This client has more than 20 linked contact records. Some historical items may be omitted.' });
    } catch {
      return { answerBlocks: [block('client-resolution', 'Client records unavailable', 'Linked client records could not be verified. Try again or open the client.', [], true)], warnings: [{ code: 'contact-group-unavailable', message: 'Historical client links could not be verified.' }], suggestions: [] };
    }
  }
  const matchesContact = (id: string | undefined) => !contact || (id !== undefined && contactIds.includes(id));
  const aggregate = ['workspace-overview', 'organization', 'client-status'].includes(intent.kind);
  const limit = aggregate ? 3 : OMNIX_MODULE_READ_LIMIT;
  const modules: Module[] = intent.kind === 'client-status' ? ['contacts', 'tasks', 'transactions', 'nurture', 'proposals', 'capture']
    : aggregate ? ['contacts', 'tasks', 'transactions', 'properties', 'nurture', 'proposals']
      : [intent.kind as Module];
  const read = async (area: Module, available: boolean, fn: () => Promise<readonly OmnixCopilotAnswerItem[]>, detail: string) => {
    if (!available) {
      warnings.push({ code: `${area}-unavailable`, message: `${titles[area]} are unavailable. Try again or open the records.` });
      answerBlocks.push(block(`module-${area}`, titles[area], 'Unavailable. Try again or open the records.', [], true)); return;
    }
    try {
      const items = [...new Map((await fn()).map((item) => [item.id, item])).values()];
      if (items.length > limit) warnings.push({ code: `${area}-truncated`, message: `${titles[area]}: showing up to ${limit} records; more may exist.` });
      answerBlocks.push(block(`module-${area}`, titles[area], `${items.length ? detail : `No ${titles[area].toLowerCase()} found in this read. ${detail}`} Read as of ${asOf}.`, items.slice(0, limit)));
      suggestions.push({ id: `review-module-${area}`, kind: 'review-link', title: `Review ${titles[area].toLowerCase()}`, detail: 'Open the saved records to review or make changes.', href: contact && ['contacts', 'nurture', 'capture'].includes(area) ? `/contacts/${encodeURIComponent(contact.id)}` : route(area), readOnly: true, citations: [] });
    } catch {
      warnings.push({ code: `${area}-unavailable`, message: `${titles[area]} could not be loaded. Try again or open the records.` });
      answerBlocks.push(block(`module-${area}`, titles[area], 'Unavailable. Try again or open the records.', [], true));
    }
  };
  for (const area of modules) {
    if (area === 'contacts') await read(area, true, async () => {
      const contacts: Contact[] = contact ? [contact] : [];
      let total: number | undefined;
      if (!contact && context.repository.listPage) {
        for (let offset = 0; offset < 500; offset += 100) {
          const page = await context.repository.listPage({ scope: 'all', offset, limit: 100 });
          contacts.push(...page.items); total = page.total;
          if (!page.items.length || contacts.length >= page.total) break;
        }
      } else if (!contact) contacts.push(...(await context.repository.list()).slice(0, 500));
      if (!contact && (total === undefined || total > contacts.length)) warnings.push({ code: 'contacts-bounded', message: 'Priorities cover up to 500 active clients; more may exist.' });
      const selected = contact ? contacts : contacts.filter((item) => !item.archivedAt && (!item.nextTouchAt || ['new', 'contacted'].includes(item.pipelineStage)));
      return selected.map((item) => { const href = `/contacts/${encodeURIComponent(item.id)}`; return { id: item.id, label: displayName(item), detail: `Relationship stage: ${item.pipelineStage}; qualification: ${item.qualificationStatus ?? 'not recorded'}; next touch: ${item.nextTouchAt ?? 'not recorded'}.`, href, citations: [cite('contact', item.id, ['firstName', 'preferredName', 'lastName', 'pipelineStage', 'qualificationStatus', 'nextTouchAt'], asOf, href, item.updatedAt ?? item.createdAt)] }; });
    }, contact ? 'Stored relationship, qualification and follow-up facts; these are separate from transaction status.' : 'Contacts needing a recorded next touch or early relationship review, in contact list order.');
    if (area === 'tasks') await read(area, Boolean(context.activityRepository), async () => {
      const tasks = scoped(await context.activityRepository!.listTasks(scope, { ...(contact ? { contactId: contact.id } : {}), status: 'open', limit: limit + 1 }), scope).filter((item) => matchesContact(item.contactId));
      return tasks.map((item) => { const href = `/activities?taskId=${encodeURIComponent(item.id)}`; return { id: item.id, label: clean(item.title), detail: `Open; recorded due ${item.dueAt}${Date.parse(item.dueAt) < Date.parse(asOf) ? '; overdue as of this read' : ''}.`, href, citations: [cite('task', item.id, ['title', 'status', 'dueAt'], asOf, href, item.updatedAt)] }; });
    }, 'Open tasks with recorded due times; no deadline is invented.');
    if (area === 'transactions' || area === 'finances') await read(area, Boolean(context.transactionRepository), async () => {
      const repo = context.transactionRepository!;
      const rows = scoped(await repo.list(scope), scope);
      // The existing transaction seam has no total/pagination contract. Never call this a workspace total.
      warnings.push({ code: `${area}-coverage`, message: 'Transactions shown are a recent selection; more may exist. Financial figures belong to individual records.' });
      const parties = contact ? scoped(await repo.listParties(scope, rows.map((row) => row.id)), scope).filter((row) => !row.archivedAt && matchesContact(row.contactId)) : [];
      const selected = rows.filter((row) => matchesContact(row.contactId) || parties.some((party) => party.transactionId === row.id)).slice(0, limit + 1);
      if (!selected.length) return [];
      if (area === 'finances') {
        const financials = scoped(await repo.listFinancials(scope, selected.map((row) => row.id)), scope);
        return selected.map((row) => { const fact = financials.find((item) => item.transactionId === row.id), href = `/transactions#transaction-${encodeURIComponent(row.id)}`; return { id: row.id, label: clean(row.title), detail: fact ? `Recorded gross commission ${money(fact.grossCommissionCents)}; recorded net commission ${money(fact.netCommissionCents)}; ${fact.verificationState}; source ${fact.sourceType}; effective ${fact.effectiveDate}. These amounts are not proof of received payment.` : 'Financial authority is missing; legacy transaction figures are not substituted.', href, citations: [fact ? cite('transaction-finance', fact.id, ['grossCommissionCents', 'netCommissionCents', 'verificationState', 'sourceType', 'effectiveDate'], asOf, href, fact.updatedAt) : cite('transaction', row.id, ['status'], asOf, href, row.updatedAt)] }; });
      }
      const plans = scoped(await repo.listWorkflowPlans(scope, selected.map((row) => row.id)), scope).filter((plan) => selected.some((row) => row.id === plan.transactionId));
      const steps = plans.length ? scoped(await repo.listWorkflowSteps(scope, plans.map((row) => row.id)), scope) : [];
      return selected.map((row) => { const href = `/transactions#transaction-${encodeURIComponent(row.id)}`, planIds = new Set(plans.filter((plan) => plan.transactionId === row.id).map((plan) => plan.id)); const work = steps.filter((step) => planIds.has(step.planId)).slice(0, 3); return { id: row.id, label: clean(row.title), detail: `Transaction: ${row.status}; expected close: ${row.expectedCloseDate ?? 'not recorded'}; next action: ${row.nextAction ? clean(row.nextAction) : 'not recorded'}${row.nextActionDueAt ? ` (${row.nextActionDueAt})` : ''}.${work.length ? ` Workflow: ${work.map((step) => `${clean(step.title)}: ${step.state}`).join('; ')}.` : ' No workflow steps in this read.'}`, href, citations: [cite('transaction', row.id, ['title', 'status', 'expectedCloseDate', 'nextAction', 'nextActionDueAt'], asOf, href, row.updatedAt), ...work.map((step) => cite('workflow-step', step.id, ['title', 'state'], asOf, href, step.updatedAt))] }; });
    }, area === 'transactions' ? 'Saved transactions and linked workflow steps. Expected dates are recorded plans, not verified outcomes.' : 'Recorded financial authority only; missing, unverified and contradictory records remain labeled.');
    if (area === 'properties') await read(area, Boolean(context.propertyRepository), async () => {
      const repo = context.propertyRepository!;
      const rows = scoped(await repo.list(scope, { limit: contact ? 500 : limit + 1 }), scope);
      const interests = contact ? scoped((await Promise.all(contactIds.map((contactId) => repo.listInterests(scope, { contactId })))).flat(), scope).filter((item) => matchesContact(item.contactId) && !item.archivedAt) : [];
      if (contact) warnings.push({ code: 'properties-coverage', message: 'Client interests are matched against up to 500 properties; more may exist.' });
      const selected = rows.filter((row) => !contact || interests.some((item) => item.propertyId === row.id)).slice(0, limit + 1);
      const facts = selected.length ? scoped(await repo.listFacts(scope, selected.map((row) => row.id)), scope) : [];
      let suppressed = false;
      const items = selected.map((row) => { const href = `/properties#property-${encodeURIComponent(row.id)}`; const visible = facts.filter((fact) => {
        if (fact.propertyId !== row.id) return false;
        const allowed = propertyFactCanDisplay(fact, new Date(asOf)) && Number.isFinite(Date.parse(fact.asOf)) && Date.parse(fact.asOf) <= Date.parse(asOf)
          && (!fact.retentionUntil || Date.parse(fact.retentionUntil) >= Date.parse(asOf))
          && (fact.authority !== 'licensed-provider' || Boolean(fact.provider && fact.providerRecordId && fact.displayUntil && fact.retentionUntil));
        if (!allowed) suppressed = true; return allowed;
      }).slice(0, 4); return { id: row.id, label: clean(`${row.addressLine1}, ${row.city}`), detail: `Stored ${row.kind}; lifecycle ${row.lifecycle}.${visible.length ? ` ${visible.map((fact) => `${fact.field}: ${clean(String(fact.value))} (${fact.authority}, as of ${fact.asOf})`).join('; ')}` : ' No displayable property facts.'}`, href, citations: [cite('property', row.id, ['addressLine1', 'city', 'kind', 'lifecycle'], asOf, href, row.updatedAt), ...visible.map((fact) => cite('property-fact', fact.id, ['field', 'value', 'authority', 'asOf', 'permissionState'], asOf, href, fact.asOf))] }; });
      if (suppressed) warnings.push({ code: 'property-facts-unavailable', message: 'Restricted, expired, future-dated or insufficiently licensed facts were withheld.' });
      return items;
    }, 'Saved properties and facts available to view. No current market value is inferred.');
    if (area === 'nurture') await read(area, Boolean(context.nurturePlanRepository), async () => scoped((await Promise.all((contact ? contactIds : [undefined]).map((contactId) => context.nurturePlanRepository!.list(scope, { ...(contactId ? { contactId } : {}), limit: limit + 1 })))).flat(), scope).filter((row) => matchesContact(row.contactId)).map((row) => { const href = `/contacts/${encodeURIComponent(row.contactId)}`; return { id: row.id, label: `Nurture · ${row.state}`, detail: `Cadence ${row.cadenceDays} days; step ${row.currentStep}/${row.maximumSteps}; next step ${row.nextStepAt ?? 'not scheduled'}${row.snoozedUntil ? `; snoozed until ${row.snoozedUntil}` : ''}.`, href, citations: [cite('nurture-plan', row.id, ['state', 'cadenceDays', 'currentStep', 'maximumSteps', 'nextStepAt', 'snoozedUntil'], asOf, href, row.updatedAt)] }; }), 'Recorded plan status; delivery is shown separately.');
    if (area === 'proposals') await read(area, Boolean(context.omnixProposalRepository), async () => scoped((await Promise.all((contact ? contactIds : [undefined]).map((contactId) => context.omnixProposalRepository!.list(scope, { ...(contactId ? { contactId } : {}), state: 'all', limit: limit + 1 })))).flat(), scope).filter((row) => matchesContact(row.contactId)).map((row) => { const href = `/approvals?proposalId=${encodeURIComponent(row.id)}#proposal-${encodeURIComponent(row.id)}`; const providerPrepared = row.executionReference?.startsWith('connector-intent:'); return { id: row.id, label: clean(row.title), detail: `${providerPrepared ? 'Prepared; provider approval or dispatch remains separate' : row.state}; version ${row.currentVersion}; approval authority ${row.approvalMode}; expires ${row.expiresAt}.`, href, citations: [cite('proposal', row.id, ['title', 'state', 'currentVersion', 'approvalMode', 'expiresAt', 'executionReference'], asOf, href, row.updatedAt)] }; }), 'Saved action reviews and their current status.');
    if (area === 'capture') await read(area, Boolean(context.captureOutcomeRepository), async () => {
      warnings.push({ code: 'capture-coverage', message: 'Showing recent saved review statuses. Open a review to read its recap and actions.' });
      return scoped((await Promise.all((contact ? contactIds : [undefined]).map((contactId) => context.captureOutcomeRepository!.list(scope, contactId)))).flat(), scope).filter((row) => matchesContact(row.contactId)).slice(0, limit + 1).map((row) => { const historical = Boolean(contact && row.contactId !== contact.id); const href = historical ? `/contacts/${encodeURIComponent(contact!.id)}` : `/contacts/${encodeURIComponent(row.contactId)}/outcome?proposalId=${encodeURIComponent(row.id)}`; if (historical && !warnings.some((item) => item.code === 'capture-history-unavailable')) warnings.push({ code: 'capture-history-unavailable', message: 'Some saved reviews predate this client merge and cannot be reopened here.' }); return { id: row.id, label: `Saved recap review · ${row.status}`, detail: `Reviewed version ${row.version}; ${row.operations.filter((op) => op.selected).length} selected operations; created ${row.createdAt}.${historical ? ' Saved before this contact was merged. Reopening this historical review is not available here.' : ''}`, href, citations: [cite('capture', row.id, ['status', 'version', 'createdAt'], asOf, href, row.createdAt)] }; });
    }, 'Saved review state, including partial completion and awaiting-provider.');
  }
  return { answerBlocks, warnings, suggestions };
}
