import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContactImportSourceFactRecord } from '@/lib/domain/rich-contact';
import type { Contact } from '@/lib/domain/contact';
import { ImportedContactProfile, RichContactWorkspace } from './rich-contact-workspace';

function fact(
  id: string,
  category: ContactImportSourceFactRecord['category'],
  label: string,
  value: ContactImportSourceFactRecord['value'],
  valueType: ContactImportSourceFactRecord['valueType'] = 'text',
): ContactImportSourceFactRecord {
  return {
    id, workspaceId: 'workspace-a', contactId: 'contact-a', provider: 'first-class-real-estate',
    schemaVersion: 'first-class-real-estate.contact-profile.v1', key: id, label, category,
    valueType, value, valueHash: 'a'.repeat(64), sourceRowNumber: 2,
    groupIdempotencyKey: 'private-group-key', requestHash: 'b'.repeat(64),
    capturedAt: '2026-08-18T12:00:00.000Z',
  };
}

describe('ImportedContactProfile', () => {
  it('groups typed facts into expandable sections and explains consent non-escalation', () => {
    const html = renderToStaticMarkup(<ImportedContactProfile facts={[
      fact('first-name', 'identity', 'First Name', 'Synthetic'),
      fact('assigned-agent', 'ownership', 'Assigned Agent', 'Example Agent'),
      fact('primary-city', 'address', 'Primary City', 'Example City'),
      fact('deal-type', 'real-estate', 'Deal Type', 'buyer'),
      fact('call-count', 'engagement', 'Call Count', 3, 'number'),
      fact('email-verified', 'verification', 'Email Verified', true, 'boolean'),
      fact('email-optin', 'consent', 'Email Optin', true, 'boolean'),
      fact('status', 'other', 'Status', 'Legacy Client'),
    ]} />);

    expect(html).toContain('Imported profile · 8 preserved facts');
    for (const label of ['Identity', 'Ownership &amp; source', 'Addresses', 'Real-estate preferences',
      'Engagement', 'Verification', 'Consent evidence', 'Other source facts']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('do not grant messaging consent');
    expect(html).toContain('Email Optin');
    expect(html).toContain('Yes');
    expect(html).not.toContain('private-group-key');
    expect(html).not.toContain('bbbbbbbbbbbbbbbb');
  });

  it('renders nothing when no authorized facts were loaded', () => {
    expect(renderToStaticMarkup(<ImportedContactProfile facts={[]} />)).toBe('');
  });
});

describe('RichContactWorkspace archive continuation', () => {
  const contact: Contact = {
    id: 'contact-b', firstName: 'Bea', lastName: 'Lead', leadType: 'warm', relationship: 'lead',
    intent: 'unknown', source: 'other', pipelineStage: 'new', tags: [], createdAt: '2026-09-01T12:00:00.000Z',
  };
  const render = (archiveReturnContext?: string, archived = false) => renderToStaticMarkup(
    <RichContactWorkspace contact={contact} points={[]} households={[]} relationships={[]} assignments={[]}
      members={[]} contacts={[contact]} definitions={[]} customValues={[]} importedFacts={[]}
      archived={archived} isOwner archiveReturnContext={archiveReturnContext} />,
  );

  it('submits the list context with the archive form and explains where work continues', () => {
    const html = render('q=Bea&from=list');
    expect(html).toContain('name="returnContext" value="q=Bea&amp;from=list"');
    expect(html).toContain('After archiving, the next contact in this list opens.');
  });

  it('omits list context for direct access and keeps the restore path for archived records', () => {
    expect(render()).not.toContain('returnContext');
    expect(render()).toContain('After archiving, you return to your contacts.');
    const archivedHtml = render(undefined, true);
    expect(archivedHtml).toContain('Restore contact');
    expect(archivedHtml).not.toContain('Archive record');
  });
});
