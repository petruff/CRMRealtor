import { randomUUID } from 'node:crypto';
import type { ActivityRepository } from '../data/activity-repository.ts';
import type { ContactRepository } from '../data/repository.ts';
import { displayName, type Contact } from '../domain/contact.ts';
import { zonedLocalDateTimeToUtc } from '../domain/operational-signal.ts';
import {
  dueDate,
  findContactMentions,
  mentionsSelectedContact,
  type OmnixActionRequest,
} from '../domain/omnix-understanding.ts';
import { QUICK_TEXT_KINDS, quickText, quickTextHref } from '../domain/quick-texts.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createTaskCommand } from './activity-commands.ts';
import { addContactNoteCommand } from './contact-commands.ts';

/**
 * Action previews for the Omnix assistant. Previews never change anything:
 * texts open the phone's own Messages app, and tasks/notes are saved only when
 * the realtor taps Save on the preview (see `confirmOmnixAssistantAction`).
 */
export interface OmnixActionPerson {
  readonly id: string;
  readonly name: string;
  readonly firstName: string;
  readonly phone?: string;
}

export type OmnixActionPreview =
  | Readonly<{
    type: 'draft-text';
    person: OmnixActionPerson;
    language: 'en' | 'es';
    drafts: readonly { readonly kind: string; readonly label: string; readonly body: string; readonly href?: string; readonly recommended: boolean }[];
  }>
  | Readonly<{ type: 'create-task'; person: OmnixActionPerson; title: string; dueDate: string; dueTime: string; dueLabel: string }>
  | Readonly<{ type: 'log-note'; person: OmnixActionPerson; body: string }>
  | Readonly<{ type: 'choose-contact'; candidates: readonly (OmnixActionPerson & { readonly detail: string })[] }>
  | Readonly<{ type: 'need-contact' }>;

function person(contact: Contact): OmnixActionPerson {
  return {
    id: contact.id,
    name: displayName(contact),
    firstName: (contact.preferredName ?? contact.firstName).trim() || displayName(contact),
    ...(contact.phone ? { phone: contact.phone } : {}),
  };
}

export function friendlyDueLabel(date: string, time: string, today: string): string {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow'
    : new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const [hour, minute] = time.split(':').map(Number);
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: minute ? '2-digit' : undefined, timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
  return `${day} at ${clock}`;
}

function taskTitle(action: Extract<OmnixActionRequest, { type: 'create-task' }>, name: string, question: string): string {
  const base = action.verb === 'call' ? `Call ${name}` : action.verb === 'text' ? `Text ${name}` : action.verb === 'email' ? `Email ${name}`
    : action.verb === 'meet' ? `Meet ${name}` : `Follow up with ${name}`;
  const about = /\b(?:about|re:?|regarding|sobre|acerca de)\s+(.{3,80}?)\s*(?:\b(?:today|tomorrow|tonight|next week|this week|on (?:mon|tues|wednes|thurs|fri|satur|sun)day|at \d.*|in \d+ (?:days?|weeks?)|hoje|amanh[aã]|ma[nñ]ana|hoy|na pr[oó]xima semana|la pr[oó]xima semana)\b.*)?[?.!]*$/iu.exec(question)?.[1];
  return (about ? `${base} about ${about.trim()}` : base).slice(0, 120);
}

export function prepareOmnixAction(input: {
  readonly action: OmnixActionRequest;
  readonly question: string;
  readonly contacts: readonly Contact[];
  readonly selectedContactId?: string;
  readonly today: string;
}): OmnixActionPreview {
  const selected = input.selectedContactId ? input.contacts.find((contact) => contact.id === input.selectedContactId && !contact.archivedAt) : undefined;
  const mentions = findContactMentions(input.question, input.contacts);
  let target: Contact | undefined;
  if (selected && (mentionsSelectedContact(input.question) || !mentions.matches.length || mentions.matches.some((contact) => contact.id === selected.id))) target = selected;
  else if (mentions.matches.length === 1) target = mentions.matches[0];
  else if (mentions.matches.length > 1) {
    return {
      type: 'choose-contact',
      candidates: mentions.matches.slice(0, 6).map((contact) => ({ ...person(contact), detail: [contact.city, contact.phone ? 'has phone' : undefined].filter(Boolean).join(' · ') || contact.relationship })),
    };
  }
  if (!target) return { type: 'need-contact' };
  const who = person(target);

  const action = input.action;
  if (action.type === 'draft-text') {
    const language = action.language;
    const order = [action.kind, ...QUICK_TEXT_KINDS.map((item) => item.kind).filter((kind) => kind !== action.kind)];
    const drafts = order.map((kind) => {
      const body = quickText(kind, language, { firstName: who.firstName });
      const label = QUICK_TEXT_KINDS.find((item) => item.kind === kind)?.label ?? 'Message';
      const href = who.phone ? quickTextHref(who.phone, body) : undefined;
      return { kind, label, body, ...(href ? { href } : {}), recommended: kind === action.kind };
    });
    return { type: 'draft-text', person: who, language, drafts };
  }
  if (action.type === 'create-task') {
    const date = dueDate(action.due, input.today);
    const time = `${String(action.due.hour ?? 9).padStart(2, '0')}:${String(action.due.minute ?? 0).padStart(2, '0')}`;
    return { type: 'create-task', person: who, title: taskTitle(action, who.name, input.question), dueDate: date, dueTime: time, dueLabel: friendlyDueLabel(date, time, input.today) };
  }
  return { type: 'log-note', person: who, body: action.body };
}

// ---------------------------------------------------------------------------
// Confirmation (explicit tap only)
// ---------------------------------------------------------------------------

export type OmnixActionConfirmation =
  | Readonly<{ type: 'create-task'; contactId: string; title: string; dueDate: string; dueTime: string }>
  | Readonly<{ type: 'log-note'; contactId: string; body: string }>;

export class OmnixActionError extends Error {}

export function parseOmnixActionConfirmation(value: unknown): OmnixActionConfirmation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OmnixActionError('Nothing to save.');
  const input = value as Record<string, unknown>;
  const contactId = typeof input.contactId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(input.contactId) ? input.contactId : undefined;
  if (!contactId) throw new OmnixActionError('Choose a contact first.');
  if (input.type === 'create-task') {
    const title = typeof input.title === 'string' ? input.title.trim().replace(/\s+/gu, ' ') : '';
    if (!title || title.length > 160 || /[\u0000-\u001f\u007f]/u.test(title)) throw new OmnixActionError('Give the follow-up a short title.');
    const date = typeof input.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(input.dueDate) && !Number.isNaN(Date.parse(`${input.dueDate}T00:00:00Z`)) ? input.dueDate : undefined;
    const time = typeof input.dueTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(input.dueTime) ? input.dueTime : undefined;
    if (!date || !time) throw new OmnixActionError('Choose a date and time.');
    return { type: 'create-task', contactId, title, dueDate: date, dueTime: time };
  }
  if (input.type === 'log-note') {
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body || body.length > 5000) throw new OmnixActionError('Write the note before saving.');
    return { type: 'log-note', contactId, body };
  }
  throw new OmnixActionError('That action is not available.');
}

export interface OmnixActionContext {
  readonly repository: ContactRepository;
  readonly activityRepository?: ActivityRepository;
  readonly workspaceScope: WorkspaceScope;
  readonly timeZone: string;
}

export async function confirmOmnixAssistantAction(
  context: OmnixActionContext,
  confirmation: OmnixActionConfirmation,
  now = new Date(),
): Promise<{ readonly message: string; readonly href: string }> {
  const contact = await context.repository.get(confirmation.contactId);
  if (!contact || contact.archivedAt) throw new OmnixActionError('That contact is no longer available.');
  const href = `/contacts/${encodeURIComponent(contact.id)}`;
  if (confirmation.type === 'create-task') {
    if (!context.activityRepository) throw new OmnixActionError('Follow-ups are unavailable right now.');
    const dueAt = zonedLocalDateTimeToUtc(`${confirmation.dueDate}T${confirmation.dueTime}`, context.timeZone);
    await createTaskCommand(context.activityRepository, context.workspaceScope, {
      contactId: contact.id,
      title: confirmation.title,
      dueAt,
      idempotencyKey: `omnix-assistant-task:${randomUUID()}`,
    }, now);
    return { message: `Follow-up saved for ${displayName(contact)}.`, href };
  }
  const form = new FormData();
  form.set('body', confirmation.body);
  await addContactNoteCommand(context.repository, contact.id, form, now, context.activityRepository ? {
    repository: context.activityRepository,
    scope: context.workspaceScope,
  } : undefined);
  return { message: `Note saved to ${displayName(contact)}.`, href: `${href}#notes` };
}
