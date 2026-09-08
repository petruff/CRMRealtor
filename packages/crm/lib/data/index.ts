/**
 * Repository factory — the single seam between demo data and the real database.
 *
 * Live when Supabase is configured AND someone is signed in. Otherwise the
 * seeded in-memory store, so the app is always demonstrable.
 *
 * The distinction is deliberate rather than a silent fallback: `isLive` is
 * returned so the UI can be honest about which one it is showing. A demo that
 * looks identical to real data is how someone ends up trusting seeded contacts.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { memoryContactIsActive, memoryRepository } from './memory-repository';
import { supabaseRepository } from './supabase-repository';
import type { ContactRepository } from './repository';
import { memoryImportGateway, type ImportGateway } from './import-gateway';
import { supabaseImportGateway } from './supabase-import-gateway';
import { memoryMailerRepository } from './memory-mailer-repository';
import type { MailerRepository } from './mailer-repository';
import { supabaseMailerRepository } from './supabase-mailer-repository';
import {
  SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  SAMPLE_WORKSPACE_SCOPE,
  type WorkspaceScope,
} from '@/lib/domain/workspace';
import {
  createSampleWorkspaceRepository,
} from './memory-workspace-repository';
import type { WorkspaceRepository } from './workspace-repository';
import { resolveSupabaseWorkspaceScope } from './supabase-workspace-scope';
import { supabaseWorkspaceRepository } from './supabase-workspace-repository';
import type { SmartListRepository } from './smart-list-repository';
import { createMemorySmartListRepository } from './memory-smart-list-repository';
import { supabaseSmartListRepository } from './supabase-smart-list-repository';
import type { IncompleteRecordRepository } from './incomplete-record-repository';
import { createMemoryIncompleteRecordRepository } from './memory-incomplete-record-repository';
import { supabaseIncompleteRecordRepository } from './supabase-incomplete-record-repository';
import type { ActivityRepository } from './activity-repository';
import { createMemoryActivityRepository } from './memory-activity-repository';
import { supabaseActivityRepository } from './supabase-activity-repository';
import type { ConnectorRepository } from './connector-repository';
import { createMemoryConnectorRepository } from './memory-connector-repository';
import { supabaseConnectorRepository } from './supabase-connector-repository';
import {
  loadConfiguredConnectorRuntimeConfiguration,
} from '@/lib/config/connector-runtime';
import type { RichContactRepository } from './rich-contact-repository';
import { createMemoryRichContactRepository } from './memory-rich-contact-repository';
import { supabaseRichContactRepository } from './supabase-rich-contact-repository';
import type { PipelineRepository } from './pipeline-repository';
import { createMemoryPipelineRepository } from './memory-pipeline-repository';
import { supabasePipelineRepository } from './supabase-pipeline-repository';
import { supabaseContactIdentityMap } from './supabase-contact-identity-map';
import type { ContactIdentityMap } from './contact-identity-map';
import { selectedWorkspaceId } from './selected-workspace';
import type { AttentionRepository } from './attention-repository';
import { createMemoryAttentionRepository } from './memory-attention-repository';
import { supabaseAttentionRepository } from './supabase-attention-repository';
import type { TransactionRepository } from './transaction-repository';
import { createMemoryTransactionRepository } from './memory-transaction-repository';
import { supabaseTransactionRepository } from './supabase-transaction-repository';
import type { OmnixProposalRepository } from './omnix-proposal-repository';
import { createMemoryOmnixProposalRepository } from './memory-omnix-proposal-repository';
import { supabaseOmnixProposalRepository } from './supabase-omnix-proposal-repository';
import type { NurturePlanRepository } from './nurture-plan-repository';
import { createMemoryNurturePlanRepository } from './memory-nurture-plan-repository';
import { supabaseNurturePlanRepository } from './supabase-nurture-plan-repository';
import type { OperationalSignalRepository } from './operational-signal-repository';
import { createMemoryOperationalSignalRepository } from './memory-operational-signal-repository';
import { supabaseOperationalSignalRepository } from './supabase-operational-signal-repository';
import type { AffordabilityRepository } from './affordability-repository';
import { createMemoryAffordabilityRepository } from './memory-affordability-repository';
import { supabaseAffordabilityRepository } from './supabase-affordability-repository';
import type { PropertyRepository } from './property-repository';
import { createMemoryPropertyRepository } from './memory-property-repository';
import { supabasePropertyRepository } from './supabase-property-repository';
import type { ListingProviderRepository } from './listing-provider-repository';
import { createMemoryListingProviderRepository } from './memory-listing-provider-repository';
import { supabaseListingProviderRepository } from './supabase-listing-provider-repository';
import type { PropertyBehaviorRepository } from './property-behavior-repository';
import { createMemoryPropertyBehaviorRepository } from './memory-property-behavior-repository';
import { supabasePropertyBehaviorRepository } from './supabase-property-behavior-repository';
import type { MeetingBriefRepository } from './meeting-brief-repository';
import { createMemoryMeetingBriefRepository } from './memory-meeting-brief-repository';
import { supabaseMeetingBriefRepository } from './supabase-meeting-brief-repository';
import type { CaptureOutcomeRepository } from './capture-outcome-repository';
import { createMemoryCaptureOutcomeRepository } from './memory-capture-outcome-repository';
import { supabaseCaptureOutcomeRepository } from './supabase-capture-outcome-repository';

// Sample work-queue repositories intentionally live for the lifetime of this
// server process. Recreating them inside every request would make a successful
// Smart List/task action disappear on the very next render.
const sampleSmartListRepository = createMemorySmartListRepository();
const sampleIncompleteRecordRepository = createMemoryIncompleteRecordRepository();
const sampleConversationCache = globalThis as typeof globalThis & {
  __omnixConversationActivities?: ActivityRepository;
  __omnixConversationProposals?: OmnixProposalRepository;
  __omnixConversationCaptures?: CaptureOutcomeRepository;
  __omnixConversationBriefs?: MeetingBriefRepository;
  __omnixConversationNurture?: NurturePlanRepository;
};
const sampleActivityRepository = sampleConversationCache.__omnixConversationActivities ??= createMemoryActivityRepository({
  activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId, SAMPLE_ASSISTANT_MEMBERSHIP_ID],
  isActiveContact: memoryContactIsActive,
});
const sampleContactRepository = memoryRepository();
const sampleRichContactRepository = createMemoryRichContactRepository({
  contactRepository: sampleContactRepository,
  activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId, SAMPLE_ASSISTANT_MEMBERSHIP_ID],
  activityRepository: sampleActivityRepository,
});
const sampleImportGateway = memoryImportGateway({
  repository: sampleContactRepository,
  richContactRepository: sampleRichContactRepository,
  activityRepository: sampleActivityRepository,
});
const samplePipelineRepository = createMemoryPipelineRepository({
  contacts: sampleContactRepository,
  activities: sampleActivityRepository,
});
export const sampleAttentionRepository = createMemoryAttentionRepository({
  activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId, SAMPLE_ASSISTANT_MEMBERSHIP_ID],
});
const sampleTransactionRepository = createMemoryTransactionRepository(sampleContactRepository);
const sampleOmnixProposalRepository = sampleConversationCache.__omnixConversationProposals ??= createMemoryOmnixProposalRepository();
const sampleCaptureOutcomeRepository = sampleConversationCache.__omnixConversationCaptures ??= createMemoryCaptureOutcomeRepository(sampleContactRepository, sampleOmnixProposalRepository, sampleActivityRepository);
const sampleNurturePlanRepository = sampleConversationCache.__omnixConversationNurture ??= createMemoryNurturePlanRepository();
const sampleOperationalSignalRepository = createMemoryOperationalSignalRepository(sampleContactRepository, sampleTransactionRepository);
const sampleAffordabilityRepository = createMemoryAffordabilityRepository();
const samplePropertyRepository = createMemoryPropertyRepository();
const sampleListingProviderRepository = createMemoryListingProviderRepository();
const samplePropertyBehaviorRepository = createMemoryPropertyBehaviorRepository();
const sampleMeetingBriefSources = createMemoryMeetingBriefRepository({
  contacts: sampleContactRepository, activities: sampleActivityRepository,
  transactions: sampleTransactionRepository, nurturePlans: sampleNurturePlanRepository,
  propertyBehavior: samplePropertyBehaviorRepository,
});
const sampleMeetingBriefHistory = sampleConversationCache.__omnixConversationBriefs ??= sampleMeetingBriefSources;
// Keep prior snapshots across development reloads while using the current source adapters.
const sampleMeetingBriefRepository: MeetingBriefRepository = { ...sampleMeetingBriefHistory, loadSources: sampleMeetingBriefSources.loadSources };
const connectorConfiguration = loadConfiguredConnectorRuntimeConfiguration();
const sampleConnectorRepository = createMemoryConnectorRepository({
  definitions: connectorConfiguration.definitions,
  initialConnections: [{
    id: 'connection-contract-test',
    workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
    provider: 'contract-test',
    remoteAccountId: 'contract-test-account',
    remoteAccountLabel: 'Non-live deterministic adapter',
    grantedScopes: ['test.succeed', 'test.ambiguous'],
    status: 'active',
    connectedAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  }],
});

export interface RepositoryContext {
  contactIdentityMap?: ContactIdentityMap;
  meetingBriefRepository?: MeetingBriefRepository;
  captureOutcomeRepository?: CaptureOutcomeRepository;
  repository: ContactRepository;
  importGateway: ImportGateway;
  mailerRepository: MailerRepository;
  workspaceRepository: WorkspaceRepository;
  smartListRepository: SmartListRepository;
  incompleteRecordRepository: IncompleteRecordRepository;
  activityRepository: ActivityRepository;
  pipelineRepository: PipelineRepository;
  connectorRepository: ConnectorRepository;
  attentionRepository: AttentionRepository;
  transactionRepository: TransactionRepository;
  omnixProposalRepository: OmnixProposalRepository;
  nurturePlanRepository: NurturePlanRepository;
  operationalSignalRepository: OperationalSignalRepository;
  affordabilityRepository: AffordabilityRepository;
  propertyRepository: PropertyRepository;
  listingProviderRepository: ListingProviderRepository;
  propertyBehaviorRepository: PropertyBehaviorRepository;
  /** Unavailable only while the live database is missing Story 3.2 migration support. */
  richContactRepository?: RichContactRepository;
  workspaceScope: WorkspaceScope;
  isLive: boolean;
  /** Present only when live. */
  userEmail?: string;
  /** Authenticated profile name, when the identity provider supplied one. */
  userDisplayName?: string;
}

function safePersonName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 120) : undefined;
}

export function resolveUserDisplayName(
  user: { email?: string | null; user_metadata?: Record<string, unknown> },
  canonicalProfileName?: string,
): string | undefined {
  const canonical = safePersonName(canonicalProfileName);
  if (canonical) return canonical;
  const metadata = user.user_metadata ?? {};
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = safePersonName(metadata[key]);
    if (value) return value;
  }
  const localPart = user.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!localPart) return undefined;
  return safePersonName(localPart.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-US')));
}

export async function getRepository(): Promise<RepositoryContext> {
  if (!isSupabaseConfigured()) {
    const repository = memoryRepository();
    return {
      repository,
      importGateway: sampleImportGateway,
      mailerRepository: memoryMailerRepository(repository),
      workspaceRepository: createSampleWorkspaceRepository(),
      smartListRepository: sampleSmartListRepository,
      incompleteRecordRepository: sampleIncompleteRecordRepository,
      activityRepository: sampleActivityRepository,
      pipelineRepository: samplePipelineRepository,
      connectorRepository: sampleConnectorRepository,
      attentionRepository: sampleAttentionRepository,
      transactionRepository: sampleTransactionRepository,
      omnixProposalRepository: sampleOmnixProposalRepository,
      nurturePlanRepository: sampleNurturePlanRepository,
      operationalSignalRepository: sampleOperationalSignalRepository,
      affordabilityRepository: sampleAffordabilityRepository,
      propertyRepository: samplePropertyRepository,
      listingProviderRepository: sampleListingProviderRepository,
      propertyBehaviorRepository: samplePropertyBehaviorRepository,
      richContactRepository: sampleRichContactRepository,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      isLive: false,
      meetingBriefRepository: sampleMeetingBriefRepository,
      captureOutcomeRepository: sampleCaptureOutcomeRepository,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    // Configured but signed out — middleware handles the redirect. Seeded data
    // keeps any public or transitional route renderable rather than crashing.
    const repository = memoryRepository();
    return {
      repository,
      importGateway: sampleImportGateway,
      mailerRepository: memoryMailerRepository(repository),
      workspaceRepository: createSampleWorkspaceRepository(),
      smartListRepository: sampleSmartListRepository,
      incompleteRecordRepository: sampleIncompleteRecordRepository,
      activityRepository: sampleActivityRepository,
      pipelineRepository: samplePipelineRepository,
      connectorRepository: sampleConnectorRepository,
      attentionRepository: sampleAttentionRepository,
      transactionRepository: sampleTransactionRepository,
      omnixProposalRepository: sampleOmnixProposalRepository,
      nurturePlanRepository: sampleNurturePlanRepository,
      operationalSignalRepository: sampleOperationalSignalRepository,
      affordabilityRepository: sampleAffordabilityRepository,
      propertyRepository: samplePropertyRepository,
      listingProviderRepository: sampleListingProviderRepository,
      propertyBehaviorRepository: samplePropertyBehaviorRepository,
      richContactRepository: sampleRichContactRepository,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      isLive: false,
      meetingBriefRepository: sampleMeetingBriefRepository,
      captureOutcomeRepository: sampleCaptureOutcomeRepository,
    };
  }

  const workspaceScope = await resolveSupabaseWorkspaceScope(supabase, user.id, {
    selectedWorkspaceId: await selectedWorkspaceId(),
  });
  const contactIdentityMap = supabaseContactIdentityMap(supabase);
  const repository = supabaseRepository(supabase, workspaceScope, contactIdentityMap);
  return {
    contactIdentityMap,
    repository,
    importGateway: supabaseImportGateway(supabase, workspaceScope, contactIdentityMap),
    mailerRepository: supabaseMailerRepository(supabase, workspaceScope),
    workspaceRepository: supabaseWorkspaceRepository(supabase),
    smartListRepository: supabaseSmartListRepository(supabase),
    incompleteRecordRepository: supabaseIncompleteRecordRepository(supabase),
    activityRepository: supabaseActivityRepository(supabase, contactIdentityMap),
    pipelineRepository: supabasePipelineRepository(supabase, contactIdentityMap),
    connectorRepository: supabaseConnectorRepository(supabase, connectorConfiguration.definitions),
    attentionRepository: supabaseAttentionRepository(supabase),
    transactionRepository: supabaseTransactionRepository(supabase),
    omnixProposalRepository: supabaseOmnixProposalRepository(supabase),
    nurturePlanRepository: supabaseNurturePlanRepository(supabase),
    operationalSignalRepository: supabaseOperationalSignalRepository(supabase),
    affordabilityRepository: supabaseAffordabilityRepository(supabase),
    propertyRepository: supabasePropertyRepository(supabase),
    listingProviderRepository: supabaseListingProviderRepository(supabase),
    propertyBehaviorRepository: supabasePropertyBehaviorRepository(supabase),
    richContactRepository: supabaseRichContactRepository(supabase, contactIdentityMap),
    workspaceScope,
    isLive: true,
    meetingBriefRepository: supabaseMeetingBriefRepository(supabase),
    captureOutcomeRepository: supabaseCaptureOutcomeRepository(supabase),
    userEmail: user.email ?? undefined,
    userDisplayName: resolveUserDisplayName(user),
  };
}
