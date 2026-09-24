import { displayName, type Contact } from '../domain/contact.ts';
import { overrideNextTouch } from '../domain/cadence.ts';
import { extractVoiceUpdate, voiceUpdatePatch, VOICE_UPDATE_MAX, type VoiceChangeField, type VoiceUpdatePreview } from '../domain/voice-update.ts';
import { appendActivityEventCommand } from './activity-commands.ts';
import { recordContactTouchCommand, type ContactActivityContext } from './contact-commands.ts';
import type { ContactRepository } from '../data/repository.ts';

export class VoiceUpdateError extends Error {}

export interface VoiceUpdateReview extends VoiceUpdatePreview {
  readonly contactId: string;
  readonly contactName: string;
}

function validText(text: unknown): string {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) throw new VoiceUpdateError('Say or type what happened first.');
  if (value.length > VOICE_UPDATE_MAX) throw new VoiceUpdateError(`Keep the update under ${VOICE_UPDATE_MAX} characters.`);
  return value;
}

async function activeContact(repository: ContactRepository, contactId: unknown): Promise<Contact> {
  if (typeof contactId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(contactId)) throw new VoiceUpdateError('Choose a contact first.');
  const contact = await repository.get(contactId);
  if (!contact || contact.archivedAt) throw new VoiceUpdateError('That contact is no longer available.');
  return contact;
}

/** Read-only: what Omnix would change. */
export async function reviewVoiceUpdate(repository: ContactRepository, contactId: unknown, text: unknown, today: string): Promise<VoiceUpdateReview> {
  const contact = await activeContact(repository, contactId);
  return { ...extractVoiceUpdate(validText(text), contact, today), contactId: contact.id, contactName: displayName(contact) };
}

/**
 * Applies only the changes the realtor kept. The server re-reads the words she
 * confirmed, so the browser can choose which changes to keep but never invent one.
 */
export async function applyVoiceUpdate(input: {
  readonly repository: ContactRepository;
  readonly activity?: ContactActivityContext;
  readonly contactId: unknown;
  readonly text: unknown;
  readonly keep: unknown;
  readonly saveNote: unknown;
  readonly today: string;
  readonly now?: Date;
}): Promise<{ readonly message: string; readonly changed: number }> {
  const now = input.now ?? new Date();
  const contact = await activeContact(input.repository, input.contactId);
  const text = validText(input.text);
  const keep = new Set(Array.isArray(input.keep) ? input.keep.filter((field): field is VoiceChangeField => typeof field === 'string') : []);
  const preview = extractVoiceUpdate(text, contact, input.today);
  const kept = preview.changes.filter((change) => keep.has(change.field));
  const { patch, talked, nextTouchAt } = voiceUpdatePatch(contact, kept);

  if (input.saveNote === true) {
    const note = await input.repository.addNote(contact.id, preview.note);
    if (input.activity) await appendActivityEventCommand(input.activity.repository, input.activity.scope, { type: 'note-added', contactId: contact.id, idempotencyKey: `note-added:${note.id}` }, now);
  }
  if (Object.keys(patch).length) {
    await input.repository.update(contact.id, patch);
    if (input.activity) await appendActivityEventCommand(input.activity.repository, input.activity.scope, { type: 'contact-updated', contactId: contact.id, idempotencyKey: `contact-updated:${contact.id}:${now.getTime()}` }, now);
  }
  if (talked) await recordContactTouchCommand(input.repository, contact.id, now, input.activity);
  if (nextTouchAt) {
    const current = (await input.repository.get(contact.id)) ?? contact;
    const overridden = overrideNextTouch(current, nextTouchAt);
    await input.repository.update(contact.id, { nextTouchAt: overridden.nextTouchAt, touchDateOverridden: true });
  }
  const changed = kept.length + (input.saveNote === true ? 1 : 0);
  return { message: changed ? `${displayName(contact)} is up to date.` : 'Nothing was changed.', changed };
}
