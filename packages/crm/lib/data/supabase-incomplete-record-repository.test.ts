import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseIncompleteRecordRepository } from './supabase-incomplete-record-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};

const pendingRow = {
  id: 'record-a', workspace_id: 'workspace-a', source: 'boldtrail', external_id: 'lead-a',
  candidate: { firstName: 'Ada', email: 'ada@example.com' },
  validation_reasons: [{ field: 'candidate', code: 'incomplete-contact', message: 'Review.' }],
  status: 'pending', intake_idempotency_key: 'intake-a', converted_contact_id: null,
  conversion_action: null, conversion_idempotency_key: null, converted_at: null,
  converted_by_membership_id: null, archived_at: null, archived_by_membership_id: null,
  archive_reason: null, created_at: '2026-08-11T12:00:00.000Z',
  updated_at: '2026-08-11T12:00:00.000Z',
};

function incompleteClient() {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  function query() {
    const builder = {
      select(value?: unknown) { calls.push({ operation: 'select', value }); return this; },
      eq(field: string, value: unknown) { calls.push({ operation: `eq:${field}`, value }); return this; },
      order(field: string) { calls.push({ operation: `order:${field}` }); return this; },
      limit(value: number) {
        calls.push({ operation: 'limit', value });
        return Promise.resolve({ data: [pendingRow], error: null });
      },
      maybeSingle() { return Promise.resolve({ data: pendingRow, error: null }); },
    };
    return builder;
  }
  const client = {
    from() { return query(); },
    rpc(operation: string, value: unknown) {
      calls.push({ operation: `rpc:${operation}`, value });
      if (operation === 'create_incomplete_record') {
        return Promise.resolve({ data: pendingRow, error: null });
      }
      const converted = {
        ...pendingRow, status: 'converted', converted_contact_id: 'contact-a',
        conversion_action: 'create', conversion_idempotency_key: 'convert-a',
        converted_at: '2026-08-11T13:00:00.000Z', converted_by_membership_id: 'membership-a',
      };
      return Promise.resolve({
        data: { record: converted, contactId: 'contact-a', action: 'create', noOp: false },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('supabaseIncompleteRecordRepository', () => {
  it('maps and bounds workspace-scoped quarantine reads', async () => {
    const harness = incompleteClient();
    const records = await supabaseIncompleteRecordRepository(harness.client)
      .list(scope, { status: 'pending', limit: 20 });
    expect(records).toEqual([expect.objectContaining({
      id: 'record-a', workspaceId: 'workspace-a', source: 'boldtrail',
      candidate: { firstName: 'Ada', email: 'ada@example.com' },
    })]);
    expect(harness.calls).toContainEqual({ operation: 'eq:workspace_id', value: 'workspace-a' });
    expect(harness.calls).toContainEqual({ operation: 'limit', value: 500 });
  });

  it('finds a quarantined record by its exact record id', async () => {
    const harness = incompleteClient();
    const records = await supabaseIncompleteRecordRepository(harness.client)
      .list(scope, { status: 'pending', query: 'record-a', limit: 20 });
    expect(records.map((record) => record.id)).toEqual(['record-a']);
  });

  it('derives authority for intake creation and consumes the atomic conversion envelope', async () => {
    const harness = incompleteClient();
    const repository = supabaseIncompleteRecordRepository(harness.client);
    await repository.create(scope, {
      source: 'boldtrail', externalId: 'lead-a', candidate: { firstName: 'Ada' },
      reasons: [{ field: 'candidate', code: 'review', message: 'Review.' }],
      intakeIdempotencyKey: 'intake-a', createdAt: '2026-08-11T12:00:00.000Z',
    });
    expect(harness.calls.find((call) => call.operation === 'rpc:create_incomplete_record')?.value)
      .toMatchObject({
        target_workspace_id: 'workspace-a', target_actor_membership_id: 'membership-a',
        target_intake_idempotency_key: 'intake-a',
      });
    const receipt = await repository.convertAtomically(scope, {
      recordId: 'record-a', candidate: { firstName: 'Ada' },
      plan: { action: 'create', contactInput: {
        firstName: 'Ada', lastName: '', leadType: 'warm', relationship: 'lead', intent: 'unknown',
        source: 'other', pipelineStage: 'new', tags: [], emailSubscribed: true,
        touchDateOverridden: false,
      }, changes: ['firstName'] },
      idempotencyKey: 'convert-a', actorMembershipId: 'membership-a',
      convertedAt: '2026-08-11T13:00:00.000Z',
    });
    expect(receipt).toMatchObject({ contactId: 'contact-a', action: 'create', noOp: false });
    expect(harness.calls.find((call) => call.operation === 'rpc:convert_incomplete_record')?.value)
      .toMatchObject({
        target_record_id: 'record-a', target_actor_membership_id: 'membership-a',
        target_idempotency_key: 'convert-a',
      });
  });

  it('rejects forged conversion actors before calling the database', async () => {
    const harness = incompleteClient();
    await expect(supabaseIncompleteRecordRepository(harness.client).convertAtomically(scope, {
      recordId: 'record-a', candidate: { firstName: 'Ada' },
      plan: { action: 'unchanged', matchedContactId: 'contact-a', changes: [] },
      idempotencyKey: 'convert-a', actorMembershipId: 'membership-b',
      convertedAt: '2026-08-11T13:00:00.000Z',
    })).rejects.toMatchObject({ code: 'forbidden' });
    expect(harness.calls.some((call) => call.operation === 'rpc:convert_incomplete_record')).toBe(false);
  });
});
