import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseRepository } from './supabase-repository';

interface Call {
  table?: string;
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

function contactClient(contactRows = [contactRow], responseLimit?: number) {
  const calls: Call[] = [];
  function response(table: string, terminal: string) {
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
      in(field: string, value: unknown) { calls.push({ table, operation: `in:${field}`, value }); return this; },
      is(field: string, value: unknown) { calls.push({ table, operation: `is:${field}`, value }); return this; },
      not(field: string, operator: string, value: unknown) {
        calls.push({ table, operation: `not:${field}:${operator}`, value }); return this;
      },
      order(field: string) {
        calls.push({ table, operation: `order:${field}` });
        return table === 'notes' ? Promise.resolve(response(table, 'order')) : this;
      },
      range(from: number, to: number) {
        calls.push({ table, operation: 'range', value: [from, to] });
        const end = responseLimit ? Math.min(to + 1, from + responseLimit) : to + 1;
        return Promise.resolve({ data: contactRows.slice(from, end), error: null, count: contactRows.length });
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
    client: {
      from(table: string) { return chain(table); },
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ operation: `rpc:${name}`, value: args });
        const offset = args.target_offset as number;
        const limit = args.target_limit as number;
        return Promise.resolve({
          data: {
            items: contactRows.slice(offset, offset + limit),
            total: contactRows.length,
            activeTotal: contactRows.length,
            scopeCounts: {
              leads: contactRows.length,
              clients: 0,
              'active-clients': 0,
              'past-clients': 0,
              'needs-review': 0,
              all: contactRows.length,
            },
            leadTypeCounts: { hot: 0, warm: contactRows.length, nurture: 0 },
            offset,
            limit,
            aliasEpoch: 7,
          },
          error: null,
        });
      },
    } as unknown as SupabaseClient,
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
    expect(calls).toContainEqual({ table: 'contacts', operation: 'range', value: [0, 499] });
    expect(calls).toContainEqual({ table: 'contacts', operation: 'is:archived_at', value: null });
    const inserts = calls.filter((call) => call.operation === 'insert');
    expect(inserts).toHaveLength(2);
    for (const call of inserts) {
      expect(call.value).toMatchObject({ workspace_id: 'workspace-a', owner_id: 'owner-a' });
    }
  });

  it('reads beyond 500 without truncation and returns bounded pages with exact canonical totals', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ ...contactRow, id: `contact-${index}` }));
    const { client, calls } = contactClient(rows, 100);
    const repository = supabaseRepository(client, scope);

    await expect(repository.list()).resolves.toHaveLength(1001);
    await expect(repository.listPage?.({ offset: 500, limit: 50 })).resolves.toMatchObject({
      total: 1001,
      items: expect.arrayContaining([expect.objectContaining({ id: 'contact-500' })]),
    });
    expect(calls).toContainEqual({ table: 'contacts', operation: 'range', value: [100, 599] });
    expect(calls).toContainEqual({ table: 'contacts', operation: 'range', value: [1000, 1499] });
  });

  it('uses one canonical RPC for aliases, filters, counts, and bounded rows without exhaustive fallback', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ ...contactRow, id: `contact-${index}` }));
    const { client, calls } = contactClient(rows);
    const identityMap = {
      hasActiveAliases: async () => true,
      resolveCanonical: async (_scope: WorkspaceScope, id: string) => id,
      listGroupMembers: async (_scope: WorkspaceScope, id: string) => ({
        requestedContactId: id, canonicalContactId: id, memberContactIds: [id], aliasEpoch: 0,
      }),
      resolvePage: async () => { throw new Error('exhaustive alias resolution must not run'); },
    };
    const repository = supabaseRepository(client, scope, identityMap);

    await expect(repository.listPage?.({
      scope: 'leads', query: 'Ada', leadType: 'warm', source: 'other',
      smartListId: '11111111-1111-4111-8111-111111111111', offset: 500, limit: 50,
    })).resolves.toMatchObject({
      total: 1001,
      activeTotal: 1001,
      aliasEpoch: 7,
      scopeCounts: { leads: 1001, all: 1001 },
      items: expect.any(Array),
    });
    expect(calls.filter((call) => call.operation === 'range')).toEqual([]);
    expect(calls.filter((call) => call.operation === 'rpc:list_canonical_contact_page')).toEqual([{
      operation: 'rpc:list_canonical_contact_page',
      value: {
        target_workspace_id: 'workspace-a',
        target_scope: 'leads',
        target_query: 'Ada',
        target_lead_type: 'warm',
        target_source: 'other',
        target_smart_list_id: '11111111-1111-4111-8111-111111111111',
        target_archived_only: false,
        target_offset: 500,
        target_limit: 50,
      },
    }]);
  });

  it('rejects sample authority at the live adapter boundary', () => {
    expect(() => supabaseRepository({} as SupabaseClient, { ...scope, mode: 'sample' }))
      .toThrow(/live workspace scope/i);
  });
});
