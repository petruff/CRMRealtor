import { describe, expect, it } from 'vitest';
import type {
  TwilioReconciliationJob,
  TwilioReconciliationRepository,
} from '../data/supabase-twilio-reconciliation-repository.ts';
import { loadConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import { drainTwilioReconciliations } from './twilio-reconciliation-service.ts';

const leased: TwilioReconciliationJob = {
  id: 'job-1', workspaceId: 'workspace-1', connectionId: 'connection-1', messageId: 'message-1',
  state: 'leased', attemptCount: 0, maxAttempts: 5, fencingToken: 2, leaseOwner: 'worker-1', correlationId: 'correlation-1',
};

function repository(transitioned: Array<Record<string, unknown>>): TwilioReconciliationRepository {
  return {
    schedule: async () => 1,
    claim: async () => [leased],
    start: async () => ({ ...leased, state: 'executing', attemptCount: 1 }),
    readAuthority: async ({ job }) => ({
      job, accountSidHash: 'a'.repeat(64), apiKeySidHash: 'b'.repeat(64), messagingServiceSidHash: 'c'.repeat(64),
      providerMessageSid: `SM${'d'.repeat(32)}`, providerMessageSidHash: 'e'.repeat(64),
      providerAuthorityVersion: 1, apiCredentialVersion: 1,
      providerAuthorityEnvelope: {} as never, apiCredentialEnvelope: {} as never,
    }),
    transition: async (input) => {
      transitioned.push(input as unknown as Record<string, unknown>);
      return { ...input.job, state: input.outcome === 'resolved' ? 'succeeded' : 'retry_wait' };
    },
  };
}

describe('Twilio reconciliation worker', () => {
  it('resolves a terminal provider state without sending again', async () => {
    const transitions: Array<Record<string, unknown>> = [];
    const result = await drainTwilioReconciliations({
      repository: repository(transitions), configuration: loadConnectorRuntimeConfiguration({}),
      workerId: 'worker-1', deadlineMs: Date.parse('2026-08-12T12:05:00.000Z'),
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      createClient: () => ({ getMessage: async () => ({ messageSid: `SM${'d'.repeat(32)}`, status: 'delivered' }) }),
    });
    expect(result).toMatchObject({ scheduled: 1, claimed: 1, resolved: 1, deferred: 0 });
    expect(transitions[0]).toMatchObject({ outcome: 'resolved', providerStatus: 'delivered' });
  });

  it('defers a nonterminal provider state for bounded lookup', async () => {
    const transitions: Array<Record<string, unknown>> = [];
    const result = await drainTwilioReconciliations({
      repository: repository(transitions), configuration: loadConnectorRuntimeConfiguration({}),
      workerId: 'worker-1', deadlineMs: Date.parse('2026-08-12T12:05:00.000Z'),
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      createClient: () => ({ getMessage: async () => ({ messageSid: `SM${'d'.repeat(32)}`, status: 'sent' }) }),
    });
    expect(result.deferred).toBe(1);
    expect(transitions[0]).toMatchObject({ outcome: 'retry', errorCategory: 'provider_status_pending' });
  });
});
