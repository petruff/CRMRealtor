import { describe, expect, it, vi } from 'vitest';
import type { ConnectorJob } from '@/lib/domain/connector';
import { createMailchimpMemberOperation } from '@/lib/domain/mailchimp';
import { MailchimpConnectorAdapter } from './mailchimp-adapter';

const job: ConnectorJob = {
  id: 'job-a', workspaceId: 'workspace-a', intentId: 'intent-a', intentVersion: 1,
  provider: 'mailchimp', actionType: 'audience.sync', payloadReference: 'payload-a',
  idempotencyKey: 'idempotency-a', correlationId: 'correlation-a', state: 'executing',
  attemptCount: 1, maxAttempts: 5, scheduledAt: '2026-08-11T12:00:00Z',
  leaseOwner: 'worker-a', leaseExpiresAt: '2026-08-11T12:02:00Z', fencingToken: 1,
  createdAt: '2026-08-11T12:00:00Z', updatedAt: '2026-08-11T12:00:00Z',
};

const operation = createMailchimpMemberOperation({
  audienceId: 'audience-a', normalizedEmail: 'buyer@example.com', leadType: 'hot',
});
const guardedOperation = { ...operation, contactId: 'contact-a', contactPointId: 'point-a', reviewedAliasEpoch: 3 };
const outboundGuard = { assertTarget: vi.fn(async () => ({ contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 3 })) };

describe('Mailchimp Story 3.5 adapter', () => {
  it('executes one fixed tag operation and returns an opaque provider receipt', async () => {
    const client = { setOmnixLeadTag: vi.fn(async () => undefined), listMemberTagNames: vi.fn() };
    const adapter = new MailchimpConnectorAdapter({ load: async () => ({ operation: guardedOperation, client }) }, outboundGuard);
    await expect(adapter.execute(job)).resolves.toEqual({
      outcome: 'succeeded', providerReceiptId: operation.operationKey, providerStatus: 'tag-active',
    });
    expect(client.setOmnixLeadTag).toHaveBeenCalledWith({
      audienceId: 'audience-a', subscriberHash: operation.subscriberHash,
      tagName: 'Omnix: Hot',
    });
  });

  it('reconciles ambiguous delivery without blindly sending again', async () => {
    const client = {
      setOmnixLeadTag: vi.fn(),
      listMemberTagNames: vi.fn(async () => ['Preserved', 'Omnix: Hot']),
    };
    const adapter = new MailchimpConnectorAdapter({ load: async () => ({ operation: guardedOperation, client }) }, outboundGuard);
    await expect(adapter.reconcile(job)).resolves.toMatchObject({
      outcome: 'succeeded', providerStatus: 'tag-active-reconciled',
    });
    expect(client.setOmnixLeadTag).not.toHaveBeenCalled();
  });

  it('maps unknown transport exceptions to reconciliation-required outcomes', async () => {
    const adapter = new MailchimpConnectorAdapter({ load: async () => { throw new Error('socket lost after write'); } }, outboundGuard);
    await expect(adapter.execute(job)).resolves.toEqual({
      outcome: 'unknown', errorCategory: 'network_outcome_unknown',
    });
  });

  it('rechecks the reviewed alias epoch immediately before Mailchimp dispatch', async () => {
    const client = { setOmnixLeadTag: vi.fn(), listMemberTagNames: vi.fn() };
    const changedGuard = { assertTarget: vi.fn(async () => { throw new Error('alias state changed after review'); }) };
    const adapter = new MailchimpConnectorAdapter({ load: async () => ({ operation: guardedOperation, client }) }, changedGuard);
    await expect(adapter.execute(job)).resolves.toEqual({
      outcome: 'terminal-failure', errorCategory: 'validation_failed',
    });
    expect(changedGuard.assertTarget).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a' }),
      'contact-a', 'point-a', 3);
    expect(client.setOmnixLeadTag).not.toHaveBeenCalled();
  });

  it('keeps disconnect unconfirmed when Mailchimp offers no reviewed revocation endpoint', async () => {
    const load = vi.fn();
    const adapter = new MailchimpConnectorAdapter({ load }, outboundGuard);
    await expect(adapter.revoke()).resolves.toEqual({
      outcome: 'terminal-failure',
      errorCategory: 'configuration_required',
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('routes a provider rate limit to bounded retry instead of terminal failure', async () => {
    const client = {
      setOmnixLeadTag: vi.fn(async () => {
        const { ConnectorError } = await import('@/lib/domain/connector');
        throw new ConnectorError('provider-retryable', 'Provider retryable status.');
      }),
      listMemberTagNames: vi.fn(),
    };
    const adapter = new MailchimpConnectorAdapter({ load: async () => ({ operation: guardedOperation, client }) }, outboundGuard);
    await expect(adapter.execute(job)).resolves.toEqual({
      outcome: 'retryable-failure', errorCategory: 'rate_limited',
    });
  });
});
