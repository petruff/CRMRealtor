import { randomUUID } from 'node:crypto';
import type {
  MailchimpWebhookSigningAuthority,
  SupabaseMailchimpWebhookRepository,
} from '../data/supabase-mailchimp-webhook-repository.ts';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import { parseMailchimpWebhookEvent } from '../domain/mailchimp.ts';
import { parseMailchimpMarketingWebhookForm } from '../providers/mailchimp-webhook.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import { verifyMailchimpMarketingWebhook } from '../security/connector-webhook.ts';

const WEBHOOK_SECRET_TYPE = 'mailchimp.webhook';
const WEBHOOK_SIGNING_SECRET_TYPE = 'mailchimp-webhook-signing-secret';

export interface MailchimpWebhookIngestResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly jobId?: string;
}

export async function resolveMailchimpWebhookEndpoint(
  repository: SupabaseMailchimpWebhookRepository,
  endpointKey: string,
  input: { readonly now?: Date; readonly resolver?: ConnectorKekResolver } = {},
): Promise<MailchimpWebhookSigningAuthority & { readonly signingSecret: string }> {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(endpointKey)) {
    throw new ConnectorError('not-found', 'Mailchimp webhook endpoint was not found.');
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Webhook timestamp is invalid.');
  const authority = await repository.readSigningAuthority(sha256Hex(endpointKey), now.toISOString());
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  const signingSecret = decryptConnectorSecret(authority.signingSecretEnvelope, {
    workspaceId: authority.workspaceId,
    connectionId: authority.connectionId,
    provider: 'mailchimp',
    secretType: WEBHOOK_SIGNING_SECRET_TYPE,
    recordVersion: authority.secretVersion,
  }, resolver);
  return { ...authority, signingSecret };
}

/** Verifies exact raw bytes, then parses, encrypts and durably queues the event. */
export async function ingestMailchimpWebhook(input: {
  readonly repository: SupabaseMailchimpWebhookRepository;
  readonly endpointKey: string;
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string;
  readonly now?: Date;
  readonly correlationId?: string;
  readonly resolver?: ConnectorKekResolver;
}): Promise<MailchimpWebhookIngestResult> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Webhook timestamp is invalid.');
  const authority = await resolveMailchimpWebhookEndpoint(input.repository, input.endpointKey, {
    now,
    resolver: input.resolver,
  });
  const rawBodyHash = sha256Hex(input.rawBody);
  const verified = await verifyMailchimpMarketingWebhook({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    signingSecret: authority.signingSecret,
    providerEventKey: rawBodyHash,
    now,
    // Persistent replay authority is register_mailchimp_webhook_event. The
    // verifier still performs signature/timestamp checks before any parsing.
    replayStore: { claim: async () => true },
  });
  const event = parseMailchimpMarketingWebhookForm(input.rawBody);
  const payloadHash = stablePayloadHash(event);
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify(event), {
    workspaceId: authority.workspaceId,
    connectionId: authority.connectionId,
    provider: 'mailchimp',
    secretType: WEBHOOK_SECRET_TYPE,
    recordVersion: 1,
  }, resolver);
  return input.repository.register({
    authority,
    event,
    replayKeyHash: verified.replayKey,
    rawBodyHash: verified.bodyHash,
    payloadHash,
    envelope,
    correlationId: input.correlationId ?? randomUUID(),
    receivedAt: verified.receivedAt,
  });
}

export interface MailchimpWebhookDrainResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly deferred: number;
  readonly review: number;
}

function retryTime(now: Date, attemptCount: number): string {
  const seconds = Math.min(3_600, 15 * (2 ** Math.max(0, attemptCount - 1)));
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function decodedWebhookEvent(value: string) {
  try {
    return parseMailchimpWebhookEvent(JSON.parse(value));
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError('invalid-input', 'Mailchimp webhook payload is invalid.');
  }
}

export async function drainMailchimpWebhookJobs(input: {
  readonly repository: SupabaseMailchimpWebhookRepository;
  readonly workerId: string;
  readonly resolver?: ConnectorKekResolver;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly deadlineMs: number;
  readonly now?: () => Date;
}): Promise<MailchimpWebhookDrainResult> {
  const clock = input.now ?? (() => new Date());
  if (clock().getTime() >= input.deadlineMs) return { claimed: 0, succeeded: 0, deferred: 0, review: 0 };
  const jobs = await input.repository.claim({
    workerId: input.workerId,
    batchSize: input.batchSize,
    leaseSeconds: input.leaseSeconds,
    now: clock().toISOString(),
  });
  const result = { claimed: jobs.length, succeeded: 0, deferred: 0, review: 0 };
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  for (const leased of jobs) {
    if (clock().getTime() >= input.deadlineMs) break;
    let job = leased;
    try {
      job = await input.repository.start({ job: leased, workerId: input.workerId, now: clock().toISOString() });
      const payload = await input.repository.readPayload({ job, workerId: input.workerId, now: clock().toISOString() });
      const plaintext = decryptConnectorSecret(payload.eventEnvelope, {
        workspaceId: job.workspaceId,
        connectionId: job.connectionId,
        provider: 'mailchimp',
        secretType: WEBHOOK_SECRET_TYPE,
        recordVersion: payload.envelopeVersion,
      }, resolver);
      const event = decodedWebhookEvent(plaintext);
      if (event.audienceId !== payload.audienceId) {
        throw new ConnectorError('conflict', 'Mailchimp webhook audience binding is invalid.');
      }
      const applied = await input.repository.apply({ job, workerId: input.workerId, event });
      const review = ['review', 'blocked-unsubscribe-authority'].includes(applied.outcome);
      await input.repository.transition({
        job,
        workerId: input.workerId,
        outcome: review ? 'review' : 'succeeded',
        ...(review ? { errorCategory: applied.outcome.replaceAll('-', '_') } : {}),
        occurredAt: clock().toISOString(),
      });
      result[review ? 'review' : 'succeeded'] += 1;
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      const failClosed = error instanceof ConnectorError
        && ['invalid-input', 'conflict', 'forbidden'].includes(error.code);
      const exhausted = job.attemptCount >= job.maxAttempts;
      const review = failClosed || exhausted;
      await input.repository.transition({
        job,
        workerId: input.workerId,
        outcome: review ? 'review' : 'retry',
        errorCategory: failClosed ? 'invalid_webhook_event' : exhausted ? 'attempts_exhausted' : 'internal_error',
        ...(!review ? { retryAt: retryTime(clock(), job.attemptCount) } : {}),
        occurredAt: clock().toISOString(),
      });
      result[review ? 'review' : 'deferred'] += 1;
    }
  }
  return result;
}
