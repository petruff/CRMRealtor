import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type { TwilioUatAuthority, TwilioUatJob, TwilioUatRepository } from '../data/supabase-twilio-uat-repository.ts';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import { parseE164Phone, parseTextMessageBody } from '../domain/texting.ts';
import { TwilioMessagingClient, type TwilioFetch } from '../providers/twilio-client.ts';
import { parseTwilioApiCredential, parseTwilioProviderAuthority } from '../providers/supabase-twilio-authority-loader.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret, type ConnectorKekResolver } from '../security/connector-secret-envelope.ts';

export interface TwilioUatDrainResult {
  claimed: number; delivered: number; deferred: number; failed: number;
}

function payload(authority: TwilioUatAuthority, resolver: ConnectorKekResolver) {
  if (!authority.payloadEnvelope || !authority.payloadKind || !authority.payloadVersion || !authority.payloadHash) {
    throw new ConnectorError('conflict', 'Twilio UAT send payload is unavailable.');
  }
  const raw = decryptConnectorSecret(authority.payloadEnvelope, {
    workspaceId: authority.job.workspaceId, connectionId: authority.job.connectionId,
    provider: 'twilio', secretType: authority.payloadKind, recordVersion: authority.payloadVersion,
  }, resolver);
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    value = parsed as Record<string, unknown>;
  } catch { throw new ConnectorError('conflict', 'Twilio UAT payload is invalid.'); }
  const keys = ['schemaVersion', 'draftId', 'draftVersion', 'body', 'bodyHash', 'recipientPhone', 'recipientPhoneHash', 'connectionId'];
  if (Object.keys(value).sort().join('|') !== keys.sort().join('|')) {
    throw new ConnectorError('conflict', 'Twilio UAT payload contains unsupported routing fields.');
  }
  const body = parseTextMessageBody(value.body);
  const phone = parseE164Phone(value.recipientPhone);
  if (value.schemaVersion !== 'twilio-message-body.v1'
    || value.connectionId !== authority.job.connectionId
    || value.bodyHash !== sha256Hex(body) || value.bodyHash !== authority.job.bodyHash
    || value.bodyHash !== authority.payloadHash
    || value.recipientPhoneHash !== sha256Hex(phone)
    || value.recipientPhoneHash !== authority.job.recipientPhoneHash) {
    throw new ConnectorError('forbidden', 'Twilio UAT payload does not match the approved authority.');
  }
  return { body, phone };
}

function client(authority: TwilioUatAuthority, input: {
  resolver: ConnectorKekResolver; callbackBaseUrl: string; callbackEndpointKey: string; fetcher?: TwilioFetch;
}) {
  const provider = parseTwilioProviderAuthority(decryptConnectorSecret(authority.providerAuthorityEnvelope, {
    workspaceId: authority.job.workspaceId, connectionId: authority.job.connectionId, provider: 'twilio',
    secretType: 'twilio-provider-authority', recordVersion: authority.providerAuthorityVersion,
  }, input.resolver));
  const apiKeySecret = parseTwilioApiCredential(decryptConnectorSecret(authority.apiCredentialEnvelope, {
    workspaceId: authority.job.workspaceId, connectionId: authority.job.connectionId, provider: 'twilio',
    secretType: 'twilio-api-key-secret', recordVersion: authority.apiCredentialVersion,
  }, input.resolver));
  if (sha256Hex(provider.accountSid) !== authority.accountSidHash
    || sha256Hex(provider.apiKeySid) !== authority.apiKeySidHash
    || sha256Hex(provider.messagingServiceSid) !== authority.messagingServiceSidHash) {
    throw new ConnectorError('forbidden', 'Twilio UAT credential identity does not match the workspace.');
  }
  return new TwilioMessagingClient({
    ...provider, apiKeySecret, callbackBaseUrl: input.callbackBaseUrl,
    callbackEndpointKey: input.callbackEndpointKey,
  }, input.fetcher);
}

function retryAt(now: Date, job: TwilioUatJob): string {
  const seconds = Math.min(3_600, 15 * (2 ** Math.max(0, job.attemptCount - 1)));
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

export async function drainTwilioRealNumberUat(input: {
  repository: TwilioUatRepository; configuration: ConnectorRuntimeConfiguration;
  workerId: string; deadlineMs: number; callbackBaseUrl: string; callbackEndpointKey: string;
  now?: () => Date; resolver?: ConnectorKekResolver; fetcher?: TwilioFetch;
  createClient?: (authority: TwilioUatAuthority) => Pick<TwilioMessagingClient, 'sendMessage' | 'getMessage'>;
}): Promise<TwilioUatDrainResult> {
  const clock = input.now ?? (() => new Date());
  if (clock().getTime() >= input.deadlineMs) return { claimed: 0, delivered: 0, deferred: 0, failed: 0 };
  const jobs = await input.repository.claim({
    workerId: input.workerId, batchSize: Math.min(5, input.configuration.worker.reconciliationBatchSize),
    leaseSeconds: input.configuration.worker.leaseSeconds, now: clock().toISOString(),
  });
  const result = { claimed: jobs.length, delivered: 0, deferred: 0, failed: 0 };
  for (const leased of jobs) {
    if (clock().getTime() >= input.deadlineMs) break;
    let job = leased;
    let evidenceComplete = false;
    try {
      job = await input.repository.start({ job, workerId: input.workerId, now: clock().toISOString() });
      const authority = await input.repository.read({ job, workerId: input.workerId, now: clock().toISOString() });
      evidenceComplete = authority.evidenceComplete;
      const provider = input.createClient ? input.createClient(authority) : client(authority, {
        resolver: input.resolver ?? createEnvironmentKekResolver(), callbackBaseUrl: input.callbackBaseUrl,
        callbackEndpointKey: input.callbackEndpointKey, fetcher: input.fetcher,
      });
      if (authority.mode === 'send') {
        const operation = payload(authority, input.resolver ?? createEnvironmentKekResolver());
        const send = await provider.sendMessage({
          to: operation.phone, body: operation.body, idempotencyKey: `uat:${job.id}`,
        });
        await input.repository.bind({
          job, workerId: input.workerId, messageSid: send.messageSid,
          requestHash: stablePayloadHash({ jobId: job.id, bodyHash: job.bodyHash, recipientPhoneHash: job.recipientPhoneHash }),
          now: clock().toISOString(),
        });
        authority.providerMessageSid = send.messageSid;
        authority.providerMessageSidHash = sha256Hex(send.messageSid);
      }
      if (!authority.providerMessageSid || sha256Hex(authority.providerMessageSid) !== authority.providerMessageSidHash) {
        throw new ConnectorError('forbidden', 'Twilio UAT provider message binding is invalid.');
      }
      const lookup = await provider.getMessage(authority.providerMessageSid);
      const now = clock();
      if (
        lookup
        && lookup.messageSid === authority.providerMessageSid
        && lookup.status === 'delivered'
        && authority.evidenceComplete
      ) {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: 'delivered', finalStatus: lookup.status,
          evidenceHash: stablePayloadHash({ jobId: job.id, messageSidHash: sha256Hex(lookup.messageSid), status: lookup.status }),
          now: now.toISOString(),
        });
        result.delivered += 1;
      } else {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: 'retry',
          errorCategory: authority.evidenceComplete
            ? 'uat_finalize_pending'
            : lookup?.status === 'delivered'
              ? 'uat_sequence_pending'
              : 'uat_delivery_pending',
          nextAttemptAt: retryAt(now, job), now: now.toISOString(),
        });
        result.deferred += 1;
      }
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      if (authorityIsAwaitingFinalLookup(error, job, evidenceComplete)) {
        const now = clock();
        try {
          await input.repository.transition({
            job,
            workerId: input.workerId,
            outcome: 'retry',
            errorCategory: 'uat_finalize_pending',
            nextAttemptAt: retryAt(now, job),
            now: now.toISOString(),
          });
          result.deferred += 1;
        } catch (transitionError) {
          if (!(transitionError instanceof ConnectorError && transitionError.code === 'lease-lost')) throw transitionError;
        }
        continue;
      }
      const terminal = error instanceof ConnectorError
        && ['forbidden', 'invalid-input', 'conflict', 'configuration-required', 'provider-disabled'].includes(error.code);
      const now = clock();
      try {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: terminal || job.attemptCount >= job.maxAttempts ? 'failed' : 'retry',
          errorCategory: terminal ? 'uat_authority_invalid' : 'uat_provider_unavailable',
          ...(!terminal && job.attemptCount < job.maxAttempts ? { nextAttemptAt: retryAt(now, job) } : {}),
          now: now.toISOString(),
        });
        result[terminal || job.attemptCount >= job.maxAttempts ? 'failed' : 'deferred'] += 1;
      } catch (transitionError) {
        if (!(transitionError instanceof ConnectorError && transitionError.code === 'lease-lost')) throw transitionError;
      }
    }
  }
  return result;
}

function authorityIsAwaitingFinalLookup(
  error: unknown,
  job: TwilioUatJob,
  evidenceComplete: boolean,
): boolean {
  return job.state === 'executing'
    && evidenceComplete
    && error instanceof ConnectorError
    && error.code === 'provider-retryable';
}
