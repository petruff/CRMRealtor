import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import type { PipelineEvidenceResult } from '@/lib/application/pipeline-evidence';

vi.mock('@/app/pipeline/actions', () => ({ movePipelineStageAction: vi.fn() }));

import { PipelineBoard } from '@/components/pipeline-board';

const contact: Contact = {
  id: 'contact-1', firstName: 'Judith', lastName: 'Client', leadType: 'hot',
  relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'active',
  tags: [], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z',
};

function render(evidence: PipelineEvidenceResult): string {
  return renderToStaticMarkup(<PipelineBoard initialContacts={[contact]} evidence={evidence} />);
}

describe('PipelineBoard next-step evidence', () => {
  it('shows an actual task date, source, latest activity, and button affordance', () => {
    const html = render({
      availability: 'available',
      byContactId: {
        [contact.id]: {
          nextStep: {
            kind: 'task', date: '2026-08-14T15:00:00.000Z', label: 'Confirm inspection',
            source: 'Open CRM task', href: '/activities?contactId=contact-1',
          },
          latestActivity: {
            type: 'task-created', occurredAt: '2026-08-12T12:00:00.000Z',
            source: 'CRM activity history', href: '/contacts/contact-1',
          },
        },
      },
    });

    expect(html).toContain('Confirm inspection');
    expect(html).toContain('Aug 14, 2026, 3:00 PM');
    expect(html).toContain('Source:</span> Open CRM task');
    expect(html).toContain('task created');
    expect(html).toContain('CRM activity history');
    expect(html).toContain('class="sk-secondary-button');
    expect(html).toContain('href="/activities?contactId=contact-1"');
  });

  it('renders explicit missing remediation without inventing a deadline', () => {
    const html = render({ availability: 'available', byContactId: { [contact.id]: {} } });
    expect(html).toContain('Next step missing');
    expect(html).toContain('Add next touch');
    expect(html).toContain('No stored activity for this contact');
    expect(html).not.toMatch(/revenue|likelihood|closing deadline/i);
  });

  it('hides task/activity detail when the authorized projection is unavailable', () => {
    const html = render({ availability: 'unavailable', byContactId: {} });
    expect(html).toContain('Task and activity evidence unavailable');
    expect(html).toContain('href="/activities"');
    expect(html).not.toContain('Confirm inspection');
  });
});
