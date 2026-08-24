import type { ActivityEvent, ActivityEventType } from '../domain/activity.ts';
import type { Contact } from '../domain/contact.ts';
import { displayName } from '../domain/contact.ts';

const EVENT_COPY: Readonly<Record<ActivityEventType, { singular: string; plural: string; detail: string }>> = {
  'contact-created': { singular: 'Contact added', plural: 'Contacts added', detail: 'A new relationship record was created for' },
  'contact-updated': { singular: 'Contact updated', plural: 'Contacts updated', detail: 'Stored contact information was updated for' },
  'contact-imported': { singular: 'Contact imported', plural: 'Contacts imported', detail: 'An authorized import added' },
  'note-added': { singular: 'Note saved', plural: 'Notes saved', detail: 'New relationship context was recorded for' },
  'touch-recorded': { singular: 'Follow-up recorded', plural: 'Follow-ups recorded', detail: 'The latest contact rhythm was updated for' },
  'contact-archived': { singular: 'Contact archived', plural: 'Contacts archived', detail: 'Active work was paused for' },
  'contact-restored': { singular: 'Contact restored', plural: 'Contacts restored', detail: 'Active work resumed for' },
  'contact-point-added': { singular: 'Contact detail added', plural: 'Contact details added', detail: 'An email address or phone detail was organized for' },
  'contact-point-updated': { singular: 'Contact detail updated', plural: 'Contact details updated', detail: 'An email address or phone detail was updated for' },
  'contact-point-archived': { singular: 'Old contact detail archived', plural: 'Old contact details archived', detail: 'An outdated email address or phone detail was set aside for' },
  'contact-point-restored': { singular: 'Contact detail restored', plural: 'Contact details restored', detail: 'A previously archived contact detail was restored for' },
  'household-updated': { singular: 'Household updated', plural: 'Households updated', detail: 'Household information changed for' },
  'relationship-updated': { singular: 'Relationship updated', plural: 'Relationships updated', detail: 'A relationship changed for' },
  'assignment-updated': { singular: 'Assignment updated', plural: 'Assignments updated', detail: 'Workspace responsibility changed for' },
  'custom-field-updated': { singular: 'Additional detail updated', plural: 'Additional details updated', detail: 'An additional CRM detail changed for' },
  'pipeline-stage-changed': { singular: 'Pipeline stage changed', plural: 'Pipeline stages changed', detail: 'Deal progress was updated for' },
  'incomplete-record-received': { singular: 'New intake received', plural: 'New intakes received', detail: 'A new lead needs review for' },
  'incomplete-record-converted': { singular: 'Intake converted', plural: 'Intakes converted', detail: 'A reviewed intake became a contact for' },
  'email-metadata-linked': { singular: 'Email activity linked', plural: 'Email activities linked', detail: 'Authorized Gmail activity was linked for' },
  'email-sent': { singular: 'Email sent', plural: 'Emails sent', detail: 'A provider-confirmed email send was recorded for' },
  'task-created': { singular: 'Task added', plural: 'Tasks added', detail: 'A follow-up task entered the queue for' },
  'task-completed': { singular: 'Task completed', plural: 'Tasks completed', detail: 'A follow-up task was completed for' },
  'task-archived': { singular: 'Task archived', plural: 'Tasks archived', detail: 'A task was removed from active work for' },
};

export interface ActivityFeedGroup {
  readonly id: string;
  readonly type: ActivityEventType;
  readonly label: string;
  readonly detail: string;
  readonly occurredAt: string;
  readonly count: number;
  readonly contacts: readonly { id: string; name: string }[];
}

export function activityEventLabel(type: ActivityEventType): string {
  return EVENT_COPY[type].singular;
}

export function groupRecentActivity(events: readonly ActivityEvent[], contacts: readonly Contact[]): readonly ActivityFeedGroup[] {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const grouped = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = `${event.type}:${new Date(event.occurredAt).toISOString().slice(0, 16)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return [...grouped.entries()].map(([id, entries]) => {
    const first = entries[0] as ActivityEvent;
    const linkedContacts = [...new Map(entries.flatMap((event) => {
      const contact = event.contactId ? contactsById.get(event.contactId) : undefined;
      return contact ? [[contact.id, { id: contact.id, name: displayName(contact) }] as const] : [];
    })).values()];
    const copy = EVENT_COPY[first.type];
    const count = entries.length;
    return {
      id,
      type: first.type,
      label: count === 1 ? copy.singular : copy.plural,
      detail: count === 1 && linkedContacts[0]
        ? `${copy.detail} ${linkedContacts[0].name}.`
        : `${count} updates across ${linkedContacts.length || count} ${linkedContacts.length === 1 ? 'contact' : 'contacts'}.`,
      occurredAt: first.occurredAt,
      count,
      contacts: linkedContacts,
    };
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
}
