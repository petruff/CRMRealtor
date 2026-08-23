import { describe, expect, it } from 'vitest';
import type { Contact, Note } from '@/lib/domain/contact';
import type { ContactRepository } from '@/lib/data/repository';
import { memoryImportGateway } from '@/lib/data/import-gateway';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { createMemoryIncompleteRecordRepository } from '@/lib/data/memory-incomplete-record-repository';
import { createMemoryRichContactRepository } from '@/lib/data/memory-rich-contact-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { executeContactImport, previewContactImport } from './contact-import-service';
import { parseContactImport, parseJsonContactImport } from './contact-import';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function contact(patch: Partial<Contact> = {}): Contact {
  return {
    id: 'existing-1',
    firstName: 'Jamie',
    lastName: 'Rivera',
    phone: '555-010-1000',
    email: 'jamie@example.com',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'unknown',
    source: 'other',
    pipelineStage: 'new',
    touchDateOverridden: false,
    tags: ['Client'],
    emailSubscribed: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

function repository(seed: Contact[] = []) {
  const contacts = [...seed];
  const notes: Note[] = [];
  const repo: ContactRepository = {
    async list() { return [...contacts]; },
    async get(id) { return contacts.find((item) => item.id === id); },
    async create(input) {
      const created: Contact = { ...input, id: `created-${contacts.length + 1}`, createdAt: '2026-08-10T12:00:00.000Z' };
      contacts.push(created);
      return created;
    },
    async update(id, patch) {
      const index = contacts.findIndex((item) => item.id === id);
      if (index < 0 || !contacts[index]) throw new Error('not found');
      contacts[index] = { ...contacts[index], ...patch } as Contact;
      return contacts[index];
    },
    async remove(id) {
      const index = contacts.findIndex((item) => item.id === id);
      if (index >= 0) contacts.splice(index, 1);
    },
    async notesFor(contactId) { return notes.filter((note) => note.contactId === contactId); },
    async addNote(contactId, body) {
      const note = { id: `note-${notes.length + 1}`, contactId, body, createdAt: '2026-08-10T12:00:00.000Z' };
      notes.push(note);
      return note;
    },
    async runTransaction<T>(operation: () => Promise<T>) {
      const contactsBefore = structuredClone(contacts);
      const notesBefore = structuredClone(notes);
      try {
        return await operation();
      } catch (error) {
        contacts.splice(0, contacts.length, ...contactsBefore);
        notes.splice(0, notes.length, ...notesBefore);
        throw error;
      }
    },
  };
  return { repo, contacts, notes };
}

describe('contact import service', () => {
  it('matches email conservatively, fills empty fields, unions tags, and preserves names', async () => {
    const state = repository([contact({ firstName: 'Existing', city: undefined })]);
    const parsed = parseJsonContactImport({
      source: 'mailchimp',
      contacts: [{ firstName: 'Imported', lastName: 'Name', email: 'JAMIE@example.com', city: 'Austin', tags: 'VIP', emailSubscribed: 'false' }],
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    expect(preview.rows[0]).toMatchObject({ action: 'update', matchBy: 'email', changes: ['city', 'tags', 'emailSubscribed'] });
    const result = await executeContactImport(state.repo, gateway, preview);
    expect(result).toMatchObject({ ok: true, updated: 1, created: 0 });
    expect(state.contacts[0]).toMatchObject({ firstName: 'Existing', city: 'Austin', tags: ['Client', 'VIP'], emailSubscribed: false });
  });

  it('applies reviewed realtor organization fields to an existing matched contact', async () => {
    const state = repository([contact({
      email: 'existing@example.com', leadType: 'nurture', relationship: 'lead',
      intent: 'unknown', source: 'other', pipelineStage: 'new',
    })]);
    const parsed = parseContactImport({
      filename: 'contacts-omnix.csv',
      content: [
        'First Name,Email,Lead Type,Relationship,Intent,Source,Pipeline Stage,Tags',
        'Jamie,existing@example.com,Hot,client,seller,lead import,client,nurture',
      ].join('\n'),
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(state.repo, gateway, parsed);

    expect(preview.rows[0]).toMatchObject({
      action: 'update', matchBy: 'email',
      candidate: {
        leadType: 'hot', relationship: 'active-client', intent: 'seller',
        source: 'other', pipelineStage: 'closed', qualificationStatus: 'qualified',
      },
      changes: expect.arrayContaining(['leadType', 'qualificationStatus', 'relationship', 'intent', 'pipelineStage']),
    });

    const result = await executeContactImport(state.repo, gateway, preview, NOW);
    expect(result).toMatchObject({ ok: true, updated: 1, created: 0 });
    expect(state.contacts[0]).toMatchObject({
      firstName: 'Jamie', leadType: 'hot', relationship: 'active-client', intent: 'seller',
      source: 'other', pipelineStage: 'closed', qualificationStatus: 'qualified',
    });
  });

  it('keeps a pipeline stage edited by a person and reports the protected conflict', async () => {
    const state = repository([contact({ pipelineStage: 'active' })]);
    const activityRepository = createMemoryActivityRepository();
    await activityRepository.appendEvent(SAMPLE_WORKSPACE_SCOPE, {
      type: 'contact-updated',
      contactId: 'existing-1',
      actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
      occurredAt: '2026-08-09T12:00:00.000Z',
      idempotencyKey: 'contact-updated:existing-1:manual',
    });
    const parsed = parseContactImport({
      filename: 'status-reconciliation.csv',
      content: 'First Name,Email,Pipeline Stage\nJamie,jamie@example.com,client',
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(
      state.repo,
      gateway,
      parsed,
      SAMPLE_WORKSPACE_SCOPE,
      activityRepository,
    );

    expect(preview.counts.protected).toBe(1);
    expect(preview.rows[0]).toMatchObject({ protectedFields: ['pipelineStage'] });
    expect(preview.rows[0]?.patch).not.toHaveProperty('pipelineStage');

    const result = await executeContactImport(state.repo, gateway, preview, NOW);
    expect(result.protected).toBe(1);
    expect(result.rowOutcomes[0]).toMatchObject({
      outcome: 'updated',
      errorCode: 'manual-pipeline-stage-protected',
    });
    expect(state.contacts[0]?.pipelineStage).toBe('active');
  });

  it('allows an import-managed stage to be corrected on re-import', async () => {
    const state = repository([contact({ pipelineStage: 'active' })]);
    const activityRepository = createMemoryActivityRepository();
    await activityRepository.appendEvent(SAMPLE_WORKSPACE_SCOPE, {
      type: 'contact-updated',
      contactId: 'existing-1',
      actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
      occurredAt: '2026-08-09T12:00:00.000Z',
      idempotencyKey: 'contact-import-updated:existing-1:prior-import',
    });
    const parsed = parseContactImport({
      filename: 'status-reconciliation.csv',
      content: 'First Name,Email,Pipeline Stage\nJamie,jamie@example.com,client',
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(
      state.repo,
      gateway,
      parsed,
      SAMPLE_WORKSPACE_SCOPE,
      activityRepository,
    );

    expect(preview.counts.protected).toBe(0);
    expect(preview.rows[0]?.patch).toMatchObject({ pipelineStage: 'closed' });
  });

  it('uses the canonical identity resolver so additional contact points cannot create duplicates', async () => {
    const existing = contact({ id: 'contact-with-secondary-email', email: 'primary@example.com' });
    const state = repository([existing]);
    const base = memoryImportGateway({ repository: state.repo });
    const gateway = {
      ...base,
      async resolveContactImportIdentity() {
        return {
          outcome: 'active-match' as const,
          contactId: existing.id,
          matchedBy: 'email' as const,
          matchCount: 1,
        };
      },
    };
    const parsed = parseJsonContactImport({
      source: 'mailchimp',
      contacts: [{ firstName: 'Jamie', email: 'secondary@example.com', city: 'Round Rock' }],
    });

    const preview = await previewContactImport(
      state.repo,
      gateway,
      parsed,
      SAMPLE_WORKSPACE_SCOPE,
    );

    expect(preview.rows[0]).toMatchObject({
      action: 'update',
      contactId: existing.id,
      matchBy: 'email',
    });
    expect(preview.counts.create).toBe(0);
  });

  it('keeps reduced KvCore imports on canonical external-id, email, and phone duplicate resolution', async () => {
    const existing = contact({ id: 'kvcore-existing', email: 'primary@example.com' });
    const state = repository([existing]);
    const base = memoryImportGateway({ repository: state.repo });
    let identityInput: Parameters<NonNullable<typeof base.resolveContactImportIdentity>>[0] | undefined;
    const gateway = {
      ...base,
      async resolveContactImportIdentity(input: Parameters<NonNullable<typeof base.resolveContactImportIdentity>>[0]) {
        identityInput = input;
        return {
          outcome: 'active-match' as const,
          contactId: existing.id,
          matchedBy: 'external-id' as const,
          matchCount: 1,
        };
      },
    };
    const parsed = parseContactImport({
      filename: 'realtor-cleaned.csv',
      content: [
        'Email,Cell Phone 1,Deal Type,Status,Rating,Contact Id,First Name,Last Name',
        'secondary@example.com,+1 (512) 555-0114,buyer,Active Lead,3,kv-identity-1,Jamie,Rivera',
      ].join('\n'),
    });

    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);

    expect(identityInput).toMatchObject({
      scope: SAMPLE_WORKSPACE_SCOPE,
      provider: 'first-class-real-estate',
      externalId: 'kv-identity-1',
      email: 'secondary@example.com',
      phone: '5125550114',
    });
    expect(preview.rows[0]).toMatchObject({
      action: 'unchanged', contactId: existing.id, matchBy: 'external-id',
    });
    expect(preview.counts.create).toBe(0);
  });

  it.each([
    ['ambiguous-identity' as const, undefined, 'ambiguous-identity' as const],
    ['archived-match' as const, 'existing-1', 'archived-match' as const],
  ])('keeps canonical %s identity results review-only', async (outcome, contactId, action) => {
    const existing = contact({ archivedAt: outcome === 'archived-match' ? '2026-08-09T00:00:00.000Z' : undefined });
    const state = repository([existing]);
    const base = memoryImportGateway({ repository: state.repo });
    const gateway = {
      ...base,
      async resolveContactImportIdentity() {
        return {
          outcome,
          ...(contactId ? { contactId } : {}),
          matchedBy: 'phone' as const,
          matchCount: outcome === 'ambiguous-identity' ? 2 : 1,
        };
      },
    };
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [{ firstName: 'Jamie', phone: '555-010-9999' }],
    });

    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);
    expect(preview.rows[0]).toMatchObject({ action, matchBy: 'phone' });
    const result = await executeContactImport(state.repo, gateway, preview, NOW);
    expect(result).toMatchObject({ created: 0, updated: 0, failed: 0 });
    expect(state.contacts).toHaveLength(1);
  });

  it('resolves a real secondary email through the memory canonical contact-point repository', async () => {
    const existing = contact({ id: 'contact-secondary-email', email: 'primary@example.com' });
    const state = repository([existing]);
    const rich = createMemoryRichContactRepository({
      contactRepository: state.repo,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
    });
    await rich.addContactPoint(SAMPLE_WORKSPACE_SCOPE, {
      contactId: existing.id, type: 'email', label: 'Personal', displayValue: 'secondary@example.com',
      normalizedValue: 'secondary@example.com', isPrimary: false, emailSubscribed: true, displayOrder: 1,
      actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId, occurredAt: NOW.toISOString(),
    });
    const gateway = memoryImportGateway({ repository: state.repo, richContactRepository: rich });
    const parsed = parseJsonContactImport({ source: 'mailchimp', contacts: [
      { firstName: 'Jamie', email: 'SECONDARY@example.com', city: 'Round Rock' },
    ] });

    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);

    expect(preview.rows[0]).toMatchObject({
      action: 'update', contactId: existing.id, matchBy: 'email',
    });
    expect(preview.counts.create).toBe(0);
  });

  it('fails closed when a real third phone is shared by two memory contacts', async () => {
    const first = contact({ id: 'contact-shared-phone-a', phone: '555-010-1001' });
    const second = contact({ id: 'contact-shared-phone-b', phone: '555-010-1002' });
    const state = repository([first, second]);
    const rich = createMemoryRichContactRepository({
      contactRepository: state.repo,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
    });
    for (const existing of [first, second]) {
      await rich.addContactPoint(SAMPLE_WORKSPACE_SCOPE, {
        contactId: existing.id, type: 'phone', label: 'Other', displayValue: '(614) 555-0199',
        normalizedValue: '6145550199', isPrimary: false, displayOrder: 2,
        actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId, occurredAt: NOW.toISOString(),
      });
    }
    const gateway = memoryImportGateway({ repository: state.repo, richContactRepository: rich });
    const parsed = parseJsonContactImport({ source: 'website', contacts: [
      { firstName: 'Shared', phone: '614-555-0199', city: 'Austin' },
    ] });

    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);
    const result = await executeContactImport(state.repo, gateway, preview, NOW);

    expect(preview.rows[0]).toMatchObject({ action: 'ambiguous-identity', matchBy: 'phone' });
    expect(result).toMatchObject({ created: 0, updated: 0, ambiguousIdentities: 1 });
    expect(state.contacts).toHaveLength(2);
  });

  it('routes an archived non-primary point to review without mutation', async () => {
    const existing = contact({
      id: 'contact-archived-point', email: 'primary@example.com',
      archivedAt: '2026-08-09T00:00:00.000Z',
    });
    const state = repository([existing]);
    const rich = createMemoryRichContactRepository({
      contactRepository: state.repo,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
    });
    await rich.addContactPoint(SAMPLE_WORKSPACE_SCOPE, {
      contactId: existing.id, type: 'email', label: 'Previous', displayValue: 'archived-secondary@example.com',
      normalizedValue: 'archived-secondary@example.com', isPrimary: false, emailSubscribed: false, displayOrder: 1,
      actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId, occurredAt: NOW.toISOString(),
    });
    const gateway = memoryImportGateway({ repository: state.repo, richContactRepository: rich });
    const parsed = parseJsonContactImport({ source: 'mailchimp', contacts: [
      { firstName: 'Jamie', email: 'archived-secondary@example.com', city: 'Austin' },
    ] });

    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);
    const result = await executeContactImport(state.repo, gateway, preview, NOW);

    expect(preview.rows[0]).toMatchObject({
      action: 'archived-match', contactId: existing.id, matchBy: 'email',
    });
    expect(result).toMatchObject({ created: 0, updated: 0, archivedMatches: 1 });
    expect(state.contacts[0]?.city).toBeUndefined();
  });

  it('collapses duplicates inside one batch and remains idempotent by external ID', async () => {
    const state = repository();
    const gateway = memoryImportGateway({ repository: state.repo });
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [
        { externalId: 'lead-unique-991', firstName: 'River', email: 'river-991@example.com', note: 'Asked for a showing' },
        { externalId: 'lead-second-991', firstName: 'River', email: 'river-991@example.com', phone: '5550102991', note: 'Asked for a showing' },
      ],
    });
    const firstPreview = await previewContactImport(state.repo, gateway, parsed);
    expect(firstPreview.counts).toMatchObject({ create: 1, merge: 1 });
    const first = await executeContactImport(state.repo, gateway, firstPreview);
    expect(first).toMatchObject({ created: 1, merged: 1, notesAdded: 1, failed: 0 });
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]?.phone).toBe('5550102991');
    expect(state.notes).toHaveLength(1);

    const secondPreview = await previewContactImport(state.repo, gateway, parsed);
    expect(secondPreview.counts.create).toBe(0);
    const second = await executeContactImport(state.repo, gateway, secondPreview);
    expect(second.created).toBe(0);
    expect(second.notesAdded).toBe(0);
    expect(state.contacts).toHaveLength(1);
    expect(state.notes).toHaveLength(1);
  });

  it('reports row failures without discarding successful rows', async () => {
    const state = repository();
    let creates = 0;
    const originalCreate = state.repo.create;
    state.repo.create = async (input) => {
      creates += 1;
      if (creates === 2) throw new Error('database refused row');
      return originalCreate(input);
    };
    const parsed = parseJsonContactImport({
      source: 'platform',
      contacts: [{ firstName: 'One' }, { firstName: 'Two' }],
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    const result = await executeContactImport(state.repo, gateway, preview);
    expect(result).toMatchObject({ ok: false, created: 1, failed: 1 });
    expect(result.errors[0]?.message).toBe('database refused row');
  });

  it('requires an explicit restore when identity resolves to one archived contact', async () => {
    const state = repository([contact({ archivedAt: '2026-08-09T12:00:00.000Z' })]);
    const parsed = parseJsonContactImport({
      source: 'platform',
      contacts: [{ firstName: 'Jamie', email: 'JAMIE@example.com', city: 'Austin' }],
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    expect(preview.rows[0]).toMatchObject({ action: 'archived-match', matchBy: 'email', contactId: 'existing-1' });
    expect(preview.counts['archived-match']).toBe(1);
    const result = await executeContactImport(state.repo, gateway, preview);
    expect(result).toMatchObject({ ok: false, archivedMatches: 1, created: 0, updated: 0 });
    expect(state.contacts[0]).toMatchObject({ archivedAt: '2026-08-09T12:00:00.000Z' });
    expect(state.contacts[0]?.city).toBeUndefined();
  });

  it('does not mutate when a shared identity resolves to multiple contacts', async () => {
    const state = repository([
      contact({ id: 'shared-a', email: 'shared@example.com' }),
      contact({ id: 'shared-b', firstName: 'Taylor', email: 'shared@example.com' }),
    ]);
    const parsed = parseJsonContactImport({
      source: 'platform',
      contacts: [{ firstName: 'Shared', email: 'shared@example.com', city: 'Austin' }],
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    expect(preview.rows[0]).toMatchObject({ action: 'ambiguous-identity', matchBy: 'email' });
    expect(preview.counts['ambiguous-identity']).toBe(1);
    const result = await executeContactImport(state.repo, gateway, preview);
    expect(result).toMatchObject({ ok: false, ambiguousIdentities: 1, created: 0, updated: 0 });
    expect(state.contacts.every((item) => item.city === undefined)).toBe(true);
  });

  it('collapses two rows targeting the same existing contact before filling gaps', async () => {
    const state = repository([contact({ city: undefined, state: undefined })]);
    const parsed = parseJsonContactImport({
      source: 'platform',
      contacts: [
        { externalId: 'existing-a', firstName: 'Jamie', email: 'jamie@example.com', city: 'Austin' },
        { externalId: 'existing-b', firstName: 'Jamie', email: 'jamie@example.com', city: 'Dallas', state: 'TX' },
      ],
    });
    const gateway = memoryImportGateway({ repository: state.repo });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    expect(preview.counts).toMatchObject({ update: 1, merge: 1 });
    expect(preview.rows[0]?.patch).toMatchObject({ city: 'Austin', state: 'TX' });
    const result = await executeContactImport(state.repo, gateway, preview);
    expect(result).toMatchObject({ updated: 1, merged: 1, failed: 0 });
    expect(state.contacts[0]).toMatchObject({ city: 'Austin', state: 'TX' });
  });

  it('removes a newly created contact when its external identity cannot be linked', async () => {
    const state = repository();
    const activityRepository = createMemoryActivityRepository();
    const gateway = memoryImportGateway({ repository: state.repo, activityRepository });
    await gateway.linkContact({ provider: 'website', externalId: 'collision-771', contactId: 'another-contact' });
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [{ externalId: 'collision-771', firstName: 'Avery' }],
    });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    const result = await executeContactImport(state.repo, gateway, preview, NOW, {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      activityRepository,
      idempotencyKeyBase: 'collision-771',
    });
    expect(result).toMatchObject({ ok: false, created: 0, failed: 1 });
    expect(state.contacts).toHaveLength(0);
    expect(await activityRepository.listEvents(SAMPLE_WORKSPACE_SCOPE, { limit: 100 })).toHaveLength(0);
  });

  it('quarantines safe invalid rows and records import activity once on replay', async () => {
    const state = repository();
    const incompleteRecordRepository = createMemoryIncompleteRecordRepository();
    const activityRepository = createMemoryActivityRepository();
    const gateway = memoryImportGateway({ repository: state.repo, activityRepository });
    const context = {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository,
      activityRepository,
      idempotencyKeyBase: 'file-content-digest-991',
    };
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [
        { externalId: 'valid-991', firstName: 'Jordan', email: 'jordan-991@example.com' },
        { externalId: 'invalid-991', firstName: 'Avery', email: 'not-an-email' },
        { birthdate: 'not-a-date' },
      ],
    });
    const firstPreview = await previewContactImport(state.repo, gateway, parsed);
    const first = await executeContactImport(state.repo, gateway, firstPreview, NOW, context);
    expect(first).toMatchObject({ created: 1, rejected: 2, quarantined: 1, failed: 0 });

    const pending = await incompleteRecordRepository.list(SAMPLE_WORKSPACE_SCOPE, {
      status: 'pending',
      limit: 100,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ externalId: 'invalid-991', source: 'website' });

    const secondPreview = await previewContactImport(state.repo, gateway, parsed);
    const second = await executeContactImport(state.repo, gateway, secondPreview, NOW, context);
    expect(second).toMatchObject({ created: 0, rejected: 2, quarantined: 1, failed: 0 });
    expect(await incompleteRecordRepository.list(SAMPLE_WORKSPACE_SCOPE, {
      status: 'pending',
      limit: 100,
    })).toHaveLength(1);

    const events = await activityRepository.listEvents(SAMPLE_WORKSPACE_SCOPE, { limit: 100 });
    expect(events.map((event) => event.type).sort()).toEqual([
      'contact-created',
      'contact-imported',
    ]);
  });

  it('preserves every First Class source column as an imported profile value', async () => {
    const state = repository();
    const activityRepository = createMemoryActivityRepository();
    const rich = createMemoryRichContactRepository({
      contactRepository: state.repo,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
      activityRepository,
    });
    const gateway = memoryImportGateway({ repository: state.repo, richContactRepository: rich, activityRepository });
    const headers = ['Contact Id','First Name','Last Name','Email','Cell Phone 1','Status','Deal Type','Assigned Agent ID','TCPA Optin Date','Rating','Email Optin','Spouse First Name'];
    const values = ['fc-1','Judith','Serna','judith@example.com','+1 555 123 4567','Client','buyer','agent-1','2025-01-01','5','1','Alex'];
    const content = [headers, values].map((row) => row.map((value) => `"${value}"`).join(',')).join('\n');
    const parsed = parseContactImport({ filename: 'first-class.csv', content });
    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);
    const result = await executeContactImport(state.repo, gateway, preview, NOW, {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      activityRepository,
      richContactRepository: rich,
      idempotencyKeyBase: 'first-class-fixture',
    });

    expect(preview).toMatchObject({
      provider: 'first-class-real-estate',
      preservedFields: headers,
      unknownFields: [],
      classificationCounts: { automatic: 1, explicit: 0, needsReview: 0 },
    });
    expect(preview.rows[0]).toMatchObject({
      candidate: {
        leadType: 'hot', relationship: 'active-client', pipelineStage: 'active',
        qualificationStatus: 'qualified', intent: 'buyer',
      },
      classification: { mode: 'automatic', needsReview: false },
    });
    expect(result).toMatchObject({ ok: true, created: 1, rejected: 0, failed: 0 });
    expect(await rich.listCustomFieldDefinitions(SAMPLE_WORKSPACE_SCOPE)).toEqual([]);
    const saved = await rich.listContactImportSourceFacts(SAMPLE_WORKSPACE_SCOPE, state.contacts[0]!.id);
    expect(saved).toHaveLength(values.length);
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'spouse-first-name', category: 'identity', valueType: 'text', value: 'Alex' }),
      expect.objectContaining({ key: 'tcpa-optin-date', category: 'consent', valueType: 'timestamp' }),
      expect.objectContaining({ key: 'rating', category: 'engagement', valueType: 'number', value: 5 }),
    ]));
    expect(state.contacts[0]).toMatchObject({
      emailSubscribed: false,
      leadType: 'hot', relationship: 'active-client', pipelineStage: 'active',
      qualificationStatus: 'qualified', intent: 'buyer',
    });

    const replay = await executeContactImport(state.repo, gateway, preview, NOW, {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      activityRepository,
      richContactRepository: rich,
      idempotencyKeyBase: 'first-class-fixture',
    });
    expect(replay).toMatchObject({ ok: true, created: 0, unchanged: 1, failed: 0 });
    expect(await rich.listContactImportSourceFacts(SAMPLE_WORKSPACE_SCOPE, state.contacts[0]!.id)).toHaveLength(values.length);
  });

  it('does not mutate an existing First Class client and reports the identity as already existing', async () => {
    const existing = contact({
      firstName: 'Judith', lastName: 'Serna', email: 'judith@example.com', city: undefined,
    });
    const state = repository([existing]);
    const activityRepository = createMemoryActivityRepository();
    const rich = createMemoryRichContactRepository({
      contactRepository: state.repo,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
      activityRepository,
    });
    const gateway = memoryImportGateway({ repository: state.repo, richContactRepository: rich, activityRepository });
    const parsed = parseContactImport({
      filename: 'first-class.csv',
      content: [
        'Contact Id,First Name,Last Name,Email,Cell Phone 1,Primary City,Status,Deal Type,Assigned Agent ID,TCPA Optin Date,Rating,Email Optin',
        'fc-existing,Imported,Name,judith@example.com,5551234567,Austin,Client,buyer,agent-1,2025-01-01,5,1',
      ].join('\n'),
    });
    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);
    const result = await executeContactImport(state.repo, gateway, preview, NOW, {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      activityRepository,
      richContactRepository: rich,
      idempotencyKeyBase: 'first-class-existing-client',
    });

    expect(preview.rows[0]).toMatchObject({
      action: 'unchanged', matchBy: 'email', contactId: existing.id, changes: [],
    });
    expect(result).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 1, failed: 0 });
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({ firstName: 'Judith', lastName: 'Serna', city: undefined });
    expect(await rich.listCustomFieldValues(SAMPLE_WORKSPACE_SCOPE, existing.id)).toEqual([]);
    expect(await activityRepository.listEvents(SAMPLE_WORKSPACE_SCOPE, { limit: 100 })).toEqual([
      expect.objectContaining({ type: 'contact-imported', contactId: existing.id }),
    ]);
    expect(await rich.listContactImportSourceFacts(SAMPLE_WORKSPACE_SCOPE, existing.id)).toHaveLength(12);
  });

  it('imports only the first First Class row when the workbook repeats the same client', async () => {
    const state = repository();
    const activityRepository = createMemoryActivityRepository();
    const rich = createMemoryRichContactRepository({
      contactRepository: state.repo,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
      activityRepository,
    });
    const gateway = memoryImportGateway({ repository: state.repo, richContactRepository: rich, activityRepository });
    const header = 'Contact Id,First Name,Last Name,Email,Cell Phone 1,Primary City,Status,Deal Type,Assigned Agent ID,TCPA Optin Date,Rating,Email Optin';
    const parsed = parseContactImport({
      filename: 'first-class.csv',
      content: [
        header,
        'fc-new,First,Client,first@example.com,5551234567,Miami,Client,buyer,agent-1,2025-01-01,5,1',
        'fc-new,Changed,Name,first@example.com,5551234567,Austin,Client,buyer,agent-1,2025-01-01,1,0',
      ].join('\n'),
    });
    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);
    const result = await executeContactImport(state.repo, gateway, preview, NOW, {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      activityRepository,
      richContactRepository: rich,
      idempotencyKeyBase: 'first-class-duplicate-row',
    });

    expect(preview.rows.map((row) => row.action)).toEqual(['create', 'merge']);
    expect(result).toMatchObject({ ok: true, created: 1, merged: 1, failed: 0 });
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({ firstName: 'First', lastName: 'Client', city: 'Miami' });
  });

  it('preserves generic spreadsheet contacts with distinct emails that share a household phone', async () => {
    const state = repository();
    const gateway = memoryImportGateway({ repository: state.repo });
    const parsed = parseContactImport({
      filename: 'household.csv',
      content: [
        'First Name,Email,Phone,Lead Type,Relationship,Pipeline Stage',
        'Avery,avery@example.com,5551234567,Hot,lead,active lead',
        'Jordan,jordan@example.com,5551234567,Warm,client,client',
      ].join('\n'),
    });

    const preview = await previewContactImport(state.repo, gateway, parsed);
    const result = await executeContactImport(state.repo, gateway, preview, NOW);

    expect(preview.rows.map((row) => row.action)).toEqual(['create', 'create']);
    expect(result).toMatchObject({ ok: true, created: 2, merged: 0, failed: 0 });
    expect(state.contacts).toHaveLength(2);
  });

  it('preserves distinct First Class contacts that legitimately share a household phone', async () => {
    const state = repository();
    const gateway = memoryImportGateway({ repository: state.repo });
    const parsed = parseContactImport({
      filename: 'first-class.csv',
      content: [
        'Contact Id,First Name,Last Name,Email,Cell Phone 1,Status,Assigned Agent ID',
        'fc-household-1,Avery,Stone,avery@example.com,5551234567,Client,agent-1',
        'fc-household-2,Jordan,Stone,jordan@example.com,5551234567,Client,agent-1',
      ].join('\n'),
    });

    const preview = await previewContactImport(state.repo, gateway, parsed, SAMPLE_WORKSPACE_SCOPE);

    expect(preview.rows.map((row) => row.action)).toEqual(['create', 'create']);
    expect(preview.rows.map((row) => row.candidate.externalId)).toEqual([
      'fc-household-1',
      'fc-household-2',
    ]);
  });

  it('rolls back contact, link, note, and activity when an atomic group fails', async () => {
    const state = repository();
    const activityRepository = createMemoryActivityRepository();
    const gateway = memoryImportGateway({ repository: state.repo, activityRepository });
    await gateway.linkContact({ provider: 'website', externalId: 'collision-atomic', contactId: 'other-contact' });
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [{ externalId: 'collision-atomic', firstName: 'Atomic', note: 'Must roll back' }],
    });
    const preview = await previewContactImport(state.repo, gateway, parsed);
    const result = await executeContactImport(state.repo, gateway, preview, NOW, {
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      activityRepository,
      idempotencyKeyBase: 'atomic-rollback-proof',
    });
    expect(result).toMatchObject({ ok: false, failed: 1, created: 0, notesAdded: 0 });
    expect(state.contacts).toEqual([]);
    expect(state.notes).toEqual([]);
    expect(await activityRepository.listEvents(SAMPLE_WORKSPACE_SCOPE, { limit: 100 })).toEqual([]);
  });
});
