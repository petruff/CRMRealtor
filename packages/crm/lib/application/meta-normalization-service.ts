import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import type { SupabaseMetaNormalizationRepository } from '../data/supabase-meta-normalization-repository.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';

export interface MetaNormalizationDrainResult {
  readonly claimed: number;
  readonly linked: number;
  readonly review: number;
  readonly deferred: number;
  readonly failed: number;
}

export async function drainMetaNormalizationJobs(input: {
  readonly repository: SupabaseMetaNormalizationRepository;
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly deadlineMs: number;
  readonly resolver?: ConnectorKekResolver;
  readonly now?: () => Date;
}): Promise<MetaNormalizationDrainResult> {
  const clock = input.now ?? (() => new Date());
  const result = { claimed: 0, linked: 0, review: 0, deferred: 0, failed: 0 };
  if (clock().getTime() >= input.deadlineMs) return result;
  const jobs = await input.repository.claim({
    workerId: input.workerId, batchSize: input.batchSize,
    leaseSeconds: input.leaseSeconds, now: clock().toISOString(),
  });
  result.claimed = jobs.length;
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  for (const leased of jobs) {
    if (clock().getTime() >= input.deadlineMs) break;
    let job = leased;
    try {
      job = await input.repository.start({ job, workerId: input.workerId, now: clock().toISOString() });
      const authority = await input.repository.read({ job, workerId: input.workerId, now: clock().toISOString() });
      const plaintext = decryptConnectorSecret(authority.payload.value, {
        workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'meta',
        secretType: 'meta-inbound-message', recordVersion: authority.payload.version,
      }, resolver);
      if (authority.payload.canonicalHash !== authority.eventContentHash) {
        throw new ConnectorError('conflict', 'Meta content hash authority does not match the event.');
      }
      let payload: unknown;
      try { payload = JSON.parse(plaintext); } catch { throw new ConnectorError('invalid-input', 'Meta content payload is invalid.'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || (payload as Record<string, unknown>).schemaVersion !== 'meta-inbound-message.v1') {
        throw new ConnectorError('invalid-input', 'Meta content schema is invalid.');
      }
      const content = payload as Record<string, unknown>;
      if (stablePayloadHash({
        text: typeof content.text === 'string' ? content.text : undefined,
        attachmentTypes: content.attachmentTypes,
      }) !== authority.eventContentHash) {
        throw new ConnectorError('conflict', 'Meta decrypted content does not match its event hash.');
      }
      const outcome = await input.repository.apply({
        job, workerId: input.workerId,
        evidenceHash: sha256Hex(`meta-normalization|${authority.eventContentHash}`),
        occurredAt: clock().toISOString(),
      });
      result[outcome === 'linked' ? 'linked' : 'review'] += 1;
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      const failClosed = error instanceof ConnectorError && ['invalid-input', 'conflict', 'forbidden'].includes(error.code);
      const exhausted = job.attemptCount >= job.maxAttempts;
      const failed = failClosed || exhausted;
      await input.repository.transition({
        job, workerId: input.workerId, outcome: failed ? 'failed' : 'retry',
        errorCategory: failClosed ? 'invalid_payload' : exhausted ? 'attempts_exhausted' : 'internal_error',
        ...(!failed ? { retryAt: new Date(clock().getTime() + 60_000).toISOString() } : {}),
        occurredAt: clock().toISOString(),
      });
      result[failed ? 'failed' : 'deferred'] += 1;
    }
  }
  return result;
}
