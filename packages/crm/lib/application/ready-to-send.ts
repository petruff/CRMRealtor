import { displayName, initials, type Contact, type LeadType, type Relationship } from '../domain/contact.ts';
import { ensureNextTouch } from '../domain/cadence.ts';
import { anniversaryOrdinal } from '../domain/dates.ts';
import { quickText, quickTextHref } from '../domain/quick-texts.ts';
import { contactHint, extractMemoryFacts } from '../domain/relationship-memory.ts';
import { buildTriage } from '../domain/triage.ts';
import { isActiveSeller, sellerUpdateDraft, sellerUpdateDue, summarizeSellerWeek } from '../domain/seller-update.ts';
import type { Note } from '../domain/contact.ts';
import { buildFocusMoments, buildFocusQueue } from './focus-queue.ts';
import { draftMessage } from './referral-engine.ts';

/**
 * "Ready to send": each morning Omnix prepares the day's texts — new leads,
 * follow-ups that are due, birthdays and home anniversaries — personalized
 * from what is saved about each person. Nothing is sent: the realtor opens each
 * one in her own Messages app, and marks it sent when she's done.
 */
export type ReadyKind = 'new-lead' | 'follow-up' | 'birthday' | 'homeaversary' | 'seller-update';

export interface ReadyItem {
  readonly id: string;
  readonly contactId: string;
  readonly name: string;
  readonly firstName: string;
  readonly initials: string;
  readonly leadType: LeadType;
  readonly relationship: Relationship;
  readonly kind: ReadyKind;
  /** Why this person, today. */
  readonly reason: string;
  /** Timing or channel preference pulled from notes. */
  readonly hint?: string;
  readonly phone: string;
  readonly body: string;
  readonly href: string;
}

export const READY_LIMIT = 8;

function firstNameOf(contact: Contact): string {
  return (contact.preferredName ?? contact.firstName).trim() || displayName(contact);
}

function agentFirst(agentName: string | undefined): string | undefined {
  return agentName?.trim().split(/\s+/u)[0];
}

function lookingFor(contact: Contact): string | undefined {
  const buyer = contact.buyer;
  if (!buyer) return undefined;
  const home = buyer.beds ? `a ${buyer.beds}-bedroom${buyer.desiredPropertyType ? ` ${buyer.desiredPropertyType.toLowerCase()}` : ''}`
    : buyer.desiredPropertyType ? `a ${buyer.desiredPropertyType.toLowerCase()}` : 'a home';
  const where = buyer.areas?.length ? ` in ${buyer.areas.slice(0, 2).join(' or ')}` : '';
  const price = buyer.priceMax ? ` under $${buyer.priceMax >= 1_000_000 ? `${(buyer.priceMax / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M` : `${Math.round(buyer.priceMax / 1000)}k`}` : '';
  return where || price || buyer.beds ? `${home}${where}${price}` : undefined;
}

/** A follow-up that sounds like her, grounded only in what's saved. */
export function followUpDraft(contact: Contact, agentName?: string): string {
  const name = firstNameOf(contact);
  const sign = agentFirst(agentName) ? ` — ${agentFirst(agentName)}` : '';
  const search = lookingFor(contact);
  if ((contact.intent === 'buyer' || contact.intent === 'both' || contact.intent === 'investor') && search) {
    return `Hi ${name}, checking in on your home search — are you still looking for ${search}? Happy to send you what’s new this week.${sign}`;
  }
  if (contact.intent === 'seller' || contact.seller?.propertyAddress) {
    const home = contact.seller?.propertyAddress ? ` ${contact.seller.propertyAddress}` : ' your home';
    return `Hi ${name}, are you still thinking about selling${home}? I’d be happy to put together an updated value for you — no pressure.${sign}`;
  }
  if (contact.relationship === 'past-client' || contact.relationship === 'sphere') {
    return `Hi ${name}! It’s been a little while — how’s everything with the house? Let me know if I can ever help with anything.${sign}`;
  }
  return quickText('check-in', 'en', { firstName: name, ...(agentName ? { agentName } : {}) });
}

export function buildReadyToSend(input: {
  readonly contacts: readonly Contact[];
  readonly now: Date;
  readonly historicalImportContactIds?: ReadonlySet<string>;
  readonly agentName?: string;
  readonly limit?: number;
}): ReadyItem[] {
  const limit = input.limit ?? READY_LIMIT;
  const contacts = input.contacts.map((contact) => ensureNextTouch(contact, input.now));
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const buckets = buildTriage(contacts, input.now, { historicalImportContactIds: input.historicalImportContactIds ?? new Set() });
  const focus = buildFocusQueue(buckets, input.now);
  const moments = buildFocusMoments(buckets, input.now, 12).filter((moment) => moment.inDays <= 1);
  const items: ReadyItem[] = [];
  const seen = new Set<string>();
  const push = (contact: Contact | undefined, kind: ReadyKind, reason: string, body: string) => {
    if (!contact?.phone || contact.archivedAt || seen.has(contact.id) || items.length >= limit) return;
    const href = quickTextHref(contact.phone, body);
    if (!href) return;
    seen.add(contact.id);
    items.push({
      id: `${kind}:${contact.id}`, contactId: contact.id, name: displayName(contact), firstName: firstNameOf(contact), initials: initials(contact),
      leadType: contact.leadType, relationship: contact.relationship, kind, reason, phone: contact.phone, body, href,
    });
  };

  // Speed to lead first, then today's personal moments, then overdue and due follow-ups.
  for (const item of focus.filter((entry) => entry.kind === 'first-contact')) {
    const contact = byId.get(item.contactId);
    push(contact, 'new-lead', item.why, quickText('new-lead', 'en', { firstName: contact ? firstNameOf(contact) : item.name, ...(input.agentName ? { agentName: input.agentName } : {}) }));
  }
  for (const moment of moments) {
    const contact = byId.get(moment.contactId);
    if (!contact) continue;
    const years = moment.kind === 'homeaversary' && contact.homePurchaseDate ? anniversaryOrdinal(contact.homePurchaseDate, input.now) : undefined;
    const draft = draftMessage(moment.kind, contact, 'en', { ...(input.agentName ? { agentName: agentFirst(input.agentName) } : {}), ...(years ? { years } : {}) });
    push(contact, moment.kind, moment.label, draft.sms);
  }
  for (const item of focus.filter((entry) => entry.kind !== 'first-contact')) {
    const contact = byId.get(item.contactId);
    if (contact) push(contact, 'follow-up', item.why, followUpDraft(contact, input.agentName));
  }
  return items;
}

/** Adds timing hints from each person's notes (only for the few selected). */
export function withNoteHints(items: readonly ReadyItem[], notesByContact: ReadonlyMap<string, readonly Note[]>): ReadyItem[] {
  return items.map((item) => {
    const hint = contactHint(extractMemoryFacts(notesByContact.get(item.contactId) ?? []));
    return hint ? { ...item, hint } : item;
  });
}

export const SELLER_UPDATE_LIMIT = 6;

/** Active sellers with a phone, the ones whose notes are worth loading on Fridays. */
export function sellerUpdateCandidates(contacts: readonly Contact[], limit = SELLER_UPDATE_LIMIT): Contact[] {
  return contacts.filter((contact) => isActiveSeller(contact) && contact.phone && quickTextHref(contact.phone, 'x'))
    .sort((a, b) => (a.pipelineStage === 'under-contract' ? 0 : 1) - (b.pipelineStage === 'under-contract' ? 0 : 1) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** One ready-to-send item for a seller, or undefined when this week's update was already sent. */
export function sellerUpdateItem(contact: Contact, notes: readonly Note[], now: Date, agentName?: string, force = false): ReadyItem | undefined {
  if (!contact.phone || !isActiveSeller(contact)) return undefined;
  const week = summarizeSellerWeek(notes, now);
  if (!force && !sellerUpdateDue(week, now)) return undefined;
  const body = sellerUpdateDraft(contact, week, agentName);
  const href = quickTextHref(contact.phone, body);
  if (!href) return undefined;
  const reason = contact.pipelineStage === 'under-contract' ? 'Under contract — a Friday update keeps your seller calm' : 'Friday seller update — keep your seller in the loop';
  return {
    id: `seller-update:${contact.id}`, contactId: contact.id, name: displayName(contact), firstName: firstNameOf(contact), initials: initials(contact),
    leadType: contact.leadType, relationship: contact.relationship, kind: 'seller-update', reason,
    ...(week.evidence.length ? { hint: `From your notes: ${week.evidence.join(' · ')}` } : { hint: 'No showings logged this week — edit if that’s not right' }),
    phone: contact.phone, body, href,
  };
}

/** Seller updates go right after new leads; a seller's update replaces their generic follow-up. */
export function mergeSellerUpdates(items: readonly ReadyItem[], sellerItems: readonly ReadyItem[], limit = READY_LIMIT): ReadyItem[] {
  if (!sellerItems.length) return [...items];
  const sellerIds = new Set(sellerItems.map((item) => item.contactId));
  const rest = items.filter((item) => !sellerIds.has(item.contactId) || item.kind === 'new-lead');
  const leads = rest.filter((item) => item.kind === 'new-lead');
  const others = rest.filter((item) => item.kind !== 'new-lead');
  const sellers = sellerItems.filter((item) => !leads.some((lead) => lead.contactId === item.contactId));
  return [...leads, ...sellers, ...others].slice(0, limit + sellers.length);
}
