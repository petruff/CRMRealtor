import { displayName, initials, type Contact, type LeadType } from '../domain/contact.ts';

/**
 * "Revive old leads": a short daily batch of personal emails to leads who were
 * imported or captured but never worked. Each one is written for that person,
 * opened in the realtor's own email app, and only logged when she taps Mark
 * sent. Only contacts with an active email subscription are ever included, and
 * every draft tells them how to opt out.
 */
export const REVIVE_BATCH = 10;
export const REVIVE_QUIET_DAYS = 30;
/** Newer leads get the speed-to-lead text in Ready to send instead. */
export const REVIVE_MIN_AGE_DAYS = 7;

export interface ReviveItem {
  readonly contactId: string;
  readonly name: string;
  readonly firstName: string;
  readonly initials: string;
  readonly leadType: LeadType;
  readonly email: string;
  readonly angle: 'seller' | 'buyer' | 'general';
  readonly why: string;
  readonly subject: string;
  readonly body: string;
}

export interface ReviveBatch {
  readonly items: readonly ReviveItem[];
  readonly eligible: number;
}

const DAY = 86_400_000;
const TYPE_RANK: Record<LeadType, number> = { hot: 0, warm: 1, nurture: 2 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function first(contact: Contact): string {
  return (contact.preferredName ?? contact.firstName).trim();
}

/** "1450 Sunset Dr" from "1450 Sunset Dr, Coral Gables, FL 33143" — never invented. */
export function streetOf(contact: Pick<Contact, 'mailingAddress'>): string | undefined {
  const line = contact.mailingAddress?.split(/[,\n]/u)[0]?.replace(/\s+/gu, ' ').trim();
  return line && /\d/u.test(line) && /\p{L}/u.test(line) && line.length <= 80 ? line : undefined;
}

export function isReviveCandidate(contact: Contact, now: Date): boolean {
  if (contact.archivedAt || contact.relationship !== 'lead') return false;
  if (contact.pipelineStage !== 'new' && contact.pipelineStage !== 'contacted') return false;
  if (contact.emailSubscribed !== true || !contact.email || !EMAIL.test(contact.email.trim())) return false;
  if (contact.lastContactedAt && now.getTime() - Date.parse(contact.lastContactedAt) < REVIVE_QUIET_DAYS * DAY) return false;
  const created = Date.parse(contact.createdAt);
  return Number.isFinite(created) && now.getTime() - created >= REVIVE_MIN_AGE_DAYS * DAY;
}

/** The home they'd sell: the saved listing address first, then their mailing address. */
function homeStreet(contact: Contact): string | undefined {
  return streetOf({ mailingAddress: contact.seller?.propertyAddress }) ?? streetOf(contact);
}

function angleOf(contact: Contact): ReviveItem['angle'] {
  if (contact.intent === 'seller' || (contact.intent === 'both' && homeStreet(contact))) return 'seller';
  if (contact.intent === 'buyer' || contact.intent === 'both' || contact.intent === 'investor') return 'buyer';
  return 'general';
}

/** A short, honest first email. No claims about their home or the market. */
export function reviveEmailDraft(contact: Contact, agentName?: string): { readonly subject: string; readonly body: string } {
  const name = first(contact) || 'there';
  const agent = agentName?.trim();
  const intro = agent ? `This is ${agent}, a local realtor.` : 'I’m a local realtor.';
  const sign = agent ? `\n\nBest,\n${agent}` : '\n\nBest regards';
  const optOut = '\n\nIf you’d rather not hear from me, just reply “stop” and I won’t email you again.';
  const street = homeStreet(contact);
  const city = contact.city?.trim();
  switch (angleOf(contact)) {
    case 'seller':
      return {
        subject: street ? `A quick question about ${street}` : 'A quick question about your home',
        body: `Hi ${name},\n\n${intro} I wanted to reach out personally: would a free, no-obligation value update for ${street ?? 'your home'} be helpful? It’s a quick way to see where things stand${city ? ` in ${city}` : ''}, whether you’re thinking of selling soon or just curious.\n\nJust reply to this email and I’ll put it together for you — no pressure at all.${sign}${optOut}`,
      };
    case 'buyer':
      return {
        subject: 'Still looking for a home?',
        body: `Hi ${name},\n\n${intro} Are you still thinking about buying${city ? ` around ${city}` : ''}? If so, tell me what you’re looking for and I’ll send you homes that fit — including ones that are just coming on the market.\n\nJust reply to this email whenever it’s convenient.${sign}${optOut}`,
      };
    default:
      return {
        subject: 'Are you still thinking about a move?',
        body: `Hi ${name},\n\n${intro} I’m reaching out to see if you’re still thinking about buying or selling a home this year. If you are, I’d be glad to help — even if it’s just answering a few questions.\n\nJust reply to this email and let me know.${sign}${optOut}`,
      };
  }
}

function why(contact: Contact, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(contact.createdAt)) / DAY));
  const age = days >= 60 ? `${Math.floor(days / 30)} months` : `${days} days`;
  const never = !contact.lastContactedAt;
  const kind = angleOf(contact) === 'seller' ? 'Seller lead' : angleOf(contact) === 'buyer' ? 'Buyer lead' : 'Lead';
  return never ? `${kind} · added ${age} ago, never contacted` : `${kind} · no contact in over ${REVIVE_QUIET_DAYS} days`;
}

/** Today's batch: sellers with a known home first, then by temperature, oldest first. */
export function buildReviveBatch(input: {
  readonly contacts: readonly Contact[];
  readonly now: Date;
  readonly agentName?: string;
  readonly limit?: number;
}): ReviveBatch {
  const candidates = input.contacts.filter((contact) => isReviveCandidate(contact, input.now));
  const rank = (contact: Contact) => (angleOf(contact) === 'seller' ? (homeStreet(contact) ? 0 : 1) : angleOf(contact) === 'buyer' ? 2 : 3);
  const ordered = [...candidates].sort((a, b) =>
    rank(a) - rank(b)
    || TYPE_RANK[a.leadType] - TYPE_RANK[b.leadType]
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
  const items = ordered.slice(0, input.limit ?? REVIVE_BATCH).map((contact): ReviveItem => {
    const draft = reviveEmailDraft(contact, input.agentName);
    return {
      contactId: contact.id, name: displayName(contact), firstName: first(contact) || displayName(contact), initials: initials(contact),
      leadType: contact.leadType, email: contact.email!.trim(), angle: angleOf(contact), why: why(contact, input.now), ...draft,
    };
  });
  return { items, eligible: candidates.length };
}

export function reviveMailto(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
