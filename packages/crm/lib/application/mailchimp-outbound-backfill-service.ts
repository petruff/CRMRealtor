import { randomUUID } from 'node:crypto';
import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type {
  MailchimpOutboundBackfillMode,
  MailchimpOutboundBackfillRepository,
} from '../data/mailchimp-outbound-backfill-repository.ts';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import {
  isCanonicalWorkspaceOwnerScope,
  validateWorkspaceScope,
  type WorkspaceScope,
} from '../domain/workspace.ts';
import {
  createEnvironmentKekResolver,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';

function enabled(configuration: ConnectorRuntimeConfiguration) {
  const definition = configuration.definitions.find((item) => item.provider === 'mailchimp');
  if (!definition?.enabled || !['uat', 'live'].includes(definition.mode)) {
    throw new ConnectorError('provider-disabled', 'Mailchimp is not enabled in this deployment.');
  }
}

function owner(scopeInput: WorkspaceScope) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.mode !== 'live' || !isCanonicalWorkspaceOwnerScope(scope)) {
    throw new ConnectorError('forbidden', 'A signed-in workspace owner is required.');
  }
  return scope;
}

export function previewMailchimpOutboundBackfillCommand(
  repository: MailchimpOutboundBackfillRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly mode?: MailchimpOutboundBackfillMode;
    readonly pageSize?: number;
    readonly requestKey?: string;
    readonly correlationId?: string;
    readonly maxAttempts?: number;
  },
  now = new Date(),
) {
  const scope = owner(scopeInput);
  enabled(configuration);
  const connectionId = input.connectionId.trim();
  const pageSize = input.pageSize ?? 100;
  const maxAttempts = input.maxAttempts ?? 10;
  if (!connectionId || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20
    || !Number.isFinite(now.getTime())) {
    throw new ConnectorError('invalid-input', 'Mailchimp outbound preview input is invalid.');
  }
  return repository.preview(scope, {
    connectionId, mode: input.mode ?? 'backfill', pageSize, maxAttempts,
    requestKeyHash: sha256Hex(input.requestKey ?? randomUUID()),
    correlationId: input.correlationId ?? randomUUID(), previewedAt: now.toISOString(),
  });
}

export function approveMailchimpOutboundBackfillCommand(
  repository: MailchimpOutboundBackfillRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { readonly runId: string; readonly snapshotHash: string; readonly mappingVersion: number; readonly correlationId?: string },
  now = new Date(),
) {
  const scope = owner(scopeInput);
  enabled(configuration);
  if (!input.runId.trim() || !/^[0-9a-f]{64}$/.test(input.snapshotHash)
    || !Number.isInteger(input.mappingVersion) || input.mappingVersion < 1
    || !Number.isFinite(now.getTime())) {
    throw new ConnectorError('invalid-input', 'Mailchimp outbound approval input is invalid.');
  }
  return repository.approve(scope, {
    runId: input.runId.trim(), snapshotHash: input.snapshotHash,
    mappingVersion: input.mappingVersion, correlationId: input.correlationId ?? randomUUID(),
    approvedAt: now.toISOString(),
  });
}

export interface MailchimpOutboundBackfillDrainResult {
  readonly scheduled: number;
  readonly claimed: number;
  readonly pages: number;
  readonly jobsEnqueued: number;
  readonly deferred: number;
  readonly review: number;
  readonly completed: number;
}

export async function drainMailchimpOutboundBackfills(input: {
  readonly repository: MailchimpOutboundBackfillRepository;
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly reconciliationIntervalSeconds?: number;
  readonly deadlineMs: number;
  readonly resolver?: ConnectorKekResolver;
  readonly now?: () => Date;
}): Promise<MailchimpOutboundBackfillDrainResult> {
  const clock = input.now ?? (() => new Date());
  const counters = { scheduled: 0, claimed: 0, pages: 0, jobsEnqueued: 0, deferred: 0, review: 0, completed: 0 };
  if (clock().getTime() >= input.deadlineMs) return counters;
  counters.scheduled = (await input.repository.scheduleDue({
    now: clock().toISOString(), intervalSeconds: input.reconciliationIntervalSeconds ?? 86_400, limit: 25,
  })).length;
  if (clock().getTime() >= input.deadlineMs) return counters;
  const claimed = await input.repository.claim({
    workerId: input.workerId, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds, now: clock().toISOString(),
  });
  counters.claimed = claimed.length;
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  for (const claimedRun of claimed) {
    if (clock().getTime() >= input.deadlineMs) break;
    let active = claimedRun;
    try {
      active = await input.repository.start({
        runId: active.id, workerId: input.workerId, fencingToken: active.fencingToken, startedAt: clock().toISOString(),
      });
      while (active.nextOffset < active.eligibleCount && clock().getTime() < input.deadlineMs) {
        const page = await input.repository.readPage({
          runId: active.id, workerId: input.workerId, fencingToken: active.fencingToken, now: clock().toISOString(),
        });
        const envelopes = page.items.map((item) => ({
          itemIndex: item.itemIndex,
          operationKey: item.operation.operationKey,
          envelope: encryptConnectorSecret(JSON.stringify(item.operation), {
            workspaceId: page.run.workspaceId,
            connectionId: page.run.connectionId,
            provider: 'mailchimp',
            secretType: 'audience.sync',
            recordVersion: 1,
          }, resolver),
        }));
        const enqueued = await input.repository.enqueuePage({
          runId: active.id, workerId: input.workerId, fencingToken: active.fencingToken,
          offset: page.offset, pageHash: page.pageHash, envelopes, occurredAt: clock().toISOString(),
        });
        active = enqueued.run;
        counters.pages += enqueued.noOp ? 0 : 1;
        counters.jobsEnqueued += enqueued.noOp ? 0 : enqueued.jobIds.length;
      }
      if (active.nextOffset < active.eligibleCount) {
        await input.repository.transition({
          runId: active.id, workerId: input.workerId, fencingToken: active.fencingToken,
          outcome: 'retry', errorCategory: 'runtime_deadline',
          retryAt: new Date(clock().getTime() + 60_000).toISOString(), occurredAt: clock().toISOString(),
        });
        counters.deferred += 1;
        continue;
      }
      const settled = await input.repository.settle({
        runId: active.id, workerId: input.workerId, fencingToken: active.fencingToken,
        retryAt: new Date(clock().getTime() + 60_000).toISOString(), occurredAt: clock().toISOString(),
      });
      if (settled.completed) counters.completed += 1;
      else if (settled.run.state === 'review') counters.review += 1;
      else counters.deferred += 1;
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      try {
        await input.repository.transition({
          runId: active.id, workerId: input.workerId, fencingToken: active.fencingToken,
          outcome: 'retry', errorCategory: 'worker_failure',
          retryAt: new Date(clock().getTime() + 60_000).toISOString(), occurredAt: clock().toISOString(),
        });
        counters.deferred += 1;
      } catch (transitionError) {
        if (!(transitionError instanceof ConnectorError && transitionError.code === 'lease-lost')) throw transitionError;
      }
    }
  }
  return counters;
}
