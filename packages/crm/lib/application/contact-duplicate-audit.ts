import { createHash } from 'node:crypto';
import type { RepositoryContext } from '@/lib/data';
import type { Contact } from '@/lib/domain/contact';
import type { ContactPoint, ContactPointType } from '@/lib/domain/rich-contact';

export const CONTACT_DUPLICATE_AUDIT_SCHEMA_VERSION = 'contact-duplicate-audit.v1' as const;
export const CONTACT_DUPLICATE_AUDIT_LIMIT = 500;

export interface ContactDuplicateGroup {
  readonly id: string;
  readonly kind: ContactPointType;
  readonly contactIds: readonly string[];
  readonly evidenceCount: number;
  readonly disposition: 'review-required';
}

export interface ContactDuplicateAudit {
  readonly schemaVersion: typeof CONTACT_DUPLICATE_AUDIT_SCHEMA_VERSION;
  readonly asOf: string;
  readonly activeContacts: number;
  readonly archivedContacts: number;
  readonly canonicalPoints: number;
  readonly duplicateGroups: readonly ContactDuplicateGroup[];
  readonly candidateContacts: number;
  readonly partial: boolean;
  readonly automaticMerges: 0;
}

function groupId(type: ContactPointType, normalizedValue: string): string {
  const digest = createHash('sha256').update(type).update('\0').update(normalizedValue).digest('hex');
  return `duplicate:${type}:${digest}`;
}

export function buildContactDuplicateAudit(input: {
  readonly contacts: readonly Contact[];
  readonly points: readonly ContactPoint[];
  readonly asOf: string;
  readonly partial?: boolean;
}): ContactDuplicateAudit {
  const instant = new Date(input.asOf);
  if (!Number.isFinite(instant.getTime())) throw new Error('Duplicate audit as-of time is invalid.');
  const active = new Set(input.contacts.filter((contact) => !contact.archivedAt).map((contact) => contact.id));
  const grouped = new Map<string, { type: ContactPointType; value: string; contacts: Set<string>; evidenceCount: number }>();
  const currentPoints = input.points.filter((point) => !point.archivedAt && active.has(point.contactId));

  for (const point of currentPoints) {
    const key = `${point.type}\0${point.normalizedValue}`;
    const current = grouped.get(key) ?? {
      type: point.type,
      value: point.normalizedValue,
      contacts: new Set<string>(),
      evidenceCount: 0,
    };
    current.contacts.add(point.contactId);
    current.evidenceCount += 1;
    grouped.set(key, current);
  }

  const duplicateGroups = [...grouped.values()]
    .filter((group) => group.contacts.size > 1)
    .map((group): ContactDuplicateGroup => ({
      id: groupId(group.type, group.value),
      kind: group.type,
      contactIds: [...group.contacts].sort(),
      evidenceCount: group.evidenceCount,
      disposition: 'review-required',
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));

  return Object.freeze({
    schemaVersion: CONTACT_DUPLICATE_AUDIT_SCHEMA_VERSION,
    asOf: instant.toISOString(),
    activeContacts: active.size,
    archivedContacts: input.contacts.length - active.size,
    canonicalPoints: currentPoints.length,
    duplicateGroups,
    candidateContacts: new Set(duplicateGroups.flatMap((group) => group.contactIds)).size,
    partial: input.partial === true,
    automaticMerges: 0,
  });
}

export async function loadContactDuplicateAudit(
  context: Pick<RepositoryContext, 'repository' | 'richContactRepository' | 'workspaceScope'>,
  now = new Date(),
): Promise<{ readonly audit: ContactDuplicateAudit; readonly contacts: readonly Contact[] }> {
  if (!context.richContactRepository) throw new Error('Canonical contact-point audit is unavailable.');
  const allContacts = await context.repository.list({ includeArchived: true });
  const contacts = allContacts.slice(0, CONTACT_DUPLICATE_AUDIT_LIMIT);
  const points = await context.richContactRepository.listContactPointsForContacts(
    context.workspaceScope,
    contacts.map((contact) => contact.id),
    true,
  );
  return {
    audit: buildContactDuplicateAudit({
      contacts,
      points,
      asOf: now.toISOString(),
      partial: allContacts.length > CONTACT_DUPLICATE_AUDIT_LIMIT,
    }),
    contacts,
  };
}
