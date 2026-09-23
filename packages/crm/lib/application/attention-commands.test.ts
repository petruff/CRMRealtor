import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import { createMemoryAttentionRepository } from '../data/memory-attention-repository';
import { createOmnixCopilotAlert, createOmnixCopilotCitation } from '../domain/omnix-copilot';
import {
  attentionMaterializationsFromAlerts,
  attentionMaterializationsFromMilestones,
  listAttentionCommand,
  reconcileAttentionCommand,
  transitionAttentionCommand,
} from './attention-commands';
import type { TransactionMilestone } from '../domain/operational-signal';

const citation = createOmnixCopilotCitation({
  entityType: 'contact', recordId: 'contact-1', factKeys: ['nextTouchAt'],
  responseAsOf: '2026-08-24T12:00:00Z', target: '/contacts/contact-1',
});
const alert = createOmnixCopilotAlert({
  rule: 'overdue-follow-up', category: 'follow-up', priority: 'urgent', order: 1,
  reason: '1 day overdue', asOf: '2026-08-24T12:00:00Z', recordId: 'contact-1',
  href: '/contacts/contact-1', citations: [citation], occurrenceKey: 'follow-up:contact-1',
  sourceFingerprint: 'a'.repeat(64), dueAt: '2026-08-23T12:00:00Z', dismissAllowed: false,
});

describe('attention commands', () => {
  it('maps canonical alert identity without relative wording in the occurrence key', () => {
    const [mapped] = attentionMaterializationsFromAlerts([alert]);
    expect(mapped).toMatchObject({
      occurrenceKey: 'follow-up:contact-1', sourceFingerprint: 'a'.repeat(64), priority: 'p0',
    });
  });

  it('materializes one explainable canonical risk per milestone without inventing unknown dates', () => {
    const base: TransactionMilestone = {
      id: 'milestone-1', workspaceId: 'workspace-1', transactionId: 'transaction-1', contactId: 'contact-1',
      contactName: 'Avery Buyer', propertyAddress: '1 Main Street', potentialValueCents: 900000,
      kind: 'inspection', label: 'Inspection deadline', state: 'open', dueAt: '2026-09-02T17:00:00.000Z',
      timezone: 'America/New_York', responsibleMembershipId: 'membership-1', source: 'manual', sourceType: 'contract',
      sourceReference: 'Contract section 12', sourceDate: '2026-08-30', verificationState: 'verified',
      currentVersion: 1, createdAt: '2026-08-30T12:00:00.000Z', updatedAt: '2026-08-30T12:00:00.000Z',
    };
    const approaching = attentionMaterializationsFromMilestones([base], new Date('2026-09-01T12:00:00.000Z'));
    expect(approaching).toHaveLength(1);
    expect(approaching[0]).toMatchObject({
      rule: 'transaction-deadline-approaching', subjectType: 'transaction', subjectId: 'transaction-1',
      occurrenceKey: 'transaction-milestone-risk:milestone-1', priority: 'p1', dismissAllowed: false,
    });
    expect(attentionMaterializationsFromMilestones([{ ...base, verificationState: 'unverified' }], new Date('2026-09-01T12:00:00.000Z'))[0])
      .toMatchObject({ rule: 'transaction-deadline-unverified', priority: 'p1' });
    const contradiction = attentionMaterializationsFromMilestones([
      base, { ...base, id: 'milestone-2', dueAt: '2026-09-03T17:00:00.000Z' },
    ], new Date('2026-09-01T12:00:00.000Z'));
    expect(contradiction).toHaveLength(2);
    expect(contradiction.every((item) => item.rule === 'transaction-deadline-contradictory')).toBe(true);
    expect(attentionMaterializationsFromMilestones([{ ...base, state: 'completed' }], new Date('2026-09-01T12:00:00.000Z'))).toEqual([]);
  });

  it('reconciles, lists and completes through one repository contract', async () => {
    const repository = createMemoryAttentionRepository({ activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId] });
    await reconcileAttentionCommand(repository, SAMPLE_WORKSPACE_SCOPE, [alert], new Date('2026-08-24T12:00:00Z'), 'run-1');
    const [item] = await listAttentionCommand(repository, SAMPLE_WORKSPACE_SCOPE, { now: new Date('2026-08-24T12:01:00Z') });
    expect(item?.priority).toBe('p0');
    await transitionAttentionCommand(repository, SAMPLE_WORKSPACE_SCOPE, item?.id, {
      transition: 'complete', expectedVersion: item?.version,
      idempotencyKey: 'complete-1',
    }, new Date('2026-08-24T12:02:00Z'));
    expect(await listAttentionCommand(repository, SAMPLE_WORKSPACE_SCOPE)).toEqual([]);
  });
});
