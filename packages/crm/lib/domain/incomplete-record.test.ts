import { describe, expect, it } from 'vitest';
import {
  archiveIncompleteRecord,
  markIncompleteRecordConverted,
  projectIncompleteCandidate,
  restoreIncompleteRecord,
  type IncompleteRecord,
} from './incomplete-record';

function record(): IncompleteRecord {
  return {
    id: 'incomplete-1', workspaceId: 'workspace-a', source: 'website',
    candidate: { email: 'broken@' },
    reasons: [{ field: 'email', code: 'invalid-email', message: 'email is invalid.' }],
    status: 'pending', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
  };
}

describe('incomplete record domain', () => {
  it('projects only normalized allowlisted candidate fields and never raw secrets', () => {
    const result = projectIncompleteCandidate({
      firstName: '  Ana  ', email: 'ANA@EXAMPLE.COM', phone: '+1 (305) 555-0100',
      note: 'authorization Bearer secret', authorization: 'secret', rawBody: { token: 'secret' },
      tags: [' Buyer ', 'Buyer'],
    }, ['A required field failed validation.']);
    expect(result.candidate).toEqual({
      firstName: 'Ana', email: 'ana@example.com', phone: '13055550100', tags: ['Buyer'],
    });
    expect(JSON.stringify(result)).not.toMatch(/authorization|bearer|secret|rawBody|note/i);
  });

  it('accepts provider external ID as the only safe identity signal but rejects no identity', () => {
    expect(projectIncompleteCandidate({}, ['Missing contact name.'], 'provider-42').eligible).toBe(true);
    expect(() => projectIncompleteCandidate({ unknown: 'value' })).toThrow(/no safe identity/i);
  });

  it('records bounded validation reasons for invalid candidate values', () => {
    const result = projectIncompleteCandidate({
      firstName: 'Ana', email: 'not-an-email', leadType: 'boiling', birthdate: '2026-02-31',
    });
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      'invalid-email', 'invalid-enum', 'invalid-date',
    ]));
  });

  it('archives/restores idempotently and prevents converted records from being archived', () => {
    const archived = archiveIncompleteRecord(record(), 'member-a', '2026-08-12T00:00:00.000Z', 'duplicate');
    expect(archived.record.status).toBe('archived');
    expect(archiveIncompleteRecord(archived.record, 'member-a', '2026-08-13T00:00:00.000Z', 'again').noOp)
      .toBe(true);
    expect(restoreIncompleteRecord(archived.record, '2026-08-14T00:00:00.000Z').record.status).toBe('pending');
    const converted = markIncompleteRecordConverted(record(), {
      contactId: 'contact-1', action: 'create', idempotencyKey: 'conversion-1',
      actorMembershipId: 'member-a', convertedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(() => archiveIncompleteRecord(converted.record, 'member-a', '2026-08-13T00:00:00.000Z', 'x'))
      .toThrow(/cannot be archived/i);
  });

  it('returns the immutable original contact receipt on conversion replay', () => {
    const first = markIncompleteRecordConverted(record(), {
      contactId: 'contact-1', action: 'create', idempotencyKey: 'conversion-1',
      actorMembershipId: 'member-a', convertedAt: '2026-08-12T00:00:00.000Z',
    });
    const replay = markIncompleteRecordConverted(first.record, {
      contactId: 'contact-1', action: 'create', idempotencyKey: 'conversion-1',
      actorMembershipId: 'member-a', convertedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(replay).toMatchObject({ noOp: true, contactId: 'contact-1', action: 'create' });
    expect(replay.record.convertedAt).toBe('2026-08-12T00:00:00.000Z');
  });
});
