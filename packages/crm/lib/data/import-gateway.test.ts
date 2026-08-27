import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import {
  memoryImportGateway,
  validateContactImportPlanResult,
  verifyContactImportPlanOutcome,
  verifyContactImportGroupOutcome,
  type ContactImportGroupCommand,
} from './import-gateway';

describe('intake receipt reservations', () => {
  it('claims a key atomically, completes it, and replays the final receipt', async () => {
    const gateway = memoryImportGateway();
    const key = 'atomic:unique-test-20260810';
    const pending = { idempotencyKey: key, requestHash: 'hash-a', statusCode: 102, response: { ok: false }, createdAt: '2026-08-10T00:00:00Z' };
    expect(await gateway.claimReceipt(pending, 'correlation-a')).toBe(true);
    expect(await gateway.claimReceipt(pending, 'correlation-a')).toBe(false);
    await gateway.completeReceipt({ ...pending, statusCode: 200, response: { ok: true } }, 'correlation-a');
    expect(await gateway.getReceipt(key)).toMatchObject({ statusCode: 200, response: { ok: true } });
  });

  it('finalizes a placeholder exactly once instead of deleting failed evidence', async () => {
    const gateway = memoryImportGateway();
    const key = 'atomic:release-test-20260810';
    const pending = { idempotencyKey: key, requestHash: 'hash-b', statusCode: 102, response: {}, createdAt: '2026-08-10T00:00:00Z' };
    expect(await gateway.claimReceipt(pending, 'correlation-b')).toBe(true);
    const failed = { ...pending, statusCode: 500, response: { ok: false } };
    await gateway.completeReceipt(failed, 'correlation-b');
    await expect(gateway.completeReceipt(failed, 'correlation-b')).resolves.toBeUndefined();
    await expect(gateway.completeReceipt({ ...failed, statusCode: 422 }, 'correlation-b'))
      .rejects.toThrow(/already terminal/);
    expect(await gateway.claimReceipt(pending, 'correlation-b')).toBe(false);
  });
});

describe('atomic contact import plan envelopes', () => {
  const orderedPlan = [
    { rowNumber: 1, kind: 'reject' as const, errorCode: 'ambiguous-identity' },
    { rowNumber: 2, kind: 'alias' as const, targetRowNumber: 1 },
  ];

  it('rejects count drift, reordered rows, and plan-kind disagreements', () => {
    const valid = {
      state: 'recorded', runId: 'run-a', planHash: 'a'.repeat(64), noOp: false,
      counts: { total: 2, created: 0, updated: 0, unchanged: 1, rejected: 1, quarantined: 0, failed: 0, notesAdded: 0 },
      rowOutcomes: [
        { rowNumber: 1, outcome: 'rejected', errorCode: 'ambiguous-identity' },
        { rowNumber: 2, outcome: 'unchanged', contactId: 'contact-a' },
      ],
    };
    expect(validateContactImportPlanResult(valid, orderedPlan)).toMatchObject({ counts: { total: 2 } });
    expect(() => validateContactImportPlanResult({ ...valid, planHash: 'not-a-plan-hash' }, orderedPlan))
      .toThrow(/invalid terminal envelope/);
    expect(() => validateContactImportPlanResult({
      ...valid, counts: { ...valid.counts, rejected: 0 },
    }, orderedPlan)).toThrow(/counts disagree/);
    expect(() => validateContactImportPlanResult({
      ...valid, rowOutcomes: [...valid.rowOutcomes].reverse(),
    }, orderedPlan)).toThrow(/invalid row outcome/);
    expect(() => validateContactImportPlanResult({
      ...valid, rowOutcomes: [valid.rowOutcomes[0], { rowNumber: 2, outcome: 'quarantined', incompleteRecordId: 'incomplete-a' }],
    }, orderedPlan)).toThrow(/disagree/);
  });

  it('accepts an RPC replay no-op only when its plan hash and durable receipt stay exact', () => {
    const command = {
      scope: SAMPLE_WORKSPACE_SCOPE,
      idempotencyKey: 'ui:plan-replay', requestHash: 'b'.repeat(64), source: 'spreadsheet',
      format: 'csv' as const, fileHash: 'c'.repeat(64), orderedPlan,
      startedAt: '2026-08-25T12:30:00.000Z', completedAt: '2026-08-25T12:30:01.000Z',
      correlationId: '59123000-0000-4000-8000-000000000001',
    };
    const response = {
      state: 'recorded' as const, runId: 'run-a', planHash: 'a'.repeat(64), noOp: false,
      counts: { total: 2, created: 0, updated: 0, unchanged: 1, rejected: 1, quarantined: 0, failed: 0, notesAdded: 0 },
      rowOutcomes: [
        { rowNumber: 1, outcome: 'rejected' as const, errorCode: 'ambiguous-identity' },
        { rowNumber: 2, outcome: 'unchanged' as const, contactId: 'contact-a' },
      ],
    };
    const receipt = {
      idempotencyKey: command.idempotencyKey, requestHash: command.requestHash, statusCode: 200,
      response, createdAt: command.completedAt,
    };
    expect(verifyContactImportPlanOutcome({ command, mutation: { ...response, noOp: true }, receipt }))
      .toEqual(response);
    expect(() => verifyContactImportPlanOutcome({
      command, mutation: { ...response, planHash: 'd'.repeat(64), noOp: true }, receipt,
    })).toThrow(/does not match/);
  });
});

describe('atomic contact import outcomes', () => {
  const command = {
    scope: SAMPLE_WORKSPACE_SCOPE,
    groupIdempotencyKey: 'import-group:terminal-proof',
    requestHash: 'a'.repeat(64),
    plan: {
      action: 'create' as const,
      contact: { firstName: 'Avery', lastName: 'Stone' },
      points: [], householdIds: [], assigneeMembershipIds: [], customValues: [],
      activityIdempotencyKey: 'import:terminal-proof:1',
    },
    occurredAt: '2026-08-25T12:00:00.000Z',
  } as ContactImportGroupCommand;
  const mutation = { contactId: 'contact-a', action: 'create', notesAdded: false, noOp: false };

  it('returns success only when the mutation has exact durable terminal evidence', () => {
    expect(() => verifyContactImportGroupOutcome({ command, mutation, receipt: undefined }))
      .toThrow(/terminal receipt is missing/);
    expect(() => verifyContactImportGroupOutcome({
      command,
      mutation,
      receipt: {
        idempotencyKey: command.groupIdempotencyKey,
        requestHash: 'b'.repeat(64),
        statusCode: 200,
        response: mutation,
        createdAt: command.occurredAt,
      },
    })).toThrow(/does not match/);
    expect(verifyContactImportGroupOutcome({
      command,
      mutation,
      receipt: {
        idempotencyKey: command.groupIdempotencyKey,
        requestHash: command.requestHash,
        statusCode: 200,
        response: mutation,
        createdAt: command.occurredAt,
      },
    })).toMatchObject({
      contactId: 'contact-a',
      terminalReceipt: { requestHash: command.requestHash, statusCode: 200 },
    });
  });
});
