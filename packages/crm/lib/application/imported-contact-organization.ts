import { createHash } from 'node:crypto';
import {
  classifyContactImportCandidate,
  CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION,
} from '@/lib/application/contact-import-classification';
import type { ContactImportCandidate, ContactImportSourceFact } from '@/lib/application/contact-import';
import { historicalImportNextTouch, isDormant } from '@/lib/domain/cadence';
import type { Contact, LeadType, PipelineStage } from '@/lib/domain/contact';
import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { ImportedContactOrganizationChange, ImportGateway } from '@/lib/data/import-gateway';
import type { ContactRepository } from '@/lib/data/repository';
import type { RichContactRepository } from '@/lib/data/rich-contact-repository';
import type { WorkspaceScope } from '@/lib/domain/workspace';

const ORGANIZATION_LIMIT = 500;

export interface ImportedContactOrganizationResult {
  readonly dryRun: boolean;
  readonly policyVersion: typeof CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION;
  readonly scanned: number;
  readonly withImportProfile: number;
  readonly eligible: number;
  readonly wouldUpdate: number;
  readonly updated: number;
  readonly alreadyOrganized: number;
  readonly skippedProtected: number;
  readonly needsReview: number;
  readonly failed: number;
  readonly runId?: string;
  readonly rollbackAvailable: boolean;
  readonly leadTypes: Record<LeadType, number>;
  readonly pipelineStages: Record<PipelineStage, number>;
}

export interface ImportedContactOrganizationContext {
  readonly repository: ContactRepository;
  readonly richContactRepository: RichContactRepository;
  readonly activityRepository: ActivityRepository;
  readonly importGateway: ImportGateway;
  readonly workspaceScope: WorkspaceScope;
}

function sourceFactsForClassification(
  facts: Awaited<ReturnType<RichContactRepository['listContactImportSourceFacts']>>,
): ContactImportSourceFact[] {
  const latest = new Map<string, (typeof facts)[number]>();
  for (const fact of facts) if (!latest.has(fact.key)) latest.set(fact.key, fact);
  return [...latest.values()].map((fact) => ({
    key: fact.key,
    label: fact.label,
    category: fact.category,
    valueType: fact.valueType,
    value: fact.value,
    sourceRowNumber: fact.sourceRowNumber,
  }));
}

function oldImportDefaults(contact: Contact): boolean {
  return contact.leadType === 'warm'
    && (contact.qualificationStatus ?? 'qualified') === 'qualified'
    && contact.relationship === 'lead'
    && contact.pipelineStage === 'new'
    && !contact.touchDateOverridden
    && !contact.archivedAt;
}

function candidateForRepair(contact: Contact, sourceFacts: readonly ContactImportSourceFact[]): ContactImportCandidate {
  return {
    rowNumber: 1,
    firstName: contact.firstName,
    lastName: contact.lastName,
    preferredName: contact.preferredName,
    phone: contact.phone,
    secondaryPhone: contact.secondaryPhone,
    email: contact.email,
    mailingAddress: contact.mailingAddress,
    city: contact.city,
    state: contact.state,
    postalCode: contact.postalCode,
    birthdate: contact.birthdate,
    homePurchaseDate: contact.homePurchaseDate,
    intent: contact.intent === 'unknown' ? undefined : contact.intent,
    source: contact.source === 'other' ? undefined : contact.source,
    tags: [...contact.tags],
    emailSubscribed: contact.emailSubscribed,
    sourceFacts,
  };
}

function emptyResult(dryRun: boolean): ImportedContactOrganizationResult {
  return {
    dryRun,
    policyVersion: CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION,
    scanned: 0,
    withImportProfile: 0,
    eligible: 0,
    wouldUpdate: 0,
    updated: 0,
    alreadyOrganized: 0,
    skippedProtected: 0,
    needsReview: 0,
    failed: 0,
    rollbackAvailable: false,
    leadTypes: { hot: 0, warm: 0, nurture: 0 },
    pipelineStages: {
      new: 0, contacted: 0, 'appointment-set': 0, active: 0,
      'under-contract': 0, closed: 0, lost: 0,
    },
  };
}

export async function organizeExistingImportedContacts(
  context: ImportedContactOrganizationContext,
  input: { readonly dryRun: boolean },
  now = new Date(),
): Promise<ImportedContactOrganizationResult> {
  const contacts = (await context.repository.list({ includeArchived: true })).slice(0, ORGANIZATION_LIMIT);
  const protectedEvents = (await Promise.all([
    context.activityRepository.listEvents(context.workspaceScope, { type: 'contact-updated', limit: ORGANIZATION_LIMIT }),
    context.activityRepository.listEvents(context.workspaceScope, { type: 'touch-recorded', limit: ORGANIZATION_LIMIT }),
    context.activityRepository.listEvents(context.workspaceScope, { type: 'pipeline-stage-changed', limit: ORGANIZATION_LIMIT }),
  ])).flat();
  const importedEvents = await context.activityRepository.listEvents(
    context.workspaceScope,
    { type: 'contact-imported', limit: ORGANIZATION_LIMIT },
  );
  const protectedContactIds = new Set(protectedEvents.flatMap((event) => event.contactId ? [event.contactId] : []));
  const importedContactIds = new Set(importedEvents.flatMap((event) => event.contactId ? [event.contactId] : []));
  const mutable = emptyResult(input.dryRun) as {
    -readonly [Key in keyof ImportedContactOrganizationResult]: ImportedContactOrganizationResult[Key]
  };
  mutable.scanned = contacts.length;
  const changesToApply: ImportedContactOrganizationChange[] = [];

  for (const contact of contacts) {
    const persistedFacts = await context.richContactRepository.listContactImportSourceFacts(context.workspaceScope, contact.id);
    if (!persistedFacts.length && !importedContactIds.has(contact.id)) continue;
    mutable.withImportProfile += 1;
    const classificationEligible = oldImportDefaults(contact) && !protectedContactIds.has(contact.id);
    const cadenceEligible = importedContactIds.has(contact.id)
      && !contact.lastContactedAt
      && !contact.touchDateOverridden
      && !isDormant(contact);
    if (!classificationEligible && !cadenceEligible) {
      if (oldImportDefaults(contact) && protectedContactIds.has(contact.id)) mutable.skippedProtected += 1;
      else mutable.alreadyOrganized += 1;
      continue;
    }

    mutable.eligible += 1;
    const classified = classificationEligible
      ? classifyContactImportCandidate(candidateForRepair(
          contact,
          sourceFactsForClassification(persistedFacts),
        ))
      : undefined;
    const organized = classified?.candidate;
    const finalContact: Contact = organized ? {
      ...contact,
      leadType: organized.leadType!,
      qualificationStatus: organized.qualificationStatus!,
      relationship: organized.relationship!,
      intent: organized.intent!,
      source: organized.source!,
      pipelineStage: organized.pipelineStage!,
    } : contact;
    const cadence = isDormant(finalContact)
      ? { nextTouchAt: null as string | null, touchDateOverridden: false }
      : {
          nextTouchAt: cadenceEligible
            ? historicalImportNextTouch(finalContact, now)
            : finalContact.nextTouchAt,
          touchDateOverridden: false,
        };
    const patch = {
      leadType: finalContact.leadType,
      qualificationStatus: finalContact.qualificationStatus,
      relationship: finalContact.relationship,
      intent: finalContact.intent,
      source: finalContact.source,
      pipelineStage: finalContact.pipelineStage,
      ...cadence,
    };
    const changes = Object.entries(patch).filter(([key, value]) => {
      const current = contact[key as keyof Contact];
      return (value ?? undefined) !== current;
    });
    if (!changes.length) {
      mutable.alreadyOrganized += 1;
      continue;
    }

    mutable.wouldUpdate += 1;
    mutable.leadTypes[finalContact.leadType] += 1;
    mutable.pipelineStages[finalContact.pipelineStage] += 1;
    if (classified?.classification.needsReview) mutable.needsReview += 1;
    changesToApply.push({
      contactId: contact.id,
      expectedUpdatedAt: contact.updatedAt ?? contact.createdAt,
      after: {
        leadType: patch.leadType,
        qualificationStatus: patch.qualificationStatus,
        relationship: patch.relationship,
        intent: patch.intent,
        source: patch.source,
        pipelineStage: patch.pipelineStage,
        nextTouchAt: patch.nextTouchAt ?? null,
        touchDateOverridden: patch.touchDateOverridden,
      },
    });
  }

  if (!input.dryRun && changesToApply.length) {
    if (!context.importGateway.applyImportedContactOrganization) {
      throw new Error('Reversible historical organization is not available in this environment.');
    }
    const sortedChanges = [...changesToApply].sort((left, right) => left.contactId.localeCompare(right.contactId));
    const requestHash = createHash('sha256').update(JSON.stringify({
      policyVersion: CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION,
      changes: sortedChanges,
    })).digest('hex');
    const receipt = await context.importGateway.applyImportedContactOrganization({
      scope: context.workspaceScope,
      policyVersion: CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION,
      requestHash,
      changes: sortedChanges,
      occurredAt: now.toISOString(),
    });
    mutable.updated = receipt.contactCount;
    mutable.runId = receipt.runId;
    mutable.rollbackAvailable = Boolean(receipt.rollbackAvailable);
  }

  return mutable;
}
