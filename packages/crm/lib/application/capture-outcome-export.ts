import { createHash, randomUUID } from 'node:crypto';
import { CaptureOutcomeError, type CaptureOperationAfter } from '../domain/capture-outcome.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { CaptureOutcomeRepository } from '../data/capture-outcome-repository.ts';
import type { ContactRepository } from '../data/repository.ts';

export interface CaptureExportReceipt {
  readonly correlationId: string;
  readonly selection: { readonly captureId: string; readonly version: number; readonly contentHash: string; readonly includeSource: boolean };
  readonly selectionHash: string;
  readonly createdAt: string;
}

const AFTER_FIELDS: readonly (keyof CaptureOperationAfter)[] = ['text','title','dueAt','toStage','cadenceDays','maximumSteps','startAt','planId','action','snoozedUntil','stopReason','connectionId','contactPointId','subject','body','taskId','endAt','timeZone'];
const BEFORE_FIELDS = ['pipelineStage','nextTouchAt','nurtureState','planVersion','recipient','sender','taskTitle','taskVersion','taskDueAt'];
function selectedFields(value: object, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CaptureOutcomeError('unavailable', 'Stored review cannot be exported.');
  return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => {
    const field = (value as Record<string, unknown>)[key];
    if (field !== undefined && field !== null && typeof field !== 'string' && typeof field !== 'boolean' && !(typeof field === 'number' && Number.isFinite(field))) {
      throw new CaptureOutcomeError('unavailable', 'Stored review cannot be exported.');
    }
    return [key, field];
  }));
}

/** Exports exactly one current review; this is not a full-history or deletion operation. */
export async function exportCaptureOutcome(deps: {
  scope: WorkspaceScope; captures: CaptureOutcomeRepository; contacts: ContactRepository;
  recordReceipt: (receipt: CaptureExportReceipt) => Promise<void>;
}, input: { contactId: string; proposalId: string; includeSource?: boolean }) {
  const scope = validateWorkspaceScope(deps.scope);
  const contact = await deps.contacts.get(input.contactId);
  if (!contact || contact.archivedAt) throw new CaptureOutcomeError('not-found', 'Contact is unavailable.');
  const proposal = await deps.captures.get(scope, input.proposalId);
  if (!proposal || proposal.workspaceId !== scope.workspaceId || proposal.contactId !== contact.id) {
    throw new CaptureOutcomeError('not-found', 'Review is unavailable.');
  }
  const selection = { captureId: proposal.id, version: proposal.version, contentHash: proposal.contentHash, includeSource: input.includeSource === true };
  const correlationId = randomUUID();
  const exportedAt = new Date().toISOString();
  const review = {
    ...selectedFields(proposal, ['id','contactId','version','contentHash','sourceHash','status','createdAt']),
    operations: proposal.operations.map(({ id, type, state, selected, receipt, after, before, evidence, confidence, consequence }) => ({ ...selectedFields({ id, type, state, selected, receipt }, ['id','type','state','selected','receipt']),
      ...(selection.includeSource ? { after: selectedFields(after, AFTER_FIELDS), before: before ? selectedFields(before, BEFORE_FIELDS) : null,
        evidence: evidence ? selectedFields(evidence, ['quote','start','end']) : null, ...selectedFields({ confidence, consequence }, ['confidence','consequence']) } : {}),
    })),
    ...(selection.includeSource ? { ...selectedFields(proposal, ['sourceText','summary']),
      facts: proposal.facts.map(({ category, text, confidence, uncertain, evidence }) => ({ ...selectedFields({ category, text, confidence, uncertain }, ['category','text','confidence','uncertain']),
        evidence: evidence ? selectedFields(evidence, ['quote','start','end']) : null })),
      unknowns: (proposal.unknowns ?? []).map(value => { if (typeof value !== 'string') throw new CaptureOutcomeError('unavailable', 'Stored review cannot be exported.'); return value; }),
    } : {}),
  };
  const body = JSON.stringify({ schemaVersion: 'capture-export.v1', scope: 'current-review-only', exportedAt, correlationId,
    includesConfidentialSource: selection.includeSource, mode: scope.mode, review }, null, 2);
  const selectionHash = createHash('sha256').update(JSON.stringify(selection)).digest('hex');
  // No bytes leave this service unless the audit receipt has been accepted.
  await deps.recordReceipt({ correlationId, selection, selectionHash, createdAt: exportedAt });
  return { body, filename: `conversation-review-${proposal.id}.json`, correlationId };
}
