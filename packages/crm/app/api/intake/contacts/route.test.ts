import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const harness = vi.hoisted(() => {
  const contacts: Array<Record<string, unknown>> = [];
  const notes: Array<Record<string, unknown>> = [];
  const links: Array<{ provider: string; externalId: string; contactId: string }> = [];
  const incompleteRecords: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const receipts = new Map<string, { idempotencyKey: string; requestHash: string; statusCode: number; response: unknown; createdAt: string }>();
  const state = { failCreate: false };
  const repository = {
    async list() { return [...contacts]; },
    async get(id: string) { return contacts.find((item) => item.id === id); },
    async create(input: Record<string, unknown>) {
      if (state.failCreate) throw new Error('provider unavailable');
      const created = { ...input, id: `route-contact-${contacts.length + 1}`, createdAt: '2026-08-10T00:00:00Z' };
      contacts.push(created);
      return created;
    },
    async update(id: string, patch: Record<string, unknown>) {
      const index = contacts.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('not found');
      contacts[index] = { ...contacts[index], ...patch };
      return contacts[index];
    },
    async remove(id: string) {
      const index = contacts.findIndex((item) => item.id === id);
      if (index >= 0) contacts.splice(index, 1);
    },
    async notesFor(contactId: string) { return notes.filter((item) => item.contactId === contactId); },
    async addNote(contactId: string, body: string) {
      const note = { id: `route-note-${notes.length + 1}`, contactId, body, createdAt: '2026-08-10T00:00:00Z' };
      notes.push(note);
      return note;
    },
    async runTransaction<T>(operation: () => Promise<T>) {
      const contactsBefore = structuredClone(contacts);
      const notesBefore = structuredClone(notes);
      try { return await operation(); }
      catch (error) {
        contacts.splice(0, contacts.length, ...contactsBefore);
        notes.splice(0, notes.length, ...notesBefore);
        throw error;
      }
    },
  };
  const importGateway = {
    async linksFor(provider: string, externalIds: string[]) {
      return links.filter((link) => link.provider === provider && externalIds.includes(link.externalId));
    },
    async linkContact(link: { provider: string; externalId: string; contactId: string }) {
      const existing = links.find((item) => item.provider === link.provider && item.externalId === link.externalId);
      if (existing && existing.contactId !== link.contactId) throw new Error('identity collision');
      if (!existing) links.push(link);
    },
    async getReceipt(key: string) { return receipts.get(key); },
    async claimReceipt(receipt: { idempotencyKey: string; requestHash: string; statusCode: number; response: unknown; createdAt: string }) {
      if (receipts.has(receipt.idempotencyKey)) return false;
      receipts.set(receipt.idempotencyKey, receipt);
      return true;
    },
    async completeReceipt(receipt: { idempotencyKey: string; requestHash: string; statusCode: number; response: unknown; createdAt: string }) {
      receipts.set(receipt.idempotencyKey, receipt);
    },
    async releaseReceipt(key: string, hash: string) {
      if (receipts.get(key)?.requestHash === hash) receipts.delete(key);
    },
    async applyContactImportGroup(command: {
      groupIdempotencyKey: string; requestHash: string; occurredAt: string;
      plan: { action: 'create' | 'update' | 'unchanged'; contactId?: string; contact: Record<string, unknown>;
        externalLink?: { provider: string; externalId: string }; note?: string; activityIdempotencyKey: string };
    }) {
      const known = receipts.get(command.groupIdempotencyKey);
      if (known) {
        if (known.requestHash !== command.requestHash) throw new Error('group conflict');
        return { ...(known.response as Record<string, unknown>), noOp: true };
      }
      const contactsBefore = structuredClone(contacts);
      const notesBefore = structuredClone(notes);
      const linksBefore = structuredClone(links);
      const activitiesBefore = structuredClone(activities);
      try {
        let contactId = command.plan.contactId;
        if (command.plan.action === 'create') contactId = (await repository.create(command.plan.contact)).id as string;
        else if (command.plan.action === 'update' && contactId) await repository.update(contactId, command.plan.contact);
        if (!contactId) throw new Error('missing target');
        if (command.plan.externalLink) await importGateway.linkContact({ ...command.plan.externalLink, contactId });
        let notesAdded = false;
        if (command.plan.note && !(await repository.notesFor(contactId)).some((item) => item.body === command.plan.note)) {
          await repository.addNote(contactId, command.plan.note); notesAdded = true;
        }
        if (command.plan.action === 'create') await activityRepository.appendEvent(null, { type: 'contact-created', contactId, idempotencyKey: `contact-created:${contactId}` });
        await activityRepository.appendEvent(null, { type: 'contact-imported', contactId, idempotencyKey: command.plan.activityIdempotencyKey });
        const response = { contactId, action: command.plan.action, notesAdded, noOp: false };
        receipts.set(command.groupIdempotencyKey, { idempotencyKey: command.groupIdempotencyKey,
          requestHash: command.requestHash, statusCode: 200, response, createdAt: command.occurredAt });
        return response;
      } catch (error) {
        contacts.splice(0, contacts.length, ...contactsBefore);
        notes.splice(0, notes.length, ...notesBefore);
        links.splice(0, links.length, ...linksBefore);
        activities.splice(0, activities.length, ...activitiesBefore);
        throw error;
      }
    },
  };
  const workspaceScope = {
    authenticatedUserId: 'route-owner',
    ownerUserId: 'route-owner',
    membershipId: 'route-membership',
    workspaceId: 'route-workspace',
    role: 'owner' as const,
    mode: 'live' as const,
  };
  const incompleteRecordRepository = {
    async create(_scope: unknown, input: Record<string, unknown>) {
      const key = input.intakeIdempotencyKey;
      const existing = incompleteRecords.find((record) => record.intakeIdempotencyKey === key);
      if (existing) return existing;
      const record = { ...input, id: `incomplete-${incompleteRecords.length + 1}`, status: 'pending' };
      incompleteRecords.push(record);
      return record;
    },
  };
  const activityRepository = {
    async appendEvent(_scope: unknown, input: Record<string, unknown>) {
      const existing = activities.find((event) => event.idempotencyKey === input.idempotencyKey);
      if (existing) return { event: existing, noOp: true };
      const event = { ...input, id: `activity-${activities.length + 1}`, workspaceId: workspaceScope.workspaceId };
      activities.push(event);
      return { event, noOp: false };
    },
  };
  return {
    contacts,
    links,
    incompleteRecords,
    activities,
    receipts,
    state,
    repository,
    importGateway,
    incompleteRecordRepository,
    activityRepository,
    workspaceScope,
    reset() {
      contacts.length = 0;
      notes.length = 0;
      links.length = 0;
      incompleteRecords.length = 0;
      activities.length = 0;
      receipts.clear();
      state.failCreate = false;
    },
  };
});

vi.mock('@/lib/data/automation-context', () => ({
  createAutomationContext: () => ({
    repository: harness.repository,
    importGateway: harness.importGateway,
    incompleteRecordRepository: harness.incompleteRecordRepository,
    activityRepository: harness.activityRepository,
    workspaceScope: harness.workspaceScope,
  }),
}));

import { requestHash } from '@/lib/application/intake-security';
import { POST } from './route';

const TOKEN = 'route-test-token-at-least-24-characters';

function intakeRequest(body: string, key = 'route:test-key', token = TOKEN, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/intake/contacts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': key,
      ...headers,
    },
    body,
  });
}

beforeEach(() => {
  harness.reset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://route-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'route-service-role';
  process.env.OMNIX_INTAKE_OWNER_ID = '123e4567-e89b-42d3-a456-426614174000';
  process.env.OMNIX_INTAKE_TOKEN = TOKEN;
});

describe('POST /api/intake/contacts', () => {
  it('fails closed when live configuration is incomplete', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const response = await POST(intakeRequest('{}'));
    expect(response.status).toBe(503);
  });

  it('rejects unauthorized and oversized requests before persistence', async () => {
    expect((await POST(intakeRequest('{}', 'route:unauth', 'wrong-token'))).status).toBe(401);
    const oversized = await POST(intakeRequest('{}', 'route:oversize', TOKEN, { 'content-length': '256001' }));
    expect(oversized.status).toBe(413);
    expect(harness.contacts).toHaveLength(0);
  });

  it('requires a bounded external ID on every automatic contact', async () => {
    const body = JSON.stringify({ source: 'website', contacts: [{ firstName: 'Avery' }] });
    const response = await POST(intakeRequest(body, 'route:missing-external'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ rows: [1] });

    const oversizedId = JSON.stringify({ source: 'website', contacts: [{ externalId: 'x'.repeat(256), firstName: 'Avery' }] });
    const oversizedResponse = await POST(intakeRequest(oversizedId, 'route:oversized-external'));
    expect(oversizedResponse.status).toBe(422);
    await expect(oversizedResponse.json()).resolves.toMatchObject({
      rejected: [{ rowNumber: 1, errors: ['External ID must be 255 characters or fewer.'] }],
      quarantined: 1,
    });
    expect(harness.incompleteRecords).toHaveLength(1);
    expect(harness.incompleteRecords[0]).not.toHaveProperty('externalId');

    const replay = await POST(intakeRequest(oversizedId, 'route:oversized-external'));
    expect(replay.status).toBe(422);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(harness.incompleteRecords).toHaveLength(1);
  });

  it('creates once, replays the exact receipt, and rejects a conflicting key reuse', async () => {
    const body = JSON.stringify({ source: 'website', contacts: [{ externalId: 'web-101', firstName: 'Avery', email: 'avery@example.com' }] });
    const first = await POST(intakeRequest(body, 'route:replay-101'));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true, created: 1 });
    const replay = await POST(intakeRequest(body, 'route:replay-101'));
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(harness.contacts).toHaveLength(1);
    expect(harness.activities.map((event) => event.type).sort()).toEqual([
      'contact-created',
      'contact-imported',
    ]);

    const conflictingBody = JSON.stringify({ source: 'website', contacts: [{ externalId: 'web-102', firstName: 'Morgan' }] });
    expect((await POST(intakeRequest(conflictingBody, 'route:replay-101'))).status).toBe(409);
  });

  it('returns the in-progress receipt for a concurrent exact replay', async () => {
    const body = JSON.stringify({ source: 'website', contacts: [{ externalId: 'web-201', firstName: 'River' }] });
    harness.receipts.set('route:processing-201', {
      idempotencyKey: 'route:processing-201',
      requestHash: requestHash(body),
      statusCode: 202,
      response: { ok: false, message: 'Intake request is processing.' },
      createdAt: '2026-08-10T00:00:00Z',
    });
    const response = await POST(intakeRequest(body, 'route:processing-201'));
    expect(response.status).toBe(202);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('returns structured partial failure and completes its receipt on provider failure', async () => {
    harness.state.failCreate = true;
    const body = JSON.stringify({ source: 'website', contacts: [{ externalId: 'web-fail-301', firstName: 'Fail' }] });
    const response = await POST(intakeRequest(body, 'route:provider-failure'));
    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toMatchObject({ ok: false, created: 0, failed: 1 });
    expect(harness.receipts.get('route:provider-failure')?.statusCode).toBe(207);
  });

  it('rejects malformed JSON and oversized batches', async () => {
    expect((await POST(intakeRequest('{', 'route:malformed'))).status).toBe(400);
    const batch = JSON.stringify({ source: 'website', contacts: Array.from({ length: 51 }, (_, index) => ({ externalId: `web-${index}`, firstName: 'A' })) });
    expect((await POST(intakeRequest(batch, 'route:batch-limit'))).status).toBe(422);
  });
});
