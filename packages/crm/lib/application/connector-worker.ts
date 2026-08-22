import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import {
  ConnectorError,
  redactConnectorDetail,
  stablePayloadHash,
  type ConnectorAdapter,
  type ConnectorAdapterResult,
  type ConnectorJob,
  type ConnectorProvider,
} from '../domain/connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import { connectorTelemetryEvent, type ConnectorTelemetrySink } from '../observability/connector-telemetry.ts';

export interface ConnectorWorkerDependencies {
  readonly repository: ConnectorRepository;
  readonly scope: WorkspaceScope;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly adapters: ReadonlyMap<ConnectorProvider, ConnectorAdapter>;
  readonly workerId: string;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly telemetry?: ConnectorTelemetrySink;
}

export interface ConnectorWorkerResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly deferred: number;
  readonly failed: number;
  readonly reconciled: number;
  readonly jobIds: readonly string[];
}

function retryDelaySeconds(
  attempt: number,
  configuration: ConnectorRuntimeConfiguration,
  random: () => number,
  providerDelay?: number,
): number {
  if (providerDelay !== undefined) {
    return Math.min(configuration.retry.maxDelaySeconds, Math.max(1, Math.ceil(providerDelay)));
  }
  const cap = Math.min(
    configuration.retry.maxDelaySeconds,
    configuration.retry.baseDelaySeconds * (2 ** Math.max(0, attempt - 1)),
  );
  return Math.max(1, Math.ceil(cap * Math.min(1, Math.max(0, random()))));
}

function requestHash(job: ConnectorJob): string {
  return stablePayloadHash({
    provider: job.provider,
    actionType: job.actionType,
    payloadReference: job.payloadReference,
    idempotencyKey: job.idempotencyKey,
  });
}

async function hasUnknownOutcome(repository: ConnectorRepository, scope: WorkspaceScope, job: ConnectorJob) {
  const receipts = await repository.listReceipts(scope, { jobId: job.id, limit: 100 });
  const latestUnknown = receipts.find((event) => event.type === 'provider.unknown');
  const latestFinal = receipts.find((event) => event.type === 'provider.final');
  return Boolean(latestUnknown && (!latestFinal || latestUnknown.occurredAt > latestFinal.occurredAt));
}

async function applyAdapterResult(
  deps: ConnectorWorkerDependencies,
  job: ConnectorJob,
  result: ConnectorAdapterResult,
  occurredAt: string,
  reconciliation: boolean,
): Promise<'succeeded' | 'deferred' | 'failed'> {
  const { repository, scope, workerId, configuration } = deps;
  if (result.outcome === 'succeeded') {
    await repository.completeJob(scope, {
      jobId: job.id,
      workerId,
      fencingToken: job.fencingToken,
      providerReceiptId: result.providerReceiptId,
      providerStatus: result.providerStatus,
      requestHash: requestHash(job),
      occurredAt,
    });
    if (reconciliation) {
      await repository.appendReceipt(scope, {
        provider: job.provider,
        intentId: job.intentId,
        jobId: job.id,
        attemptNumber: job.attemptCount + 1,
        type: 'job.reconciled',
        correlationId: job.correlationId,
        providerReceiptId: result.providerReceiptId,
        providerStatus: result.providerStatus,
        errorCategory: 'none',
        occurredAt,
      });
    }
    return 'succeeded';
  }
  if (result.outcome === 'unknown') {
    const nextAttemptAt = new Date(new Date(occurredAt).getTime() + configuration.retry.baseDelaySeconds * 1_000)
      .toISOString();
    await repository.deferJob(scope, {
      jobId: job.id,
      workerId,
      fencingToken: job.fencingToken,
      errorCategory: result.errorCategory,
      detail: 'Provider outcome requires reconciliation; execution will not be repeated blindly.',
      nextAttemptAt,
      occurredAt,
    });
    return 'deferred';
  }
  if (result.outcome === 'retryable-failure') {
    const seconds = retryDelaySeconds(
      job.attemptCount + 1,
      configuration,
      deps.random ?? Math.random,
      result.retryAfterSeconds,
    );
    await repository.deferJob(scope, {
      jobId: job.id,
      workerId,
      fencingToken: job.fencingToken,
      errorCategory: result.errorCategory,
      detail: 'Provider attempt did not complete and is eligible for bounded retry.',
      nextAttemptAt: new Date(new Date(occurredAt).getTime() + seconds * 1_000).toISOString(),
      occurredAt,
    });
    return 'deferred';
  }
  await repository.deferJob(scope, {
    jobId: job.id,
    workerId,
    fencingToken: job.fencingToken,
    errorCategory: result.errorCategory,
    detail: 'Provider attempt reached a terminal failure category.',
    occurredAt,
  });
  return 'failed';
}

export async function drainConnectorJobs(
  dependencies: ConnectorWorkerDependencies,
): Promise<ConnectorWorkerResult> {
  const scope = validateWorkspaceScope(dependencies.scope);
  if (scope.role !== 'owner' || scope.mode !== 'live') {
    throw new ConnectorError('forbidden', 'Connector worker requires a server-bound live owner workspace.');
  }
  const started = (dependencies.now ?? (() => new Date()))();
  const leased = await dependencies.repository.leaseJobs(scope, {
    workerId: dependencies.workerId,
    now: started.toISOString(),
    leaseSeconds: dependencies.configuration.worker.leaseSeconds,
    limit: dependencies.configuration.worker.batchSize,
  });
  let succeeded = 0;
  let deferred = 0;
  let failed = 0;
  let reconciled = 0;
  for (const job of leased) {
    const elapsedSeconds = ((dependencies.now ?? (() => new Date()))().getTime() - started.getTime()) / 1_000;
    if (elapsedSeconds >= dependencies.configuration.worker.maxRuntimeSeconds) break;
    const adapter = dependencies.adapters.get(job.provider);
    if (!adapter) {
      await dependencies.repository.deferJob(scope, {
        jobId: job.id,
        workerId: dependencies.workerId,
        fencingToken: job.fencingToken,
        errorCategory: 'configuration_required',
        detail: 'No enabled adapter is registered for this provider.',
        occurredAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      });
      failed += 1;
      continue;
    }
    const reconciliation = await hasUnknownOutcome(dependencies.repository, scope, job);
    try {
      await dependencies.repository.beginAttempt(scope, {
        jobId: job.id,
        workerId: dependencies.workerId,
        fencingToken: job.fencingToken,
        occurredAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      });
      const result = reconciliation ? await adapter.reconcile(job) : await adapter.execute(job);
      const outcome = await applyAdapterResult(
        dependencies,
        job,
        result,
        (dependencies.now ?? (() => new Date()))().toISOString(),
        reconciliation,
      );
      if (outcome === 'succeeded') succeeded += 1;
      else if (outcome === 'deferred') deferred += 1;
      else failed += 1;
      if (reconciliation && outcome === 'succeeded') reconciled += 1;
      dependencies.telemetry?.(connectorTelemetryEvent({
        event: 'worker.job-finished',
        provider: job.provider,
        workspaceId: scope.workspaceId,
        jobId: job.id,
        correlationId: job.correlationId,
        outcome,
        errorCategory: outcome === 'succeeded' ? 'none' : outcome === 'deferred'
          ? 'provider_acceptance_unknown' : 'internal_error',
      }));
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      await dependencies.repository.deferJob(scope, {
        jobId: job.id,
        workerId: dependencies.workerId,
        fencingToken: job.fencingToken,
        errorCategory: 'internal_error',
        detail: redactConnectorDetail(error instanceof Error ? error.message : 'Unknown worker error.'),
        occurredAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      });
      failed += 1;
    }
  }
  const result = {
    claimed: leased.length,
    succeeded,
    deferred,
    failed,
    reconciled,
    jobIds: leased.map((job) => job.id),
  };
  dependencies.telemetry?.(connectorTelemetryEvent({
    event: 'worker.batch-finished',
    workspaceId: scope.workspaceId,
    outcome: failed ? 'failed' : deferred ? 'deferred' : 'succeeded',
    errorCategory: failed ? 'internal_error' : deferred ? 'provider_acceptance_unknown' : 'none',
    count: leased.length,
  }));
  return result;
}

export class ContractTestConnectorAdapter implements ConnectorAdapter {
  readonly provider = 'contract-test' as const;
  private readonly reconciled = new Set<string>();

  async execute(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.actionType === 'test.succeed') {
      return { outcome: 'succeeded', providerReceiptId: `contract:${job.id}`, providerStatus: 'accepted' };
    }
    if (job.actionType === 'test.ambiguous') {
      this.reconciled.add(job.id);
      return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
    }
    if (job.actionType === 'test.retryable') {
      return { outcome: 'retryable-failure', errorCategory: 'provider_unavailable' };
    }
    return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
  }

  async reconcile(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.actionType === 'test.ambiguous' && this.reconciled.has(job.id)) {
      return { outcome: 'succeeded', providerReceiptId: `contract:${job.id}`, providerStatus: 'reconciled' };
    }
    return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
  }

  async revoke(connection: import('../domain/connector.ts').ConnectorConnection): Promise<ConnectorAdapterResult> {
    return {
      outcome: 'succeeded',
      providerReceiptId: `contract:revoke:${connection.id}`,
      providerStatus: 'revoked',
    };
  }
}
