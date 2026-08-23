import { describe, expect, it } from 'vitest';
import { buildContactDuplicateAudit, loadContactDuplicateAudit } from './contact-duplicate-audit';
import type { Contact } from '@/lib/domain/contact';
import type { ContactPoint } from '@/lib/domain/rich-contact';
import type { WorkspaceScope } from '@/lib/domain/workspace';

const base: Omit<Contact, 'id' | 'firstName'> = {
  lastName: 'Client', leadType: 'warm', relationship: 'lead', intent: 'unknown',
  source: 'other', pipelineStage: 'new', tags: [], emailSubscribed: true,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function point(id: string, contactId: string, type: 'email' | 'phone', value: string, archivedAt?: string): ContactPoint {
  return {
    id, workspaceId: 'workspace-a', contactId, type, label: 'Imported', displayValue: value,
    normalizedValue: value, isPrimary: true, displayOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...(archivedAt ? { archivedAt } : {}),
  };
}

describe('buildContactDuplicateAudit', () => {
  it('groups only exact canonical identifiers across distinct active contacts without exposing the value', () => {
    const contacts: Contact[] = [
      { ...base, id: 'contact-a', firstName: 'A' },
      { ...base, id: 'contact-b', firstName: 'B' },
      { ...base, id: 'contact-c', firstName: 'C', archivedAt: '2026-08-10T00:00:00.000Z' },
    ];
    const audit = buildContactDuplicateAudit({
      contacts,
      points: [
        point('point-a', 'contact-a', 'email', 'same@example.com'),
        point('point-b', 'contact-b', 'email', 'same@example.com'),
        point('point-c', 'contact-c', 'email', 'same@example.com'),
        point('point-d', 'contact-a', 'phone', '+15550000001'),
        point('point-e', 'contact-b', 'phone', '+15550000002'),
      ],
      asOf: '2026-08-14T12:00:00.000Z',
    });

    expect(audit).toMatchObject({ activeContacts: 2, archivedContacts: 1, candidateContacts: 2, automaticMerges: 0 });
    expect(audit.duplicateGroups).toHaveLength(1);
    expect(audit.duplicateGroups[0]).toMatchObject({ kind: 'email', contactIds: ['contact-a', 'contact-b'], disposition: 'review-required' });
    expect(JSON.stringify(audit)).not.toContain('same@example.com');
  });

  it('does not treat names or archived points as identity evidence', () => {
    const contacts: Contact[] = [
      { ...base, id: 'contact-a', firstName: 'Same' },
      { ...base, id: 'contact-b', firstName: 'Same' },
    ];
    const audit = buildContactDuplicateAudit({
      contacts,
      points: [
        point('point-a', 'contact-a', 'phone', '+15550000001', '2026-08-13T00:00:00.000Z'),
        point('point-b', 'contact-b', 'phone', '+15550000001'),
      ],
      asOf: '2026-08-14T12:00:00.000Z',
    });

    expect(audit.duplicateGroups).toEqual([]);
  });

  it('loads one bounded point batch instead of one request per contact', async () => {
    const contacts: Contact[] = [
      { ...base, id: 'contact-a', firstName: 'A' },
      { ...base, id: 'contact-b', firstName: 'B' },
    ];
    const batches: string[][] = [];
    const result = await loadContactDuplicateAudit({
      repository: { list: async () => contacts },
      richContactRepository: {
        listContactPointsForContacts: async (_scope: WorkspaceScope, contactIds: readonly string[]) => {
          batches.push([...contactIds]);
          return [
            point('point-a', 'contact-a', 'email', 'same@example.com'),
            point('point-b', 'contact-b', 'email', 'same@example.com'),
          ];
        },
      },
      workspaceScope: {
        authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: 'member-a',
        workspaceId: 'workspace-a', role: 'owner', mode: 'live',
      },
    } as unknown as Parameters<typeof loadContactDuplicateAudit>[0], new Date('2026-08-14T12:00:00.000Z'));

    expect(batches).toEqual([['contact-a', 'contact-b']]);
    expect(result.audit.duplicateGroups).toHaveLength(1);
  });
});
