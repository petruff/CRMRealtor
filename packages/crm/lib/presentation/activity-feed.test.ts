import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../domain/activity.ts';
import type { Contact } from '../domain/contact.ts';
import { activityEventLabel, groupRecentActivity } from './activity-feed.ts';

const contact = { id: 'contact-1', firstName: 'Judith', lastName: 'Serna' } as Contact;
const event = (id: string, type: ActivityEvent['type']): ActivityEvent => ({
  id, workspaceId: 'workspace-1', type, contactId: 'contact-1', actorMembershipId: 'member-1',
  occurredAt: '2026-08-24T12:32:10.000Z', createdAt: '2026-08-24T12:32:10.000Z', idempotencyKey: id,
});

describe('activity feed presentation', () => {
  it('uses customer-facing activity names', () => {
    expect(activityEventLabel('contact-point-archived')).toBe('Old contact detail archived');
  });

  it('groups repetitive events from the same minute without losing contact links', () => {
    const groups = groupRecentActivity([
      event('event-1', 'contact-point-added'),
      event('event-2', 'contact-point-added'),
      event('event-3', 'contact-point-archived'),
    ], [contact]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ label: 'Contact details added', count: 2 });
    expect(groups[0]?.contacts).toEqual([{ id: 'contact-1', name: 'Judith Serna' }]);
  });
});
