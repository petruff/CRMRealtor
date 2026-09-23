import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import { loadConfiguredConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type { ConnectorWorkerRepository } from '../data/supabase-connector-worker-repository.ts';
import { supabaseConnectorWorkerRepository } from '../data/supabase-connector-worker-repository.ts';
import type { ConnectorRevocationRepository } from '../data/supabase-connector-revocation-repository.ts';
import { supabaseConnectorRevocationRepository } from '../data/supabase-connector-revocation-repository.ts';
import {
  ConnectorError,
  stablePayloadHash,
  type ConnectorAdapter,
  type ConnectorAdapterResult,
  type ConnectorJob,
  type ConnectorProvider,
} from '../domain/connector.ts';
import { ContractTestConnectorAdapter } from './connector-worker.ts';
import { MailchimpConnectorAdapter } from '../providers/mailchimp-adapter.ts';
import { GoogleConnectorAdapter } from '../providers/google-adapter.ts';
import { createSupabaseGoogleAuthorityLoader } from '../providers/supabase-google-authority-loader.ts';
import { supabaseGoogleJobAuthorityReader } from '../data/supabase-google-worker-authority.ts';
import { TwilioConnectorAdapter } from '../providers/twilio-adapter.ts';
import { supabaseServiceContactOutboundGuard } from '../data/supabase-contact-outbound-guard.ts';
import { revokeMetaProviderConnection } from './meta-revocation-service.ts';
import { createSupabaseTwilioAuthorityLoader } from '../providers/supabase-twilio-authority-loader.ts';
import { supabaseTwilioJobAuthorityReader } from '../data/supabase-twilio-worker-authority.ts';
import { supabaseTwilioReconciliationRepository } from '../data/supabase-twilio-reconciliation-repository.ts';
import { drainTwilioReconciliations } from './twilio-reconciliation-service.ts';
import { drainTwilioRealNumberUat } from './twilio-uat-service.ts';
import { supabaseTwilioUatRepository } from '../data/supabase-twilio-uat-repository.ts';
import { drainMetaNormalizationJobs } from './meta-normalization-service.ts';
import { supabaseMetaNormalizationRepository } from '../data/supabase-meta-normalization-repository.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret } from '../security/connector-secret-envelope.ts';
import { createSupabaseMailchimpAuthorityLoader } from '../providers/supabase-mailchimp-authority-loader.ts';
import { supabaseMailchimpJobAuthorityReader } from '../data/supabase-mailchimp-worker-authority.ts';
import {
  drainConnectorRevocations,
  type ConnectorRevocationWorkerDependencies,
} from './connector-revocation-worker.ts';
import { drainMailchimpWebhookJobs } from './mailchimp-webhook-service.ts';
import { supabaseMailchimpWebhookRepository } from '../data/supabase-mailchimp-webhook-repository.ts';
import { supabaseMailchimpReconciliationRepository } from '../data/supabase-mailchimp-reconciliation-repository.ts';
import { drainMailchimpReconciliationRuns } from './mailchimp-reconciliation-service.ts';
import { drainMailchimpOutboundBackfills } from './mailchimp-outbound-backfill-service.ts';
import { supabaseMailchimpOutboundBackfillRepository } from '../data/supabase-mailchimp-outbound-backfill-repository.ts';
import {
  connectorTelemetryEvent,
  defaultConnectorTelemetrySink,
  type ConnectorTelemetrySink,
} from '../observability/connector-telemetry.ts';
import { drainGoogleGmailWakeups } from './google-gmail-wakeup-worker.ts';
import { createSupabaseOmnixServiceAiBudgetAuthority } from './omnix-ai-budget.ts';
import { loadWorkspaceAiAutomationCredential } from './workspace-ai-settings.ts';
import { supabaseGoogleGmailWakeupRepository } from '../data/supabase-google-gmail-wakeup-repository.ts';
import { loadOptionalGoogleGmailPushConfiguration } from '../config/google-gmail-push.ts';

export interface ConnectorServiceWorkerDependencies {
  readonly repository: ConnectorWorkerRepository;
  readonly revocationRepository?: ConnectorRevocationRepository;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly adapters: ReadonlyMap<ConnectorProvider, ConnectorAdapter>;
  readonly workerId: string;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly telemetry?: ConnectorTelemetrySink;
  readonly reconciliationOnly?: boolean;
  readonly deadlineMs?: number;
  readonly decryptRevocationSecret?: ConnectorRevocationWorkerDependencies['decryptRevocationSecret'];
  readonly revokeMeta?: ConnectorRevocationWorkerDependencies['revokeMeta'];
}

export interface ConnectorServiceDrainResult {
  readonly claimed: number;
  readonly reconciliationClaimed: number;
  readonly succeeded: number;
  readonly deferred: number;
  readonly failed: number;
  readonly swept: number;
  readonly revocations?: {
    readonly claimed: number;
    readonly confirmed: number;
    readonly deferred: number;
    readonly unconfirmed: number;
  };
  readonly mailchimpWebhooks?: {
    readonly claimed: number;
    readonly succeeded: number;
    readonly deferred: number;
    readonly review: number;
  };
  readonly mailchimpReconciliations?: {
    readonly claimed: number;
    readonly completed: number;
    readonly deferred: number;
    readonly review: number;
    readonly pages: number;
  };
  readonly mailchimpOutboundBackfills?: {
    readonly scheduled: number;
    readonly claimed: number;
    readonly pages: number;
    readonly jobsEnqueued: number;
    readonly deferred: number;
    readonly review: number;
    readonly completed: number;
  };
  readonly twilioReconciliations?: {
    readonly scheduled: number;
    readonly claimed: number;
    readonly resolved: number;
    readonly deferred: number;
    readonly failed: number;
  };
  readonly twilioRealNumberUat?: {
    readonly claimed: number;
    readonly delivered: number;
    readonly deferred: number;
    readonly failed: number;
  };
  readonly metaNormalizations?: {
    readonly claimed: number;
    readonly linked: number;
    readonly review: number;
    readonly deferred: number;
    readonly failed: number;
  };
  readonly googleGmailWakeups?: {
    readonly claimed: number;
    readonly succeeded: number;
    readonly deferred: number;
    readonly failed: number;
    readonly messages: number;
  };
}

function requestHash(job: ConnectorJob): string {
  return stablePayloadHash({
    provider: job.provider,
    actionType: job.actionType,
    payloadReference: job.payloadReference,
    idempotencyKey: job.idempotencyKey,
  });
}

function retryAt(
  job: ConnectorJob,
  occurredAt: string,
  configuration: ConnectorRuntimeConfiguration,
  random: () => number,
  requested?: number,
): string {
  const cap = requested ?? Math.min(
    configuration.retry.maxDelaySeconds,
    configuration.retry.baseDelaySeconds * (2 ** Math.max(0, job.attemptCount - 1)),
  );
  const seconds = requested ? Math.ceil(cap) : Math.max(1, Math.ceil(cap * Math.max(0, Math.min(1, random()))));
  return new Date(new Date(occurredAt).getTime() + seconds * 1_000).toISOString();
}

async function transitionResult(
  repository: ConnectorWorkerRepository,
  configuration: ConnectorRuntimeConfiguration,
  job: ConnectorJob,
  workerId: string,
  result: ConnectorAdapterResult,
  reconciliation: boolean,
  occurredAt: string,
  random: () => number,
): Promise<'succeeded' | 'deferred' | 'failed'> {
  if (result.outcome === 'succeeded') {
    await repository.transition({
      jobId: job.id,
      workerId,
      fencingToken: job.fencingToken,
      state: 'succeeded',
      receiptType: reconciliation ? 'reconciliation.resolved' : 'provider.accepted',
      providerRequestHash: requestHash(job),
      remoteOperationId: result.providerReceiptId,
      providerStatus: result.providerStatus,
      ...(reconciliation ? { reconciliationResult: 'succeeded' } : {}),
      transitionedAt: occurredAt,
    });
    return 'succeeded';
  }
  if (result.outcome === 'unknown') {
    await repository.transition({
      jobId: job.id,
      workerId,
      fencingToken: job.fencingToken,
      state: 'reconciliation_required',
      receiptType: 'provider.unknown',
      errorCategory: result.errorCategory,
      ...(result.providerReceiptId ? { remoteOperationId: result.providerReceiptId } : {}),
      scheduledAt: retryAt(job, occurredAt, configuration, random, configuration.retry.baseDelaySeconds),
      transitionedAt: occurredAt,
    });
    return 'deferred';
  }
  if (result.outcome === 'retryable-failure') {
    const exhausted = job.attemptCount >= job.maxAttempts;
    await repository.transition({
      jobId: job.id,
      workerId,
      fencingToken: job.fencingToken,
      state: exhausted ? 'dead_letter' : 'retry_wait',
      receiptType: 'provider.failed',
      errorCategory: result.errorCategory,
      ...(!exhausted ? {
        scheduledAt: retryAt(job, occurredAt, configuration, random, result.retryAfterSeconds),
      } : {}),
      transitionedAt: occurredAt,
    });
    return exhausted ? 'failed' : 'deferred';
  }
  await repository.transition({
    jobId: job.id,
    workerId,
    fencingToken: job.fencingToken,
    state: 'failed',
    receiptType: reconciliation ? 'reconciliation.resolved' : 'provider.failed',
    errorCategory: result.errorCategory,
    ...(reconciliation ? { reconciliationResult: 'failed' } : {}),
    transitionedAt: occurredAt,
  });
  return 'failed';
}

async function processJobs(
  jobs: readonly ConnectorJob[],
  reconciliation: boolean,
  dependencies: ConnectorServiceWorkerDependencies,
  counters: { succeeded: number; deferred: number; failed: number },
  deadlineMs: number,
): Promise<void> {
  const clock = dependencies.now ?? (() => new Date());
  const telemetry = dependencies.telemetry ?? defaultConnectorTelemetrySink;
  for (const leased of jobs) {
    if (clock().getTime() >= deadlineMs) break;
    let job = leased;
    if (!reconciliation) {
      try {
        job = await dependencies.repository.startAttempt({
          jobId: leased.id,
          workerId: dependencies.workerId,
          fencingToken: leased.fencingToken,
          startedAt: clock().toISOString(),
        });
      } catch (error) {
        if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
        throw error;
      }
    }

    const adapter = dependencies.adapters.get(leased.provider);
    if (!adapter) {
      try {
        await dependencies.repository.transition({
          jobId: job.id, workerId: dependencies.workerId, fencingToken: job.fencingToken,
          state: 'failed', receiptType: reconciliation ? 'reconciliation.resolved' : 'provider.failed',
          errorCategory: 'configuration_required',
          ...(reconciliation ? { reconciliationResult: 'failed' } : {}),
          transitionedAt: clock().toISOString(),
        });
      } catch (error) {
        if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
        throw error;
      }
      counters.failed += 1;
      telemetry(connectorTelemetryEvent({
        event: 'worker.job-finished',
        provider: job.provider,
        workspaceId: job.workspaceId,
        jobId: job.id,
        correlationId: job.correlationId,
        outcome: 'failed',
        errorCategory: 'configuration_required',
      }));
      continue;
    }
    let outcome: 'succeeded' | 'deferred' | 'failed';
    try {
      const result = reconciliation ? await adapter.reconcile(job) : await adapter.execute(job);
      outcome = await transitionResult(
        dependencies.repository,
        dependencies.configuration,
        job,
        dependencies.workerId,
        result,
        reconciliation,
        clock().toISOString(),
        dependencies.random ?? Math.random,
      );
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      outcome = await transitionResult(
        dependencies.repository,
        dependencies.configuration,
        job,
        dependencies.workerId,
        { outcome: 'unknown', errorCategory: 'network_outcome_unknown' },
        reconciliation,
        clock().toISOString(),
        dependencies.random ?? Math.random,
      );
    }
    counters[outcome] += 1;
    telemetry(connectorTelemetryEvent({
      event: 'worker.job-finished',
      provider: job.provider,
      workspaceId: job.workspaceId,
      jobId: job.id,
      correlationId: job.correlationId,
      outcome,
      errorCategory: outcome === 'succeeded' ? 'none'
        : outcome === 'deferred' ? 'provider_acceptance_unknown' : 'internal_error',
    }));
  }
}

export async function drainConnectorServiceJobs(
  dependencies: ConnectorServiceWorkerDependencies,
): Promise<ConnectorServiceDrainResult> {
  const clock = dependencies.now ?? (() => new Date());
  const startedAt = clock();
  const now = startedAt.toISOString();
  const deadlineMs = dependencies.deadlineMs ?? (startedAt.getTime()
    + dependencies.configuration.worker.maxRuntimeSeconds * 1_000);
  const revocations = dependencies.revocationRepository && !dependencies.reconciliationOnly
    ? await drainConnectorRevocations({
        repository: dependencies.revocationRepository,
        configuration: dependencies.configuration,
        adapters: dependencies.adapters,
        workerId: dependencies.workerId,
        deadlineMs,
        now: clock,
        random: dependencies.random,
        telemetry: dependencies.telemetry,
        ...(dependencies.decryptRevocationSecret
          ? { decryptRevocationSecret: dependencies.decryptRevocationSecret }
          : {}),
        ...(dependencies.revokeMeta ? { revokeMeta: dependencies.revokeMeta } : {}),
      })
    : undefined;
  const swept = clock().getTime() < deadlineMs
    ? await dependencies.repository.sweepExpired({ batchSize: 100, now })
    : [];
  const jobs = dependencies.reconciliationOnly || clock().getTime() >= deadlineMs ? [] : await dependencies.repository.claimJobs({
      workerId: dependencies.workerId,
      batchSize: dependencies.configuration.worker.batchSize,
      leaseSeconds: dependencies.configuration.worker.leaseSeconds,
      now,
    });
  const counters = { succeeded: 0, deferred: 0, failed: 0 };
  await processJobs(jobs, false, dependencies, counters, deadlineMs);
  let reconciliationJobs: readonly ConnectorJob[] = [];
  if (clock().getTime() < deadlineMs) {
    reconciliationJobs = await dependencies.repository.claimReconciliationJobs({
      workerId: dependencies.workerId,
      batchSize: dependencies.configuration.worker.reconciliationBatchSize,
      leaseSeconds: dependencies.configuration.worker.leaseSeconds,
      now: clock().toISOString(),
    });
    await processJobs(reconciliationJobs, true, dependencies, counters, deadlineMs);
  }
  const result = {
    claimed: jobs.length,
    reconciliationClaimed: reconciliationJobs.length,
    ...counters,
    swept: swept.length,
    ...(revocations ? { revocations } : {}),
  };
  (dependencies.telemetry ?? defaultConnectorTelemetrySink)(connectorTelemetryEvent({
    event: 'worker.batch-finished',
    outcome: result.failed ? 'failed' : result.deferred ? 'deferred' : 'succeeded',
    errorCategory: result.failed ? 'internal_error'
      : result.deferred ? 'provider_acceptance_unknown' : 'none',
    count: jobs.length + reconciliationJobs.length,
  }));
  return result;
}

export async function drainConfiguredConnectorServiceJobs(
  environment: Record<string, string | undefined> = process.env,
  options: { readonly reconciliationOnly?: boolean } = {},
): Promise<ConnectorServiceDrainResult> {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey
    || (!serviceRoleKey.startsWith('ey') && !serviceRoleKey.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Connector service-role worker configuration is missing.');
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const configuration = loadConfiguredConnectorRuntimeConfiguration(environment);
  const workerId = randomUUID();
  const adapters = new Map<ConnectorProvider, ConnectorAdapter>([
    ['contract-test', new ContractTestConnectorAdapter()],
  ]);
  const mailchimp = configuration.definitions.find((definition) => definition.provider === 'mailchimp');
  const google = configuration.definitions.find((definition) => definition.provider === 'google');
  const twilio = configuration.definitions.find((definition) => definition.provider === 'twilio');
  const meta = configuration.definitions.find((definition) => definition.provider === 'meta');
  if (mailchimp?.enabled && ['uat', 'live'].includes(mailchimp.mode)) {
    adapters.set('mailchimp', new MailchimpConnectorAdapter(
      createSupabaseMailchimpAuthorityLoader({
        reader: supabaseMailchimpJobAuthorityReader(client, { workerId }),
      }),
      supabaseServiceContactOutboundGuard(client),
    ));
  }
  if (google?.enabled && ['uat', 'live'].includes(google.mode)) {
    adapters.set('google', new GoogleConnectorAdapter(createSupabaseGoogleAuthorityLoader({
      reader: supabaseGoogleJobAuthorityReader(client, { workerId }), client, environment,
    })));
  }
  if (twilio?.enabled && ['uat', 'live'].includes(twilio.mode)) {
    const callbackBaseUrl = environment.TWILIO_CALLBACK_BASE_URL?.trim();
    const callbackEndpointKey = environment.TWILIO_CALLBACK_ENDPOINT_KEY?.trim();
    if (!callbackBaseUrl || !callbackEndpointKey) {
      throw new ConnectorError('configuration-required', 'Twilio worker callback routing is missing.');
    }
    adapters.set('twilio', new TwilioConnectorAdapter(
      createSupabaseTwilioAuthorityLoader({
        reader: supabaseTwilioJobAuthorityReader(client, { workerId }),
        client, callbackBaseUrl, callbackEndpointKey,
      }),
      undefined,
      supabaseServiceContactOutboundGuard(client),
    ));
  }
  const configuredStartedAt = new Date();
  const deadlineMs = configuredStartedAt.getTime() + configuration.worker.maxRuntimeSeconds * 1_000;
  const result = await drainConnectorServiceJobs({
    repository: supabaseConnectorWorkerRepository(client),
    revocationRepository: supabaseConnectorRevocationRepository(client),
    configuration,
    adapters,
    workerId,
    reconciliationOnly: options.reconciliationOnly,
    deadlineMs,
    decryptRevocationSecret: (job, envelope) => decryptConnectorSecret({
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: envelope.ciphertext, iv: envelope.nonce, tag: envelope.authTag,
      encryptedDek: envelope.wrappedDek, encryptedDekIv: envelope.wrapNonce,
      encryptedDekTag: envelope.wrapAuthTag, kekVersion: envelope.kekVersion,
      aadHash: envelope.aadHash,
    }, {
      workspaceId: job.workspaceId, connectionId: job.connectionId, provider: job.provider,
      secretType: envelope.secretType, recordVersion: envelope.secretVersion,
    }, createEnvironmentKekResolver(environment)),
    revokeMeta: (job, authority) => revokeMetaProviderConnection({ job, authority, environment }),
  });
  const twilioReconciliations = twilio?.enabled
    ? await drainTwilioReconciliations({
        repository: supabaseTwilioReconciliationRepository(client), configuration, workerId, deadlineMs,
      }) : undefined;
  const twilioRealNumberUat = twilio?.enabled
    ? await drainTwilioRealNumberUat({
        repository: supabaseTwilioUatRepository(client), configuration, workerId, deadlineMs,
        callbackBaseUrl: environment.TWILIO_CALLBACK_BASE_URL?.trim() ?? '',
        callbackEndpointKey: environment.TWILIO_CALLBACK_ENDPOINT_KEY?.trim() ?? '',
      }) : undefined;
  const metaNormalizations = meta?.enabled
    ? await drainMetaNormalizationJobs({
        repository: supabaseMetaNormalizationRepository(client),
        workerId, batchSize: configuration.worker.batchSize,
        leaseSeconds: configuration.worker.leaseSeconds, deadlineMs,
      }) : undefined;
  const googleGmailPush = google?.enabled
    ? loadOptionalGoogleGmailPushConfiguration(environment)
    : undefined;
  const googleGmailWakeups = google?.enabled && googleGmailPush
    ? await drainGoogleGmailWakeups({
        repository: supabaseGoogleGmailWakeupRepository(client), configuration,
        workerId, deadlineMs, gmailPush: googleGmailPush,
        intelligence: {
          loadCredential: loadWorkspaceAiAutomationCredential,
          createBudget: (workspaceId, ownerMembershipId) =>
            createSupabaseOmnixServiceAiBudgetAuthority(client, workspaceId, ownerMembershipId),
        },
      }) : undefined;
  if (!mailchimp?.enabled) return {
    ...result,
    ...(twilioReconciliations ? { twilioReconciliations } : {}),
    ...(twilioRealNumberUat ? { twilioRealNumberUat } : {}),
    ...(metaNormalizations ? { metaNormalizations } : {}),
    ...(googleGmailWakeups ? { googleGmailWakeups } : {}),
  };
  const mailchimpReconciliations = await drainMailchimpReconciliationRuns({
    repository: supabaseMailchimpReconciliationRepository({ authenticated: client, service: client }),
    configuration,
    workerId,
    deadlineMs,
  });
  const mailchimpOutboundBackfills = await drainMailchimpOutboundBackfills({
    repository: supabaseMailchimpOutboundBackfillRepository({ authenticated: client, service: client }),
    workerId,
    batchSize: configuration.worker.reconciliationBatchSize,
    leaseSeconds: configuration.worker.leaseSeconds,
    deadlineMs,
  });
  if (options.reconciliationOnly) return {
    ...result, mailchimpReconciliations, mailchimpOutboundBackfills,
    ...(twilioReconciliations ? { twilioReconciliations } : {}),
    ...(twilioRealNumberUat ? { twilioRealNumberUat } : {}),
    ...(metaNormalizations ? { metaNormalizations } : {}),
    ...(googleGmailWakeups ? { googleGmailWakeups } : {}),
  };
  const mailchimpWebhooks = await drainMailchimpWebhookJobs({
    repository: supabaseMailchimpWebhookRepository(client),
    workerId,
    batchSize: configuration.worker.batchSize,
    leaseSeconds: configuration.worker.leaseSeconds,
    deadlineMs,
  });
  return {
    ...result, mailchimpWebhooks, mailchimpReconciliations, mailchimpOutboundBackfills,
    ...(twilioReconciliations ? { twilioReconciliations } : {}),
    ...(twilioRealNumberUat ? { twilioRealNumberUat } : {}),
    ...(metaNormalizations ? { metaNormalizations } : {}),
    ...(googleGmailWakeups ? { googleGmailWakeups } : {}),
  };
}
