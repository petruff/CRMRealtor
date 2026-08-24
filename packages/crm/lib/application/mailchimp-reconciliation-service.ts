import { randomUUID } from 'node:crypto';
import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type {
  MailchimpReconciliationRepository,
  MailchimpReconciliationRun,
} from '../data/supabase-mailchimp-reconciliation-repository.ts';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret, type ConnectorKekResolver } from '../security/connector-secret-envelope.ts';
import { MailchimpMarketingClient, type MailchimpFetch } from '../providers/mailchimp-client.ts';
import type { MailchimpSetupRepository } from '../data/mailchimp-operation-repository.ts';

export async function requestMailchimpReconciliationCommand(
  operations: MailchimpSetupRepository,
  repository: MailchimpReconciliationRepository,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly mode?: 'baseline' | 'reconcile';
    readonly pageSize?: number;
    readonly correlationId: string;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.mode !== 'live' || scope.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  const connectionId = input.connectionId.trim();
  const pageSize = input.pageSize ?? 100;
  if (!connectionId || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new ConnectorError('invalid-input', 'Mailchimp reconciliation request is invalid.');
  }
  const binding = await operations.getSelectedAudience(scope, connectionId);
  if (!binding?.id) throw new ConnectorError('not-found', 'Select a Mailchimp audience first.');
  const mode = input.mode ?? (binding.baselineRequired ? 'baseline' : 'reconcile');
  const snapshotHash = stablePayloadHash({
    connectionId,
    bindingId: binding.id,
    audienceId: binding.audienceId,
    mappingVersion: binding.mappingVersion,
    mode,
    pageSize,
  });
  const requestKeyHash = stablePayloadHash({ snapshotHash, requestedAt: now.toISOString() });
  return repository.request(scope, {
    connectionId,
    bindingId: binding.id,
    mode,
    snapshotHash,
    requestKeyHash,
    pageSize,
    correlationId: input.correlationId,
    requestedAt: now.toISOString(),
  });
}

/**
 * Starts the durable baseline and gives the owner-triggered request a bounded
 * opportunity to finish immediately. The persisted run remains the source of
 * truth, so a timeout or provider retry is safely resumed by the cron worker.
 */
export async function requestAndDrainMailchimpReconciliationCommand(
  operations: MailchimpSetupRepository,
  repository: MailchimpReconciliationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scope: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly mode?: 'baseline' | 'reconcile';
    readonly pageSize?: number;
    readonly correlationId: string;
  },
  options: {
    readonly workerId?: string;
    readonly runtimeBudgetMs?: number;
    readonly now?: () => Date;
    readonly resolver?: ConnectorKekResolver;
    readonly fetcher?: MailchimpFetch;
    readonly createClient?: (dataCenter: string, token: string) => Pick<MailchimpMarketingClient, 'listAudienceMembers'>;
  } = {},
) {
  const clock = options.now ?? (() => new Date());
  const runtimeBudgetMs = options.runtimeBudgetMs ?? Math.min(
    configuration.worker.maxRuntimeSeconds * 1_000,
    8_000,
  );
  if (!Number.isInteger(runtimeBudgetMs) || runtimeBudgetMs < 1_000 || runtimeBudgetMs > 30_000) {
    throw new ConnectorError('invalid-input', 'Mailchimp reconciliation runtime budget is invalid.');
  }
  const requested = await requestMailchimpReconciliationCommand(
    operations,
    repository,
    scope,
    input,
    clock(),
  );
  const startedAt = clock().getTime();
  const drained = await drainMailchimpReconciliationRuns({
    repository,
    configuration,
    workerId: options.workerId ?? randomUUID(),
    deadlineMs: startedAt + runtimeBudgetMs,
    now: clock,
    resolver: options.resolver,
    fetcher: options.fetcher,
    createClient: options.createClient,
  });
  return { requested, drained };
}

export interface MailchimpReconciliationDrainResult {
  readonly claimed: number;
  readonly completed: number;
  readonly deferred: number;
  readonly review: number;
  readonly pages: number;
}

function retryAt(now: Date, run: MailchimpReconciliationRun): string {
  const seconds = Math.min(3_600, 15 * (2 ** Math.max(0, run.attemptCount - 1)));
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

export async function drainMailchimpReconciliationRuns(input: {
  readonly repository: MailchimpReconciliationRepository;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly workerId: string;
  readonly deadlineMs: number;
  readonly now?: () => Date;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: MailchimpFetch;
  readonly createClient?: (dataCenter: string, token: string) => Pick<MailchimpMarketingClient, 'listAudienceMembers'>;
}): Promise<MailchimpReconciliationDrainResult> {
  const clock = input.now ?? (() => new Date());
  if (clock().getTime() >= input.deadlineMs) return { claimed: 0, completed: 0, deferred: 0, review: 0, pages: 0 };
  const claimed = await input.repository.claim({
    workerId: input.workerId,
    batchSize: input.configuration.worker.reconciliationBatchSize,
    leaseSeconds: input.configuration.worker.leaseSeconds,
    now: clock().toISOString(),
  });
  const result = { claimed: claimed.length, completed: 0, deferred: 0, review: 0, pages: 0 };
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  for (const leased of claimed) {
    if (clock().getTime() >= input.deadlineMs) break;
    let run = leased;
    try {
      run = await input.repository.start({ run, workerId: input.workerId, now: clock().toISOString() });
      const authority = await input.repository.readAuthority({ run, workerId: input.workerId, now: clock().toISOString() });
      if (authority.run.workspaceId !== run.workspaceId || authority.run.connectionId !== run.connectionId) {
        throw new ConnectorError('forbidden', 'Mailchimp reconciliation authority is invalid.');
      }
      const token = decryptConnectorSecret(authority.accessTokenEnvelope, {
        workspaceId: run.workspaceId,
        connectionId: run.connectionId,
        provider: 'mailchimp',
        secretType: 'mailchimp-access-token',
        recordVersion: authority.secretVersion,
      }, resolver);
      const provider = input.createClient?.(authority.dataCenter, token)
        ?? new MailchimpMarketingClient(authority.dataCenter, token, input.fetcher);
      let finished = false;
      while (!finished && clock().getTime() < input.deadlineMs) {
        const page = await provider.listAudienceMembers({
          audienceId: authority.audienceId,
          count: run.pageSize,
          offset: run.nextOffset,
        });
        const members = page.members.map((member) => ({
          ...member,
          sourceHash: stablePayloadHash({
            runId: run.id,
            audienceId: authority.audienceId,
            memberId: member.memberId,
            subscriberHash: member.subscriberHash,
            status: member.subscriptionStatus,
            lastChangedAt: member.lastChangedAt,
          }),
        }));
        const nextOffset = run.nextOffset + members.length;
        const pageHash = stablePayloadHash({
          runId: run.id,
          offset: run.nextOffset,
          nextOffset,
          providerTotal: page.totalItems,
          sourceHashes: members.map((member) => member.sourceHash),
        });
        const applied = await input.repository.applyPage({
          run,
          workerId: input.workerId,
          members,
          nextOffset,
          providerTotal: page.totalItems,
          pageHash,
          appliedAt: clock().toISOString(),
        });
        result.pages += 1;
        run = applied.run;
        if (applied.finalPage) {
          const final = await input.repository.complete({
            run,
            workerId: input.workerId,
            providerRequestHash: stablePayloadHash({ runId: run.id, providerTotal: page.totalItems, pageHash }),
            completedAt: clock().toISOString(),
          });
          result[final.state === 'succeeded' ? 'completed' : 'review'] += 1;
          finished = true;
        }
      }
      if (!finished) {
        const occurredAt = clock();
        const exhausted = run.attemptCount >= run.maxAttempts;
        await input.repository.transition({
          run,
          workerId: input.workerId,
          outcome: exhausted ? 'review' : 'retry',
          errorCategory: exhausted ? 'attempts_exhausted' : 'runtime_checkpoint',
          ...(!exhausted ? { retryAt: new Date(occurredAt.getTime() + 1_000).toISOString() } : {}),
          occurredAt: occurredAt.toISOString(),
        });
        result[exhausted ? 'review' : 'deferred'] += 1;
      }
    } catch (problem) {
      if (problem instanceof ConnectorError && problem.code === 'lease-lost') continue;
      const failClosed = problem instanceof ConnectorError && ['invalid-input', 'conflict', 'forbidden'].includes(problem.code);
      const exhausted = run.attemptCount >= run.maxAttempts;
      const review = failClosed || exhausted;
      try {
        const rateLimited = problem instanceof ConnectorError && problem.code === 'provider-retryable';
        await input.repository.transition({
          run,
          workerId: input.workerId,
          outcome: review ? 'review' : 'retry',
          errorCategory: failClosed ? 'invalid_provider_page'
            : exhausted ? 'attempts_exhausted'
              : rateLimited ? 'rate_limited' : 'provider_unavailable',
          ...(!review ? { retryAt: retryAt(clock(), run) } : {}),
          occurredAt: clock().toISOString(),
        });
        result[review ? 'review' : 'deferred'] += 1;
      } catch (transitionError) {
        if (!(transitionError instanceof ConnectorError && transitionError.code === 'lease-lost')) throw transitionError;
      }
    }
  }
  return result;
}
