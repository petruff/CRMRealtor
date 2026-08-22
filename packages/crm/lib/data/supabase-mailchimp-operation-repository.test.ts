import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { encryptConnectorSecret } from '@/lib/security/connector-secret-envelope';
import { supabaseMailchimpOperationRepository } from './supabase-mailchimp-operation-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};
const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 4) };

function chain(value: unknown) {
  const result = Promise.resolve({ data: value, error: null });
  const self = {
    select: vi.fn(() => self), eq: vi.fn(() => self), is: vi.fn(() => self), limit: vi.fn(() => result),
    single: vi.fn(() => result), maybeSingle: vi.fn(() => result), then: result.then.bind(result),
  };
  return self;
}

describe('Supabase Mailchimp operation repository', () => {
  it('uses a service-only owner-bound token read and returns no plaintext', async () => {
    const encrypted = encryptConnectorSecret('token-a', {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'mailchimp-access-token', recordVersion: 1,
    }, resolver);
    const serviceRpc = vi.fn(async () => ({ data: {
      workspaceId: 'workspace-a', connectionId: 'connection-a', providerAccountKeyHash: 'a'.repeat(64),
      grantedScopes: ['audience.sync', 'audience.reconcile'],
      secret: {
        secretVersion: 1, ciphertext: encrypted.ciphertext, nonce: encrypted.iv, authTag: encrypted.tag,
        wrappedDek: encrypted.encryptedDek, wrapNonce: encrypted.encryptedDekIv,
        wrapAuthTag: encrypted.encryptedDekTag, kekVersion: encrypted.kekVersion, aadHash: encrypted.aadHash,
      },
    }, error: null }));
    const authenticated = { from: vi.fn(() => chain({ remote_identity_summary: { dataCenter: 'us21' } })) };
    const repository = supabaseMailchimpOperationRepository({
      authenticated: authenticated as never, service: { rpc: serviceRpc } as never,
    });
    const result = await repository.readConnectionAuthority(scope, 'connection-a');
    expect(result).toMatchObject({ workspaceId: 'workspace-a', connectionId: 'connection-a', dataCenter: 'us21', grantedScopes: ['audience.sync', 'audience.reconcile'] });
    expect(serviceRpc).toHaveBeenCalledWith('read_mailchimp_access_token', {
      target_workspace_id: 'workspace-a', target_connection_id: 'connection-a',
      target_authenticated_user_id: 'user-a', target_membership_id: 'membership-a',
    });
    expect(JSON.stringify(result)).not.toContain('token-a');
  });

  it('records a redacted probe through the service-only connector state RPC', async () => {
    const serviceRpc = vi.fn(async () => ({ data: { connection: {
      id: 'connection-a', workspace_id: 'workspace-a', provider: 'mailchimp', status: 'degraded',
    }, noOp: false }, error: null }));
    const repository = supabaseMailchimpOperationRepository({
      authenticated: {} as never, service: { rpc: serviceRpc } as never,
    });
    await expect(repository.recordProbe(scope, {
      connectionId: 'connection-a', status: 'degraded', accountIdHash: 'a'.repeat(64),
      grantedScopes: ['audience.sync'], occurredAt: '2026-08-11T12:00:00.000Z',
      errorCategory: 'rate_limited', correlationId: 'correlation-a',
    })).resolves.toEqual({ status: 'degraded', occurredAt: '2026-08-11T12:00:00.000Z', noOp: false });
    expect(serviceRpc).toHaveBeenCalledWith('record_connector_connection_state', expect.objectContaining({
      target_connection_id: 'connection-a', target_status: 'degraded',
      target_last_error_category: 'rate_limited', target_remote_identity_summary: null,
    }));
  });

  it('persists audience selection only through the authenticated owner RPC', async () => {
    const authenticatedRpc = vi.fn(async () => ({ data: { binding: {
      id: 'binding-a',
      connection_id: 'connection-a', account_id_hash: 'a'.repeat(64), data_center: 'us21',
      audience_external_id: 'audience-a', audience_name: 'Primary', mapping_version: 1,
      selected_at: '2026-08-11T12:00:00Z', baseline_required: true,
      webhook_registration_required: true,
    }, noOp: false }, error: null }));
    const repository = supabaseMailchimpOperationRepository({
      authenticated: { rpc: authenticatedRpc } as never, service: { rpc: vi.fn() } as never,
    });
    await expect(repository.selectAudience(scope, {
      connectionId: 'connection-a', accountIdHash: 'a'.repeat(64), dataCenter: 'us21',
      audience: { id: 'audience-a', name: 'Primary' }, mappingVersion: 1,
      correlationId: 'correlation-a', selectedAt: '2026-08-11T12:00:00Z',
    })).resolves.toMatchObject({
      binding: { id: 'binding-a', audienceId: 'audience-a', baselineRequired: true, webhookRegistrationRequired: true },
      noOp: false,
    });
    expect(authenticatedRpc).toHaveBeenCalledWith('select_mailchimp_audience', expect.objectContaining({
      target_connection_id: 'connection-a', target_audience_external_id: 'audience-a',
    }));
  });
});
