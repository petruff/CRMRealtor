import type { Contact } from './contact.ts';

/** A named physical-mail campaign, such as a postcard or holiday card. */
export interface Mailer {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
}

/** Row existence is the checked state; sentOn is a calendar fact. */
export interface MailerSend {
  mailerId: string;
  contactId: string;
  sentOn: string;
}

export interface MailerCampaign extends Mailer {
  sends: MailerSend[];
}

export interface MailerSummary {
  sent: number;
  remaining: number;
  total: number;
  needsAddress: number;
}

export const MAILER_NAME_MAX = 120;
export const MAILER_NOTES_MAX = 1_000;

export const MAILING_ADDRESS_LABELS = {
  mailingAddress: 'street',
  city: 'city',
  state: 'state',
  postalCode: 'ZIP code',
} as const;

export type MailingAddressField = keyof typeof MAILING_ADDRESS_LABELS;

export function missingMailingAddressFields(
  contact: Pick<Contact, MailingAddressField>,
): MailingAddressField[] {
  return (Object.keys(MAILING_ADDRESS_LABELS) as MailingAddressField[])
    .filter((field) => !contact[field]?.trim());
}

export function isMailingReady(contact: Pick<Contact, MailingAddressField>): boolean {
  return missingMailingAddressFields(contact).length === 0;
}

/** Count current deliverability without deleting historical sends. */
export function summarizeMailer(
  contacts: readonly Pick<Contact, 'id' | MailingAddressField>[],
  sends: readonly MailerSend[],
): MailerSummary {
  const eligibleContacts = contacts.filter(isMailingReady);
  const eligible = new Set(eligibleContacts.map((contact) => contact.id));
  const sent = new Set(
    sends.filter((send) => eligible.has(send.contactId)).map((send) => send.contactId),
  ).size;
  return {
    sent,
    remaining: Math.max(0, eligible.size - sent),
    total: eligible.size,
    needsAddress: contacts.length - eligibleContacts.length,
  };
}
