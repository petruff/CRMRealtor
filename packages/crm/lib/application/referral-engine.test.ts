import { describe, expect, it } from 'vitest';
import type { Contact } from '../domain/contact.ts';
import { buildReferralEngine, draftMessage, mailtoHref, smsHref } from './referral-engine.ts';

const NOW = new Date('2026-09-23T15:00:00.000Z');
let seq = 0;
function person(patch: Partial<Contact>): Contact {
  seq += 1;
  return {
    id: `c-${seq}`, firstName: `Name${seq}`, lastName: 'Test', leadType: 'nurture', relationship: 'past-client', intent: 'buyer',
    source: 'referral', pipelineStage: 'closed', tags: [], createdAt: '2024-01-01T00:00:00.000Z', ...patch,
  } as Contact;
}

describe('buildReferralEngine', () => {
  it('finds home anniversaries and birthdays within 30 days, soonest first', () => {
    const ana = person({ firstName: 'Ana', homePurchaseDate: '2023-10-01', lastContactedAt: '2026-09-01T00:00:00.000Z' });
    const ben = person({ firstName: 'Ben', birthdate: '1980-09-25', relationship: 'sphere', lastContactedAt: '2026-09-01T00:00:00.000Z' });
    const far = person({ firstName: 'Far', birthdate: '1980-12-25', lastContactedAt: '2026-09-01T00:00:00.000Z' });
    const lead = person({ firstName: 'Lead', relationship: 'lead', birthdate: '1980-09-24' });
    const engine = buildReferralEngine([ana, ben, far, lead], NOW);
    expect(engine.moments.map((moment) => [moment.firstName, moment.kind, moment.days])).toEqual([['Ben', 'birthday', 2], ['Ana', 'homeaversary', 8]]);
    expect(engine.moments[1]?.label).toBe('3rd home anniversary in 8 days');
    expect(engine.moments[1]?.drafts.en.sms).toContain('Happy 3rd home anniversary');
  });

  it('lists quiet past clients (90+ days) without duplicating a moment, longest-quiet first', () => {
    const quiet = person({ firstName: 'Quiet', lastContactedAt: '2026-03-01T00:00:00.000Z' });
    const never = person({ firstName: 'Never' });
    const recent = person({ firstName: 'Recent', lastContactedAt: '2026-09-01T00:00:00.000Z' });
    const celebrating = person({ firstName: 'Party', birthdate: '1990-09-30' });
    const sphereOnly = person({ firstName: 'Friend', relationship: 'sphere' });
    const engine = buildReferralEngine([quiet, never, recent, celebrating, sphereOnly], NOW);
    expect(engine.checkIns.map((moment) => moment.firstName)).toEqual(['Never', 'Quiet']);
    expect(engine.checkIns[0]?.label).toBe('No conversation logged yet');
    expect(engine.checkIns[1]?.label).toBe('Quiet for 6 months');
  });

  it('ranks referrers and reports the sphere pulse', () => {
    const giver = person({ firstName: 'Gina', lastContactedAt: '2026-09-10T00:00:00.000Z' });
    const other = person({ firstName: 'Omar', lastContactedAt: '2025-01-01T00:00:00.000Z' });
    const referred = [person({ firstName: 'Ray', relationship: 'lead', referredById: giver.id }), person({ firstName: 'Sue', relationship: 'lead', referredById: giver.id }), person({ firstName: 'Tim', relationship: 'lead', referredById: other.id })];
    const archived = person({ firstName: 'Old', relationship: 'lead', referredById: giver.id, archivedAt: '2026-01-01T00:00:00.000Z' });
    const engine = buildReferralEngine([giver, other, ...referred, archived], NOW);
    expect(engine.referrers.map((referrer) => [referrer.name, referrer.referrals])).toEqual([['Gina Test', 2], ['Omar Test', 1]]);
    expect(engine.referrers[0]?.drafts.en.sms).toContain('referring Ray');
    expect(engine.pulse).toEqual({ size: 2, touchedRecently: 1, touchedShare: 50, referralsReceived: 3 });
  });
});

describe('drafts', () => {
  it('writes warm English and Spanish drafts that sign with the agent name', () => {
    const contact = person({ firstName: 'María', preferredName: 'Mari' });
    const en = draftMessage('check-in', contact, 'en', { agentName: 'Paula Reyes' });
    const es = draftMessage('check-in', contact, 'es', { agentName: 'Paula Reyes' });
    expect(en.sms).toMatch(/^Hi Mari/);
    expect(en.emailBody.endsWith('Paula Reyes')).toBe(true);
    expect(es.sms).toMatch(/^Hola Mari/);
    expect(es.emailSubject).toBe('¿Cómo va todo, Mari?');
    expect(draftMessage('homeaversary', contact, 'es', { years: 1 }).sms).toContain('1 año');
  });

  it('builds safe sms and mailto links only when the channel exists', () => {
    expect(smsHref('(813) 555-0142', 'Hi & bye')).toBe('sms:8135550142?&body=Hi%20%26%20bye');
    expect(smsHref(undefined, 'x')).toBeUndefined();
    expect(mailtoHref('a@b.co', 'Hi', 'Body')).toBe('mailto:a%40b.co?subject=Hi&body=Body');
  });
});
