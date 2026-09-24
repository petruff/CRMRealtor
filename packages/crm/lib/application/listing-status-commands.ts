import { appendActivityEventCommand } from './activity-commands.ts';
import type { ContactActivityContext } from './contact-commands.ts';
import type { ContactRepository } from '../data/repository.ts';
import { displayName } from '../domain/contact.ts';
import { listingStatusPatch, ListingStatusError, parseListingStatusInput } from '../domain/listing-status.ts';

/** Saves a seller's listing status and address. */
export async function setListingStatus(input: {
  readonly repository: ContactRepository;
  readonly activity?: ContactActivityContext;
  readonly contactId: unknown;
  readonly status: unknown;
  readonly propertyAddress: unknown;
  readonly now?: Date;
}): Promise<{ readonly message: string }> {
  const now = input.now ?? new Date();
  if (typeof input.contactId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.contactId)) throw new ListingStatusError('Choose a contact first.');
  const contact = await input.repository.get(input.contactId);
  if (!contact || contact.archivedAt) throw new ListingStatusError('This contact is archived or no longer exists.');
  const parsed = parseListingStatusInput(input);
  await input.repository.update(contact.id, listingStatusPatch(contact, parsed));
  if (input.activity) await appendActivityEventCommand(input.activity.repository, input.activity.scope, { type: 'contact-updated', contactId: contact.id, idempotencyKey: `contact-updated:${contact.id}:${now.getTime()}` }, now);
  return { message: `${displayName(contact)}’s listing is ${parsed.status.toLowerCase()}.` };
}
