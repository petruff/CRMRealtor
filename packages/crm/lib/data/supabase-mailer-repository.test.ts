import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseMailerRepository } from './supabase-mailer-repository';

interface Call {
  table: string;
  operation: string;
  value?: unknown;
}

function clientHarness() {
  const calls: Call[] = [];
  const response = (table: string, operation: string) => {
    if (table === 'mailers' && operation === 'order') {
      return { data: [{ id: 'm-1', name: 'Postcard', notes: null, created_at: '2026-08-10T00:00:00Z' }], error: null };
    }
    if (table === 'mailer_sends' && operation === 'order') {
      return { data: [{ mailer_id: 'm-1', contact_id: 'c-1', sent_on: '2026-08-10' }], error: null };
    }
    if (table === 'mailers' && operation === 'single') {
      return { data: { id: 'm-2', name: 'Created', notes: null, created_at: '2026-08-10T00:00:00Z' }, error: null };
    }
    if (table === 'mailer_sends' && operation === 'maybeSingle') {
      return { data: { mailer_id: 'm-1', contact_id: 'c-1', sent_on: '2026-08-10' }, error: null };
    }
    if (operation === 'maybeSingle') return { data: { id: table === 'mailers' ? 'm-1' : 'c-1' }, error: null };
    return { data: null, error: null };
  };

  function chain(table: string) {
    const query = {
      select(value?: unknown) { calls.push({ table, operation: 'select', value }); return this; },
      insert(value?: unknown) { calls.push({ table, operation: 'insert', value }); return this; },
      upsert(value?: unknown) { calls.push({ table, operation: 'upsert', value }); return this; },
      delete() { calls.push({ table, operation: 'delete' }); return this; },
      eq(field: string, value: unknown) { calls.push({ table, operation: `eq:${field}`, value }); return this; },
      in(field: string, value: unknown) { calls.push({ table, operation: `in:${field}`, value }); return this; },
      order(field: string) {
        calls.push({ table, operation: `order:${field}` });
        return Promise.resolve(response(table, 'order'));
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
    return query;
  }

  const client = {
    from(table: string) { calls.push({ table, operation: 'from' }); return chain(table); },
    rpc(_name: string, input: Record<string, unknown>) {
      return Promise.resolve({ data: { contactId: input.target_contact_id, contactPointId: null, aliasEpoch: 2 }, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const scope: WorkspaceScope = {
  authenticatedUserId: 'assistant-a',
  ownerUserId: 'owner-1',
  membershipId: 'membership-assistant-a',
  workspaceId: 'workspace-a',
  role: 'assistant',
  mode: 'live',
};

describe('supabaseMailerRepository workspace scope', () => {
  it('filters by workspace and retains the owner alias only on inserts', async () => {
    const { client, calls } = clientHarness();
    const repository = supabaseMailerRepository(client, scope);
    expect(await repository.list()).toMatchObject([
      { id: 'm-1', sends: [{ contactId: 'c-1', sentOn: '2026-08-10' }] },
    ]);
    await repository.create({ name: 'Created' });
    await repository.markSent('m-1', 'c-1', '2026-08-10');
    await repository.unmarkSent('m-1', 'c-1');

    const workspaceFilters = calls.filter(
      (call) => call.operation === 'eq:workspace_id' && call.value === 'workspace-a',
    );
    expect(workspaceFilters.length).toBeGreaterThanOrEqual(7);
    expect(calls.some((call) => call.operation === 'eq:owner_id')).toBe(false);
    expect(calls.find((call) => call.operation === 'upsert')?.value).toMatchObject({
      mailer_id: 'm-1',
      contact_id: 'c-1',
      owner_id: 'owner-1',
      workspace_id: 'workspace-a',
    });
    expect(calls.find((call) => call.table === 'mailers' && call.operation === 'insert')?.value)
      .toMatchObject({ owner_id: 'owner-1', workspace_id: 'workspace-a' });
  });
});
