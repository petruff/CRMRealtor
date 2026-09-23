export const CAPTURE_SCHEMA_VERSION = 'capture-outcome.v1' as const;
export const CAPTURE_SOURCE_MAX = 8000;
export type CaptureStatus = 'pending' | 'selected' | 'executing' | 'completed' | 'awaiting-provider' | 'partially-completed' | 'failed' | 'stale' | 'expired' | 'rejected' | 'deferred';
export interface CaptureEvidence { readonly quote: string; readonly start: number; readonly end: number }
export interface CaptureFact {
  readonly category: 'fact' | 'preference' | 'commitment' | 'objection' | 'question' | 'consent' | 'lifecycle';
  readonly text: string;
  readonly evidence: CaptureEvidence;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly uncertain: boolean;
}
export interface CaptureExtractedTask {
  readonly title: string;
  readonly dueAt: string | null;
  readonly owner: 'realtor' | 'client' | 'unknown';
  readonly evidence: CaptureEvidence;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly uncertain: boolean;
}
export interface ExtractedOutcome {
  readonly schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
  readonly summary: string;
  readonly facts: readonly CaptureFact[];
  readonly tasks: readonly CaptureExtractedTask[];
  readonly unknowns: readonly string[];
}
export type CaptureOperationType = 'note-append' | 'task-create' | 'pipeline-move' | 'nurture-plan' | 'nurture-transition' | 'google-email-draft' | 'google-calendar-event';
export interface CaptureOperationAfter {
  readonly text?: string; readonly title?: string; readonly dueAt?: string;
  readonly toStage?: string; readonly cadenceDays?: number; readonly maximumSteps?: number; readonly startAt?: string;
  readonly planId?: string; readonly action?: string; readonly snoozedUntil?: string; readonly stopReason?: string;
  readonly connectionId?: string; readonly contactPointId?: string; readonly subject?: string; readonly body?: string;
  readonly taskId?: string; readonly endAt?: string; readonly timeZone?: string;
}
export interface CaptureOperationPreconditions {
  readonly contactVersion?: string; readonly pipelineStage?: string;
  readonly planId?: string; readonly planVersion?: number; readonly noCurrentNurture?: boolean;
  readonly taskVersion?: number; readonly taskTitle?: string;
  readonly contactPointVersion?: string; readonly recipient?: string;
  readonly connectionVersion?: string; readonly sender?: string;
}
export interface CaptureOutcomeOperation {
  readonly id: string;
  readonly type: CaptureOperationType;
  readonly after: CaptureOperationAfter;
  readonly before: Readonly<Record<string, string | number | boolean | null>> | null;
  readonly preconditions?: CaptureOperationPreconditions;
  readonly requiredAuthority?: 'owner' | 'active-member';
  readonly consequence?: string;
  readonly evidence: CaptureEvidence | null;
  readonly confidence: 'high' | 'medium' | 'low' | 'manual';
  readonly flags: readonly string[];
  readonly selected: boolean;
  readonly state: 'pending' | 'executing' | 'completed' | 'awaiting-provider' | 'failed' | 'stale';
  readonly childProposalId?: string;
  readonly receipt?: string;
  readonly error?: string;
}
export interface CaptureOutcomeProposal {
  readonly schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly createdByMembershipId: string;
  readonly sourceText: string;
  readonly sourceHash: string;
  readonly targetHash: string;
  readonly summary: string;
  readonly facts: readonly CaptureFact[];
  readonly unknowns: readonly string[];
  readonly extractionState: 'available' | 'manual' | 'unconfigured' | 'failed' | 'limited';
  readonly version: number;
  readonly revision: number;
  readonly contentHash: string;
  readonly status: CaptureStatus;
  readonly operations: readonly CaptureOutcomeOperation[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly deferredUntil?: string;
  readonly executionLeaseUntil?: string;
  readonly retentionState: 'workspace-record';
}

export class CaptureOutcomeError extends Error {
  readonly code: 'invalid-input' | 'forbidden' | 'not-found' | 'conflict' | 'expired' | 'unavailable';
  constructor(code: CaptureOutcomeError['code'], message: string) {
    super(message); this.name = 'CaptureOutcomeError'; this.code = code;
  }
}
export function captureText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new CaptureOutcomeError('invalid-input', `${field} is required and must be at most ${maximum} characters.`);
  }
  return value;
}
/** Requires a calendar-valid explicit offset; local and relative dates never silently become UTC. */
export function captureInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new CaptureOutcomeError('invalid-input', 'Choose an exact date, time, and timezone.');
  }
  const day = value.slice(0, 10);
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw new CaptureOutcomeError('invalid-input', 'The clock time is invalid.');
  }
  const offset = value.match(/[+-](\d{2}):(\d{2})$/);
  if (offset && (Number(offset[1]) > 14 || Number(offset[2]) > 59 || (Number(offset[1]) === 14 && Number(offset[2]) !== 0))) throw new CaptureOutcomeError('invalid-input', 'The timezone offset is invalid.');
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== day || !Number.isFinite(Date.parse(value))) {
    throw new CaptureOutcomeError('invalid-input', 'The calendar date is invalid.');
  }
  return new Date(value).toISOString();
}
