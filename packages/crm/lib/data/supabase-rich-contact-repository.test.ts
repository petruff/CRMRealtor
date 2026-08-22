import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../domain/workspace.ts';
import { supabaseRichContactRepository } from './supabase-rich-contact-repository.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-live', ownerUserId: 'owner-live', membershipId: 'membership-live',
  workspaceId: 'workspace-live', role: 'owner', mode: 'live',
};
const pointRow = {
  id: 'point-a', workspace_id: 'workspace-live', contact_id: 'contact-a', type: 'email',
  label: 'Primary', display_value: 'Ada@Example.com', normalized_value: 'ada@example.com',
  is_primary: true, email_subscribed: true, display_order: 0,
  created_at: '2026-08-11T12:00:00.000Z', updated_at: '2026-08-11T12:00:00.000Z',
  archived_at: null, archived_by_membership_id: null, archive_reason: null,
};
const sourceFactRow = {
  id: 'fact-a', workspace_id: 'workspace-live', contact_id: 'contact-a',
  provider: 'first-class-real-estate', schema_version: 'first-class-real-estate.contact-profile.v1',
  source_key: 'email-optin', source_label: 'Email Optin', category: 'consent',
  value_type: 'boolean', value_json: true, value_hash: 'a'.repeat(64), source_row_number: 2,
  group_idempotency_key: 'import-group:fixture:2', request_hash: 'b'.repeat(64),
  captured_at: '2026-08-11T12:00:00.000Z',
};

function client() {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const rpc = vi.fn(async (name: string) => ({ data: name === 'remove_household_member' ? null : pointRow, error: null }));
  function chain(table: string) {
    return {
      select(value?: unknown) { calls.push({ operation: 'select', value }); return this; },
      eq(field: string, value: unknown) { calls.push({ operation: `eq:${field}`, value }); return this; },
      in(field: string, value: unknown) { calls.push({ operation: `in:${field}`, value }); return this; },
      is(field: string, value: unknown) { calls.push({ operation: `is:${field}`, value }); return this; },
      or(value: string) { calls.push({ operation: 'or', value }); return this; },
      order(field: string) { calls.push({ operation: `order:${field}` }); return this; },
      limit(value: number) { calls.push({ operation: 'limit', value }); return Promise.resolve({ data: [table === 'contact_import_source_facts' ? sourceFactRow : pointRow], error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    };
  }
  return { supabase: { from: (table: string) => chain(table), rpc } as unknown as SupabaseClient, calls, rpc };
}

describe('Supabase rich contact repository', () => {
  it('aggregates donor history and routes new contact-scoped facts to the survivor', async () => {
    const mock = client();
    const identityMap = {
      resolveCanonical: async () => 'contact-a',
      listGroupMembers: async () => ({ requestedContactId: 'donor-a', canonicalContactId: 'contact-a',
        memberContactIds: ['contact-a', 'donor-a'], aliasEpoch: 2 }),
      resolvePage: async () => new Map<string, string>(),
    };
    const repository = supabaseRichContactRepository(mock.supabase, identityMap);
    await repository.listContactPoints(scope, 'donor-a');
    await repository.addContactPoint(scope, {
      contactId: 'donor-a', type: 'email', label: 'Primary', displayValue: 'Ada@Example.com',
      normalizedValue: 'ada@example.com', isPrimary: true, emailSubscribed: true, displayOrder: 0,
      actorMembershipId: 'membership-live', occurredAt: '2026-08-20T12:00:00.000Z',
    });
    expect(mock.calls).toContainEqual({ operation: 'in:contact_id', value: ['contact-a', 'donor-a'] });
    expect(mock.rpc).toHaveBeenCalledWith('add_contact_point', expect.objectContaining({
      target_contact_id: 'contact-a',
    }));
    await expect(repository.restoreContact(
      scope, 'donor-a', 'membership-live', '2026-08-20T12:00:00.000Z',
    )).rejects.toThrow(/aliased donor/i);
  });

  it('uses workspace-scoped active reads and maps canonical contact points', async () => {
    const mock = client();
    const repository = supabaseRichContactRepository(mock.supabase);
    await expect(repository.listContactPoints(scope, 'contact-a')).resolves.toEqual([
      expect.objectContaining({ id: 'point-a', workspaceId: 'workspace-live', normalizedValue: 'ada@example.com' }),
    ]);
    expect(mock.calls).toContainEqual({ operation: 'eq:workspace_id', value: 'workspace-live' });
    expect(mock.calls).toContainEqual({ operation: 'is:archived_at', value: null });
    expect(mock.calls).toContainEqual({ operation: 'limit', value: 500 });
  });

  it('binds mutations to the authenticated actor and frozen RPC contract', async () => {
    const mock = client();
    const repository = supabaseRichContactRepository(mock.supabase);
    await repository.addContactPoint(scope, {
      contactId: 'contact-a', type: 'email', label: 'Primary', displayValue: 'Ada@Example.com',
      normalizedValue: 'ada@example.com', isPrimary: true, emailSubscribed: true, displayOrder: 0,
      actorMembershipId: 'membership-live', occurredAt: '2026-08-11T12:00:00.000Z',
    });
    expect(mock.rpc).toHaveBeenCalledWith('add_contact_point', expect.objectContaining({
      target_contact_id: 'contact-a', target_actor_membership_id: 'membership-live',
      target_normalized_value: 'ada@example.com',
    }));
    await repository.removeHouseholdMember(
      scope, 'household-a', 'contact-a', 'membership-live', '2026-08-11T12:00:00.000Z',
    );
    expect(mock.rpc).toHaveBeenCalledWith('remove_household_member', expect.objectContaining({
      target_household_id: 'household-a', target_contact_id: 'contact-a',
      target_actor_membership_id: 'membership-live',
    }));
  });

  it('reads typed import provenance through workspace and contact scope', async () => {
    const mock = client();
    const repository = supabaseRichContactRepository(mock.supabase);
    await expect(repository.listContactImportSourceFacts(scope, 'contact-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'fact-a', provider: 'first-class-real-estate', key: 'email-optin',
        category: 'consent', valueType: 'boolean', value: true, sourceRowNumber: 2,
      }),
    ]);
    expect(mock.calls).toContainEqual({ operation: 'eq:workspace_id', value: 'workspace-live' });
    expect(mock.calls).toContainEqual({ operation: 'eq:contact_id', value: 'contact-a' });
  });

  it('rejects sample authority at the live adapter boundary', async () => {
    const repository = supabaseRichContactRepository(client().supabase);
    await expect(repository.listHouseholds(SAMPLE_WORKSPACE_SCOPE)).rejects.toMatchObject({ code: 'scope-mismatch' });
  });
});
