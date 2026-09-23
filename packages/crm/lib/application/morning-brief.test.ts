import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import { buildMorningBrief } from './morning-brief';

const NOW = new Date('2026-09-23T11:00:00.000Z');
const person = (id: string, patch: Partial<Contact> = {}): Contact => ({
  id, firstName: id, lastName: 'Lane', leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'other',
  pipelineStage: 'contacted', tags: [], createdAt: '2026-08-01T00:00:00.000Z', lastContactedAt: '2026-09-10', nextTouchAt: '2026-09-20', ...patch,
});

describe('morning brief notification', () => {
  it('keeps names off the lock screen unless the member opted in', () => {
    const contacts = [person('Ana'), person('Bo'), person('Cy'), person('Di')];
    expect(buildMorningBrief(contacts, NOW)).toEqual({
      title: 'Good morning — 4 people to reach', body: 'Tap to start your Power Hour.', url: '/power-hour', count: 4,
    });
    expect(buildMorningBrief(contacts, NOW, { showNames: true })?.body).toBe('Start with Ana Lane, Bo Lane and Cy Lane.');
  });

  it('mentions deal deadlines and never pings when nothing needs her', () => {
    expect(buildMorningBrief([person('Ok', { nextTouchAt: '2026-10-10' })], NOW)).toBeUndefined();
    expect(buildMorningBrief([], NOW, { openDeadlines: 2 })).toMatchObject({ title: 'Good morning — 2 deal deadlines', url: '/transactions' });
    expect(buildMorningBrief([person('Ana')], NOW, { openDeadlines: 1, showNames: true })).toMatchObject({
      title: 'Good morning — 1 person to reach · 1 deal deadline', body: 'Start with Ana Lane.',
    });
  });

  it('ignores archived contacts', () => {
    expect(buildMorningBrief([person('Gone', { archivedAt: '2026-09-01T00:00:00Z' })], NOW)).toBeUndefined();
  });

  it('leads with a deal date due within 48 hours', () => {
    const urgent = [{ label: 'Inspection period ends', propertyAddress: '1408 Bayshore Dr', when: 'tomorrow' as const }];
    expect(buildMorningBrief([person('Ana')], NOW, { openDeadlines: 1, showNames: true, urgent })).toEqual({
      title: 'Deal date tomorrow · 1 person to reach · 1 deal deadline',
      body: 'Inspection period ends — due tomorrow (1408 Bayshore Dr). Start with Ana Lane.',
      url: '/power-hour', count: 1,
    });
    expect(buildMorningBrief([], NOW, { openDeadlines: 0, urgent: [{ ...urgent[0]!, when: 'overdue' }] })).toEqual({
      title: 'Good morning — a deal date needs you', body: '1 deal date needs attention now.', url: '/transactions', count: 0,
    });
  });
});
