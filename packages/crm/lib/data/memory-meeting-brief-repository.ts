import type { ContactRepository } from './repository.ts';
import type { ActivityRepository } from './activity-repository.ts';
import type { TransactionRepository } from './transaction-repository.ts';
import type { NurturePlanRepository } from './nurture-plan-repository.ts';
import type { PropertyBehaviorRepository } from './property-behavior-repository.ts';
import { MEETING_BRIEF_SOURCE_LIMIT, MeetingBriefError, type MeetingBriefSnapshot } from '../domain/meeting-brief.ts';
import { validateWorkspaceScope, SAMPLE_WORKSPACE_ID, SAMPLE_WORKSPACE_SCOPE, SAMPLE_ASSISTANT_SCOPE, type WorkspaceScope } from '../domain/workspace.ts';
import type { MeetingBriefRepository, MeetingBriefSourceRecord } from './meeting-brief-repository.ts';

export function createMemoryMeetingBriefRepository(deps: { contacts: ContactRepository; activities?: ActivityRepository; transactions?: TransactionRepository; nurturePlans?: NurturePlanRepository; propertyBehavior?: PropertyBehaviorRepository }): MeetingBriefRepository {
  const snapshots = new Map<string, MeetingBriefSnapshot>();
  function sample(input: WorkspaceScope) {
    const scope = validateWorkspaceScope(input);
    const member=[SAMPLE_WORKSPACE_SCOPE,SAMPLE_ASSISTANT_SCOPE].find(m=>m.membershipId===scope.membershipId && m.authenticatedUserId===scope.authenticatedUserId && m.role===scope.role && m.ownerUserId===scope.ownerUserId);
    if (scope.mode !== 'sample' || scope.workspaceId !== SAMPLE_WORKSPACE_ID || !member) throw new MeetingBriefError('not-found', 'Brief is unavailable.');
    return scope;
  }
  return {
    async loadSources(input, contactId, transactionId) {
      const scope = sample(input); const records: MeetingBriefSourceRecord[] = [];
      const unavailable = ['provider messages', 'appointments', 'household']; const bounded: string[] = [];
      async function read(name: string, fn: () => Promise<MeetingBriefSourceRecord[]>) {
        try { const rows = await fn(); if (rows.length >= MEETING_BRIEF_SOURCE_LIMIT) bounded.push(name); records.push(...rows.slice(0, MEETING_BRIEF_SOURCE_LIMIT)); } catch { unavailable.push(name); }
      }
      await read('notes', async () => (await deps.contacts.notesFor(contactId)).filter((n) => !n.archivedAt && n.contactId === contactId).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((n) => ({ id:n.id, sourceType:'note', contactId, workspaceId:scope.workspaceId, time:n.createdAt, label:'Recorded note', text:`Recorded note: ${n.body}` })));
      if (deps.activities) {
        await read('tasks', async () => (await deps.activities!.listTasks(scope, {contactId, status:'open', limit:MEETING_BRIEF_SOURCE_LIMIT})).map((t) => ({id:t.id, sourceType:'task', contactId:t.contactId ?? '', workspaceId:t.workspaceId, time:t.updatedAt, label:'Open CRM task', text:`${t.title} · due ${t.dueAt}`, dueAt:t.dueAt, status:t.status})));
        await read('activities', async () => (await deps.activities!.listEvents(scope, {contactId, limit:MEETING_BRIEF_SOURCE_LIMIT})).map((e) => ({id:e.id, sourceType:'activity', contactId:e.contactId ?? '', workspaceId:e.workspaceId, time:e.occurredAt, label:'Recorded activity', text:`Recorded activity: ${e.type.replaceAll('-', ' ')}`})));
      } else unavailable.push('tasks', 'activities');
      if (deps.transactions) await read('transactions', async () => (await deps.transactions!.list(scope)).filter((t) => t.contactId === contactId && (!transactionId || t.id === transactionId)).map((t) => ({id:t.id, sourceType:'transaction', contactId:t.contactId, workspaceId:t.workspaceId, time:t.updatedAt, label:'Transaction status and next step', text:`${t.title} · ${t.status}${t.expectedCloseDate ? ` · expected close ${t.expectedCloseDate}` : ''}${t.nextAction ? ` · next step: ${t.nextAction}` : ''}`})));
      else unavailable.push('transactions');
      if (deps.nurturePlans) await read('nurture', async () => (await deps.nurturePlans!.list(scope, {contactId,limit:MEETING_BRIEF_SOURCE_LIMIT})).map((p) => ({id:p.id, sourceType:'nurture', contactId:p.contactId, workspaceId:p.workspaceId, time:p.updatedAt, label:'Nurture plan', text:`Nurture: ${p.state} · cadence ${p.cadenceDays} days${p.nextStepAt ? ` · next step ${p.nextStepAt}` : ''}`})));
      else unavailable.push('nurture');
      if(deps.propertyBehavior) await read('property behavior',async()=> (await deps.propertyBehavior!.listBehaviors(scope,{contactId})).filter(e=>e.permissionState==='allowed' && e.workspaceId===scope.workspaceId && e.contactId===contactId).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).map(e=>({id:e.id,sourceType:'property-behavior',workspaceId:e.workspaceId,contactId:e.contactId,time:e.occurredAt,label:'Recorded property behavior',text:`Recorded property behavior: ${e.type.replaceAll('-',' ')} · source: ${e.source}. This is an observed event, not a conclusion about buying intent.`})));
      else unavailable.push('property behavior');
      return {records, unavailable, bounded};
    },
    async create(input, snapshot) {
      const scope = sample(input);
      if (snapshot.workspaceId !== scope.workspaceId || snapshot.createdByMembershipId !== scope.membershipId) throw new MeetingBriefError('not-found', 'Brief is unavailable.');
      const prior=snapshot.priorSnapshotId?snapshots.get(snapshot.priorSnapshotId):undefined;
      if(snapshot.priorSnapshotId ? !prior || prior.workspaceId!==scope.workspaceId || prior.subjectContactId!==snapshot.subjectContactId || prior.optionalTransactionId!==snapshot.optionalTransactionId || snapshot.version!==prior.version+1 : snapshot.version!==1) throw new MeetingBriefError('conflict','Brief version is invalid.');
      if (snapshots.has(snapshot.id) || (snapshot.priorSnapshotId && [...snapshots.values()].some((s) => s.priorSnapshotId === snapshot.priorSnapshotId))) throw new MeetingBriefError('conflict', 'This brief was already refreshed. Reopen the contact for a current brief.');
      snapshots.set(snapshot.id, structuredClone(snapshot));
    },
    async get(input, id) { const scope = sample(input); const snapshot = snapshots.get(id); return snapshot?.workspaceId === scope.workspaceId ? structuredClone(snapshot) : undefined; },
  };
}
