import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseImportGateway } from './supabase-import-gateway';

interface Call {
  table: string;
  operation: string;
  value?: unknown;
}

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a',
  ownerUserId: 'owner-a',
  membershipId: 'membership-owner-a',
  workspaceId: 'workspace-a',
  role: 'owner',
  mode: 'live',
};

function importClient() {
  const calls: Call[] = [];
  const receiptRows = new Map<string, Record<string, unknown>>();
  const rpc = async (name: string, value: unknown) => {
    calls.push({ table: 'rpc', operation: name, value });
    const input = value as Record<string, unknown>;
    if (name === 'begin_contact_intake_receipt') {
      const key = String(input.target_idempotency_key);
      if (receiptRows.has(key)) return { data: { receiptId: 'receipt-a', state: 'pending', noOp: true }, error: null };
      receiptRows.set(key, {
        idempotency_key: key, request_hash: input.target_request_hash,
        status_code: 102, response_json: { state: 'pending' }, created_at: input.target_occurred_at,
      });
      return { data: { receiptId: 'receipt-a', state: 'pending', noOp: false }, error: null };
    }
    if (name === 'finalize_contact_intake_receipt') {
      const key = String(input.target_idempotency_key);
      const current = receiptRows.get(key);
      if (!current) return { data: null, error: { message: 'missing placeholder' } };
      receiptRows.set(key, {
        ...current, status_code: input.target_status_code,
        response_json: input.target_response_json,
      });
      return { data: { receiptId: 'receipt-a', state: 'terminal', noOp: false }, error: null };
    }
    if (name === 'resolve_contact_import_identity') {
      return { data: { outcome: 'active-match', contactId: 'contact-a', matchedBy: 'email', matchCount: 1 }, error: null };
    }
    if (name === 'apply_imported_contact_organization') {
      return { data: { runId: 'run-a', contactCount: 2, state: 'applied', noOp: false, rollbackAvailable: true }, error: null };
    }
    if (name === 'rollback_imported_contact_organization') {
      return { data: { runId: 'run-a', contactCount: 2, state: 'rolled-back', noOp: false }, error: null };
    }
    if (name === 'apply_contact_import_plan') {
      const response = {
        state: 'recorded', runId: 'run-plan-a', planHash: 'f'.repeat(64), noOp: false,
        counts: { total: 1, created: 1, updated: 0, unchanged: 0, rejected: 0, quarantined: 0, failed: 0, notesAdded: 0 },
        rowOutcomes: [{ rowNumber: 1, outcome: 'created', contactId: 'contact-plan-a' }],
      };
      receiptRows.set(String(input.target_idempotency_key), {
        idempotency_key: input.target_idempotency_key,
        request_hash: input.target_request_hash,
        status_code: 200,
        response_json: response,
        created_at: input.target_completed_at,
      });
      return {
        data: response,
        error: null,
      };
    }
    return { data: { contactId: 'contact-a', action: 'update', notesAdded: true, noOp: false }, error: null };
  };
  function chain(table: string) {
    return {
      select(value?: unknown) { calls.push({ table, operation: 'select', value }); return this; },
      insert(value?: unknown) { calls.push({ table, operation: 'insert', value }); return this; },
      update(value?: unknown) { calls.push({ table, operation: 'update', value }); return this; },
      delete() { calls.push({ table, operation: 'delete' }); return this; },
      eq(field: string, value: unknown) { calls.push({ table, operation: `eq:${field}`, value }); return this; },
      in(field: string, value: unknown) {
        calls.push({ table, operation: `in:${field}`, value });
        return Promise.resolve({ data: [], error: null });
      },
      maybeSingle() {
        calls.push({ table, operation: 'maybeSingle' });
        const atomicCall = [...calls].reverse().find((call) => call.operation === 'apply_contact_import_group');
        const atomicInput = atomicCall?.value as {
          target_group_idempotency_key?: string;
          target_request_hash?: string;
          target_plan?: { action?: string };
          target_occurred_at?: string;
        } | undefined;
        const receiptRead = table === 'contact_intake_receipts'
          && atomicInput?.target_group_idempotency_key
          && calls.some((call) => call.table === table
            && call.operation === 'eq:idempotency_key'
            && call.value === atomicInput.target_group_idempotency_key);
        const requestedReceiptKey = [...calls].reverse().find((call) => (
          call.table === table && call.operation === 'eq:idempotency_key'
        ))?.value;
        const controlledReceipt = typeof requestedReceiptKey === 'string'
          ? receiptRows.get(requestedReceiptKey)
          : undefined;
        const data = controlledReceipt ?? (receiptRead ? {
          idempotency_key: atomicInput.target_group_idempotency_key,
          request_hash: atomicInput.target_request_hash,
          status_code: 200,
          response_json: {
            contactId: 'contact-a', action: atomicInput.target_plan?.action,
            notesAdded: true, noOp: false,
          },
          created_at: atomicInput.target_occurred_at,
        } : null);
        return Promise.resolve({ data, error: null });
      },
      then(resolve: (value: { data: null; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
  }
  return {
    client: { from(table: string) { return chain(table); }, rpc } as unknown as SupabaseClient,
    calls,
  };
}

describe('supabaseImportGateway workspace scope', () => {
  it('canonicalizes imported donor matches and update plans before persistence', async () => {
    const { client, calls } = importClient();
    const identityMap = {
      resolveCanonical: async (_scope: WorkspaceScope, id: string) => id === 'contact-a' ? 'survivor-a' : id,
      listGroupMembers: async (_scope: WorkspaceScope, id: string) => ({
        requestedContactId: id, canonicalContactId: 'survivor-a',
        memberContactIds: ['survivor-a', id], aliasEpoch: 3,
      }),
      resolvePage: async (_scope: WorkspaceScope, ids: readonly string[]) => (
        new Map(ids.map((id) => [id, id === 'contact-a' ? 'survivor-a' : id]))
      ),
    };
    const gateway = supabaseImportGateway(client, scope, identityMap);
    await expect(gateway.resolveContactImportIdentity?.({
      scope, provider: 'website', email: 'a@example.com',
    })).resolves.toMatchObject({ contactId: 'survivor-a' });
    await gateway.applyContactImportGroup({
      scope, groupIdempotencyKey: 'import-group:alias', requestHash: 'c'.repeat(64),
      plan: {
        action: 'update', contactId: 'contact-a', contact: { city: 'Austin' }, points: [],
        householdIds: [], assigneeMembershipIds: [], customValues: [],
        activityIdempotencyKey: 'contact-imported:survivor-a',
      },
      occurredAt: '2026-08-20T12:00:00.000Z',
    });
    expect(calls.find((call) => call.operation === 'apply_contact_import_group')?.value)
      .toMatchObject({ target_plan: { contactId: 'survivor-a' } });
  });

  it('binds links and idempotency receipts to workspace_id', async () => {
    const { client, calls } = importClient();
    const gateway = supabaseImportGateway(client, scope);
    await gateway.linksFor('website', ['external-a']);
    await gateway.linkContact({ provider: 'website', externalId: 'external-a', contactId: 'contact-a' });
    await gateway.getReceipt('intake-key-a');
    const pending = {
      idempotencyKey: 'intake-key-a',
      requestHash: 'a'.repeat(64),
      statusCode: 102,
      response: {},
      createdAt: '2026-08-11T12:00:00.000Z',
    };
    expect(await gateway.claimReceipt(pending, 'correlation-a')).toBe(true);
    await gateway.completeReceipt({ ...pending, statusCode: 200 }, 'correlation-a');
    await expect(gateway.resolveContactImportIdentity?.({ scope, provider: 'website', externalId: 'external-a', email: 'a@example.com' }))
      .resolves.toMatchObject({ outcome: 'active-match', contactId: 'contact-a', matchedBy: 'email' });
    await expect(gateway.applyContactImportGroup({
      scope,
      groupIdempotencyKey: 'import-group:abc12345',
      requestHash: 'b'.repeat(64),
      plan: {
        action: 'update', contactId: 'contact-a', contact: { city: 'Austin' }, points: [], householdIds: [],
        assigneeMembershipIds: [], customValues: [], activityIdempotencyKey: 'contact-imported:contact-a',
        sourceProfile: {
          provider: 'first-class-real-estate', schemaVersion: 'first-class-real-estate.contact-profile.v1',
          facts: [{ key: 'status', label: 'Status', category: 'other', valueType: 'text', value: 'Client', sourceRowNumber: 2 }],
        },
      },
      occurredAt: '2026-08-11T12:00:00.000Z',
    })).resolves.toMatchObject({
      contactId: 'contact-a', action: 'update', notesAdded: true, noOp: false,
      terminalReceipt: { requestHash: 'b'.repeat(64), statusCode: 200 },
    });

    expect(calls.filter((call) => (
      call.operation === 'eq:workspace_id' && call.value === 'workspace-a'
    )).length).toBeGreaterThanOrEqual(4);
    expect(calls.some((call) => call.operation === 'eq:owner_id')).toBe(false);
    const inserts = calls.filter((call) => call.operation === 'insert');
    expect(inserts).toHaveLength(1);
    for (const call of inserts) {
      expect(call.value).toMatchObject({ workspace_id: 'workspace-a', owner_id: 'owner-a' });
    }
    expect(calls).toContainEqual(expect.objectContaining({ table: 'rpc', operation: 'resolve_contact_import_identity' }));
    expect(calls).toContainEqual(expect.objectContaining({ table: 'rpc', operation: 'apply_contact_import_group' }));
    expect(calls).toContainEqual(expect.objectContaining({ table: 'rpc', operation: 'begin_contact_intake_receipt' }));
    expect(calls).toContainEqual(expect.objectContaining({ table: 'rpc', operation: 'finalize_contact_intake_receipt' }));
    expect(calls.some((call) => ['update', 'delete'].includes(call.operation)
      && call.table === 'contact_intake_receipts')).toBe(false);
    expect(calls.find((call) => call.operation === 'apply_contact_import_group')?.value).toMatchObject({
      target_plan: { sourceProfile: { facts: [expect.objectContaining({ key: 'status', value: 'Client' })] } },
    });
  });

  it('uses owner-scoped batch apply and rollback RPCs', async () => {
    const { client, calls } = importClient();
    const gateway = supabaseImportGateway(client, scope);
    await expect(gateway.applyImportedContactOrganization?.({
      scope, policyVersion: 'omnix.import-classification.v2', requestHash: 'd'.repeat(64),
      changes: [{
        contactId: 'contact-a', expectedUpdatedAt: '2026-08-22T04:00:00.000Z',
        after: { leadType: 'hot', qualificationStatus: 'qualified', relationship: 'lead', intent: 'buyer',
          source: 'referral', pipelineStage: 'active', nextTouchAt: '2026-08-29', touchDateOverridden: false },
      }],
      occurredAt: '2026-08-22T04:30:00.000Z',
    })).resolves.toMatchObject({ runId: 'run-a', rollbackAvailable: true });
    await expect(gateway.rollbackImportedContactOrganization?.({
      scope, runId: 'run-a', requestHash: 'e'.repeat(64), occurredAt: '2026-08-22T04:31:00.000Z',
    })).resolves.toMatchObject({ state: 'rolled-back', rollbackAvailable: false });
    expect(calls).toContainEqual(expect.objectContaining({ table: 'rpc', operation: 'apply_imported_contact_organization' }));
    expect(calls).toContainEqual(expect.objectContaining({ table: 'rpc', operation: 'rollback_imported_contact_organization' }));
  });

  it('invokes the complete import plan RPC once and validates its terminal envelope', async () => {
    const { client, calls } = importClient();
    const gateway = supabaseImportGateway(client, scope);
    const orderedPlan = [{
      rowNumber: 1,
      kind: 'apply' as const,
      groupIdempotencyKey: 'import-group:complete-plan:1',
      requestHash: 'b'.repeat(64),
      plan: {
        action: 'create' as const,
        contact: { firstName: 'Avery', lastName: 'Stone' },
        points: [], householdIds: [], assigneeMembershipIds: [], customValues: [],
        activityIdempotencyKey: 'import:complete-plan:1',
      },
    }];
    await expect(gateway.applyContactImportPlan?.({
      scope,
      idempotencyKey: 'ui:complete-plan',
      requestHash: 'a'.repeat(64),
      source: 'spreadsheet',
      format: 'csv',
      fileHash: 'c'.repeat(64),
      orderedPlan,
      startedAt: '2026-08-25T12:30:00.000Z',
      completedAt: '2026-08-25T12:30:01.000Z',
      correlationId: '59123000-0000-4000-8000-000000000001',
    })).resolves.toMatchObject({
      state: 'recorded',
      counts: { total: 1, created: 1, failed: 0 },
      rowOutcomes: [{ rowNumber: 1, outcome: 'created', contactId: 'contact-plan-a' }],
    });
    expect(calls.filter((call) => call.operation === 'apply_contact_import_plan')).toHaveLength(1);
    expect(calls.find((call) => call.operation === 'apply_contact_import_plan')?.value).toMatchObject({
      target_workspace_id: scope.workspaceId,
      target_actor_membership_id: scope.membershipId,
      target_ordered_plan: orderedPlan,
    });
  });

  it('surfaces an RPC failure without issuing any fallback mutation', async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: null, error: { message: 'injected transaction rollback' } };
      },
      from: () => { throw new Error('fallback table mutation is forbidden'); },
    } as unknown as SupabaseClient;
    const gateway = supabaseImportGateway(client, scope);
    await expect(gateway.applyContactImportPlan?.({
      scope,
      idempotencyKey: 'ui:failed-plan',
      requestHash: 'a'.repeat(64),
      source: 'spreadsheet',
      format: 'csv',
      fileHash: 'b'.repeat(64),
      orderedPlan: [],
      startedAt: '2026-08-25T12:30:00.000Z',
      completedAt: '2026-08-25T12:30:01.000Z',
      correlationId: '59123000-0000-4000-8000-000000000001',
    })).rejects.toThrow(/injected transaction rollback/);
    expect(calls).toEqual(['apply_contact_import_plan']);
  });
});
