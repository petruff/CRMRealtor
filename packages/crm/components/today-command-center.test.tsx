import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { daySummary, preferredGreetingName, TodayCommandCenter, todayDateContext } from '@/components/today-command-center';
import type { TodayOperatingProjection } from '@/lib/application/today-operating-projection';
import type { Contact } from '@/lib/domain/contact';

const AS_OF = '2026-08-12T14:00:00.000Z';
const alerts = { alerts: [], citations: [], warnings: [], asOf: AS_OF, availability: 'available' as const, dataMode: 'live' as const };

const person = (id: string, patch: Partial<Contact> = {}): Contact => ({
  id, firstName: id, lastName: 'Serna', leadType: 'warm', relationship: 'lead', intent: 'seller', source: 'website',
  pipelineStage: 'contacted', tags: [], createdAt: '2026-07-01T13:00:00.000Z', lastContactedAt: '2026-07-20',
  nextTouchAt: '2026-08-30', phone: '(813) 555-0100', ...patch,
});

const projection = {
  asOf: AS_OF, sourceState: 'available', priorityContributors: [],
  approvals: { state: 'available', count: 2, topLabel: 'Send Ada a price update' },
  replies: { state: 'available', count: 1, topLabel: 'Ada Serna' },
  deadlines: { state: 'available', count: 3, overdue: 1 },
  growth: { state: 'available', activeNurtures: 0, dueNurtures: 0 },
  connections: { state: 'available', connected: 0, needsAttention: 0, labels: [] },
  business: { state: 'available', activeTransactions: 0, underContract: 0 },
  unknowns: { count: 0, labels: [] },
} as unknown as TodayOperatingProjection;

describe('TodayCommandCenter', () => {
  it('uses a concise greeting name and the workspace time zone', () => {
    expect(preferredGreetingName('  Judith   Serna  ')).toBe('Judith');
    expect(preferredGreetingName('')).toBeUndefined();
    expect(todayDateContext(new Date('2026-08-14T00:24:00.000Z'), 'America/New_York')).toEqual({ greeting: 'Good evening', dateLabel: 'Thursday, August 13' });
  });

  it('summarizes the day in one plain sentence', () => {
    expect(daySummary(3, projection)).toBe('3 people to reach, 1 reply waiting and 3 open deadlines.');
    expect(daySummary(1)).toBe('1 person to reach.');
    expect(daySummary(0)).toBe('Nothing urgent today — a good day to nurture your sphere.');
  });

  it('puts one ordered queue with names, reasons and one-tap actions above the fold', () => {
    const html = renderToStaticMarkup(<TodayCommandCenter
      alerts={alerts}
      contacts={[
        person('Late', { nextTouchAt: '2026-08-02', leadType: 'hot' }),
        person('Fresh', { lastContactedAt: undefined, nextTouchAt: undefined, pipelineStage: 'new', createdAt: '2026-08-12T13:00:00.000Z' }),
        person('Calm'),
      ]}
      userDisplayName="Judith Serna"
      timeZone="America/New_York"
      operatingProjection={projection}
    />);

    expect(html).toContain('Good morning, Judith.');
    expect(html).toContain('href="/power-hour"');
    expect(html).toContain('Start Power Hour');
    expect(html.indexOf('>Fresh Serna<')).toBeLessThan(html.indexOf('>Late Serna<'));
    expect(html).not.toContain('>Calm Serna<');
    expect(html).toContain('New website lead — reach out today');
    expect(html).toContain('Follow-up 10 days overdue · last spoke Mon, Jul 20');
    expect(html).toContain('aria-label="Call Late Serna"');
    expect(html).toContain('href="tel:(813) 555-0100"');
    expect(html).toContain('href="/contacts/Late/outcome"');
    expect(html).not.toMatch(/Follow-up \d{4}-\d{2}-\d{2}/);
    expect(html).not.toMatch(/canonical|verified contributor|false zero|authorized CRM evidence/i);
  });

  it('shows what is waiting on her without inventing zeros for unavailable sources', () => {
    const unavailable = { ...projection, replies: { state: 'unavailable', count: 0 } } as unknown as TodayOperatingProjection;
    const html = renderToStaticMarkup(<TodayCommandCenter alerts={alerts} contacts={[person('Calm')]} operatingProjection={unavailable} />);
    expect(html).toContain('aria-label="— replies"');
    expect(html).toContain('aria-label="2 approvals"');
    expect(html).toContain('1 past due');
    expect(html).toContain('Everyone is reached and on schedule.');
  });

  it('celebrates birthdays and home anniversaries in plain language', () => {
    const html = renderToStaticMarkup(<TodayCommandCenter alerts={alerts} contacts={[
      person('Bday', { birthdate: '1980-08-15' }),
      person('Home', { homePurchaseDate: '2020-08-20', relationship: 'past-client' }),
    ]} />);
    expect(html).toContain('Birthday in 3 days');
    expect(html).toContain('6th home anniversary in 8 days');
  });

  it('offers a calm first-run path when no contacts exist', () => {
    const html = renderToStaticMarkup(<TodayCommandCenter alerts={alerts} contacts={[]} />);
    expect(html).toContain('Bring your relationships in.');
    expect(html).toContain('href="/contacts/import"');
    expect(html).not.toContain('Start Power Hour');
  });
});
