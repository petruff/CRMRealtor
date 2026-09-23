import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import { localCalendarDay, runMorningBrief, type MorningBriefStore, type PushTarget } from './morning-brief-sender';

const NOW = new Date('2026-09-23T11:00:00.000Z');
const due = (id: string): Contact => ({
  id, firstName: id, lastName: 'Lane', leadType: 'hot', relationship: 'lead', intent: 'buyer', source: 'other',
  pipelineStage: 'contacted', tags: [], createdAt: '2026-08-01T00:00:00.000Z', lastContactedAt: '2026-09-10', nextTouchAt: '2026-09-20',
});
const target = (id: string, patch: Partial<PushTarget> = {}): PushTarget => ({ id, endpoint: `https://push.example/${id}`, p256dh: 'k', authSecret: 'a', showNames: false, ...patch });

function store(targets: PushTarget[]): MorningBriefStore & { sent: string[]; revoked: string[] } {
  const sent: string[] = [];
  const revoked: string[] = [];
  return {
    sent, revoked,
    listTargets: async () => targets,
    markSent: async (id) => { sent.push(id); },
    revoke: async (id) => { revoked.push(id); },
  };
}

describe('morning brief sender', () => {
  it('uses the realtor’s local calendar day', () => {
    expect(localCalendarDay(new Date('2026-09-24T02:00:00.000Z'), 'America/New_York')).toBe('2026-09-23');
  });

  it('sends once per device per day, respecting each device’s privacy choice', async () => {
    const deliveries: { id: string; body: string }[] = [];
    const devices = store([target('phone', { showNames: true }), target('laptop'), target('done', { lastSentOn: '2026-09-23' })]);
    const result = await runMorningBrief({
      contacts: [due('Ana')], openDeadlines: 0, store: devices, now: NOW, timeZone: 'America/New_York',
      deliver: async (device, payload) => { deliveries.push({ id: device.id, body: payload.body }); },
    });
    expect(result).toMatchObject({ day: '2026-09-23', sent: 2, alreadySent: 1, failed: 0 });
    expect(deliveries).toEqual([{ id: 'phone', body: 'Start with Ana Lane.' }, { id: 'laptop', body: 'Tap to start your Power Hour.' }]);
    expect(devices.sent).toEqual(['phone', 'laptop']);
  });

  it('stays silent on quiet days and revokes endpoints the push service says are gone', async () => {
    const quiet = await runMorningBrief({ contacts: [], openDeadlines: 0, store: store([target('a')]), now: NOW, timeZone: 'UTC', deliver: vi.fn() });
    expect(quiet).toMatchObject({ sent: 0, nothingToSend: 1 });

    const devices = store([target('gone'), target('flaky')]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runMorningBrief({
      contacts: [due('Ana')], openDeadlines: 0, store: devices, now: NOW, timeZone: 'UTC',
      deliver: async (device) => { throw Object.assign(new Error('push'), { statusCode: device.id === 'gone' ? 410 : 500 }); },
    });
    expect(result).toMatchObject({ revoked: 1, failed: 1, sent: 0 });
    expect(devices.revoked).toEqual(['gone']);
    expect(devices.sent).toEqual([]);
  });
});
