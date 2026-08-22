import { isMailingReady, type MailerCampaign, type MailerSend } from '../domain/mailer.ts';
import type { ContactRepository } from '../data/repository.ts';
import type { MailerRepository } from '../data/mailer-repository.ts';

const MAILER_NAME_MAX = 120;
const MAILER_NOTES_MAX = 1_000;

export class MailerCommandError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'MailerCommandError';
    this.fieldErrors = fieldErrors;
  }
}

export function isMailerCommandError(error: unknown): error is MailerCommandError {
  return error instanceof MailerCommandError;
}

type CampaignInput = FormData | { name?: unknown; notes?: unknown };

function field(input: CampaignInput, key: 'name' | 'notes'): string {
  const value = input instanceof FormData ? input.get(key) : input[key];
  return typeof value === 'string' ? value.trim() : '';
}

function identifier(value: string, label: string): string {
  const clean = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clean)) {
    throw new MailerCommandError(`${label} is invalid.`);
  }
  return clean;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function currentDateOnly(now: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value;
      const year = value('year');
      const month = value('month');
      const day = value('day');
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      throw new MailerCommandError('Configured CRM time zone is invalid.');
    }
  }
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function listMailerCampaignsCommand(
  repository: MailerRepository,
): Promise<MailerCampaign[]> {
  return repository.list();
}

export async function createMailerCampaignCommand(
  repository: MailerRepository,
  input: CampaignInput,
): Promise<MailerCampaign> {
  const name = field(input, 'name');
  const notes = field(input, 'notes');
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = 'Enter a campaign name.';
  else if (name.length > MAILER_NAME_MAX) {
    fieldErrors.name = `Use ${MAILER_NAME_MAX} characters or fewer.`;
  }
  if (notes.length > MAILER_NOTES_MAX) {
    fieldErrors.notes = `Use ${MAILER_NOTES_MAX} characters or fewer.`;
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new MailerCommandError('Check the campaign details.', fieldErrors);
  }
  return repository.create({ name, notes: notes || undefined });
}

export async function markMailerSentCommand(
  repository: MailerRepository,
  contacts: ContactRepository,
  mailerId: string,
  contactId: string,
  sentOn = currentDateOnly(),
): Promise<MailerSend> {
  const campaign = identifier(mailerId, 'Mailer campaign');
  const contactIdValue = identifier(contactId, 'Contact');
  if (!validDateOnly(sentOn)) throw new MailerCommandError('Send date is invalid.');
  const contact = await contacts.get(contactIdValue);
  if (!contact) throw new MailerCommandError('Contact not found.');
  if (!isMailingReady(contact)) {
    throw new MailerCommandError(
      'Add a complete street, city, state, and ZIP code before marking this postcard sent.',
      { mailingAddress: 'Complete the mailing address first.' },
    );
  }
  return repository.markSent(campaign, contactIdValue, sentOn);
}

export async function unmarkMailerSentCommand(
  repository: MailerRepository,
  mailerId: string,
  contactId: string,
): Promise<void> {
  return repository.unmarkSent(
    identifier(mailerId, 'Mailer campaign'),
    identifier(contactId, 'Contact'),
  );
}
