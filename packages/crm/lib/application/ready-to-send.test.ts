import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import { buildReadyToSend, followUpDraft, withNoteHints } from './ready-to-send';

const now = new Date('2026-09-24T13:00:00.000Z');

function contact(id: string, extra: Partial<Contact> = {}): Contact {
  return {
    id, firstName: id, lastName: 'Test', leadType: 'warm', relationship: 'lead', intent: 'unknown', source: 'website',
    pipelineStage: 'contacted', tags: [], createdAt: '2026-06-01T12:00:00.000Z', phone: '(305) 555-0100', ...extra,
  };
}

describe('ready to send', () => {
  it('prepares new leads first, then today’s birthdays, then due follow-ups — only people with a phone', () => {
    const items = buildReadyToSend({
      now,
      agentName: 'Judith Smith',
      contacts: [
        contact('Overdue', { lastContactedAt: '2026-09-01T12:00:00.000Z', nextTouchAt: '2026-09-20', intent: 'buyer', buyer: { beds: 3, areas: ['Doral'], priceMax: 450_000 } }),
        contact('Birthday', { relationship: 'sphere', birthdate: '1980-09-24', lastContactedAt: '2026-09-20T12:00:00.000Z', nextTouchAt: '2026-11-20' }),
        contact('Fresh', { pipelineStage: 'new', createdAt: '2026-09-24T11:00:00.000Z' }),
        contact('NoPhone', { pipelineStage: 'new', createdAt: '2026-09-24T11:00:00.000Z', phone: undefined }),
        contact('Imported', { pipelineStage: 'new', createdAt: '2026-09-24T11:00:00.000Z' }),
      ],
      historicalImportContactIds: new Set(['Imported']),
    });
    expect(items.map((item) => [item.contactId, item.kind])).toEqual([['Fresh', 'new-lead'], ['Birthday', 'birthday'], ['Overdue', 'follow-up']]);
    expect(items[0]?.body).toContain('this is Judith');
    expect(items[2]?.body).toBe('Hi Overdue, checking in on your home search — are you still looking for a 3-bedroom in Doral under $450k? Happy to send you what’s new this week. — Judith');
    expect(items[2]?.href).toMatch(/^sms:3055550100\?&body=/u);
  });

  it('caps the list and adds timing hints from notes', () => {
    const contacts = Array.from({ length: 12 }, (_, index) => contact(`c${index}`, { lastContactedAt: '2026-09-01T12:00:00.000Z', nextTouchAt: '2026-09-20' }));
    const items = buildReadyToSend({ contacts, now });
    expect(items).toHaveLength(8);
    const hinted = withNoteHints(items, new Map([['c0', [{ id: 'n', contactId: 'c0', body: 'Prefers texts. Best to text after 6 pm.', createdAt: '2026-09-01T00:00:00.000Z' }]]]));
    expect(hinted.find((item) => item.contactId === 'c0')?.hint).toBe('Prefers texts · Best reached after 6 pm');
  });

  it('writes follow-ups grounded only in saved details', () => {
    expect(followUpDraft(contact('Sam', { intent: 'seller', seller: { propertyAddress: '12 Palm Ave' } }))).toBe('Hi Sam, are you still thinking about selling 12 Palm Ave? I’d be happy to put together an updated value for you — no pressure.');
    expect(followUpDraft(contact('Pat', { relationship: 'past-client' }), 'Judith')).toContain('how’s everything with the house');
  });
});
