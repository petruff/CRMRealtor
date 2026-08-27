import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IncompleteRecordWorkspace } from './incomplete-record-workspace';
import type { IncompleteRecord } from '@/lib/domain/incomplete-record';

function record(id: string, email: string, firstName?: string): IncompleteRecord {
  return {
    id,
    workspaceId: 'workspace-a',
    source: 'mailchimp-live',
    candidate: { email, ...(firstName ? { firstName } : {}) },
    reasons: [{
      field: 'email',
      code: 'mailchimp-no-canonical-match',
      message: 'Mailchimp email has no canonical CRM contact.',
    }],
    status: 'pending',
    createdAt: '2026-08-24T12:00:00.000Z',
    updatedAt: '2026-08-24T12:00:00.000Z',
  };
}

describe('IncompleteRecordWorkspace', () => {
  it('turns the Mailchimp quarantine into a compact, human-readable review queue', () => {
    const records = [
      record('record-a', '3057907984@kvleads.com'),
      record('record-b', 'ana@example.com', 'Ana'),
    ];
    const html = renderToStaticMarkup(<IncompleteRecordWorkspace
      records={records}
      previews={{
        'record-b': { action: 'create', changes: ['firstName', 'email'] },
      }}
    />);

    expect(html).toContain('Needs review');
    expect(html).toContain('Ready to add');
    expect(html).toContain('Missing a name');
    expect(html).toContain('New lead · (305) 790-7984');
    expect(html).toContain('Mailchimp audience');
    expect(html).toContain('This person is in Mailchimp but is not yet matched to an Omnix contact.');
    expect(html).toContain('Review and add to CRM');
    expect(html).not.toContain('Unnamed intake');
    expect(html).not.toContain('no canonical CRM contact');
  });
});
