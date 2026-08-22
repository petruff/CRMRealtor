import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodayFocusTimeline, boundedFocusAlerts } from '@/components/today-focus-timeline';
import {
  OMNIX_CITATION_SCHEMA_VERSION,
  type OmnixCopilotAlert,
  type OmnixCopilotCitation,
} from '@/lib/domain/omnix-copilot';

const AS_OF = '2026-08-12T14:00:00.000Z';

function alert(index: number): OmnixCopilotAlert {
  const citation: OmnixCopilotCitation = {
    id: `citation-${index}`,
    schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
    entityType: 'contact',
    recordId: `contact-${index}`,
    factKeys: ['lastContactedAt', 'nextTouchAt'],
    responseAsOf: AS_OF,
    target: `/contacts/contact-${index}`,
    rule: 'overdue-follow-up',
  };
  return {
    id: `alert-${index}`,
    rule: 'overdue-follow-up',
    category: 'follow-up',
    priority: index === 1 ? 'urgent' : 'high',
    order: index,
    reason: `Follow up with contact ${index}`,
    asOf: AS_OF,
    recordId: `contact-${index}`,
    href: `/contacts/contact-${index}`,
    citations: [citation],
  };
}

describe('TodayFocusTimeline', () => {
  it('keeps the canonical order and bounds focus to three alerts', () => {
    const alerts = [alert(1), alert(2), alert(3), alert(4)];
    expect(boundedFocusAlerts(alerts).map((item) => item.id)).toEqual(['alert-1', 'alert-2', 'alert-3']);

    const html = renderToStaticMarkup(<TodayFocusTimeline
      alerts={alerts}
      citations={alerts.flatMap((item) => item.citations)}
      warnings={[]}
      asOf={AS_OF}
      formattedAsOf="Aug 12, 10:00 AM"
      availability="available"
      dataMode="live"
    />);

    expect(html).toContain('Follow up with contact 1');
    expect(html).toContain('Follow up with contact 3');
    expect(html).not.toContain('Follow up with contact 4');
    expect(html).toContain('Based on last contact and next follow-up · Updated Aug 12, 10:00 AM');
    expect(html).not.toContain('lastContactedAt');
    expect(html).not.toContain('nextTouchAt');
    expect(html).toContain('Choose one and it stays in place while you work.');
    expect(html).not.toContain('Pause focus');
    expect(html).toContain('aria-current="step"');
  });

  it('fails closed when alert authority is unavailable', () => {
    const html = renderToStaticMarkup(<TodayFocusTimeline
      alerts={[alert(1)]}
      citations={[]}
      warnings={[]}
      asOf={AS_OF}
      formattedAsOf="Aug 12, 10:00 AM"
      availability="unavailable"
    />);
    expect(html).toContain('Priority timeline unavailable');
    expect(html).not.toContain('Follow up with contact 1');
    expect(html).toContain('No priority is shown until authorized CRM facts can be read safely.');
  });
});
