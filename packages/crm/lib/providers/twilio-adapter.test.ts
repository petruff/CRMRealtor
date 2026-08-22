import { describe, expect, it, vi } from 'vitest';
import type { ConnectorJob } from '../domain/connector';
import { TwilioConnectorAdapter, type TwilioApprovedSendOperation } from './twilio-adapter';

const job: ConnectorJob = {
  id: 'job-a', workspaceId: 'workspace-a', intentId: 'intent-a', intentVersion: 1,
  provider: 'twilio', actionType: 'message.send', payloadReference: 'payload-a',
  idempotencyKey: `SM${'a'.repeat(32)}`, correlationId: 'correlation-a', state: 'executing', attemptCount: 1,
  maxAttempts: 5, scheduledAt: '2026-08-12T12:00:00Z', leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-12T12:02:00Z', fencingToken: 1,
  createdAt: '2026-08-12T12:00:00Z', updatedAt: '2026-08-12T12:00:00Z',
};

const operation: TwilioApprovedSendOperation = {
  kind: 'message.send', messageId: 'message-a', contactId: 'contact-a', contactPointId: 'point-a',
  to: '+12025550123', body: 'Tour confirmed.', consentEvidenceId: 'consent-a', consentVersion: 2,
  useCase: 'transactional.follow-up', policyVersion: 'policy-1', recipientTimeZone: 'America/New_York',
  quietHoursStart: '20:00', quietHoursEnd: '08:00', idempotencyKey: 'operation-a',
  approvedAt: '2026-08-12T12:00:00Z', reviewedAliasEpoch: 4,
};

const outboundGuard = { assertTarget: vi.fn(async (_scope, contactId: string, contactPointId?: string) => ({
  contactId, contactPointId, aliasEpoch: 4,
})) };

describe('Twilio governed connector adapter', () => {
  it('sends the exact approved operation and binds the provider SID once', async () => {
    const sendMessage = vi.fn(async () => ({ messageSid: `SM${'b'.repeat(32)}`, status: 'accepted' as const }));
    const bind = vi.fn(async () => undefined);
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation, client: { sendMessage, getMessage: vi.fn(), findApprovedMessage: vi.fn() }, bind,
    }) }, () => new Date('2026-08-12T16:00:00Z'), outboundGuard);
    await expect(adapter.execute(job)).resolves.toMatchObject({ outcome: 'succeeded', providerStatus: 'accepted' });
    expect(sendMessage).toHaveBeenCalledWith({ to: '+12025550123', body: 'Tour confirmed.', idempotencyKey: 'operation-a' });
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ messageSid: `SM${'b'.repeat(32)}` }));
  });

  it('blocks provider execution if the approved decision reaches quiet hours', async () => {
    const sendMessage = vi.fn();
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation, client: { sendMessage, getMessage: vi.fn(), findApprovedMessage: vi.fn() }, bind: vi.fn(),
    }) }, () => new Date('2026-08-13T02:00:00Z'), outboundGuard);
    await expect(adapter.execute(job)).resolves.toEqual({ outcome: 'terminal-failure', errorCategory: 'compliance_blocked' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rechecks the reviewed alias epoch immediately before Twilio dispatch', async () => {
    const sendMessage = vi.fn();
    const changedGuard = { assertTarget: vi.fn(async () => { throw new Error('alias state changed after review'); }) };
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation, client: { sendMessage, getMessage: vi.fn(), findApprovedMessage: vi.fn() }, bind: vi.fn(),
    }) }, () => new Date('2026-08-12T16:00:00Z'), changedGuard);
    await expect(adapter.execute(job)).resolves.toEqual({
      outcome: 'terminal-failure', errorCategory: 'compliance_blocked',
    });
    expect(changedGuard.assertTarget).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a' }),
      'contact-a', 'point-a', 4);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reconciles an unknown outcome by SID without sending again', async () => {
    const sendMessage = vi.fn();
    const bind = vi.fn(async () => undefined);
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation: { kind: 'message.lookup', messageId: operation.messageId, providerMessageSid: `SM${'a'.repeat(32)}` },
      client: { sendMessage, getMessage: vi.fn(async () => ({ messageSid: `SM${'a'.repeat(32)}`, status: 'delivered' as const })), findApprovedMessage: vi.fn() }, bind,
    }) }, () => new Date('2026-08-12T16:00:00Z'));
    await expect(adapter.reconcile(job)).resolves.toMatchObject({ outcome: 'succeeded', providerStatus: 'delivered' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('never sends again when a provider SID is already bound on an execution replay', async () => {
    const sendMessage = vi.fn();
    const bind = vi.fn(async () => undefined);
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation: { kind: 'message.lookup', messageId: operation.messageId, providerMessageSid: `SM${'a'.repeat(32)}` },
      client: { sendMessage, getMessage: vi.fn(async () => ({
        messageSid: `SM${'a'.repeat(32)}`, status: 'sent' as const,
      })), findApprovedMessage: vi.fn() }, bind,
    }) }, () => new Date('2026-08-12T16:00:00Z'));
    await expect(adapter.execute(job)).resolves.toMatchObject({ outcome: 'succeeded', providerStatus: 'sent' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('recovers a unique provider acceptance without blind resend when the SID response was lost', async () => {
    const sendMessage = vi.fn();
    const bind = vi.fn(async () => undefined);
    const findApprovedMessage = vi.fn(async () => ({
      messageSid: `SM${'c'.repeat(32)}`, status: 'sent' as const,
    }));
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation, client: { sendMessage, getMessage: vi.fn(), findApprovedMessage }, bind,
    }) }, () => new Date('2026-08-12T16:00:00Z'));
    await expect(adapter.reconcile(job)).resolves.toMatchObject({
      outcome: 'succeeded', providerReceiptId: `SM${'c'.repeat(32)}`, providerStatus: 'sent',
    });
    expect(findApprovedMessage).toHaveBeenCalledWith({
      to: operation.to, body: operation.body, attemptedAt: job.updatedAt,
    });
    expect(bind).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous provider history in review and never resends', async () => {
    const sendMessage = vi.fn();
    const adapter = new TwilioConnectorAdapter({ load: async () => ({
      operation, client: { sendMessage, getMessage: vi.fn(), findApprovedMessage: vi.fn(async () => undefined) },
      bind: vi.fn(),
    }) }, () => new Date('2026-08-12T16:00:00Z'));
    await expect(adapter.reconcile(job)).resolves.toEqual({
      outcome: 'unknown', errorCategory: 'provider_acceptance_unknown',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
