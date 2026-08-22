import { describe, expect, it } from 'vitest';
import type { Contact } from './contact';
import { buildPipeline, buildWorkspaceSnapshot, PIPELINE_STAGE_ORDER } from './workspace-intelligence';

function contact(id: string, patch: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName: id,
    lastName: 'Person',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'unknown',
    source: 'referral',
    pipelineStage: 'new',
    tags: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    emailSubscribed: true,
    ...patch,
  };
}

describe('workspace intelligence', () => {
  const now = new Date('2026-08-11T14:00:00.000Z');

  it('places every contact in one stable real-estate pipeline column', () => {
    const contacts = [
      contact('new'),
      contact('active', { pipelineStage: 'active' }),
      contact('closed', { pipelineStage: 'closed' }),
    ];
    const pipeline = buildPipeline(contacts);
    expect(pipeline.map((column) => column.stage)).toEqual(PIPELINE_STAGE_ORDER);
    expect(pipeline.flatMap((column) => column.contacts).map((item) => item.id).sort())
      .toEqual(['active', 'closed', 'new']);
  });

  it('derives source and readiness metrics only from stored contact facts', () => {
    const contacts = [
      contact('ready', {
        phone: '4045550100', email: 'ready@example.com', nextTouchAt: '2026-08-12',
        mailingAddress: '10 Main St', city: 'Decatur', state: 'GA', postalCode: '30030',
      }),
      contact('social', { source: 'social-media' }),
    ];
    const snapshot = buildWorkspaceSnapshot(contacts, now);
    expect(snapshot.totalContacts).toBe(2);
    expect(snapshot.readiness).toMatchObject({ withPhone: 1, withEmail: 1, mailReady: 1, noDirectChannel: 1 });
    expect(snapshot.sources.find((source) => source.id === 'referral')?.count).toBe(1);
    expect(snapshot.sources.find((source) => source.id === 'social-media')?.count).toBe(1);
  });

  it('explains first-contact, overdue, address, celebration, and pipeline risks', () => {
    const contacts = [
      contact('new-lead', { phone: '4045550101' }),
      contact('overdue', { lastContactedAt: '2026-08-01T12:00:00.000Z', nextTouchAt: '2026-08-10' }),
      contact('birthday', { birthdate: '1990-08-12', lastContactedAt: '2026-08-10T12:00:00.000Z' }),
      contact('deal', { pipelineStage: 'under-contract', lastContactedAt: '2026-08-10T12:00:00.000Z' }),
    ];
    const recommendations = buildWorkspaceSnapshot(contacts, now).recommendations;
    expect(recommendations.find((item) => item.id === 'first-contact')?.contactIds).toContain('new-lead');
    expect(recommendations.find((item) => item.id === 'overdue')?.contactIds).toContain('overdue');
    expect(recommendations.find((item) => item.id === 'address')?.count).toBe(4);
    expect(recommendations.find((item) => item.id === 'celebrations')?.contactIds).toContain('birthday');
    expect(recommendations.find((item) => item.id === 'pipeline-risk')?.contactIds).toContain('deal');
    expect(recommendations.every((item) => item.evidence.length > 0)).toBe(true);
  });
});

