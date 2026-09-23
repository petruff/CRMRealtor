import { createHash, randomUUID } from 'node:crypto';
import { CAPTURE_SCHEMA_VERSION, CAPTURE_SOURCE_MAX, CaptureOutcomeError, captureInstant, captureText, type CaptureOutcomeProposal, type CaptureOutcomeOperation, type CaptureOperationAfter, type CaptureOperationType } from '../domain/capture-outcome.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ContactRepository } from '../data/repository.ts';
import type { CaptureOutcomeRepository } from '../data/capture-outcome-repository.ts';
import { scanOmnixPromptContent } from './omnix-prompt-guard.ts';
import { createOmnixProposalCommand, decideOmnixProposalCommand, hashOmnixProposalPayload } from './omnix-proposal-commands.ts';
import { executeApprovedOmnixProposalCommand, type OmnixInternalExecutionDependencies } from './omnix-proposal-executor.ts';
import { captureTaskFlags, extractCaptureOutcome, type CaptureExtractionResult } from './capture-outcome-extraction.ts';
import { captureChildPayload, captureCommunicationBlocked, captureOperationIsCurrent, captureOperationOptions, prepareCaptureOperation, type CaptureOperationDependencies } from './capture-outcome-operations.ts';
import { handoffApprovedOmnixProviderProposalCommand, type OmnixProviderHandoffGateway } from './omnix-provider-proposal-handoff.ts';

export interface CaptureOutcomeDependencies extends OmnixInternalExecutionDependencies, CaptureOperationDependencies {
  readonly captures: CaptureOutcomeRepository;
  readonly contacts: ContactRepository;
  readonly extract?: (source: string, contactId: string) => Promise<CaptureExtractionResult>;
  readonly providerGateway?: OmnixProviderHandoffGateway;
}
export interface AnalyzeCaptureInput {
  readonly contactId: string;
  readonly sourceText: string;
  readonly idempotencyKey: string;
  readonly manualOnly?: boolean;
  readonly tasks?: readonly { readonly title: string; readonly dueAt: string }[];
}
export function hashCaptureContent(proposal: CaptureOutcomeProposal): string {
  return hashOmnixProposalPayload({ schemaVersion: proposal.schemaVersion, id: proposal.id, contactId: proposal.contactId, sourceHash: proposal.sourceHash, targetHash: proposal.targetHash, version: proposal.version,
    operations: proposal.operations.map(({ id, type, after, before, preconditions, requiredAuthority, consequence, evidence, confidence, flags, selected }) => ({ id, type, after, before, preconditions, requiredAuthority, consequence, evidence, confidence, flags, selected })) });
}
function safeText(value: unknown, max: number, name: string): string {
  const text = captureText(value, max, name);
  if (!scanOmnixPromptContent(text).safe) throw new CaptureOutcomeError('invalid-input', `${name} did not pass the input safety check.`);
  return text;
}
export function createCaptureOutcomeService(deps: CaptureOutcomeDependencies) {
  async function get(scopeInput: WorkspaceScope, id: string) {
    const scope = validateWorkspaceScope(scopeInput);
    const proposal = await deps.captures.get(scope, id);
    if (!proposal) throw new CaptureOutcomeError('not-found', 'Capture outcome was not found.');
    return proposal;
  }
  async function contactHash(scope: WorkspaceScope, contactId: string) {
    validateWorkspaceScope(scope);
    const contact = await deps.contacts.get(contactId);
    if (!contact || contact.archivedAt) throw new CaptureOutcomeError('not-found', 'An active contact is required.');
    return hashOmnixProposalPayload({ ...contact });
  }
  function exact(proposal: CaptureOutcomeProposal, version: number, now: Date, editable = false) {
    if (proposal.version !== version || hashCaptureContent(proposal) !== proposal.contentHash) throw new CaptureOutcomeError('conflict', 'The review changed. Reload the current version.');
    if (Date.parse(proposal.expiresAt) <= now.valueOf()) throw new CaptureOutcomeError('expired', 'This capture review has expired. Create a fresh review.');
    if (editable && (proposal.operations.some((operation) => operation.childProposalId) || !['pending', 'selected', 'deferred', 'stale'].includes(proposal.status))) {
      throw new CaptureOutcomeError('conflict', 'An approved or executed review cannot be edited.');
    }
  }
  async function version(scope: WorkspaceScope, prior: CaptureOutcomeProposal, operations: readonly CaptureOutcomeOperation[], now: Date) {
    const next: CaptureOutcomeProposal = { ...prior, version: prior.version + 1, revision: prior.revision + 1, targetHash: await contactHash(scope, prior.contactId), operations, status: operations.some((operation) => operation.selected) ? 'selected' : 'pending' };
    exact(prior, prior.version, now, true);
    return deps.captures.save(scope, { ...next, contentHash: hashCaptureContent(next) }, prior.revision);
  }
  async function analyze(scopeInput: WorkspaceScope, input: AnalyzeCaptureInput, now = new Date()): Promise<CaptureOutcomeProposal> {
    const scope = validateWorkspaceScope(scopeInput);
    if (Object.keys(input).some((key) => !['contactId', 'sourceText', 'idempotencyKey', 'manualOnly', 'tasks'].includes(key))) throw new CaptureOutcomeError('invalid-input', 'Unsupported capture fields.');
    const sourceText = safeText(input.sourceText, CAPTURE_SOURCE_MAX, 'Recap');
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(input.idempotencyKey)) throw new CaptureOutcomeError('invalid-input', 'Invalid capture idempotency key.');
    if (input.tasks && (!Array.isArray(input.tasks) || input.tasks.length > 8)) throw new CaptureOutcomeError('invalid-input', 'At most eight manual tasks are supported.');
    const targetHash = await contactHash(scope, input.contactId);
    const sourceHash = createHash('sha256').update(sourceText).digest('hex');
    const previous = await deps.captures.findByKey(scope, input.idempotencyKey);
    if (previous) {
      if (previous.sourceHash !== sourceHash || previous.contactId !== input.contactId) throw new CaptureOutcomeError('conflict', 'This key already identifies another recap.');
      return previous;
    }
    let extraction: CaptureExtractionResult = { state: 'unconfigured' };
    if (!input.manualOnly) {
      try { extraction = await (deps.extract ? deps.extract(sourceText, input.contactId) : extractCaptureOutcome(sourceText)); } catch { extraction = { state: 'failed' }; }
    }
    const operations: CaptureOutcomeOperation[] = [{ id: randomUUID(), type: 'note-append', after: { text: sourceText }, before: null, preconditions: {}, requiredAuthority: 'active-member', consequence: 'Append this recap as a contact note.', evidence: { quote: sourceText, start: 0, end: sourceText.length }, confidence: 'manual', flags: [], selected: true, state: 'pending' }];
    for (const task of extraction.outcome?.tasks ?? []) {
      const flags = captureTaskFlags(task);
      operations.push({ id: randomUUID(), type: 'task-create', after: { title: task.title, ...(task.dueAt ? { dueAt: captureInstant(task.dueAt) } : {}) }, before: null, preconditions: {}, requiredAuthority: 'active-member', evidence: task.evidence, confidence: task.confidence, flags, selected: false, state: 'pending' });
    }
    for (const task of input.tasks ?? []) {
      operations.push(await prepareCaptureOperation(deps, scope, input.contactId, { type: 'task-create', after: task }, now));
    }
    const proposal: CaptureOutcomeProposal = {
      schemaVersion: CAPTURE_SCHEMA_VERSION, id: randomUUID(), workspaceId: scope.workspaceId, contactId: input.contactId, createdByMembershipId: scope.membershipId,
      sourceText, sourceHash, targetHash, summary: extraction.outcome?.summary ?? 'Review your recap and optional tasks before saving.',
      facts: extraction.outcome?.facts ?? [], unknowns: extraction.outcome?.unknowns ?? [], extractionState: input.manualOnly ? 'manual' : extraction.state,
      version: 1, revision: 1, contentHash: '', status: 'pending', operations, createdAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 7 * 86400000).toISOString(), retentionState: 'workspace-record',
    };
    return deps.captures.create(scope, { ...proposal, contentHash: hashCaptureContent(proposal) }, input.idempotencyKey);
  }
  async function edit(scope: WorkspaceScope, id: string, expectedVersion: number, operationId: string, patch: CaptureOperationAfter, now = new Date()) {
    const prior = await get(scope, id); exact(prior, expectedVersion, now, true);
    const operation = prior.operations.find((item) => item.id === operationId);
    if (!operation) throw new CaptureOutcomeError('not-found', 'Review item was not found.');
    if (!patch || !Object.keys(patch).length) throw new CaptureOutcomeError('invalid-input', 'Supply an item edit.');
    const replacement = await prepareCaptureOperation(deps, scope, prior.contactId, { type: operation.type, after: { ...operation.after, ...patch } }, now, operation.id);
    return version(scope, prior, prior.operations.map((item) => item.id === operationId ? replacement : item), now);
  }
  async function addOperation(scope: WorkspaceScope, id: string, expectedVersion: number, input: { type: CaptureOperationType; after: CaptureOperationAfter }, now = new Date()) {
    const prior = await get(scope, id); exact(prior, expectedVersion, now, true);
    if (prior.operations.length >= 17) throw new CaptureOutcomeError('invalid-input', 'At most seventeen capture items are allowed.');
    if (['pipeline-move', 'nurture-plan', 'nurture-transition'].includes(input.type) && prior.operations.some((item) => item.type === input.type || (input.type.startsWith('nurture') && item.type.startsWith('nurture')))) throw new CaptureOutcomeError('invalid-input', 'Edit the existing lifecycle item instead of adding a conflicting change.');
    const operation = await prepareCaptureOperation(deps, scope, prior.contactId, input, now);
    return version(scope, prior, [...prior.operations, operation], now);
  }
  async function select(scope: WorkspaceScope, id: string, expectedVersion: number, ids: readonly string[], now = new Date()) {
    const prior = await get(scope, id); exact(prior, expectedVersion, now, true);
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !prior.operations.some((item) => item.id === id))) throw new CaptureOutcomeError('invalid-input', 'Invalid review selection.');
    if (prior.operations.some((item) => ids.includes(item.id) && (item.flags.length > 0 || (item.type === 'task-create' && !item.after.dueAt)))) throw new CaptureOutcomeError('invalid-input', 'Edit flagged tasks to confirm their ownership, wording and exact due date before selecting.');
    if (prior.operations.some((item) => ids.includes(item.id) && item.requiredAuthority === 'owner') && scope.role !== 'owner') throw new CaptureOutcomeError('forbidden', 'An owner must select provider preparation items.');
    if (prior.operations.some((item) => ids.includes(item.id) && item.type === 'google-email-draft') && captureCommunicationBlocked(prior.sourceText)) throw new CaptureOutcomeError('forbidden', 'This recap includes a communication opt-out. Review authoritative suppression before preparing outreach.');
    return version(scope, prior, prior.operations.map((item) => ({ ...item, selected: ids.includes(item.id) })), now);
  }
  async function confirm(scope: WorkspaceScope, id: string, expectedVersion: number, contentHash: string, now = new Date()) {
    let current = await get(scope, id);
    if (['completed', 'awaiting-provider'].includes(current.status) && current.version === expectedVersion && current.contentHash === contentHash && hashCaptureContent(current) === contentHash) return current;
    exact(current, expectedVersion, now);
    if (current.contentHash !== contentHash) throw new CaptureOutcomeError('conflict', 'Confirm the exact current review content.');
    if (current.status === 'completed') return current;
    if (['rejected', 'deferred', 'stale', 'expired'].includes(current.status)) throw new CaptureOutcomeError('conflict', 'This review cannot be confirmed in its current state.');
    if (current.status === 'executing' && Date.parse(current.executionLeaseUntil ?? '') > now.valueOf()) throw new CaptureOutcomeError('conflict', 'This review is executing. Reload its receipts shortly.');
    if (!current.operations.some((item) => item.selected)) throw new CaptureOutcomeError('invalid-input', 'Select at least one item.');
    if (current.operations.some((item) => item.selected && item.flags.length)) throw new CaptureOutcomeError('invalid-input', 'Resolve selected item flags.');
    if (current.operations.some((item) => item.selected && item.requiredAuthority === 'owner') && scope.role !== 'owner') throw new CaptureOutcomeError('forbidden', 'Only the owner can confirm provider preparation.');
    if (current.operations.some((item) => item.selected && item.type === 'google-email-draft') && captureCommunicationBlocked(current.sourceText)) throw new CaptureOutcomeError('forbidden', 'Communication opt-out requires authoritative review.');
    current = await deps.captures.save(scope, { ...current, status: 'executing', revision: current.revision + 1, executionLeaseUntil: new Date(now.valueOf() + 60000).toISOString() }, current.revision);
    for (const original of current.operations.filter((item) => item.selected && item.state !== 'completed' && item.state !== 'awaiting-provider')) {
      let operation = original;
      try {
        // An already executed canonical child wins over stale source checks during crash recovery.
        let child = operation.childProposalId ? await deps.proposals.get(scope, operation.childProposalId) : undefined;
        const currentTarget = child && child.state !== 'pending' ? true : operation.preconditions
          ? await captureOperationIsCurrent(deps, scope, current.contactId, operation, now)
          : await contactHash(scope, current.contactId) === current.targetHash;
        if (!currentTarget) {
          operation = { ...operation, state: 'stale', error: 'Contact changed. Create a fresh capture review.' };
        } else {
          if (!child) {
            const created = await createOmnixProposalCommand(deps.proposals, scope, {
              contactId: current.contactId, kind: operation.type, origin: 'deterministic', approvalMode: operation.requiredAuthority ?? 'active-member',
              factors: { urgency: 20, leadTemperature: 'unknown', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
              title: operation.after.title ?? operation.after.subject ?? `Capture: ${operation.type}`, rationale: operation.consequence ?? 'User-confirmed capture outcome item.',
              payload: captureChildPayload(current.contactId, operation),
              citations: [{ entityType: 'contact', recordId: current.contactId, factKeys: ['capture-outcome'], href: `/contacts/${encodeURIComponent(current.contactId)}` }],
              expiresAt: current.expiresAt, idempotencyKey: `capture:${current.id}:${current.version}:${operation.id}`,
            }, now);
            operation = { ...operation, childProposalId: created.proposalId, state: 'executing' };
            current = await deps.captures.save(scope, { ...current, revision: current.revision + 1, operations: current.operations.map((item) => item.id === operation.id ? operation : item) }, current.revision);
            child = await deps.proposals.get(scope, created.proposalId);
          }
          if (!child) throw new CaptureOutcomeError('unavailable', 'Canonical proposal is unavailable.');
          const childVersion = await deps.proposals.getVersion(scope, child.id, child.currentVersion);
          const expectedPayload = captureChildPayload(current.contactId, operation);
          if (child.currentVersion !== 1 || child.kind !== operation.type || child.contactId !== current.contactId || !childVersion
            || childVersion.contentHash !== hashOmnixProposalPayload(expectedPayload) || hashOmnixProposalPayload(childVersion.payload) !== childVersion.contentHash) {
            throw new CaptureOutcomeError('conflict', 'Canonical child does not match the exact confirmed capture item.');
          }
          if (child.state === 'pending') await decideOmnixProposalCommand(deps.proposals, scope, child.id, { decision: 'approve', expectedVersion: child.currentVersion, idempotencyKey: `capture-approve:${child.id}` }, now);
          const provider = operation.type === 'google-email-draft' || operation.type === 'google-calendar-event';
          if (child.state !== 'executed' && provider) {
            if (!deps.providerGateway) throw new CaptureOutcomeError('unavailable', 'Provider preparation is unavailable.');
            await handoffApprovedOmnixProviderProposalCommand(deps.proposals, deps.providerGateway, scope, child.id, now);
          } else if (child.state !== 'executed') {
            if (child.state === 'failed') await deps.proposals.transitionExecution(scope, child.id, { expectedState: 'failed', nextState: 'executing', idempotencyKey: `capture-retry:${child.id}:${current.revision}`, occurredAt: now.toISOString() });
            await executeApprovedOmnixProposalCommand({ ...deps, captureOutcomes: deps.captures }, scope, child.id, now);
          }
          const receipt = await deps.proposals.get(scope, child.id);
          if (receipt?.state !== 'executed' || !receipt.executionReference) throw new CaptureOutcomeError('unavailable', 'Canonical execution receipt is pending.');
          operation = { ...operation, state: provider ? 'awaiting-provider' : 'completed', receipt: receipt.executionReference, error: undefined };
        }
      } catch {
        operation = { ...operation, state: 'failed', error: 'Could not complete this item. Retry to recover its canonical receipt.' };
      }
      current = await deps.captures.save(scope, { ...current, revision: current.revision + 1, operations: current.operations.map((item) => item.id === operation.id ? operation : item) }, current.revision);
    }
    const selected = current.operations.filter((item) => item.selected);
    const status = selected.every((item) => item.state === 'completed') ? 'completed'
      : selected.every((item) => ['completed', 'awaiting-provider'].includes(item.state)) ? 'awaiting-provider'
        : selected.some((item) => ['completed', 'awaiting-provider'].includes(item.state)) ? 'partially-completed' : selected.some((item) => item.state === 'stale') ? 'stale' : 'failed';
    return deps.captures.save(scope, { ...current, revision: current.revision + 1, status, executionLeaseUntil: undefined }, current.revision);
  }
  async function disposition(scope: WorkspaceScope, id: string, expectedVersion: number, status: 'rejected' | 'deferred', until?: string, now = new Date()) {
    const prior = await get(scope, id); exact(prior, expectedVersion, now, true);
    return deps.captures.save(scope, { ...prior, revision: prior.revision + 1, status, ...(until ? { deferredUntil: captureInstant(until) } : {}) }, prior.revision);
  }
  return { analyze, get, edit, addOperation, select, confirm, options: (scope: WorkspaceScope, contactId: string) => captureOperationOptions(deps, validateWorkspaceScope(scope), contactId), list: (scope: WorkspaceScope, contactId?: string) => deps.captures.list(validateWorkspaceScope(scope), contactId),
    reject: (scope: WorkspaceScope, id: string, version: number, now = new Date()) => disposition(scope, id, version, 'rejected', undefined, now),
    defer: (scope: WorkspaceScope, id: string, version: number, until: string, now = new Date()) => disposition(scope, id, version, 'deferred', until, now) };
}
