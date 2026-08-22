import type {
  IncompleteCandidate,
  IncompleteContactConversionPlan,
  IncompleteConversionReceipt,
  IncompleteRecord,
  IncompleteRecordStatus,
  IncompleteValidationReason,
} from '../domain/incomplete-record.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface IncompleteRecordQuery {
  readonly status?: IncompleteRecordStatus | 'all';
  readonly query?: string;
  readonly limit: number;
}

export interface CreateIncompleteRecordInput {
  readonly source: string;
  readonly externalId?: string;
  readonly candidate: IncompleteCandidate;
  readonly reasons: readonly IncompleteValidationReason[];
  readonly intakeIdempotencyKey?: string;
  readonly createdAt: string;
}

export interface PreviewIncompleteConversionInput {
  readonly recordId: string;
  readonly candidate: IncompleteCandidate;
}

export interface ConvertIncompleteRecordInput {
  readonly recordId: string;
  readonly candidate: IncompleteCandidate;
  readonly plan: IncompleteContactConversionPlan;
  readonly idempotencyKey: string;
  readonly actorMembershipId: string;
  readonly convertedAt: string;
}

export interface ArchiveIncompleteRecordInput {
  readonly actorMembershipId: string;
  readonly archivedAt: string;
  readonly reason: string;
}

/**
 * The live implementation maps `convertAtomically` to one database transaction.
 * Workspace and legacy owner authority are always derived server-side from scope/record.
 */
export interface IncompleteRecordRepository {
  list(scope: WorkspaceScope, query: IncompleteRecordQuery): Promise<readonly IncompleteRecord[]>;
  get(scope: WorkspaceScope, id: string): Promise<IncompleteRecord | undefined>;
  create(scope: WorkspaceScope, input: CreateIncompleteRecordInput): Promise<IncompleteRecord>;
  previewConversion(
    scope: WorkspaceScope,
    input: PreviewIncompleteConversionInput,
  ): Promise<IncompleteContactConversionPlan>;
  convertAtomically(
    scope: WorkspaceScope,
    input: ConvertIncompleteRecordInput,
  ): Promise<IncompleteConversionReceipt>;
  archive(
    scope: WorkspaceScope,
    id: string,
    input: ArchiveIncompleteRecordInput,
  ): Promise<{ record: IncompleteRecord; noOp: boolean }>;
  restore(
    scope: WorkspaceScope,
    id: string,
    restoredAt: string,
  ): Promise<{ record: IncompleteRecord; noOp: boolean }>;
}
