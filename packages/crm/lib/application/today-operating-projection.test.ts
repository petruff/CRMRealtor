import { describe, expect, it } from 'vitest';
import { buildTodayOperatingProjection, type TodayOperatingSources } from './today-operating-projection';

const AVAILABLE = 'available' as const;

function sources(): TodayOperatingSources {
  return {
    attention: { state: AVAILABLE, value: [{
      id: 'attention-1', workspaceId: 'workspace-1', rule: 'deadline-risk', category: 'transaction',
      subjectType: 'transaction', subjectId: 'transaction-1', occurrenceKey: 'deadline:1', sourceFingerprint: 'a'.repeat(64),
      reason: 'Inspection deadline is overdue.', href: '/transactions#deadline-1', priority: 'p0',
      dueAt: '2026-08-30T12:00:00.000Z', enqueuedAt: '2026-08-29T12:00:00.000Z', enqueueSequence: 1,
      lastSeenAt: '2026-08-31T12:00:00.000Z', state: 'open', version: 1, dismissAllowed: false,
      stateChangedAt: '2026-08-29T12:00:00.000Z', evidence: [{ entityType: 'transaction', recordId: 'transaction-1', factKeys: ['dueAt'] }],
    }] },
    proposals: { state: AVAILABLE, value: [{
      id: 'proposal-1', workspaceId: 'workspace-1', contactId: 'contact-1', kind: 'task-create', state: 'pending',
      origin: 'deterministic', approvalMode: 'active-member', priority: 'p1', priorityScore: 600_000,
      priorityFactors: { urgency: 80, leadTemperature: 'hot', daysOverdue: 1, awaitingReply: false, potentialValueCents: 0 },
      title: 'Call Alicia', rationale: 'A verified follow-up is overdue.', currentVersion: 1, correlationId: 'correlation-1',
      expiresAt: '2026-09-02T12:00:00.000Z', createdAt: '2026-08-30T12:00:00.000Z', updatedAt: '2026-08-30T12:00:00.000Z',
    }] },
    inbound: { state: AVAILABLE, value: [{
      id: 'signal-1', workspaceId: 'workspace-1', contactId: 'contact-1', activityEventId: 'activity-1',
      contactName: 'Alicia Rivera', resourceHash: 'b'.repeat(64), receivedAt: '2026-08-31T11:00:00.000Z',
      intelligenceState: 'pending', unknowns: ['intent'], createdAt: '2026-08-31T11:00:00.000Z',
    }] },
    milestones: { state: AVAILABLE, value: [{
      id: 'milestone-1', workspaceId: 'workspace-1', transactionId: 'transaction-1', contactId: 'contact-1',
      contactName: 'Alicia Rivera', propertyAddress: '123 Main Street', potentialValueCents: 0, kind: 'inspection',
      label: 'Inspection period', state: 'open', dueAt: '2026-08-30T12:00:00.000Z', timezone: 'America/New_York',
      responsibleMembershipId: 'membership-1', source: 'manual', sourceType: 'contract', sourceReference: 'Contract page 4',
      sourceDate: '2026-08-20', verificationState: 'verified', currentVersion: 1,
      createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
    }] },
    connections: { state: AVAILABLE, value: [{
      id: 'connection-1', workspaceId: 'workspace-1', provider: 'google', remoteAccountId: 'account-1',
      grantedScopes: [], status: 'reauthorization-required', connectedAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-31T12:00:00.000Z',
    }] },
    nurture: { state: AVAILABLE, value: [{
      id: 'nurture-1', workspaceId: 'workspace-1', contactId: 'contact-1', sourceProposalId: 'proposal-1', state: 'active',
      version: 1, cadenceDays: 7, currentStep: 1, maximumSteps: 4, nextStepAt: '2026-08-31T10:00:00.000Z',
      createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
    }] },
    transactions: { state: AVAILABLE, value: [{
      id: 'transaction-1', workspaceId: 'workspace-1', contactId: 'contact-1', contactName: 'Alicia Rivera',
      kind: 'buyer', kindVerified: true, title: 'Alicia purchase', status: 'under-contract', side: 'buyer',
      propertyAddress: '123 Main Street', source: 'referral', salePriceCents: 0, grossCommissionCents: 0,
      netCommissionCents: 0, marketingCostCents: 0, expenseCents: 0, responsibleMembershipId: 'membership-1',
      version: 1, createdByMembershipId: 'membership-1', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
    }] },
  };
}

describe('buildTodayOperatingProjection', () => {
  it('projects exact operational facts without inventing financial values or provider health', () => {
    const result = buildTodayOperatingProjection(sources(), new Date('2026-08-31T12:00:00.000Z'));
    expect(result).toMatchObject({
      sourceState: 'available', approvals: { count: 1, topLabel: 'Call Alicia' },
      replies: { count: 1, topLabel: 'Alicia Rivera' }, deadlines: { count: 1, overdue: 1 },
      growth: { activeNurtures: 1, dueNurtures: 1 },
      connections: { connected: 0, needsAttention: 1, labels: ['Google Workspace'] },
      business: { activeTransactions: 1, underContract: 1 },
      unknowns: { count: 1, labels: ['Some replies still need human interpretation'] },
    });
    expect(result.priorityContributors[0]).toMatchObject({ reason: 'Inspection deadline is overdue.', evidenceCount: 1 });
    expect(JSON.stringify(result)).not.toContain('GCI');
  });

  it('preserves a visible unavailable state instead of converting missing reads into zero truth', () => {
    const input = sources();
    const result = buildTodayOperatingProjection({
      ...input,
      connections: { state: 'unavailable', value: [] },
    }, new Date('2026-08-31T12:00:00.000Z'));
    expect(result.sourceState).toBe('unavailable');
    expect(result.connections).toMatchObject({ state: 'unavailable', connected: 0, needsAttention: 0 });
    expect(result.unknowns.labels).toContain('Connection health could not be checked');
  });

  it('displays the effective aged priority used by the canonical attention queue', () => {
    const input = sources();
    const aged = { ...input.attention.value[0]!, priority: 'p3' as const, enqueuedAt: '2026-08-20T12:00:00.000Z' };
    const result = buildTodayOperatingProjection({
      ...input,
      attention: { state: 'available', value: [aged] },
    }, new Date('2026-08-31T12:00:00.000Z'));
    expect(result.priorityContributors[0]?.priority).toBe('p2');
  });
});
