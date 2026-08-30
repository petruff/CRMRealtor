import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  preferredGreetingName,
  TodayCommandCenter,
  todayDateContext,
} from '@/components/today-command-center';
import type { Contact } from '@/lib/domain/contact';
import {
  OMNIX_CITATION_SCHEMA_VERSION,
  type OmnixCopilotAlert,
  type OmnixCopilotCitation,
} from '@/lib/domain/omnix-copilot';

const AS_OF = '2026-08-12T14:00:00.000Z';

const STORED_CONTACT: Contact = {
  id: 'contact-1', firstName: 'Judith', lastName: 'Serna', leadType: 'hot',
  relationship: 'lead', intent: 'seller', source: 'website', pipelineStage: 'new',
  tags: [], createdAt: '2026-08-12T13:00:00.000Z', nextTouchAt: '2026-08-12',
};

function alert(index: number): OmnixCopilotAlert {
  const citation: OmnixCopilotCitation = {
    id: `citation-${index}`, schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
    entityType: 'contact', recordId: `contact-${index}`, factKeys: ['nextTouchAt'],
    responseAsOf: AS_OF, target: `/contacts/contact-${index}`, rule: 'due-today-follow-up',
  };
  return {
    id: `alert-${index}`, rule: 'due-today-follow-up', category: 'follow-up',
    priority: 'high', order: index, reason: `Canonical alert ${index}`, asOf: AS_OF,
    recordId: `contact-${index}`, href: `/contacts/contact-${index}`, citations: [citation],
  };
}

describe('TodayCommandCenter', () => {
  it('uses a concise truthful greeting name and the configured workspace timezone', () => {
    expect(preferredGreetingName('  Judith   Serna  ')).toBe('Judith');
    expect(preferredGreetingName('')).toBeUndefined();
    expect(todayDateContext(new Date('2026-08-14T00:24:00.000Z'), 'America/New_York')).toEqual({
      greeting: 'Good evening',
      dateLabel: 'Thursday, August 13',
    });
  });

  it('bounds the canonical alert preview, retains Today blocks, and renders the queue explorer', () => {
    const alerts = [alert(1), alert(2), alert(3), alert(4)];
    const html = renderToStaticMarkup(<TodayCommandCenter
      alerts={{
        alerts, citations: alerts.flatMap((item) => item.citations), warnings: [],
        asOf: AS_OF, availability: 'available', dataMode: 'live',
      }}
      contacts={[STORED_CONTACT]}
      userDisplayName="Judith Serna"
      timeZone="America/New_York"
    />);

    expect(html).toContain('Good morning, Judith.');
    expect(html).toContain('Here&#x27;s your day, in order.');
    expect(html).toContain('Canonical alert 1');
    expect(html).toContain('Canonical alert 3');
    expect(html).not.toContain('Canonical alert 4');
    expect(html).toContain('Review the full alert horizon');
    expect(html).toContain('Work the day with intention.');
    expect(html).toContain('Relationship book');
    expect(html).toContain('Live CRM view');
    expect(html).toContain('Based on your saved details');
    expect(html).toContain('Need attention');
    expect(html).toContain('Hot relationships');
    expect(html).toContain('Active pipeline');
    expect(html).toContain('today-command-grid');
    expect(html).toContain('What needs you most');
    expect(html).toContain('Choose one and it stays in place while you work.');
    expect(html).not.toContain('Pause focus');
    expect(html).toContain('Based on next follow-up · Updated');
    expect(html).not.toContain('nextTouchAt');
    expect(html).toContain('Attention balance');
    expect(html).toContain('Relationship orbit');
    expect(html).toContain('Pipeline panorama');
    expect(html).toContain('The shape of your business, at a glance.');
    expect(html).toContain('Today is based on authorized CRM evidence');
    expect(html).toContain('Relationship queue');
    expect(html).toContain('Explore the complete work queue');
    expect(html).not.toContain('Who needs your attention');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).not.toContain('Every stored next step');
    expect(html).toContain('class="sk-primary-button');
    expect(html).toContain('class="sk-secondary-button');
    expect(html.indexOf('today-metric-ledger')).toBeLessThan(html.indexOf('today-timeline'));
    expect(html.indexOf('today-timeline')).toBeLessThan(html.indexOf('today-command-grid'));
    expect(html.indexOf('id="today-focus-detail"')).toBeLessThan(html.indexOf('today-command-attention'));
    expect(html.indexOf('today-command-attention')).toBeLessThan(html.indexOf('today-command-moments'));
    expect(html.indexOf('today-visual-dashboard')).toBeLessThan(html.indexOf('today-status-strip'));
    expect(html.indexOf('today-status-strip')).toBeLessThan(html.indexOf('today-queue-disclosure'));
  });

  it('keeps the rail open, elevates only focus, and declares deterministic responsive reading order', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.today-focus-shell\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.today-focus-detail\s*{[^}]*grid-area:\s*focus;[^}]*box-shadow:/s);
    expect(css).toContain("grid-template-areas: 'attention focus moments'");
    expect(css).toContain("grid-template-areas: 'focus' 'attention' 'moments'");
    expect(css).toContain('@container (min-width: 48rem) and (max-width: 61.99rem)');
    expect(css).toMatch(/\.today-studio\s*{[^}]*overflow-x:\s*clip;/s);
    expect(css).toContain("'focus focus'\n        'attention moments'");
    expect(css).toMatch(/\.today-moments-list\s*{[^}]*overflow:\s*visible;/s);
    expect(css).not.toMatch(/\.today-moments-list\s*{[^}]*max-height:/s);
    expect(css).toMatch(/\.today-moments-list article a\[href\^='\/contacts\/'\]\s*{[^}]*min-height:\s*2\.75rem;/s);
  });

  it('shows one premium first-run composition without redundant zero dashboards', () => {
    const html = renderToStaticMarkup(<TodayCommandCenter
      alerts={{ alerts: [], citations: [], warnings: [], asOf: AS_OF, availability: 'available', dataMode: 'sample' }}
      contacts={[]}
      timeZone="America/New_York"
    />);
    expect(html).toContain('Bring the relationships in');
    expect(html).toContain('Import contacts');
    expect(html).toContain('Add one contact');
    expect(html).toContain('Review connections');
    expect(html).toContain('Sample CRM view');
    expect(html).toContain('Made-up contacts for preview only');
    expect(html).not.toContain('Where today stands');
    expect(html).not.toContain('You’re clear for now');
    expect(html).not.toContain('Build your first follow-up list');
  });
});
