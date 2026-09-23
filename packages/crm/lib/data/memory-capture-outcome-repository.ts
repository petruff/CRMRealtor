import { CaptureOutcomeError, type CaptureOutcomeProposal } from '../domain/capture-outcome.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import type { CaptureOutcomeRepository } from './capture-outcome-repository.ts';
import type { ContactRepository } from './repository.ts';
import type { OmnixProposalRepository } from './omnix-proposal-repository.ts';
import type { ActivityRepository } from './activity-repository.ts';

export function createMemoryCaptureOutcomeRepository(contacts: ContactRepository, proposals: OmnixProposalRepository, activities?: ActivityRepository): CaptureOutcomeRepository {
  const records = new Map<string, CaptureOutcomeProposal>();
  const keys = new Map<string, string>();
  const versions = new Map<string, CaptureOutcomeProposal>();
  const notes = new Map<string, Promise<{ id: string }>>();
  const events = new Map<string, Promise<unknown>>();
  return {
    async get(scopeInput, id) {
      const scope = validateWorkspaceScope(scopeInput); const value = records.get(id);
      return value?.workspaceId === scope.workspaceId ? structuredClone(value) : undefined;
    },
    async list(scopeInput, contactId) {
      const scope = validateWorkspaceScope(scopeInput);
      return [...records.values()].filter((value) => value.workspaceId === scope.workspaceId && (!contactId || value.contactId === contactId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map((value) => structuredClone(value));
    },
    async findByKey(scopeInput, key) {
      const scope = validateWorkspaceScope(scopeInput); const id = keys.get(`${scope.workspaceId}:${key}`);
      return id ? this.get(scope, id) : undefined;
    },
    async create(scopeInput, proposal, key) {
      const scope = validateWorkspaceScope(scopeInput);
      if (proposal.workspaceId !== scope.workspaceId || proposal.createdByMembershipId !== scope.membershipId) throw new CaptureOutcomeError('forbidden', 'Capture authority mismatch.');
      const prior = keys.get(`${scope.workspaceId}:${key}`);
      if (prior) {
        const existing = records.get(prior)!;
        if (existing.sourceHash !== proposal.sourceHash || existing.contactId !== proposal.contactId) throw new CaptureOutcomeError('conflict', 'Capture key already used.');
        return structuredClone(existing);
      }
      records.set(proposal.id, structuredClone(proposal)); keys.set(`${scope.workspaceId}:${key}`, proposal.id);
      versions.set(`${proposal.id}:1`, structuredClone(proposal)); return structuredClone(proposal);
    },
    async save(scopeInput, proposal, expectedRevision) {
      const scope = validateWorkspaceScope(scopeInput); const prior = records.get(proposal.id);
      if (!prior || prior.workspaceId !== scope.workspaceId || proposal.workspaceId !== scope.workspaceId) throw new CaptureOutcomeError('not-found', 'Capture was not found.');
      if (prior.revision !== expectedRevision || proposal.revision !== expectedRevision + 1 || proposal.version < prior.version || proposal.version > prior.version + 1) throw new CaptureOutcomeError('conflict', 'Capture changed. Reload the review.');
      if (proposal.version === prior.version && proposal.contentHash !== prior.contentHash) throw new CaptureOutcomeError('conflict', 'Immutable content requires a new version.');
      if (proposal.version > prior.version) versions.set(`${proposal.id}:${proposal.version}`, structuredClone(proposal));
      records.set(proposal.id, structuredClone(proposal)); return structuredClone(proposal);
    },
    async appendNote(scopeInput, input) {
      const scope = validateWorkspaceScope(scopeInput);
      const child = await proposals.get(scope, input.proposalId);
      const version = await proposals.getVersion(scope, input.proposalId, input.proposalVersion);
      if (!child || child.kind !== 'note-append' || !['executing', 'executed'].includes(child.state) || child.currentVersion !== input.proposalVersion || version?.payload.contactId !== input.contactId || version.payload.body !== input.body) throw new CaptureOutcomeError('forbidden', 'Approved note content is required.');
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      let pending = notes.get(key);
      if (!pending) {
        pending = contacts.addNote(input.contactId, input.body).then((note) => ({ id: note.id }));
        notes.set(key, pending);
        pending.catch(() => notes.delete(key));
      }
      const note = await pending;
      if (activities) {
        let event = events.get(key);
        if (!event) {
          event = activities.appendEvent(scope, { type: 'note-added', contactId: input.contactId, actorMembershipId: scope.membershipId, occurredAt: input.occurredAt, idempotencyKey: `note-added:${note.id}` });
          events.set(key, event);
          event.catch(() => events.delete(key));
        }
        await event;
      }
      return note;
    },
  };
}
