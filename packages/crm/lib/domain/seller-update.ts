import type { Contact, Note } from './contact.ts';

/**
 * Weekly seller update: sellers' #1 complaint is "my agent never tells me
 * anything". Every Friday Omnix drafts a short update for each active seller
 * from what the realtor logged this week. Private note text is never copied
 * into the message — only counts she can verify, shown to her as evidence.
 */
export interface SellerWeek {
  readonly showings: number;
  readonly feedback: number;
  readonly offers: number;
  readonly openHouses: number;
  /** When she last sent a weekly update (from "Texted: …weekly update…" notes). */
  readonly lastUpdateAt?: string;
  /** Plain evidence for her, e.g. "2 notes mention showings this week". */
  readonly evidence: readonly string[];
}

const DAY = 86_400_000;
const LISTED = /\b(?:listed|active|coming soon|pending|on (?:the )?market|for sale)\b/iu;
const WEEKLY_MARKER = /\b(?:weekly update|actualizaci[oó]n semanal)\b/iu;

/**
 * A seller she is actively representing: an active client, a home under
 * contract, or an active-stage seller with a listed property. Seller prospects
 * are never included.
 */
export function isActiveSeller(contact: Contact): boolean {
  if (contact.archivedAt) return false;
  if (contact.intent !== 'seller' && contact.intent !== 'both') return false;
  if (contact.pipelineStage === 'closed' || contact.pipelineStage === 'lost') return false;
  if (contact.pipelineStage === 'under-contract' || contact.relationship === 'active-client') return true;
  // "Active" alone often means an active prospect; only a real listing gets weekly updates.
  return contact.pipelineStage === 'active' && Boolean(contact.seller?.propertyAddress?.trim()) && LISTED.test(contact.seller?.listingStatus ?? '');
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Counts what happened in the last 7 days from her own notes. */
export function summarizeSellerWeek(notes: readonly Pick<Note, 'body' | 'createdAt' | 'archivedAt'>[], now: Date): SellerWeek {
  const since = now.getTime() - 7 * DAY;
  let showings = 0; let feedback = 0; let offers = 0; let openHouses = 0; let lastUpdateAt: string | undefined;
  for (const note of notes) {
    if (note.archivedAt) continue;
    const at = Date.parse(note.createdAt);
    const body = note.body;
    if (/^Texted:/u.test(body)) {
      if (WEEKLY_MARKER.test(body) && (!lastUpdateAt || note.createdAt > lastUpdateAt)) lastUpdateAt = note.createdAt;
      continue;
    }
    if (!Number.isFinite(at) || at < since || at > now.getTime() + DAY) continue;
    const explicit = body.match(/\b(\d{1,2})\s+showings?\b/iu);
    if (explicit) showings += Number(explicit[1]);
    else if (/\b(?:showing|showed (?:it|the (?:home|house|condo|property))|private tour)\b/iu.test(body)) showings += 1;
    if (/\bopen house\b/iu.test(body)) openHouses += 1;
    if (/\bfeedback\b/iu.test(body)) feedback += 1;
    if (/\boffers?\b/iu.test(body) && !/\bno offers?\b/iu.test(body)) offers += 1;
  }
  const evidence = [
    showings ? `${plural(showings, 'showing', 'showings')} in your notes this week` : undefined,
    openHouses ? `${plural(openHouses, 'open house', 'open houses')} logged` : undefined,
    feedback ? `${plural(feedback, 'note', 'notes')} with buyer feedback` : undefined,
    offers ? `${plural(offers, 'note', 'notes')} mention an offer — add details yourself` : undefined,
  ].filter((line): line is string => Boolean(line));
  return { showings, feedback, offers, openHouses, ...(lastUpdateAt ? { lastUpdateAt } : {}), evidence };
}

/** Due when no weekly update was sent in the last 6 days. */
export function sellerUpdateDue(week: SellerWeek, now: Date): boolean {
  return !week.lastUpdateAt || now.getTime() - Date.parse(week.lastUpdateAt) >= 6 * DAY;
}

/** Friday in her time zone. */
export function isSellerUpdateDay(now: Date, timeZone = 'America/New_York'): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now) === 'Fri';
}

/**
 * The text itself. Mentions only counts (never note contents or offer
 * amounts), and always includes the words "weekly update" so the next one
 * knows when this was sent.
 */
export function sellerUpdateDraft(contact: Contact, week: SellerWeek, agentName?: string): string {
  const name = (contact.preferredName ?? contact.firstName).trim() || 'there';
  const home = contact.seller?.propertyAddress?.trim() ? contact.seller.propertyAddress.trim() : 'your home';
  const sign = agentName?.trim() ? ` — ${agentName.trim().split(/\s+/u)[0]}` : '';
  const activity = [
    week.showings ? plural(week.showings, 'showing', 'showings') : undefined,
    week.openHouses ? plural(week.openHouses, 'open house', 'open houses') : undefined,
  ].filter(Boolean).join(' and ');
  if (contact.pipelineStage === 'under-contract') {
    return `Hi ${name}, your weekly update on ${home}: we’re under contract and moving toward closing. I’m keeping an eye on every deadline and will let you know the moment anything needs you. Any questions, just text me.${sign}`;
  }
  const middle = activity
    ? `this week we had ${activity}.${week.feedback ? ' I’ll share the buyer feedback when we talk.' : ''}`
    : 'it was a quieter week, and I’m working on getting more buyers through the door.';
  return `Hi ${name}, your weekly update on ${home}: ${middle} Happy to talk through next steps anytime — call or text me.${sign}`;
}
