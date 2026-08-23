import { createHash } from 'node:crypto';
import { createContactInput } from '@/lib/application/contact-commands';
import { createIncompleteRecordCommand } from '@/lib/application/incomplete-record-commands';
import {
  normalizeEmailIdentity,
  normalizePhoneIdentity,
  type ContactImportCandidate,
  type ParsedContactImport,
} from '@/lib/application/contact-import';
import {
  classifyContactImportCandidate,
  type ContactImportClassification,
} from '@/lib/application/contact-import-classification';
import type { Contact } from '@/lib/domain/contact';
import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { IncompleteRecordRepository } from '@/lib/data/incomplete-record-repository';
import type { ImportGateway } from '@/lib/data/import-gateway';
import type { ContactRepository } from '@/lib/data/repository';
import type { RichContactRepository } from '@/lib/data/rich-contact-repository';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';

export type ImportRowAction =
  | 'create'
  | 'update'
  | 'unchanged'
  | 'merge'
  | 'archived-match'
  | 'ambiguous-identity';

export interface ContactImportPlanRow {
  rowNumber: number;
  action: ImportRowAction;
  matchBy?: 'external-id' | 'email' | 'phone' | 'earlier-row';
  contactId?: string;
  targetRow?: number;
  candidate: ContactImportCandidate;
  patch?: Partial<Contact>;
  changes: string[];
  /** Explicit fields left untouched because CRM activity proves a person edited them. */
  protectedFields?: Array<'pipelineStage'>;
  classification: ContactImportClassification;
}

export interface ContactImportPreview {
  provider: string;
  filename: string;
  format: ParsedContactImport['format'];
  totalRows: number;
  headers: string[];
  recognizedFields: string[];
  unknownFields: string[];
  preservedFields: string[];
  rows: ContactImportPlanRow[];
  rejected: ParsedContactImport['rejected'];
  counts: Record<ImportRowAction | 'rejected' | 'protected', number>;
  classificationCounts: {
    explicit: number;
    automatic: number;
    needsReview: number;
  };
}

export interface ContactImportResult {
  ok: boolean;
  provider: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  merged: number;
  archivedMatches: number;
  ambiguousIdentities: number;
  notesAdded: number;
  rejected: number;
  quarantined: number;
  protected: number;
  failed: number;
  errors: Array<{ rowNumber: number; message: string }>;
  rowOutcomes: Array<{ rowNumber: number; outcome: 'created'|'updated'|'unchanged'|'rejected'|'quarantined'|'failed'; contactId?: string; errorCode?: string }>;
}

export interface ContactImportWorkQueueContext {
  readonly workspaceScope: WorkspaceScope;
  readonly incompleteRecordRepository: IncompleteRecordRepository;
  readonly activityRepository: ActivityRepository;
  readonly richContactRepository?: RichContactRepository;
  /** Stable request/file identity. It is hashed before becoming a persistence key. */
  readonly idempotencyKeyBase: string;
}

function workQueueKey(
  context: Pick<ContactImportWorkQueueContext, 'idempotencyKeyBase'>,
  kind: 'incomplete' | 'imported',
  rowNumber: number,
): string {
  const digest = createHash('sha256').update(context.idempotencyKeyBase).digest('hex');
  return `import:${digest}:${kind}:${rowNumber}`;
}

export async function quarantineContactImportRejections(
  context: ContactImportWorkQueueContext,
  input: {
    source: string;
    rejected: ContactImportPreview['rejected'];
  },
  now = new Date(),
): Promise<number> {
  let quarantined = 0;
  for (const rejected of input.rejected) {
    if (!rejected.incomplete) continue;
    await createIncompleteRecordCommand(context.incompleteRecordRepository, context.workspaceScope, {
      source: input.source,
      externalId: rejected.incomplete.externalId,
      candidate: rejected.incomplete.candidate,
      reasons: rejected.incomplete.reasons,
      intakeIdempotencyKey: workQueueKey(context, 'incomplete', rejected.rowNumber),
    }, now);
    quarantined += 1;
  }
  return quarantined;
}

const FILLABLE_FIELDS = [
  'firstName', 'lastName', 'preferredName', 'phone', 'secondaryPhone', 'email',
  'mailingAddress', 'city', 'state', 'postalCode', 'birthdate', 'homePurchaseDate',
] as const satisfies readonly (keyof ContactImportCandidate)[];

const IMPORT_ORGANIZATION_FIELDS = [
  'leadType', 'qualificationStatus', 'relationship', 'pipelineStage',
] as const satisfies readonly (keyof ContactImportCandidate & keyof Contact)[];

const EXPLICIT_ORGANIZATION_FIELDS = [
  'intent', 'source',
] as const satisfies readonly (keyof ContactImportCandidate & keyof Contact)[];

function contactForm(candidate: ContactImportCandidate, provider: string): FormData {
  const form = new FormData();
  const values: Record<string, string | undefined> = {
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    preferredName: candidate.preferredName,
    phone: candidate.phone,
    secondaryPhone: candidate.secondaryPhone,
    email: candidate.email,
    mailingAddress: candidate.mailingAddress,
    city: candidate.city,
    state: candidate.state,
    postalCode: candidate.postalCode,
    birthdate: candidate.birthdate,
    homePurchaseDate: candidate.homePurchaseDate,
    leadType: candidate.leadType ?? 'nurture',
    qualificationStatus: candidate.qualificationStatus ?? 'needs-qualification',
    relationship: candidate.relationship ?? 'lead',
    intent: candidate.intent ?? 'unknown',
    source: candidate.source ?? (provider === 'website' ? 'website' : 'other'),
    pipelineStage: candidate.pipelineStage ?? 'new',
    tags: candidate.tags.join(', '),
  };
  for (const [key, value] of Object.entries(values)) if (value) form.set(key, value);
  // Vendor opt-in is preserved as evidence, but cannot grant Omnix messaging authority.
  if (provider !== 'first-class-real-estate' && candidate.emailSubscribed !== false) {
    form.set('emailSubscribed', 'on');
  }
  return form;
}

function patchFor(
  existing: Contact,
  candidate: ContactImportCandidate,
  classification: ContactImportClassification,
): Partial<Contact> {
  const patch: Partial<Contact> = {};
  for (const field of FILLABLE_FIELDS) {
    const incoming = candidate[field];
    const current = existing[field as keyof Contact];
    if ((!current || (typeof current === 'string' && !current.trim())) && incoming) {
      (patch as Record<string, unknown>)[field] = incoming;
    }
  }
  const tags = Array.from(new Set([...existing.tags, ...candidate.tags]));
  if (tags.length !== existing.tags.length) patch.tags = tags;
  // An unsubscribe is safety-sensitive and must win over an older opt-in.
  if (candidate.emailSubscribed === false && existing.emailSubscribed) patch.emailSubscribed = false;
  const automaticFields = new Set(classification.decisions.map((decision) => decision.field));
  for (const field of IMPORT_ORGANIZATION_FIELDS) {
    const incoming = candidate[field];
    const hasReliableFileEvidence = !automaticFields.has(field) || !classification.needsReview;
    if (hasReliableFileEvidence && incoming !== undefined && incoming !== existing[field]) {
      (patch as Record<string, unknown>)[field] = incoming;
    }
  }
  for (const field of EXPLICIT_ORGANIZATION_FIELDS) {
    const incoming = candidate[field];
    if (!automaticFields.has(field) && incoming !== undefined && incoming !== existing[field]) {
      (patch as Record<string, unknown>)[field] = incoming;
    }
  }
  return patch;
}

async function hasHumanPipelineEdit(
  activityRepository: ActivityRepository | undefined,
  workspaceScope: WorkspaceScope | undefined,
  contactId: string,
): Promise<boolean> {
  if (!activityRepository || !workspaceScope) return false;
  const [pipelineEvents, updateEvents] = await Promise.all([
    activityRepository.listEvents(workspaceScope, {
      contactId,
      type: 'pipeline-stage-changed',
      limit: 1,
    }),
    activityRepository.listEvents(workspaceScope, {
      contactId,
      type: 'contact-updated',
      limit: 25,
    }),
  ]);
  if (pipelineEvents.length > 0) return true;
  return updateEvents.some((event) => {
    const importManaged = event.idempotencyKey.startsWith('contact-import-updated:')
      || event.idempotencyKey.startsWith('rich:contact-import-updated:');
    const changedFields = typeof event.metadata?.changedFields === 'string'
      ? event.metadata.changedFields.split(',').map((field) => field.trim())
      : [];
    return !importManaged && changedFields.includes('pipelineStage');
  });
}

const PIPELINE_PROTECTION_CONCURRENCY = 8;

async function primePipelineProtection(
  contactIds: readonly string[],
  protection: Map<string, Promise<boolean>>,
  activityRepository: ActivityRepository | undefined,
  workspaceScope: WorkspaceScope | undefined,
): Promise<void> {
  if (!activityRepository || !workspaceScope || contactIds.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(PIPELINE_PROTECTION_CONCURRENCY, contactIds.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < contactIds.length) {
      const contactId = contactIds[cursor++];
      if (!contactId) break;
      const check = hasHumanPipelineEdit(activityRepository, workspaceScope, contactId);
      protection.set(contactId, check);
      await check;
    }
  }));
}

function mergeCandidate(target: ContactImportCandidate, incoming: ContactImportCandidate): void {
  for (const field of FILLABLE_FIELDS) {
    if (!target[field] && incoming[field]) (target as unknown as Record<string, unknown>)[field] = incoming[field];
  }
  target.tags = Array.from(new Set([...target.tags, ...incoming.tags]));
  if (incoming.emailSubscribed === false) target.emailSubscribed = false;
  const facts = new Map((target.sourceFacts ?? []).map((fact) => [fact.key, { ...fact }]));
  for (const fact of incoming.sourceFacts ?? []) {
    const current = facts.get(fact.key);
    if (!current) facts.set(fact.key, { ...fact });
  }
  target.sourceFacts = [...facts.values()];
}

const FIRST_CLASS_SOURCE_SCHEMA_VERSION = 'first-class-real-estate.contact-profile.v1';

export async function previewContactImport(
  repository: ContactRepository,
  gateway: ImportGateway,
  parsed: ParsedContactImport,
  workspaceScope?: WorkspaceScope,
  activityRepository?: ActivityRepository,
): Promise<ContactImportPreview> {
  const contacts = await repository.list({ includeArchived: true });
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const byEmail = new Map<string, Contact[]>();
  const byPhone = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const email = normalizeEmailIdentity(contact.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), contact]);
    const phone = normalizePhoneIdentity(contact.phone);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), contact]);
  }
  const externalIds = parsed.candidates.flatMap((candidate) => candidate.externalId ? [candidate.externalId] : []);
  const links = await gateway.linksFor(parsed.provider, externalIds);
  const linked = new Map(links.map((link) => [link.externalId, byId.get(link.contactId)]));
  const pendingIdentities = new Map<string, ContactImportPlanRow>();
  const plannedByContact = new Map<string, ContactImportPlanRow>();
  const pipelineProtection = new Map<string, Promise<boolean>>();
  const rows: ContactImportPlanRow[] = [];

  const protectionContactIds = new Set<string>();
  for (const sourceCandidate of parsed.candidates) {
    const candidate = classifyContactImportCandidate(sourceCandidate).candidate;
    if (!candidate.pipelineStage) continue;
    const email = normalizeEmailIdentity(candidate.email);
    const phone = normalizePhoneIdentity(candidate.phone);
    const potentialMatches = Array.from(new Map(
      [
        candidate.externalId ? linked.get(candidate.externalId) : undefined,
        ...(email ? byEmail.get(email) ?? [] : []),
        ...(phone ? byPhone.get(phone) ?? [] : []),
      ]
        .filter((item): item is Contact => Boolean(item))
        .map((item) => [item.id, item]),
    ).values());
    const potentialMatch = potentialMatches.length === 1 ? potentialMatches[0] : undefined;
    if (potentialMatch && potentialMatch.pipelineStage !== candidate.pipelineStage) {
      protectionContactIds.add(potentialMatch.id);
    }
  }
  await primePipelineProtection(
    [...protectionContactIds],
    pipelineProtection,
    activityRepository,
    workspaceScope,
  );

  async function protectHumanPipelineStage(existing: Contact, patch: Partial<Contact>): Promise<Array<'pipelineStage'>> {
    if (patch.pipelineStage === undefined || patch.pipelineStage === existing.pipelineStage) return [];
    let check = pipelineProtection.get(existing.id);
    if (!check) {
      check = hasHumanPipelineEdit(activityRepository, workspaceScope, existing.id);
      pipelineProtection.set(existing.id, check);
    }
    if (!await check) return [];
    delete patch.pipelineStage;
    return ['pipelineStage'];
  }

  for (const sourceCandidate of parsed.candidates) {
    const organized = classifyContactImportCandidate(sourceCandidate);
    const candidate = organized.candidate;
    const email = normalizeEmailIdentity(candidate.email);
    const phone = normalizePhoneIdentity(candidate.phone);
    const external = candidate.externalId ? linked.get(candidate.externalId) : undefined;
    let emailMatches = email ? byEmail.get(email) ?? [] : [];
    let phoneMatches = phone ? byPhone.get(phone) ?? [] : [];
    let resolvedMatchBy: 'external-id' | 'email' | 'phone' | undefined;
    let resolverOutcome: 'none' | 'active-match' | 'archived-match' | 'ambiguous-identity' | undefined;
    let resolverContactId: string | undefined;
    let resolverMatchCount = 0;
    if (workspaceScope && gateway.resolveContactImportIdentity) {
      const resolution = await gateway.resolveContactImportIdentity({
        scope: workspaceScope,
        provider: parsed.provider,
        externalId: candidate.externalId,
        email: candidate.email,
        phone: candidate.phone,
      });
      resolverOutcome = resolution.outcome;
      resolverContactId = resolution.contactId;
      resolverMatchCount = resolution.matchCount;
      resolvedMatchBy = resolution.matchedBy;
      const resolved = resolution.contactId ? byId.get(resolution.contactId) : undefined;
      if (resolved && resolution.matchedBy === 'email') emailMatches = [resolved];
      if (resolved && resolution.matchedBy === 'phone') phoneMatches = [resolved];
    }
    const matches = Array.from(new Map(
      [external, resolverContactId ? byId.get(resolverContactId) : undefined, ...emailMatches, ...phoneMatches]
        .filter((item): item is Contact => Boolean(item))
        .map((item) => [item.id, item]),
    ).values());
    if (resolverOutcome === 'ambiguous-identity' || matches.length > 1
      || emailMatches.length > 1 || phoneMatches.length > 1) {
      const ambiguousMatchBy = resolvedMatchBy ?? (emailMatches.length > 1 ? 'email'
        : phoneMatches.length > 1 ? 'phone'
          : external ? 'external-id'
            : emailMatches.length ? 'email' : phoneMatches.length ? 'phone' : undefined);
      rows.push({
        rowNumber: candidate.rowNumber,
        action: 'ambiguous-identity',
        matchBy: ambiguousMatchBy,
        candidate,
        classification: organized.classification,
        changes: [],
      });
      continue;
    }
    const existing = matches[0];
    if (resolverOutcome !== undefined && resolverMatchCount > 0 && !resolverContactId) {
      rows.push({
        rowNumber: candidate.rowNumber,
        action: 'ambiguous-identity',
        candidate,
        classification: organized.classification,
        changes: [],
      });
      continue;
    }
    const matchBy = resolvedMatchBy ?? (external ? 'external-id'
      : emailMatches.length ? 'email' : phoneMatches.length ? 'phone' : undefined);

    if (existing) {
      if (resolverOutcome === 'archived-match' || existing.archivedAt) {
        rows.push({
          rowNumber: candidate.rowNumber,
          action: 'archived-match',
          matchBy,
          contactId: existing.id,
          candidate,
          classification: organized.classification,
          changes: [],
        });
        continue;
      }
      if (parsed.provider === 'first-class-real-estate') {
        rows.push({
          rowNumber: candidate.rowNumber,
          action: 'unchanged',
          matchBy,
          contactId: existing.id,
          candidate,
          classification: organized.classification,
          changes: [],
        });
        continue;
      }
      const earlier = plannedByContact.get(existing.id);
      if (earlier) {
        mergeCandidate(earlier.candidate, candidate);
        const reorganized = classifyContactImportCandidate(earlier.candidate);
        earlier.candidate = reorganized.candidate;
        earlier.classification = reorganized.classification;
        const combinedPatch = patchFor(existing, earlier.candidate, reorganized.classification);
        const protectedFields = await protectHumanPipelineStage(existing, combinedPatch);
        earlier.patch = combinedPatch;
        earlier.changes = Object.keys(combinedPatch);
        earlier.protectedFields = protectedFields;
        earlier.action = earlier.changes.length ? 'update' : 'unchanged';
        rows.push({
          rowNumber: candidate.rowNumber,
          action: 'merge',
          matchBy: 'earlier-row',
          targetRow: earlier.rowNumber,
          candidate,
          classification: organized.classification,
          changes: [],
        });
        continue;
      }
      const patch = patchFor(existing, candidate, organized.classification);
      const protectedFields = await protectHumanPipelineStage(existing, patch);
      const changes = Object.keys(patch);
      const row: ContactImportPlanRow = {
        rowNumber: candidate.rowNumber,
        action: changes.length ? 'update' : 'unchanged',
        matchBy,
        contactId: existing.id,
        candidate,
        classification: organized.classification,
        patch,
        changes,
        ...(protectedFields.length ? { protectedFields } : {}),
      };
      rows.push(row);
      plannedByContact.set(existing.id, row);
      continue;
    }

    const keys = [
      candidate.externalId ? `external:${candidate.externalId}` : '',
      email ? `email:${email}` : '',
      phone ? `phone:${phone}` : '',
    ].filter(Boolean);
    const earlier = keys
      .map((key) => ({ key, row: pendingIdentities.get(key) }))
      .find(({ key, row }) => {
        if (!row) return false;
        // A household may legitimately share a phone number while each person
        // remains a distinct contact. Distinct external IDs or distinct emails
        // are stronger identity evidence and must prevent a phone-only merge.
        if (key.startsWith('phone:')) {
          if (candidate.externalId
            && row.candidate.externalId
            && candidate.externalId !== row.candidate.externalId) return false;
          const earlierEmail = normalizeEmailIdentity(row.candidate.email);
          if (email && earlierEmail && email !== earlierEmail) return false;
        }
        return true;
      })?.row;
    if (earlier) {
      if (parsed.provider !== 'first-class-real-estate') mergeCandidate(earlier.candidate, candidate);
      if (parsed.provider !== 'first-class-real-estate') {
        const reorganized = classifyContactImportCandidate(earlier.candidate);
        earlier.candidate = reorganized.candidate;
        earlier.classification = reorganized.classification;
      }
      rows.push({
        rowNumber: candidate.rowNumber,
        action: 'merge',
        matchBy: 'earlier-row',
        targetRow: earlier.rowNumber,
        candidate,
        classification: organized.classification,
        changes: [],
      });
      continue;
    }

    const row: ContactImportPlanRow = {
      rowNumber: candidate.rowNumber,
      action: 'create',
      candidate,
      classification: organized.classification,
      changes: Object.entries(candidate)
        .filter(([key, value]) => key !== 'rowNumber' && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
        .map(([key]) => key),
    };
    rows.push(row);
    for (const key of keys) pendingIdentities.set(key, row);
  }

  const count = (action: ImportRowAction) => rows.filter((row) => row.action === action).length;
  return {
    provider: parsed.provider,
    filename: parsed.filename,
    format: parsed.format,
    totalRows: parsed.totalRows,
    headers: parsed.headers,
    recognizedFields: parsed.recognizedFields,
    unknownFields: parsed.unknownFields,
    preservedFields: parsed.preservedFields,
    rows,
    rejected: parsed.rejected,
    counts: {
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      merge: count('merge'),
      'archived-match': count('archived-match'),
      'ambiguous-identity': count('ambiguous-identity'),
      rejected: parsed.rejected.length,
      protected: rows.filter((row) => (row.protectedFields?.length ?? 0) > 0).length,
    },
    classificationCounts: {
      explicit: rows.filter((row) => row.classification.mode === 'explicit').length,
      automatic: rows.filter((row) => row.classification.mode === 'automatic').length,
      needsReview: rows.filter((row) => row.classification.needsReview).length,
    },
  };
}

export async function executeContactImport(
  repository: ContactRepository,
  gateway: ImportGateway,
  preview: ContactImportPreview,
  now = new Date(),
  workQueue?: ContactImportWorkQueueContext,
): Promise<ContactImportResult> {
  void repository;
  const quarantined = workQueue
    ? await quarantineContactImportRejections(workQueue, {
      source: preview.provider,
      rejected: preview.rejected,
    }, now)
    : 0;
  const result: ContactImportResult = {
    ok: preview.rejected.length === 0,
    provider: preview.provider,
    totalRows: preview.totalRows,
    created: 0,
    updated: 0,
    unchanged: 0,
    merged: 0,
    archivedMatches: preview.counts['archived-match'],
    ambiguousIdentities: preview.counts['ambiguous-identity'],
    notesAdded: 0,
    rejected: preview.rejected.length,
    quarantined,
    protected: preview.counts.protected,
    failed: 0,
    errors: preview.rejected.map((row) => ({ rowNumber: row.rowNumber, message: row.errors.join(' ') })),
    rowOutcomes: preview.rejected.map((row) => ({ rowNumber: row.rowNumber, outcome: workQueue ? 'quarantined' as const : 'rejected' as const, errorCode: 'validation-rejected' })),
  };
  const rowContacts = new Map<number, string>();
  const importDigest = createHash('sha256')
    .update(workQueue?.idempotencyKeyBase ?? JSON.stringify(preview))
    .digest('hex');

  for (const row of preview.rows) {
    if (row.action === 'archived-match' || row.action === 'ambiguous-identity') {
      result.ok = false;
      result.errors.push({
        rowNumber: row.rowNumber,
        message: row.action === 'archived-match'
          ? 'An archived contact matches this row. Restore the same contact and rerun the import.'
          : 'Identity signals match more than one contact. Resolve the ambiguity before importing.',
      });
      result.rowOutcomes.push({ rowNumber: row.rowNumber, outcome: 'rejected', errorCode: row.action });
      continue;
    }
    try {
      let contactId = row.contactId;
      if (preview.provider === 'first-class-real-estate'
        && row.action === 'merge' && row.targetRow) {
        contactId = rowContacts.get(row.targetRow);
        if (!contactId) throw new Error('Earlier imported contact could not be resolved.');
        rowContacts.set(row.rowNumber, contactId);
        result.merged += 1;
        result.rowOutcomes.push({ rowNumber: row.rowNumber, outcome: 'unchanged', contactId });
        continue;
      }
      if (row.action === 'merge') {
        contactId = row.targetRow ? rowContacts.get(row.targetRow) : undefined;
        if (!contactId) throw new Error('Earlier imported contact could not be resolved.');
      } else if (row.action !== 'create') {
        if (!contactId) throw new Error('Matched contact is missing.');
      }
      const action = row.action === 'merge' ? 'unchanged' : row.action;
      const contact = action === 'create'
        ? createContactInput(contactForm(row.candidate, preview.provider), now)
        : action === 'update' ? row.patch ?? {} : {};
      const activityIdempotencyKey = workQueue
        ? workQueueKey(workQueue, 'imported', row.rowNumber)
        : `import:${importDigest}:imported:${row.rowNumber}`;
      const plan = {
        action,
        ...(contactId ? { contactId } : {}),
        contact,
        points: [],
        householdIds: [],
        assigneeMembershipIds: [],
        customValues: [],
        ...((row.candidate.sourceFacts?.length ?? 0) > 0 ? { sourceProfile: {
          provider: preview.provider,
          schemaVersion: FIRST_CLASS_SOURCE_SCHEMA_VERSION,
          facts: row.candidate.sourceFacts ?? [],
        } } : {}),
        ...(row.candidate.externalId ? { externalLink: {
          provider: preview.provider, externalId: row.candidate.externalId,
        } } : {}),
        ...(row.candidate.note?.trim() ? { note: row.candidate.note.trim() } : {}),
        activityIdempotencyKey,
      } as const;
      const requestHash = createHash('sha256').update(JSON.stringify({
        provider: preview.provider,
        filename: preview.filename,
        rowNumber: row.rowNumber,
        plan,
      })).digest('hex');
      const applied = await gateway.applyContactImportGroup({
        scope: workQueue?.workspaceScope ?? SAMPLE_WORKSPACE_SCOPE,
        groupIdempotencyKey: `import-group:${importDigest}:${row.rowNumber}:${requestHash.slice(0, 16)}`,
        requestHash,
        plan,
        occurredAt: now.toISOString(),
        ...(workQueue ? { activityRepository: workQueue.activityRepository } : {}),
      });
      contactId = applied.contactId;
      rowContacts.set(row.rowNumber, contactId);
      if (!applied.noOp) {
        if (row.action === 'create') result.created += 1;
        else if (row.action === 'update') result.updated += 1;
        else if (row.action === 'merge') result.merged += 1;
        else result.unchanged += 1;
        if (applied.notesAdded) result.notesAdded += 1;
      } else if (row.action === 'merge') result.merged += 1;
      else result.unchanged += 1;
      result.rowOutcomes.push({
        rowNumber: row.rowNumber,
        outcome: row.action === 'create' && !applied.noOp
          ? 'created'
          : row.action === 'update' && !applied.noOp ? 'updated' : 'unchanged',
        contactId,
        ...((row.protectedFields?.length ?? 0) > 0
          ? { errorCode: 'manual-pipeline-stage-protected' }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed for this row.';
      result.failed += 1;
      result.ok = false;
      result.errors.push({
        rowNumber: row.rowNumber,
        message,
      });
      result.rowOutcomes.push({ rowNumber: row.rowNumber, outcome: 'failed', errorCode: 'row-apply-failed' });
    }
  }
  return result;
}
