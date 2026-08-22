import { describe, expect, it } from 'vitest';
import { connectorPersistenceMappers, supabaseConnectorRepository } from './supabase-connector-repository';

describe('Supabase connector persistence mapping', () => {
  it('maps architecture-native connection and job states into redacted domain models', () => {
    expect(connectorPersistenceMappers.connection({
      id: 'connection-a', workspace_id: 'workspace-a', provider: 'mailchimp',
      provider_account_key_hash: 'a'.repeat(64), display_label: 'Audience owner',
      status: 'reauthorization_required', granted_scopes: ['audience.sync'], last_probe_at: null,
      created_at: '2026-08-11T12:00:00Z', updated_at: '2026-08-11T12:00:00Z', disconnected_at: null,
    })).toMatchObject({
      provider: 'mailchimp', status: 'reauthorization-required', remoteAccountId: 'a'.repeat(64),
    });
    expect(connectorPersistenceMappers.job({
      id: 'job-a', workspace_id: 'workspace-a', intent_id: 'intent-a', intent_version: 1,
      provider: 'mailchimp', action_type: 'audience.sync', payload_ref: 'payload-a',
      idempotency_key: 'key-a', correlation_id: 'correlation-a', state: 'reconciliation_required',
      attempt_count: 1, max_attempts: 5, scheduled_at: '2026-08-11T12:00:00Z',
      lease_owner: null, lease_expires_at: null, fencing_token: '2',
      created_at: '2026-08-11T12:00:00Z', updated_at: '2026-08-11T12:00:00Z', completed_at: null,
    })).toMatchObject({ state: 'reconciliation-required', fencingToken: 2 });
  });

  it('allowlists receipt types and normalizes unknown persistence errors safely', () => {
    const receipt = connectorPersistenceMappers.receipt({
      id: 'receipt-a', workspace_id: 'workspace-a', provider: 'mailchimp', intent_id: 'intent-a',
      job_id: 'job-a', attempt_number: 1, event_type: 'provider.unknown', correlation_id: 'correlation-a',
      provider_request_hash: 'b'.repeat(64), remote_operation_id: null, provider_status: null,
      error_category: 'attacker_controlled_secret@example.com',
      redacted_metadata: { detail: 'redacted category only' }, occurred_at: '2026-08-11T12:00:00Z',
    });
    expect(receipt).toMatchObject({ type: 'provider.unknown', errorCategory: 'internal_error' });
    expect(JSON.stringify(receipt)).not.toContain('attacker_controlled_secret@example.com');
    expect(connectorPersistenceMappers.receipt({
      ...{
        id: 'receipt-review', workspace_id: 'workspace-a', provider: 'mailchimp', intent_id: null,
        job_id: null, attempt_number: null, event_type: 'sync.reviewed', correlation_id: 'correlation-review',
        provider_request_hash: null, remote_operation_id: null, provider_status: null,
        redacted_metadata: { itemsReviewed: 244 }, occurred_at: '2026-08-13T20:46:41Z',
      }, error_category: 'reconciliation_items_require_review',
    })).toMatchObject({
      type: 'sync.reviewed', errorCategory: 'reconciliation_items_require_review',
    });
    expect(connectorPersistenceMappers.receipt({
      id: 'receipt-oauth', workspace_id: 'workspace-a', provider: 'mailchimp', intent_id: null,
      job_id: null, attempt_number: null, event_type: 'oauth.started', correlation_id: 'correlation-oauth',
      provider_request_hash: null, remote_operation_id: null, provider_status: null,
      error_category: null, redacted_metadata: { scopeBundle: 'mailchimp.audience-sync.v1' },
      occurred_at: '2026-08-13T20:00:00Z',
    })).toMatchObject({ type: 'oauth.started', provider: 'mailchimp', errorCategory: 'none' });
    expect(() => connectorPersistenceMappers.receipt({
      ...{
        id: 'receipt-b', workspace_id: 'workspace-a', provider: 'mailchimp', intent_id: null,
        job_id: null, attempt_number: null, correlation_id: 'correlation-a', provider_request_hash: null,
        remote_operation_id: null, provider_status: null, error_category: null, redacted_metadata: {},
        occurred_at: '2026-08-11T12:00:00Z',
      }, event_type: 'made.up',
    })).toThrow(/invalid connector receipt type/i);
  });

  it('maps the durable live disconnect receipt instead of claiming immediate provider completion', async () => {
    const rpc = async () => ({
      data: {
        connection: { ...{
          id: 'connection-a', workspace_id: 'workspace-a', provider: 'mailchimp',
          provider_account_key_hash: 'a'.repeat(64), display_label: 'Audience owner',
          granted_scopes: ['audience.sync'], last_probe_at: null,
          created_at: '2026-08-11T12:00:00Z', updated_at: '2026-08-11T12:00:01Z',
          disconnected_at: null,
        }, status: 'revoking' },
        receipt: {
          id: 'receipt-a', workspace_id: 'workspace-a', provider: 'mailchimp',
          intent_id: null, job_id: null, attempt_number: null,
          event_type: 'revocation.requested', correlation_id: 'correlation-a',
          provider_request_hash: null, remote_operation_id: null, provider_status: null,
          error_category: null, redacted_metadata: { revocationJobId: 'revocation-a' },
          occurred_at: '2026-08-11T12:00:01Z',
        },
        noOp: false,
      },
      error: null,
    });
    const repository = supabaseConnectorRepository({ rpc } as never, []);
    await expect(repository.disconnectConnection({
      authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
      workspaceId: 'workspace-a', role: 'owner', mode: 'live',
    }, {
      connectionId: 'connection-a', actorMembershipId: 'membership-a',
      occurredAt: '2026-08-11T12:00:01Z', correlationId: 'correlation-a',
    })).resolves.toMatchObject({
      connection: { status: 'revoking' },
      receipt: { provider: 'mailchimp', type: 'revocation.requested' },
      noOp: false,
    });
  });
});
