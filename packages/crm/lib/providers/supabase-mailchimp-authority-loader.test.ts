import { describe, expect, it, vi } from 'vitest';
import { createMailchimpMemberOperation } from '../domain/mailchimp';
import type { ConnectorJob } from '../domain/connector';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import { createSupabaseMailchimpAuthorityLoader } from './supabase-mailchimp-authority-loader';

const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 9) };
const operation = createMailchimpMemberOperation({
  audienceId: 'audience-a', normalizedEmail: 'buyer@example.com', leadType: 'warm',
});
const reviewedOperation = { ...operation, contactId: 'contact-a', contactPointId: 'point-a', reviewedAliasEpoch: 2 };
const job: ConnectorJob = {
  id: 'job-a', workspaceId: 'workspace-a', intentId: 'intent-a', intentVersion: 1,
  provider: 'mailchimp', actionType: 'audience.sync', payloadReference: 'payload-a',
  idempotencyKey: 'key-a', correlationId: 'correlation-a', state: 'executing', attemptCount: 1,
  maxAttempts: 5, scheduledAt: '2026-08-11T12:00:00Z', leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-11T12:02:00Z', fencingToken: 1,
  createdAt: '2026-08-11T12:00:00Z', updatedAt: '2026-08-11T12:00:00Z',
};

function encrypted(overrides: Partial<{ audienceId: string; mappingVersion: number }> = {}) {
  const binding = {
    connectionId: 'connection-a', workspaceId: 'workspace-a', dataCenter: 'us21',
    audienceId: overrides.audienceId ?? 'audience-a', accountIdHash: 'a'.repeat(64),
    mappingVersion: overrides.mappingVersion ?? 1,
    baselineRequired: false, webhookRegistrationRequired: false,
  };
  return {
    binding,
    operationEnvelope: encryptConnectorSecret(JSON.stringify(reviewedOperation), {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'audience.sync', recordVersion: 1,
    }, resolver),
    operationVersion: 1,
    accessTokenEnvelope: encryptConnectorSecret('token-value', {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'mailchimp-access-token', recordVersion: 1,
    }, resolver),
    accessTokenVersion: 1,
  };
}

describe('Supabase Mailchimp authority loader', () => {
  it('decrypts lease-scoped material and calls only the fixed data-center host', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const loader = createSupabaseMailchimpAuthorityLoader({
      reader: { read: vi.fn(async () => encrypted()) }, resolver, fetcher,
    });
    const authority = await loader.load(job);
    await authority.client.setOmnixLeadTag({
      audienceId: operation.audienceId, subscriberHash: operation.subscriberHash,
      tagName: operation.desiredTag,
    });
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/^https:\/\/us21\.api\.mailchimp\.com\/3\.0\//);
    expect(JSON.stringify(authority.operation)).not.toContain('buyer@example.com');
  });

  it('rejects a payload bound to a different selected audience', async () => {
    const loader = createSupabaseMailchimpAuthorityLoader({
      reader: { read: vi.fn(async () => encrypted({ audienceId: 'audience-b' })) }, resolver,
    });
    await expect(loader.load(job)).rejects.toThrow(/selected audience authority/i);
  });
});
