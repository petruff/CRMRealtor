import type { IncompleteRecordRepository } from '../data/incomplete-record-repository.ts';
import {
  IncompleteRecordError,
  projectIncompleteCandidate,
  type IncompleteCandidate,
  type IncompleteContactConversionPlan,
  type IncompleteConversionReceipt,
  type IncompleteRecord,
  type IncompleteRecordStatus,
} from '../domain/incomplete-record.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';

export const INCOMPLETE_RECORD_QUERY_MAX = 200;
export const INCOMPLETE_RECORD_LIST_MAX = 500;

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,255}$/.test(value.trim())) {
    throw new IncompleteRecordError('invalid-input', `${field} is invalid.`, {
      [field]: 'Use a bounded identifier without whitespace.',
    });
  }
  return value.trim();
}

function printable(value: unknown, field: string, max: number, required = true): string | undefined {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return undefined;
    throw new IncompleteRecordError('invalid-input', `${field} is required.`, { [field]: 'Enter text.' });
  }
  const clean = value.trim();
  if ((!clean && required) || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new IncompleteRecordError('invalid-input', `${field} is invalid.`, {
      [field]: `Use ${required ? '1–' : 'up to '}${max} printable characters.`,
    });
  }
  return clean || undefined;
}

function timestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new IncompleteRecordError('invalid-input', 'Timestamp is invalid.');
  return now.toISOString();
}

async function requiredRecord(
  repository: IncompleteRecordRepository,
  scope: WorkspaceScope,
  id: unknown,
): Promise<IncompleteRecord> {
  const record = await repository.get(scope, identifier(id, 'recordId'));
  if (!record) throw new IncompleteRecordError('not-found', 'Incomplete record not found.');
  return record;
}

export async function createIncompleteRecordCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  input: {
    source?: unknown;
    externalId?: unknown;
    candidate?: unknown;
    reasons?: unknown;
    intakeIdempotencyKey?: unknown;
  },
  now = new Date(),
): Promise<IncompleteRecord> {
  const scope = validateWorkspaceScope(untrustedScope);
  const source = printable(input.source, 'source', 64) ?? '';
  const externalId = printable(input.externalId, 'externalId', 255, false);
  const projection = projectIncompleteCandidate(input.candidate, input.reasons, externalId);
  return repository.create(scope, {
    source,
    ...(externalId ? { externalId } : {}),
    candidate: projection.candidate,
    reasons: projection.reasons,
    ...(input.intakeIdempotencyKey === undefined ? {} : {
      intakeIdempotencyKey: identifier(input.intakeIdempotencyKey, 'intakeIdempotencyKey'),
    }),
    createdAt: timestamp(now),
  });
}

export async function listIncompleteRecordsCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  input: { status?: IncompleteRecordStatus | 'all'; query?: unknown; limit?: unknown } = {},
): Promise<readonly IncompleteRecord[]> {
  const query = printable(input.query, 'query', INCOMPLETE_RECORD_QUERY_MAX, false);
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > INCOMPLETE_RECORD_LIST_MAX) {
    throw new IncompleteRecordError('invalid-input', `limit must be 1–${INCOMPLETE_RECORD_LIST_MAX}.`);
  }
  return repository.list(validateWorkspaceScope(untrustedScope), {
    status: input.status ?? 'pending',
    ...(query ? { query } : {}),
    limit,
  });
}

export async function showIncompleteRecordCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
): Promise<IncompleteRecord> {
  return requiredRecord(repository, validateWorkspaceScope(untrustedScope), id);
}

function correctedCandidate(
  record: IncompleteRecord,
  correction: unknown,
): IncompleteCandidate {
  const patch = correction && typeof correction === 'object' && !Array.isArray(correction)
    ? correction as Record<string, unknown>
    : {};
  const projection = projectIncompleteCandidate(
    { ...record.candidate, ...patch },
    [],
    record.externalId,
  );
  const blockingReasons = projection.reasons.filter(
    (reason) => reason.code !== 'incomplete-contact',
  );
  if (blockingReasons.length > 0) {
    throw new IncompleteRecordError(
      'invalid-input',
      'Correct the invalid contact values before conversion.',
      Object.fromEntries(blockingReasons.map((reason) => [reason.field, reason.message])),
    );
  }
  if (!projection.candidate.firstName && !projection.candidate.lastName) {
    throw new IncompleteRecordError(
      'invalid-input',
      'Correct the candidate to include a first or last name before conversion.',
      { firstName: 'Enter a first or last name.', lastName: 'Enter a first or last name.' },
    );
  }
  return projection.candidate;
}

export async function previewIncompleteRecordConversionCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  correction: unknown = {},
): Promise<IncompleteContactConversionPlan> {
  const scope = validateWorkspaceScope(untrustedScope);
  const record = await requiredRecord(repository, scope, id);
  if (record.status === 'converted') {
    return {
      action: record.conversionAction ?? 'unchanged',
      matchedContactId: record.convertedContactId,
      changes: [],
    };
  }
  return repository.previewConversion(scope, {
    recordId: record.id,
    candidate: correctedCandidate(record, correction),
  });
}

export async function previewIncompleteRecordInboxCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  records: readonly IncompleteRecord[],
): Promise<Readonly<Record<string, IncompleteContactConversionPlan | undefined>>> {
  const scope = validateWorkspaceScope(untrustedScope);
  const previews = await Promise.all(
    records
      .filter((record) => record.status === 'pending')
      .map(async (record) => {
        try {
          return [
            record.id,
            await previewIncompleteRecordConversionCommand(repository, scope, record.id),
          ] as const;
        } catch (error) {
          // A quarantined record may intentionally be missing the fields needed
          // for conversion. Keep it visible so the reviewer can correct it;
          // infrastructure, scope and persistence failures still fail closed.
          if (error instanceof IncompleteRecordError && error.code === 'invalid-input') {
            return [record.id, undefined] as const;
          }
          throw error;
        }
      }),
  );
  return Object.fromEntries(previews);
}

export async function convertIncompleteRecordCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  input: { correction?: unknown; idempotencyKey?: unknown },
  now = new Date(),
): Promise<IncompleteConversionReceipt> {
  const scope = validateWorkspaceScope(untrustedScope);
  const record = await requiredRecord(repository, scope, id);
  if (record.status === 'converted') {
    if (!record.convertedContactId || !record.conversionAction) {
      throw new IncompleteRecordError('conflict', 'Converted record is missing its immutable receipt.');
    }
    return {
      record,
      contactId: record.convertedContactId,
      action: record.conversionAction,
      noOp: true,
    };
  }
  if (record.status === 'archived') {
    throw new IncompleteRecordError(
      'conflict',
      'Archived incomplete records must be restored before conversion.',
    );
  }
  const candidate = correctedCandidate(record, input.correction ?? {});
  const plan = await repository.previewConversion(scope, { recordId: record.id, candidate });
  return repository.convertAtomically(scope, {
    recordId: record.id,
    candidate,
    plan,
    idempotencyKey: identifier(input.idempotencyKey, 'idempotencyKey'),
    actorMembershipId: scope.membershipId,
    convertedAt: timestamp(now),
  });
}

export async function archiveIncompleteRecordCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  reason: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(untrustedScope);
  return repository.archive(scope, identifier(id, 'recordId'), {
    actorMembershipId: scope.membershipId,
    archivedAt: timestamp(now),
    reason: printable(reason, 'reason', 500) ?? '',
  });
}

export async function restoreIncompleteRecordCommand(
  repository: IncompleteRecordRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  now = new Date(),
) {
  return repository.restore(
    validateWorkspaceScope(untrustedScope),
    identifier(id, 'recordId'),
    timestamp(now),
  );
}
