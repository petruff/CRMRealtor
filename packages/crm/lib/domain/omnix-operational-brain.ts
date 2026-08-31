import type { AttentionPriority } from './attention.ts';

export const OMNIX_PROPOSAL_KINDS = [
  'task-create',
  'pipeline-move',
  'google-email-draft',
  'google-calendar-event',
  'mailchimp-campaign-draft',
  'nurture-plan',
] as const;
export type OmnixProposalKind = (typeof OMNIX_PROPOSAL_KINDS)[number];

export const OMNIX_PROPOSAL_STATES = [
  'pending', 'approved', 'rejected', 'executing', 'executed', 'failed', 'expired', 'cancelled',
] as const;
export type OmnixProposalState = (typeof OMNIX_PROPOSAL_STATES)[number];
export type OmnixProposalOrigin = 'deterministic' | 'gemini';
export type OmnixApprovalMode = 'active-member' | 'owner';

export interface OmnixPriorityFactors {
  readonly urgency: number;
  readonly leadTemperature: 'hot' | 'warm' | 'nurture' | 'unknown';
  readonly daysOverdue: number;
  readonly awaitingReply: boolean;
  readonly potentialValueCents: number;
}

export interface OmnixProposalCitation {
  readonly entityType: 'contact' | 'task' | 'transaction' | 'connection' | 'activity' | 'workspace';
  readonly recordId: string;
  readonly factKeys: readonly string[];
  readonly sourceTimestamp?: string;
  readonly href: string;
}

export interface OmnixActionProposal {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId?: string;
  readonly transactionId?: string;
  readonly attentionItemId?: string;
  readonly kind: OmnixProposalKind;
  readonly state: OmnixProposalState;
  readonly origin: OmnixProposalOrigin;
  readonly approvalMode: OmnixApprovalMode;
  readonly priority: AttentionPriority;
  readonly priorityScore: number;
  readonly priorityFactors: OmnixPriorityFactors;
  readonly title: string;
  readonly rationale: string;
  readonly currentVersion: number;
  readonly correlationId: string;
  readonly dueAt?: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt?: string;
  readonly executionReference?: string;
  readonly executedAt?: string;
  readonly lastErrorCategory?: string;
}

export interface OmnixProposalVersion {
  readonly proposalId: string;
  readonly version: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly citations: readonly OmnixProposalCitation[];
  readonly createdAt: string;
}

export interface CreateOmnixProposalInput {
  readonly contactId?: string;
  readonly transactionId?: string;
  readonly attentionItemId?: string;
  readonly kind: OmnixProposalKind;
  readonly origin: OmnixProposalOrigin;
  readonly approvalMode: OmnixApprovalMode;
  readonly factors: OmnixPriorityFactors;
  readonly title: string;
  readonly rationale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly citations: readonly OmnixProposalCitation[];
  readonly dueAt?: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface OmnixRelationshipMemory {
  readonly contactId: string;
  readonly deterministicSummary: string;
  readonly generatedSummary?: string;
  readonly nextBestAction: string;
  readonly citations: readonly OmnixProposalCitation[];
  readonly policyVersion: string;
  readonly model?: string;
  readonly refreshedAt: string;
}

export class OmnixOperationalError extends Error {
  readonly code: 'invalid-input' | 'forbidden' | 'not-found' | 'conflict' | 'expired' | 'unavailable';
  constructor(code: OmnixOperationalError['code'], message: string) {
    super(message);
    this.name = 'OmnixOperationalError';
    this.code = code;
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const SHA256 = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{1,152}$/;

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new OmnixOperationalError('invalid-input', `${field} is invalid.`);
  }
  return Number(value);
}

function text(value: unknown, maximum: number, field: string): string {
  if (typeof value !== 'string') throw new OmnixOperationalError('invalid-input', `${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || CONTROL.test(normalized)) {
    throw new OmnixOperationalError('invalid-input', `${field} is invalid.`);
  }
  return normalized;
}

function instant(value: unknown, field: string): string {
  const normalized = text(value, 64, field);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new OmnixOperationalError('invalid-input', `${field} is invalid.`);
  return parsed.toISOString();
}

export function validateOmnixPriorityFactors(input: OmnixPriorityFactors): OmnixPriorityFactors {
  if (!['hot', 'warm', 'nurture', 'unknown'].includes(input.leadTemperature)) {
    throw new OmnixOperationalError('invalid-input', 'leadTemperature is invalid.');
  }
  if (typeof input.awaitingReply !== 'boolean') {
    throw new OmnixOperationalError('invalid-input', 'awaitingReply is invalid.');
  }
  return Object.freeze({
    urgency: integer(input.urgency, 0, 100, 'urgency'),
    leadTemperature: input.leadTemperature,
    daysOverdue: integer(input.daysOverdue, 0, 3650, 'daysOverdue'),
    awaitingReply: input.awaitingReply,
    potentialValueCents: integer(input.potentialValueCents, 0, 10_000_000_000, 'potentialValueCents'),
  });
}

/** Explainable score. Stable createdAt/id ordering supplies FIFO for equal scores. */
export function scoreOmnixPriority(untrusted: OmnixPriorityFactors): {
  readonly score: number;
  readonly priority: AttentionPriority;
  readonly factors: OmnixPriorityFactors;
} {
  const factors = validateOmnixPriorityFactors(untrusted);
  const temperature = { hot: 180_000, warm: 90_000, nurture: 20_000, unknown: 0 }[factors.leadTemperature];
  const score = Math.min(1_000_000, (
    factors.urgency * 4_000
    + temperature
    + Math.min(factors.daysOverdue, 60) * 5_000
    + (factors.awaitingReply ? 70_000 : 0)
    + Math.min(50_000, Math.floor(factors.potentialValueCents / 10_000))
  ));
  const priority: AttentionPriority = score >= 700_000 ? 'p0'
    : score >= 500_000 ? 'p1'
      : score >= 300_000 ? 'p2'
        : score >= 120_000 ? 'p3' : 'p4';
  return Object.freeze({ score, priority, factors });
}

export function compareOmnixApprovalQueue(left: OmnixActionProposal, right: OmnixActionProposal): number {
  if (left.priorityScore !== right.priorityScore) return right.priorityScore - left.priorityScore;
  const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const created = left.createdAt.localeCompare(right.createdAt);
  return created || left.id.localeCompare(right.id);
}

export function validateCreateOmnixProposal(input: CreateOmnixProposalInput): CreateOmnixProposalInput & {
  readonly priority: AttentionPriority;
  readonly priorityScore: number;
} {
  if (!OMNIX_PROPOSAL_KINDS.includes(input.kind)) throw new OmnixOperationalError('invalid-input', 'kind is invalid.');
  if (!['deterministic', 'gemini'].includes(input.origin)) throw new OmnixOperationalError('invalid-input', 'origin is invalid.');
  if (!['active-member', 'owner'].includes(input.approvalMode)) throw new OmnixOperationalError('invalid-input', 'approvalMode is invalid.');
  if (!SHA256.test(input.contentHash)) throw new OmnixOperationalError('invalid-input', 'contentHash is invalid.');
  if (!KEY.test(input.idempotencyKey)) throw new OmnixOperationalError('invalid-input', 'idempotencyKey is invalid.');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new OmnixOperationalError('invalid-input', 'payload is invalid.');
  }
  if (!Array.isArray(input.citations) || input.citations.length < 1 || input.citations.length > 20) {
    throw new OmnixOperationalError('invalid-input', 'citations are required.');
  }
  const createdAt = instant(input.createdAt, 'createdAt');
  const expiresAt = instant(input.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new OmnixOperationalError('invalid-input', 'expiresAt must be later than createdAt.');
  const ranked = scoreOmnixPriority(input.factors);
  return Object.freeze({
    ...input,
    title: text(input.title, 160, 'title'),
    rationale: text(input.rationale, 1200, 'rationale'),
    correlationId: text(input.correlationId, 128, 'correlationId'),
    createdAt,
    expiresAt,
    ...(input.dueAt ? { dueAt: instant(input.dueAt, 'dueAt') } : {}),
    factors: ranked.factors,
    priority: ranked.priority,
    priorityScore: ranked.score,
  });
}
