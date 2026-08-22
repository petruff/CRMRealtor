import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type {
  TwilioUatAuthority,
  TwilioUatJob,
  TwilioUatRepository,
} from '../data/supabase-twilio-uat-repository.ts';
import { drainTwilioRealNumberUat } from './twilio-uat-service.ts';

const sid = `SM${'a'.repeat(32)}`;
const leased: TwilioUatJob = {
  id: 'uat-a', workspaceId: 'workspace-a', connectionId: 'connection-a',
  contactId: 'contact-a', contactPointId: 'point-a', state: 'leased',
  bodyHash: 'b'.repeat(64), recipientPhoneHash: 'c'.repeat(64),
  policyVersion: 1, fencingToken: 2, attemptCount: 0, maxAttempts: 5,
  leaseOwner: 'worker-a', correlationId: 'correlation-a',
};

function harness(evidenceComplete: boolean) {
  const transitions: Array<Record<string, unknown>> = [];
  const authority: TwilioUatAuthority = {
    job: { ...leased, state: 'executing', attemptCount: 1 },
    accountSidHash: 'd'.repeat(64), apiKeySidHash: 'e'.repeat(64),
    messagingServiceSidHash: 'f'.repeat(64), providerAuthorityVersion: 1,
    providerAuthorityEnvelope: {} as never, apiCredentialVersion: 1,
    apiCredentialEnvelope: {} as never, mode: 'lookup-only',
    providerMessageSid: sid, providerMessageSidHash: sha256Hex(sid),
    evidenceComplete,
  };
  const repository: TwilioUatRepository = {
    claim: async () => [leased],
    start: async () => authority.job,
    read: async () => authority,
    bind: async () => undefined,
    transition: async (input) => {
      transitions.push(input as unknown as Record<string, unknown>);
      return { ...input.job, state: input.outcome === 'delivered' ? 'succeeded' : 'retry_wait' };
    },
  };
  return { repository, transitions };
}

describe('Twilio real-number UAT drain', () => {
  it('keeps delivered retryable until reply, STOP, and cancellation evidence are complete', async () => {
    const state = harness(false);
    const sendMessage = vi.fn();
    const result = await drainTwilioRealNumberUat({
      repository: state.repository, configuration: loadConnectorRuntimeConfiguration({}),
      workerId: 'worker-a', deadlineMs: Date.parse('2026-08-12T12:05:00.000Z'),
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      callbackBaseUrl: 'https://crm.example.com', callbackEndpointKey: 'opaque',
      createClient: () => ({ sendMessage,
        getMessage: async () => ({ messageSid: sid, status: 'delivered' }) }),
    });
    expect(result).toMatchObject({ delivered: 0, deferred: 1, failed: 0 });
    expect(state.transitions[0]).toMatchObject({ outcome: 'retry', errorCategory: 'uat_sequence_pending' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('activates only after the complete signed UAT sequence is authoritative', async () => {
    const state = harness(true);
    const result = await drainTwilioRealNumberUat({
      repository: state.repository, configuration: loadConnectorRuntimeConfiguration({}),
      workerId: 'worker-a', deadlineMs: Date.parse('2026-08-12T12:05:00.000Z'),
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      callbackBaseUrl: 'https://crm.example.com', callbackEndpointKey: 'opaque',
      createClient: () => ({ sendMessage: vi.fn(),
        getMessage: async () => ({ messageSid: sid, status: 'delivered' }) }),
    });
    expect(result).toMatchObject({ delivered: 1, deferred: 0, failed: 0 });
    expect(state.transitions[0]).toMatchObject({ outcome: 'delivered', finalStatus: 'delivered' });
  });

  it('keeps a transient final lookup retryable without authorizing another send', async () => {
    const state = harness(true);
    const sendMessage = vi.fn();
    const result = await drainTwilioRealNumberUat({
      repository: state.repository, configuration: loadConnectorRuntimeConfiguration({}),
      workerId: 'worker-a', deadlineMs: Date.parse('2026-08-12T12:05:00.000Z'),
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      callbackBaseUrl: 'https://crm.example.com', callbackEndpointKey: 'opaque',
      createClient: () => ({
        sendMessage,
        getMessage: async () => {
          throw new ConnectorError(
            'provider-retryable',
            'Twilio lookup is temporarily unavailable.',
          );
        },
      }),
    });
    expect(result).toMatchObject({ delivered: 0, deferred: 1, failed: 0 });
    expect(state.transitions[0]).toMatchObject({
      outcome: 'retry',
      errorCategory: 'uat_finalize_pending',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps a stale non-terminal lookup budget-neutral after signed evidence is complete', async () => {
    const state = harness(true);
    const sendMessage = vi.fn();
    const result = await drainTwilioRealNumberUat({
      repository: state.repository, configuration: loadConnectorRuntimeConfiguration({}),
      workerId: 'worker-a', deadlineMs: Date.parse('2026-08-12T12:05:00.000Z'),
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      callbackBaseUrl: 'https://crm.example.com', callbackEndpointKey: 'opaque',
      createClient: () => ({ sendMessage,
        getMessage: async () => ({ messageSid: sid, status: 'sent' }) }),
    });
    expect(result).toMatchObject({ delivered: 0, deferred: 1, failed: 0 });
    expect(state.transitions[0]).toMatchObject({
      outcome: 'retry',
      errorCategory: 'uat_finalize_pending',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
