import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import { createMemoryAttentionRepository } from '../data/memory-attention-repository';
import { createOmnixCopilotAlert, createOmnixCopilotCitation } from '../domain/omnix-copilot';
import {
  attentionMaterializationsFromAlerts,
  listAttentionCommand,
  reconcileAttentionCommand,
  transitionAttentionCommand,
} from './attention-commands';

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
