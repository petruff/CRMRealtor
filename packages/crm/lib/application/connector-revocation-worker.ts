import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type {
  ConnectorRevocationJob,
  ConnectorRevocationRepository,
} from '../data/supabase-connector-revocation-repository.ts';
import {
  ConnectorError,
  stablePayloadHash,
  type ConnectorAdapter,
  type ConnectorAdapterResult,
  type ConnectorProvider,
} from '../domain/connector.ts';
import {
  connectorTelemetryEvent,
  defaultConnectorTelemetrySink,
  type ConnectorTelemetrySink,
} from '../observability/connector-telemetry.ts';

export interface ConnectorRevocationWorkerDependencies {
  readonly repository: ConnectorRevocationRepository;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly adapters: ReadonlyMap<ConnectorProvider, ConnectorAdapter>;
  readonly workerId: string;
  readonly deadlineMs: number;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly telemetry?: ConnectorTelemetrySink;
  readonly decryptRevocationSecret?: (
    job: ConnectorRevocationJob,
    envelope: Awaited<ReturnType<ConnectorRevocationRepository['readSecret']>>,
  ) => Promise<string> | string;
  readonly revokeMeta?: (
    job: ConnectorRevocationJob,
    authority: unknown,
  ) => Promise<ConnectorAdapterResult>;
}

export interface ConnectorRevocationDrainResult {
  readonly claimed: number;
  readonly confirmed: number;
  readonly deferred: number;
  readonly unconfirmed: number;
}

function nextAttemptAt(
  job: ConnectorRevocationJob,
  occurredAt: string,
  configuration: ConnectorRuntimeConfiguration,
  random: () => number,
  requested?: number,
): string {
  const cap = requested ?? Math.min(
    configuration.retry.maxDelaySeconds,
    configuration.retry.baseDelaySeconds * (2 ** Math.max(0, job.attemptCount - 1)),
  );
  const seconds = requested === undefined
    ? Math.max(1, Math.ceil(cap * Math.max(0, Math.min(1, random()))))
    : Math.max(1, Math.ceil(Math.min(configuration.retry.maxDelaySeconds, requested)));
  return new Date(new Date(occurredAt).getTime() + seconds * 1_000).toISOString();
}

function providerEvidence(job: ConnectorRevocationJob, result: ConnectorAdapterResult) {
  if (result.outcome !== 'succeeded') return {};
  return {
    confirmationKind: 'provider-confirmed' as const,
    providerRequestHash: stablePayloadHash({
      provider: job.provider,
      connectionId: job.connectionId,
      providerReceiptId: result.providerReceiptId,
    }),
    providerStatus: result.providerStatus.slice(0, 128),
  };
}

async function transitionAdapterResult(
  dependencies: ConnectorRevocationWorkerDependencies,
  job: ConnectorRevocationJob,
  result: ConnectorAdapterResult,
  occurredAt: string,
): Promise<'confirmed' | 'deferred' | 'unconfirmed'> {
  if (result.outcome === 'succeeded' && result.providerStatus === 'no-revocation-endpoint') {
    await dependencies.repository.transition({
      jobId: job.id,
      workerId: dependencies.workerId,
      fencingToken: job.fencingToken,
      outcome: 'terminal',
      errorCategory: 'configuration_required',
      evidence: { reasonCode: 'manual-provider-revocation-required' },
      transitionedAt: occurredAt,
    });
    return 'unconfirmed';
  }
  if (result.outcome === 'succeeded') {
    await dependencies.repository.transition({
      jobId: job.id,
      workerId: dependencies.workerId,
      fencingToken: job.fencingToken,
      outcome: 'confirmed',
      evidence: providerEvidence(job, result),
      transitionedAt: occurredAt,
    });
    return 'confirmed';
  }
  if (result.outcome === 'retryable-failure') {
    await dependencies.repository.transition({
      jobId: job.id,
      workerId: dependencies.workerId,
      fencingToken: job.fencingToken,
      outcome: 'retry',
      errorCategory: result.errorCategory,
      nextAttemptAt: nextAttemptAt(
        job,
        occurredAt,
        dependencies.configuration,
        dependencies.random ?? Math.random,
        result.retryAfterSeconds,
      ),
      evidence: { reasonCode: 'provider-retryable' },
      transitionedAt: occurredAt,
    });
    return job.attemptCount >= job.maxAttempts ? 'unconfirmed' : 'deferred';
  }
  if (result.outcome === 'unknown') {
    await dependencies.repository.transition({
      jobId: job.id,
      workerId: dependencies.workerId,
      fencingToken: job.fencingToken,
      outcome: 'unknown',
      errorCategory: result.errorCategory,
      nextAttemptAt: nextAttemptAt(
        job,
        occurredAt,
        dependencies.configuration,
        dependencies.random ?? Math.random,
      ),
      evidence: { reasonCode: 'provider-outcome-unknown' },
      transitionedAt: occurredAt,
    });
    return job.attemptCount >= job.maxAttempts ? 'unconfirmed' : 'deferred';
  }
  await dependencies.repository.transition({
    jobId: job.id,
    workerId: dependencies.workerId,
    fencingToken: job.fencingToken,
    outcome: 'terminal',
    errorCategory: result.errorCategory,
    evidence: { reasonCode: 'provider-terminal-failure' },
    transitionedAt: occurredAt,
  });
  return 'unconfirmed';
}

export async function drainConnectorRevocations(
  dependencies: ConnectorRevocationWorkerDependencies,
): Promise<ConnectorRevocationDrainResult> {
  const clock = dependencies.now ?? (() => new Date());
  if (clock().getTime() >= dependencies.deadlineMs) {
    return { claimed: 0, confirmed: 0, deferred: 0, unconfirmed: 0 };
  }
  const jobs = await dependencies.repository.claim({
    workerId: dependencies.workerId,
    batchSize: dependencies.configuration.worker.batchSize,
    leaseSeconds: dependencies.configuration.worker.leaseSeconds,
    now: clock().toISOString(),
  });
  const result = { claimed: jobs.length, confirmed: 0, deferred: 0, unconfirmed: 0 };
  const telemetry = dependencies.telemetry ?? defaultConnectorTelemetrySink;
  for (const leased of jobs) {
    if (clock().getTime() >= dependencies.deadlineMs) break;
    let job: ConnectorRevocationJob;
    try {
      job = await dependencies.repository.start({
        jobId: leased.id,
        workerId: dependencies.workerId,
        fencingToken: leased.fencingToken,
        startedAt: clock().toISOString(),
      });
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      throw error;
    }

    const adapter = dependencies.adapters.get(job.provider);
    let outcome: 'confirmed' | 'deferred' | 'unconfirmed';
    let category = 'none';
    try {
      if (job.provider === 'meta' && dependencies.revokeMeta) {
        const authority = await dependencies.repository.readProviderAuthority?.({
          jobId: job.id, workerId: dependencies.workerId, fencingToken: job.fencingToken,
          now: clock().toISOString(),
        });
        const adapterResult = await dependencies.revokeMeta(job, authority);
        category = adapterResult.outcome === 'succeeded' ? 'none' : adapterResult.errorCategory;
        outcome = await transitionAdapterResult(dependencies, job, adapterResult, clock().toISOString());
      } else if (!adapter?.revoke) {
        category = 'configuration_required';
        outcome = await transitionAdapterResult(dependencies, job, {
          outcome: 'terminal-failure',
          errorCategory: 'configuration_required',
        }, clock().toISOString());
      } else {
        let accessToken: string | undefined;
        if (job.provider === 'google') {
          if (!dependencies.decryptRevocationSecret) {
            throw new ConnectorError('configuration-required', 'Google revocation secret decryption is not configured.');
          }
          const envelope = await dependencies.repository.readSecret({
            jobId: job.id, workerId: dependencies.workerId, fencingToken: job.fencingToken,
            secretType: 'google-refresh-token', now: clock().toISOString(),
          });
          accessToken = await dependencies.decryptRevocationSecret(job, envelope);
        }
        const adapterResult = await adapter.revoke(job.connection, accessToken);
        category = adapterResult.outcome === 'succeeded' ? 'none' : adapterResult.errorCategory;
        outcome = await transitionAdapterResult(dependencies, job, adapterResult, clock().toISOString());
      }
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      category = 'network_outcome_unknown';
      outcome = await transitionAdapterResult(dependencies, job, {
        outcome: 'unknown', errorCategory: 'network_outcome_unknown',
      }, clock().toISOString());
    }
    result[outcome] += 1;
    telemetry(connectorTelemetryEvent({
      event: 'worker.revocation-finished',
      provider: job.provider,
      workspaceId: job.workspaceId,
      jobId: job.id,
      correlationId: job.correlationId,
      outcome: outcome === 'confirmed' ? 'succeeded' : outcome === 'deferred' ? 'deferred' : 'failed',
      errorCategory: category,
    }));
  }
  return result;
}
