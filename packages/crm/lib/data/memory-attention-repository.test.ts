import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import { createMemoryAttentionRepository } from './memory-attention-repository';

const materialization = {
  rule: 'needs-first-contact', category: 'follow-up', subjectType: 'contact' as const,
  subjectId: 'contact-1', occurrenceKey: 'follow-up:contact-1',
  sourceFingerprint: 'a'.repeat(64), reason: 'First contact is open.',
  href: '/contacts/contact-1', priority: 'p0' as const, dismissAllowed: false, evidence: [],
};

describe('memory attention repository', () => {
  it('materializes, replays and suppresses a completed unchanged occurrence', async () => {
    const repository = createMemoryAttentionRepository({ activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId] });
    const first = await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [materialization], '2026-08-24T12:00:00Z', 'run-1');
    expect(first).toMatchObject({ materialized: 1, reopened: 0, active: [{ state: 'open' }] });
    const replay = await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [materialization], '2026-08-24T12:00:00Z', 'run-1');
    expect(replay.noOp).toBe(true);

    const current = first.active[0]!;
    await repository.transition(SAMPLE_WORKSPACE_SCOPE, current.id, {
      transition: 'complete', actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
      expectedVersion: current.version, occurredAt: '2026-08-24T12:05:00Z',
      idempotencyKey: 'complete-1',
    });
    const unchanged = await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [materialization], '2026-08-24T12:10:00Z', 'run-2');
    expect(unchanged.active).toEqual([]);
    expect(unchanged.reopened).toBe(0);
  });

  it('reopens exactly once when the source fingerprint changes', async () => {
    const repository = createMemoryAttentionRepository({ activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId] });
    const first = await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [materialization], '2026-08-24T12:00:00Z', 'run-a');
    const current = first.active[0]!;
    await repository.transition(SAMPLE_WORKSPACE_SCOPE, current.id, {
      transition: 'complete', actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
      expectedVersion: current.version, occurredAt: '2026-08-24T12:05:00Z', idempotencyKey: 'complete-a',
    });
    const changed = await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [{
      ...materialization, sourceFingerprint: 'b'.repeat(64),
    }], '2026-08-24T12:10:00Z', 'run-b');
    expect(changed).toMatchObject({ reopened: 1, active: [{ state: 'open', version: 3 }] });
  });

  it('resolves active items when their source clears', async () => {
    const repository = createMemoryAttentionRepository();
    await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [materialization], '2026-08-24T12:00:00Z', 'run-x');
    const cleared = await repository.reconcile(SAMPLE_WORKSPACE_SCOPE, [], '2026-08-24T12:05:00Z', 'run-y');
    expect(cleared).toMatchObject({ resolved: 1, active: [] });
  });
});
