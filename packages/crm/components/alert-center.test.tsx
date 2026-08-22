import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlertCenter, groupAlertsForPresentation } from '@/components/alert-center';
import { OMNIX_CITATION_SCHEMA_VERSION, type OmnixCopilotAlert, type OmnixCopilotCitation } from '@/lib/domain/omnix-copilot';

const AS_OF = '2026-08-11T16:00:00.000Z';

function citation(recordId: string): OmnixCopilotCitation {
  return {
    id: `citation-${recordId}`,
    schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
    entityType: 'contact',
    recordId,
    factKeys: ['nextTouchAt'],
    responseAsOf: AS_OF,
    target: `/contacts/${recordId}`,
    rule: 'due-today-follow-up',
  };
}

function alert(recordId: string, order: number): OmnixCopilotAlert {
  const source = citation(recordId);
  return {
    id: `alert:due-today-follow-up:${recordId}:2026-08-11`,
    rule: 'due-today-follow-up',
    category: 'follow-up',
    priority: 'high',
    order,
    reason: `Follow up with ${recordId}`,
    asOf: AS_OF,
    recordId,
    href: `/contacts/${recordId}`,
    citations: [source],
  };
}

describe('AlertCenter', () => {
  it('preserves canonical order/count and renders read-only evidence actions', () => {
    const alerts = [alert('contact-b', 2), alert('contact-a', 1)];
    const html = renderToStaticMarkup(<AlertCenter
      alerts={alerts}
      citations={alerts.flatMap((item) => item.citations)}
      warnings={[]}
      asOf={AS_OF}
      availability="available"
      dataMode="sample"
    />);

    expect(html).toContain('2 alerts');
    expect(html.indexOf('Follow up with contact-b')).toBeLessThan(html.indexOf('Follow up with contact-a'));
    expect(html).toContain('href="/contacts/contact-b"');
    expect(html).toContain('<summary class="sk-secondary-button');
    expect(html).toContain('Contact record');
    expect(html).toContain('Based on next follow-up.');
    expect(html).not.toContain('nextTouchAt');
    expect(html).not.toContain('citation-contact-b');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toMatch(/dismiss|snooze|notify/i);
  });

  it('distinguishes honest empty and unavailable states', () => {
    const empty = renderToStaticMarkup(<AlertCenter alerts={[]} citations={[]} warnings={[]} asOf={AS_OF} availability="available" />);
    const unavailable = renderToStaticMarkup(<AlertCenter alerts={[]} citations={[]} warnings={['denied']} asOf={AS_OF} availability="unavailable" />);

    expect(empty).toContain('You’re clear for now');
    expect(empty).toContain('href="/contacts/new"');
    expect(unavailable).toContain('Alerts could not load');
    expect(unavailable).not.toContain('0 alerts');
    expect(unavailable).not.toContain('denied');
  });

  it('groups the canonical order into scannable action sections without changing alert facts', () => {
    const urgent = { ...alert('urgent-contact', 1), priority: 'urgent' as const };
    const upcoming = { ...alert('upcoming-contact', 2), priority: 'normal' as const };
    const celebration = {
      ...alert('birthday-contact', 3),
      priority: 'normal' as const,
      category: 'celebration' as const,
    };
    const groups = groupAlertsForPresentation([urgent, upcoming, celebration]);

    expect(groups.map((group) => [group.id, group.alerts.map((item) => item.id)])).toEqual([
      ['act-now', [urgent.id]],
      ['coming-up', [upcoming.id]],
      ['relationship-moments', [celebration.id]],
      ['data-readiness', []],
    ]);

    const html = renderToStaticMarkup(<AlertCenter
      alerts={[urgent, upcoming, celebration]}
      citations={[urgent, upcoming, celebration].flatMap((item) => item.citations)}
      warnings={[]}
      asOf={AS_OF}
      availability="available"
      dataMode="live"
    />);
    expect(html).toContain('Current priorities');
    expect(html).toContain('Why this alert?');
    expect(html).toContain('aria-controls="alerts-act-now-panel"');
    expect(html).toContain('duration-200 motion-reduce:transition-none');
    expect(html).toContain('Live workspace');
  });

  it('keeps exactly four zero-aware group tiles and marks partial counts as incomplete', () => {
    const html = renderToStaticMarkup(<AlertCenter
      alerts={[alert('partial-contact', 1)]}
      citations={[]}
      warnings={['Some records were not authorized.']}
      asOf={AS_OF}
      availability="partial"
    />);

    expect((html.match(/aria-pressed="false"/g) ?? [])).toHaveLength(13);
    expect(html).toContain('At least 1 alert');
    expect(html).toContain('Partial result · counts are incomplete');
    expect(html).toContain('Some records were not authorized.');
  });
});
