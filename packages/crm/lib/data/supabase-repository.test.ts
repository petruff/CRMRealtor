import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseRepository } from './supabase-repository';

interface Call {
  table: string;
  operation: string;
  value?: unknown;
}

const scope: WorkspaceScope = {
  authenticatedUserId: 'assistant-a',
  ownerUserId: 'owner-a',
  membershipId: 'membership-assistant-a',
  workspaceId: 'workspace-a',
  role: 'assistant',
  mode: 'live',
};

const contactRow = {
  id: 'contact-a',
  workspace_id: 'workspace-a',
  owner_id: 'owner-a',
  first_name: 'Ada',
  last_name: 'Lovelace',
  preferred_name: null,
  phone: null,
  secondary_phone: null,
  email: null,
  mailing_address: null,
  city: null,
  state: null,
  postal_code: null,
  birthdate: null,
  home_purchase_date: null,
  lead_type: 'warm',
  relationship: 'lead',
  intent: 'unknown',
  source: 'other',
  pipeline_stage: 'new',
  buyer_criteria: null,
  seller_criteria: null,
  referred_by_id: null,
  last_contacted_at: null,
  next_touch_at: null,
  touch_date_overridden: false,
  tags: [],
  email_subscribed: true,
  archived_at: null,
  archived_by_membership_id: null,
  archive_reason: null,
  created_at: '2026-08-11T12:00:00.000Z',
};

function contactClient() {
  const calls: Call[] = [];
  function response(table: string, terminal: string) {
    if (table === 'contacts' && terminal === 'limit') return { data: [contactRow], error: null };
    if (table === 'contacts' && terminal === 'maybeSingle') return { data: contactRow, error: null };
    if (table === 'contacts' && terminal === 'single') return { data: contactRow, error: null };
    if (table === 'notes' && terminal === 'order') return { data: [], error: null };
    if (table === 'notes' && terminal === 'single') {
      return {
        data: {
          id: 'note-a',
          contact_id: 'contact-a',
          body: 'Follow up',
          created_at: '2026-08-11T12:00:00.000Z',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
  function chain(table: string) {
    return {
      select(value?: unknown) { calls.push({ table, operation: 'select', value }); return this; },
      insert(value?: unknown) { calls.push({ table, operation: 'insert', value }); return this; },
      update(value?: unknown) { calls.push({ table, operation: 'update', value }); return this; },
      delete() { calls.push({ table, operation: 'delete' }); return this; },
      eq(field: string, value: unknown) { calls.push({ table, operation: `eq:${field}`, value }); return this; },
      is(field: string, value: unknown) { calls.push({ table, operation: `is:${field}`, value }); return this; },
      not(field: string, operator: string, value: unknown) {
        calls.push({ table, operation: `not:${field}:${operator}`, value }); return this;
      },
      order(field: string) {
        calls.push({ table, operation: `order:${field}` });
        return table === 'notes' ? Promise.resolve(response(table, 'order')) : this;
      },
      limit(value: number) {
        calls.push({ table, operation: 'limit', value });
        return Promise.resolve(response(table, 'limit'));
      },
      maybeSingle() {
        calls.push({ table, operation: 'maybeSingle' });
        return Promise.resolve(response(table, 'maybeSingle'));
      },
      single() {
        calls.push({ table, operation: 'single' });
        return Promise.resolve(response(table, 'single'));
      },
      then(resolve: (value: { data: null; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
  }
  return {
    client: { from(table: string) { return chain(table); } } as unknown as SupabaseClient,
    calls,
  };
}

describe('supabaseRepository workspace scope', () => {
  it('suppresses donors on lists and routes donor reads and writes to the survivor', async () => {
    const { client, calls } = contactClient();
    const identityMap = {
      resolveCanonical: async (_scope: WorkspaceScope, id: string) => id === 'donor-a' ? 'contact-a' : id,
      listGroupMembers: async (_scope: WorkspaceScope, id: string) => ({
        requestedContactId: id, canonicalContactId: 'contact-a',
        memberContactIds: ['contact-a', 'donor-a'], aliasEpoch: 2,
      }),
      resolvePage: async () => new Map([['contact-a', 'contact-a'], ['donor-a', 'contact-a']]),
    };
    const repository = supabaseRepository(client, scope, identityMap);

    await expect(repository.list()).resolves.toHaveLength(1);
    await repository.get('donor-a');
    await repository.update('donor-a', { city: 'Austin' });

    expect(calls.filter((call) => call.operation === 'eq:id').map((call) => call.value))
      .toEqual(['contact-a', 'contact-a']);
  });

  it('uses workspace_id for authorization and owner_id only for compatibility inserts', async () => {
    const { client, calls } = contactClient();
    const repository = supabaseRepository(client, scope);
    await repository.list();
    await repository.get('contact-a');
    await repository.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      leadType: 'warm',
      relationship: 'lead',
      intent: 'unknown',
      source: 'other',
      pipelineStage: 'new',
      tags: [],
    });
    await repository.update('contact-a', { firstName: 'Augusta' });
    await expect(repository.remove('contact-a')).rejects.toThrow(/archive lifecycle/i);
    await repository.notesFor('contact-a');
    await repository.addNote('contact-a', 'Follow up');

    expect(calls.filter((call) => (
      call.operation === 'eq:workspace_id' && call.value === 'workspace-a'
    )).length).toBeGreaterThanOrEqual(4);
    expect(calls.some((call) => call.operation === 'eq:owner_id')).toBe(false);
    expect(calls).toContainEqual({ table: 'contacts', operation: 'limit', value: 500 });
    expect(calls).toContainEqual({ table: 'contacts', operation: 'is:archived_at', value: null });
    const inserts = calls.filter((call) => call.operation === 'insert');
    expect(inserts).toHaveLength(2);
    for (const call of inserts) {
      expect(call.value).toMatchObject({ workspace_id: 'workspace-a', owner_id: 'owner-a' });
    }
  });

  it('rejects sample authority at the live adapter boundary', () => {
    expect(() => supabaseRepository({} as SupabaseClient, { ...scope, mode: 'sample' }))
      .toThrow(/live workspace scope/i);
  });
});
