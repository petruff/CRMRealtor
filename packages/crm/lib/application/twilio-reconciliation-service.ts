import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type {
  TwilioReconciliationAuthority,
  TwilioReconciliationJob,
  TwilioReconciliationRepository,
} from '../data/supabase-twilio-reconciliation-repository.ts';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type { TextingDeliveryState } from '../domain/texting.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret, type ConnectorKekResolver } from '../security/connector-secret-envelope.ts';
import { TwilioMessagingClient, type TwilioFetch } from '../providers/twilio-client.ts';
import { parseTwilioApiCredential, parseTwilioProviderAuthority } from '../providers/supabase-twilio-authority-loader.ts';

export interface TwilioReconciliationDrainResult {
  readonly scheduled: number;
  readonly claimed: number;
  readonly resolved: number;
  readonly deferred: number;
  readonly failed: number;
}

function retryAt(now: Date, job: TwilioReconciliationJob): string {
  const seconds = Math.min(3_600, 15 * (2 ** Math.max(0, job.attemptCount - 1)));
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function isTerminal(status: TextingDeliveryState): boolean {
  return ['delivered', 'undelivered', 'failed', 'cancelled'].includes(status);
}

function clientForAuthority(
  authority: TwilioReconciliationAuthority,
  resolver: ConnectorKekResolver,
  fetcher?: TwilioFetch,
): Pick<TwilioMessagingClient, 'getMessage'> {
  const provider = parseTwilioProviderAuthority(decryptConnectorSecret(authority.providerAuthorityEnvelope, {
    workspaceId: authority.job.workspaceId, connectionId: authority.job.connectionId, provider: 'twilio',
    secretType: 'twilio-provider-authority', recordVersion: authority.providerAuthorityVersion,
  }, resolver));
  const apiKeySecret = parseTwilioApiCredential(decryptConnectorSecret(authority.apiCredentialEnvelope, {
    workspaceId: authority.job.workspaceId, connectionId: authority.job.connectionId, provider: 'twilio',
    secretType: 'twilio-api-key-secret', recordVersion: authority.apiCredentialVersion,
  }, resolver));
  if (sha256Hex(provider.accountSid) !== authority.accountSidHash
    || sha256Hex(provider.apiKeySid) !== authority.apiKeySidHash
    || sha256Hex(provider.messagingServiceSid) !== authority.messagingServiceSidHash
    || !/^SM[A-Fa-f0-9]{32}$/.test(authority.providerMessageSid)
    || sha256Hex(authority.providerMessageSid) !== authority.providerMessageSidHash) {
    throw new ConnectorError('forbidden', 'Twilio reconciliation authority does not match its workspace binding.');
  }
  return new TwilioMessagingClient({
    ...provider, apiKeySecret,
    callbackBaseUrl: 'https://reconciliation.invalid', callbackEndpointKey: 'reconciliation-only',
  }, fetcher);
}

export async function drainTwilioReconciliations(input: {
  readonly repository: TwilioReconciliationRepository;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly workerId: string;
  readonly deadlineMs: number;
  readonly now?: () => Date;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: TwilioFetch;
  readonly createClient?: (
    authority: TwilioReconciliationAuthority,
  ) => Pick<TwilioMessagingClient, 'getMessage'>;
}): Promise<TwilioReconciliationDrainResult> {
  const clock = input.now ?? (() => new Date());
  if (clock().getTime() >= input.deadlineMs) {
    return { scheduled: 0, claimed: 0, resolved: 0, deferred: 0, failed: 0 };
  }
  const scheduled = await input.repository.schedule({ now: clock().toISOString() });
  const claimed = await input.repository.claim({
    workerId: input.workerId, batchSize: input.configuration.worker.reconciliationBatchSize,
    leaseSeconds: input.configuration.worker.leaseSeconds, now: clock().toISOString(),
  });
  const result = { scheduled, claimed: claimed.length, resolved: 0, deferred: 0, failed: 0 };
  for (const leased of claimed) {
    if (clock().getTime() >= input.deadlineMs) break;
    let job = leased;
    try {
      job = await input.repository.start({ job, workerId: input.workerId, now: clock().toISOString() });
      const authority = await input.repository.readAuthority({ job, workerId: input.workerId, now: clock().toISOString() });
      const client = input.createClient
        ? input.createClient(authority)
        : clientForAuthority(authority, input.resolver ?? createEnvironmentKekResolver(), input.fetcher);
      const provider = await client.getMessage(authority.providerMessageSid);
      const occurredAt = clock();
      if (provider && provider.messageSid === authority.providerMessageSid && isTerminal(provider.status)) {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: 'resolved', providerStatus: provider.status,
          providerOccurredAt: occurredAt.toISOString(), now: occurredAt.toISOString(),
        });
        result.resolved += 1;
      } else {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: provider ? 'retry' : 'unknown',
          errorCategory: provider ? 'provider_status_pending' : 'provider_message_not_found',
          retryAt: retryAt(occurredAt, job), now: occurredAt.toISOString(),
        });
        result.deferred += 1;
      }
    } catch (problem) {
      if (problem instanceof ConnectorError && problem.code === 'lease-lost') continue;
      const failClosed = problem instanceof ConnectorError
        && ['invalid-input', 'conflict', 'forbidden', 'configuration-required', 'provider-disabled'].includes(problem.code);
      const exhausted = job.attemptCount >= job.maxAttempts;
      const terminal = failClosed || exhausted;
      const occurredAt = clock();
      try {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: terminal ? 'terminal' : 'retry',
          errorCategory: failClosed ? 'authority_invalid' : exhausted ? 'attempts_exhausted'
            : problem instanceof ConnectorError && problem.code === 'provider-retryable'
              ? 'rate_limited' : 'provider_unavailable',
          ...(!terminal ? { retryAt: retryAt(occurredAt, job) } : {}), now: occurredAt.toISOString(),
        });
        result[terminal ? 'failed' : 'deferred'] += 1;
      } catch (transitionError) {
        if (!(transitionError instanceof ConnectorError && transitionError.code === 'lease-lost')) throw transitionError;
      }
    }
  }
  return result;
}
