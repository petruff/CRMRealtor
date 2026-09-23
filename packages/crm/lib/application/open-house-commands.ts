import type { ContactRepository } from '../data/repository.ts';
import { ensureNextTouch } from '../domain/cadence.ts';
import type { Contact } from '../domain/contact.ts';
import {
  openHouseLeadType, openHouseNote, openHouseTag, parseOpenHouseSignIn, validateOpenHouseProperty,
} from '../domain/open-house.ts';
import { appendActivityEventCommand } from './activity-commands.ts';
import type { ContactActivityContext } from './contact-commands.ts';

export interface OpenHouseSignInResult {
  readonly contactId: string;
  readonly firstName: string;
  readonly created: boolean;
}

function digits(value?: string): string | undefined {
  if (!value) return undefined;
  let result = value.replace(/\D/g, '');
  if (result.length === 11 && result.startsWith('1')) result = result.slice(1);
  return result || undefined;
}

function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Turns one kiosk sign-in into a CRM lead. A returning person (same phone or
 * email) is updated instead of duplicated, and existing consent or temperature
 * is never downgraded by a walk-in form.
 */
export async function signInOpenHouseVisitorCommand(
  repository: ContactRepository,
  input: { readonly property: unknown; readonly form: FormData; readonly timeZone?: string },
  now = new Date(),
  activity?: ContactActivityContext,
): Promise<OpenHouseSignInResult> {
  const property = validateOpenHouseProperty(input.property);
  const signIn = parseOpenHouseSignIn(input.form);
  const tag = openHouseTag(property, localDay(now, input.timeZone ?? 'America/New_York'));
  const tags = [tag, ...(signIn.hasAgent ? ['has-agent'] : []), ...(signIn.smsConsent ? ['sms-consent'] : [])];
  const note = openHouseNote(signIn, property, now.toISOString());

  const existing = (await repository.list()).find((contact) =>
    (signIn.phoneDigits && digits(contact.phone) === signIn.phoneDigits)
    || (signIn.email && contact.email?.toLowerCase() === signIn.email));

  let contact: Contact;
  let created = false;
  if (existing) {
    contact = await repository.update(existing.id, {
      tags: Array.from(new Set([...existing.tags, ...tags])),
      ...(signIn.emailConsent && !existing.emailSubscribed ? { emailSubscribed: true } : {}),
      ...(!existing.phone && signIn.phone ? { phone: signIn.phone } : {}),
      ...(!existing.email && signIn.email ? { email: signIn.email } : {}),
    });
  } else {
    const draft: Contact = ensureNextTouch({
      id: 'pending',
      createdAt: now.toISOString(),
      firstName: signIn.firstName,
      lastName: signIn.lastName,
      ...(signIn.phone ? { phone: signIn.phone } : {}),
      ...(signIn.email ? { email: signIn.email } : {}),
      leadType: openHouseLeadType(signIn),
      relationship: 'lead',
      intent: signIn.intent,
      source: 'open-house',
      pipelineStage: 'new',
      tags,
      emailSubscribed: signIn.emailConsent,
      touchDateOverridden: false,
    }, now);
    const { id: _id, createdAt: _createdAt, ...fields } = draft;
    void _id; void _createdAt;
    contact = await repository.create(fields);
    created = true;
    if (activity) {
      await appendActivityEventCommand(activity.repository, activity.scope, {
        type: 'contact-created', contactId: contact.id, idempotencyKey: `contact-created:${contact.id}`,
      }, now);
    }
  }
  const saved = await repository.addNote(contact.id, note);
  if (activity) {
    await appendActivityEventCommand(activity.repository, activity.scope, {
      type: 'note-added', contactId: contact.id, idempotencyKey: `note-added:${saved.id}`,
    }, now);
  }
  return { contactId: contact.id, firstName: signIn.firstName, created };
}

/** Visitors who signed in at any open house on the given local day. */
export function openHouseVisitors(contacts: readonly Contact[], day: string): Contact[] {
  return contacts.filter((contact) => contact.tags.some((tag) => tag.startsWith(`open-house:${day}:`)));
}
