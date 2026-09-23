import { ensureNextTouch } from '../domain/cadence.ts';
import { displayName, initials, type Contact, type LeadType, type Relationship } from '../domain/contact.ts';
import { buildTriage } from '../domain/triage.ts';

export interface CaptureCandidate {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly leadType: LeadType;
  readonly relationship: Relationship;
  readonly phone?: string;
  readonly city?: string;
  /** Plain-language reason she is likely talking to this person now. */
  readonly reason?: string;
  readonly searchText: string;
}

/**
 * People worth logging a conversation for, in the same order Today would put
 * them in front of her, followed by everyone else alphabetically.
 */
export function captureCandidates(contacts: readonly Contact[], now: Date): CaptureCandidate[] {
  const active = contacts.filter((contact) => !contact.archivedAt).map((contact) => ensureNextTouch(contact, now));
  const prioritized = new Map<string, string>();
  for (const bucket of buildTriage(active, now)) {
    if (bucket.id === 'celebrations') continue;
    for (const entry of bucket.entries) if (!prioritized.has(entry.contact.id)) prioritized.set(entry.contact.id, entry.reason);
  }
  const rank = new Map(Array.from(prioritized.keys()).map((id, index) => [id, index]));
  return active
    .map((contact): CaptureCandidate => ({
      id: contact.id,
      name: displayName(contact),
      initials: initials(contact),
      leadType: contact.leadType,
      relationship: contact.relationship,
      ...(contact.phone ? { phone: contact.phone } : {}),
      ...(contact.city ? { city: contact.city } : {}),
      ...(prioritized.has(contact.id) ? { reason: prioritized.get(contact.id) } : {}),
      searchText: [displayName(contact), contact.firstName, contact.lastName, contact.email, contact.phone, contact.phone?.replace(/\D/g, ''), contact.city]
        .filter(Boolean).join(' ').toLocaleLowerCase('en-US'),
    }))
    .sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, 'en-US'));
}

export function filterCaptureCandidates(candidates: readonly CaptureCandidate[], query: string): CaptureCandidate[] {
  const terms = query.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  if (!terms.length) return [...candidates];
  return candidates.filter((candidate) => terms.every((term) => candidate.searchText.includes(term.replace(/[^\p{L}\p{N}@.+-]/gu, '') || term)));
}
