import { describe, expect, it, vi } from 'vitest';
import { organizeExistingImportedContacts } from '@/lib/application/imported-contact-organization';
import type { Contact } from '@/lib/domain/contact';
import type { ActivityEvent } from '@/lib/domain/activity';
import type { ContactImportSourceFactRecord } from '@/lib/domain/rich-contact';
import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { ImportGateway } from '@/lib/data/import-gateway';
import type { ContactRepository } from '@/lib/data/repository';
import type { RichContactRepository } from '@/lib/data/rich-contact-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';

const NOW = new Date('2026-08-21T17:00:00.000Z');

function contact(id: string): Contact {
  return {
    id, firstName: 'Synthetic', lastName: id, leadType: 'warm', qualificationStatus: 'qualified',
    relationship: 'lead', intent: 'unknown', source: 'other', pipelineStage: 'new', tags: [],
    createdAt: '2026-08-12T12:00:00.000Z', nextTouchAt: '2026-08-19', touchDateOverridden: false,
  };
}

function fact(contactId: string, key: string, value: string | number): ContactImportSourceFactRecord {
  return {
    id: `${contactId}-${key}`, workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, contactId,
    provider: 'first-class-real-estate', schemaVersion: 'fixture.v1', key, label: key,
    category: key === 'rating' ? 'engagement' : 'other',
    valueType: typeof value === 'number' ? 'number' : 'text', value,
    valueHash: 'a'.repeat(64), groupIdempotencyKey: `fixture:${contactId}`,
    requestHash: 'b'.repeat(64), capturedAt: '2026-08-12T12:00:00.000Z',
  };
}

function importedEvent(contactId: string): ActivityEvent {
  return {
    id: `event-imported-${contactId}`, workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
    type: 'contact-imported', contactId,
    actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
    occurredAt: '2026-08-12T12:00:00.000Z', createdAt: '2026-08-12T12:00:00.000Z',
    idempotencyKey: `imported-${contactId}`,
  };
}

function context(input: {
  contacts: Contact[];
  facts: ContactImportSourceFactRecord[];
  events?: ActivityEvent[];
}) {
  const apply = vi.fn(async (command: Parameters<NonNullable<ImportGateway['applyImportedContactOrganization']>>[0]) => {
    for (const change of command.changes) {
      const target = input.contacts.find((item) => item.id === change.contactId)!;
      Object.assign(target, change.after, {
        nextTouchAt: change.after.nextTouchAt ?? undefined,
      });
    }
    return {
      runId: 'organization-run', contactCount: command.changes.length,
      state: 'applied' as const, noOp: false, rollbackAvailable: true,
    };
  });
  return {
    value: {
      repository: { list: async () => input.contacts } as ContactRepository,
      richContactRepository: {
        listContactImportSourceFacts: async (
          _scope: Parameters<RichContactRepository['listContactImportSourceFacts']>[0],
          contactId: string,
        ) => input.facts.filter((item) => item.contactId === contactId),
      } as unknown as RichContactRepository,
      activityRepository: {
        listEvents: async (
          _scope: Parameters<ActivityRepository['listEvents']>[0],
          query: Parameters<ActivityRepository['listEvents']>[1],
        ) => (input.events ?? []).filter((event) => !query.type || event.type === query.type),
      } as unknown as ActivityRepository,
      importGateway: { applyImportedContactOrganization: apply } as unknown as ImportGateway,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    },
    apply,
  };
}

describe('existing imported-contact organization', () => {
  it('dry-runs aggregate classifications without writing or returning PII', async () => {
    const first = contact('contact-hot');
    const second = contact('contact-review');
    const fixture = context({
      contacts: [first, second],
      facts: [
        fact(first.id, 'status', 'Under Contract'), fact(first.id, 'rating', 5),
        fact(second.id, 'status', 'Unrecognized legacy state'),
      ],
    });

    const result = await organizeExistingImportedContacts(fixture.value, { dryRun: true }, NOW);

    expect(result).toMatchObject({
      dryRun: true, scanned: 2, withImportProfile: 2, eligible: 2,
      wouldUpdate: 2, updated: 0, needsReview: 1, failed: 0,
      leadTypes: { hot: 1, warm: 0, nurture: 1 },
      pipelineStages: { 'under-contract': 1, new: 1 },
    });
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Synthetic');
  });

  it('applies bounded classifications through the atomic import gateway', async () => {
    const target = contact('contact-active');
    const fixture = context({
      contacts: [target],
      facts: [fact(target.id, 'status', 'Active Lead'), fact(target.id, 'rating', 3)],
    });

    const result = await organizeExistingImportedContacts(fixture.value, { dryRun: false }, NOW);

    expect(result).toMatchObject({ updated: 1, failed: 0, needsReview: 0 });
    expect(target).toMatchObject({ leadType: 'warm', relationship: 'lead', pipelineStage: 'active', qualificationStatus: 'qualified' });
    expect(fixture.apply).toHaveBeenCalledWith(expect.objectContaining({
      changes: [expect.objectContaining({ contactId: target.id })],
    }));
    expect(result).toMatchObject({ runId: 'organization-run', rollbackAvailable: true });
  });

  it('repairs proven legacy imports from preserved tags when source facts predate provenance storage', async () => {
    const prospect = { ...contact('contact-prospect'), tags: ['"prospect"'] };
    const client = { ...contact('contact-client'), tags: ['"client"'] };
    const unlabelled = contact('contact-unlabelled');
    const fixture = context({
      contacts: [prospect, client, unlabelled],
      facts: [],
      events: [importedEvent(prospect.id), importedEvent(client.id), importedEvent(unlabelled.id)],
    });

    const result = await organizeExistingImportedContacts(fixture.value, { dryRun: false }, NOW);

    expect(result).toMatchObject({
      scanned: 3, withImportProfile: 3, eligible: 3, updated: 3, needsReview: 1,
      leadTypes: { hot: 0, warm: 1, nurture: 2 },
    });
    expect(prospect).toMatchObject({
      leadType: 'nurture', relationship: 'lead', pipelineStage: 'new', qualificationStatus: 'qualified',
    });
    expect(client).toMatchObject({
      leadType: 'warm', relationship: 'active-client', pipelineStage: 'active', qualificationStatus: 'qualified',
    });
    expect(unlabelled).toMatchObject({
      leadType: 'nurture', relationship: 'lead', pipelineStage: 'new', qualificationStatus: 'needs-qualification',
    });
  });

  it('skips manually edited or already non-default contacts', async () => {
    const manuallyEdited = contact('contact-manual');
    const nonDefault = { ...contact('contact-existing-hot'), leadType: 'hot' as const };
    const manualEvent: ActivityEvent = {
      id: 'event-manual', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, type: 'contact-updated',
      contactId: manuallyEdited.id, actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
      occurredAt: '2026-08-20T12:00:00.000Z', createdAt: '2026-08-20T12:00:00.000Z',
      idempotencyKey: 'manual-update',
    };
    const fixture = context({
      contacts: [manuallyEdited, nonDefault],
      facts: [fact(manuallyEdited.id, 'rating', 5), fact(nonDefault.id, 'rating', 5)],
      events: [manualEvent],
    });

    const result = await organizeExistingImportedContacts(fixture.value, { dryRun: false }, NOW);

    expect(result).toMatchObject({ withImportProfile: 2, eligible: 0, skippedProtected: 1, alreadyOrganized: 1, updated: 0 });
    expect(fixture.apply).not.toHaveBeenCalled();
  });
});
