import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type {
  GoogleGmailWakeupRepository,
  GoogleGmailWakeupJob,
} from '../data/supabase-google-gmail-wakeup-repository.ts';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import {
  GoogleCursorExpiredError,
  GoogleWorkspaceClient,
  loadGoogleOAuthConfiguration,
  refreshGoogleAccessToken,
  type GoogleFetch,
  type GoogleOAuthConfiguration,
} from '../providers/google-client.ts';
import type { GoogleGmailPushConfiguration } from '../config/google-gmail-push.ts';
import { encryptedGoogleCursor, normalizedGoogleCounterpart } from './google-sync-service.ts';

export interface GoogleGmailWakeupDrainResult {
  readonly scheduled: number; readonly claimed: number; readonly succeeded: number; readonly deferred: number;
  readonly failed: number; readonly messages: number;
}

function tokenEnvelope(envelope: ReturnType<typeof encryptConnectorSecret>, expiresAt: string) {
  return {
    ciphertext: envelope.ciphertext, nonce: envelope.iv, authTag: envelope.tag,
    wrappedDek: envelope.encryptedDek, wrapNonce: envelope.encryptedDekIv,
    wrapAuthTag: envelope.encryptedDekTag, kekVersion: envelope.kekVersion,
    aadHash: envelope.aadHash, expiresAt,
  };
}

function retryAt(now: Date, attemptCount: number) {
  return new Date(now.getTime() + Math.min(3_600, 15 * (2 ** Math.max(0, attemptCount - 1))) * 1_000).toISOString();
}

function category(error: unknown): string {
  if (error instanceof GoogleCursorExpiredError) return 'gmail_history_expired';
  if (error instanceof ConnectorError) {
    if (error.code === 'provider-retryable') return 'rate_limited';
    if (error.code === 'forbidden') return 'authorization_revoked';
    if (error.code === 'conflict' || error.code === 'invalid-input') return 'validation_failed';
    if (error.code === 'configuration-required') return 'configuration_required';
  }
  return 'provider_unavailable';
}

export async function drainGoogleGmailWakeups(input: {
  readonly repository: GoogleGmailWakeupRepository;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly workerId: string;
  readonly deadlineMs: number;
  readonly now?: () => Date;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: GoogleFetch;
  readonly oauthConfiguration?: GoogleOAuthConfiguration;
  readonly gmailPush?: GoogleGmailPushConfiguration;
}) {
  const clock = input.now ?? (() => new Date());
  if (clock().getTime() >= input.deadlineMs) {
    return { scheduled: 0, claimed: 0, succeeded: 0, deferred: 0, failed: 0, messages: 0 };
  }
  const scheduled = input.gmailPush
    ? await input.repository.schedule({ now: clock().toISOString(), horizonSeconds: 86_400, limit: 25 })
    : 0;
  const claimed = await input.repository.claim({
    workerId: input.workerId, batchSize: input.configuration.worker.reconciliationBatchSize,
    leaseSeconds: input.configuration.worker.leaseSeconds, now: clock().toISOString(),
  });
  const result = { scheduled, claimed: claimed.length, succeeded: 0, deferred: 0, failed: 0, messages: 0 };
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  for (const leased of claimed) {
    if (clock().getTime() >= input.deadlineMs) break;
    let job: GoogleGmailWakeupJob = leased;
    try {
      job = await input.repository.start(leased, input.workerId, clock().toISOString());
      const authority = await input.repository.read(job, input.workerId, clock().toISOString());
      let accessToken = decryptConnectorSecret(authority.access, {
        workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'google',
        secretType: 'google-access-token', recordVersion: authority.access.secretVersion,
      }, resolver);
      if (authority.accessState === 'refresh-required') {
        if (!authority.refresh) throw new ConnectorError('not-found', 'Google refresh token authority is unavailable.');
        const refreshToken = decryptConnectorSecret(authority.refresh, {
          workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'google',
          secretType: 'google-refresh-token', recordVersion: authority.refresh.secretVersion,
        }, resolver);
        const refreshed = await refreshGoogleAccessToken({
          configuration: input.oauthConfiguration ?? loadGoogleOAuthConfiguration(), refreshToken,
          ...(input.fetcher ? { fetcher: input.fetcher } : {}),
        });
        if (refreshed.grantedScopes
          && !refreshed.grantedScopes.includes('https://www.googleapis.com/auth/gmail.metadata')) {
          throw new ConnectorError('forbidden', 'Google refreshed token lost Gmail metadata authority.');
        }
        const version = authority.access.secretVersion + 1;
        const expiresAt = new Date(clock().getTime() + refreshed.expiresInSeconds * 1_000).toISOString();
        const encrypted = encryptConnectorSecret(refreshed.accessToken, {
          workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'google',
          secretType: 'google-access-token', recordVersion: version,
        }, resolver);
        await input.repository.refresh({ job, workerId: input.workerId,
          expectedVersion: authority.access.secretVersion, envelope: tokenEnvelope(encrypted, expiresAt),
          occurredAt: clock().toISOString() });
        accessToken = refreshed.accessToken;
      }
      const client = new GoogleWorkspaceClient(accessToken, input.fetcher);
      if (job.jobKind === 'watch-renewal') {
        if (!input.gmailPush || authority.watch.subscriptionHash !== input.gmailPush.subscriptionHash) {
          throw new ConnectorError('configuration-required', 'Verified Gmail watch renewal routing is unavailable.');
        }
        const watch = await client.watchGmail({ topicName: input.gmailPush.topicName });
        await input.repository.renew({
          job, workerId: input.workerId, expectedWatchVersion: authority.watch.resourceVersion,
          expectedBindingVersion: authority.watch.bindingVersion,
          channelHash: stablePayloadHash({ subscription: input.gmailPush.subscriptionName }),
          resourceHash: stablePayloadHash({ historyId: watch.historyId, expiresAt: watch.expiresAt }),
          expiresAt: watch.expiresAt, endpointKeyHash: input.gmailPush.endpointKeyHash,
          exactExternalUrlHash: input.gmailPush.exactExternalUrlHash,
          subscriptionHash: input.gmailPush.subscriptionHash,
          oidcAudienceHash: input.gmailPush.oidcAudienceHash, occurredAt: clock().toISOString(),
        });
        result.succeeded += 1;
        continue;
      }
      let page: { readonly messageIds: readonly string[]; readonly historyId: string; readonly nextPageToken?: string };
      let startHistoryId: string;
      if (authority.cursor) {
        const cursorValue = decryptConnectorSecret(authority.cursor.envelope, {
          workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'google',
          secretType: 'google.gmail-history', recordVersion: authority.cursor.version,
        }, resolver);
        let cursor: { startHistoryId?: string; historyId?: string; pageToken?: string | null };
        try { cursor = JSON.parse(cursorValue) as typeof cursor; }
        catch { throw new ConnectorError('conflict', 'Google Gmail cursor is invalid.'); }
        startHistoryId = cursor.startHistoryId ?? cursor.historyId ?? '';
        if (!startHistoryId) throw new ConnectorError('conflict', 'Google Gmail cursor is invalid.');
        page = await client.listGmailHistory({
          startHistoryId, maxResults: 500, ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
        });
      } else {
        // Cursor expiry is recovered by one explicitly bounded metadata scan.
        // The next private checkpoint resumes authoritative history.list calls.
        const profile = await client.probeProfile();
        startHistoryId = profile.historyId;
        page = {
          messageIds: await client.listRecentGmailMetadataIds(100),
          historyId: profile.historyId,
        };
      }
      let lastProviderEventAt: string | undefined;
      for (const messageId of page.messageIds.slice(0, 500)) {
        const metadata = await client.getGmailMetadata(messageId);
        const counterpart = normalizedGoogleCounterpart({
          from: metadata.from, to: metadata.to, self: authority.connectionEmail,
        });
        const resourceHash = stablePayloadHash({
          connectionId: job.connectionId, messageId: metadata.messageId, threadId: metadata.threadId,
          internalDate: metadata.internalDate, direction: counterpart.direction,
          counterpart: counterpart.email, labels: metadata.labels,
        });
        await input.repository.bindMetadata({
          job, workerId: input.workerId, messageId: metadata.messageId, threadId: metadata.threadId,
          direction: counterpart.direction, counterpartEmail: counterpart.email,
          counterpartKind: counterpart.counterpartKind, labels: metadata.labels,
          providerOccurredAt: metadata.internalDate, resourceHash, occurredAt: clock().toISOString(),
        });
        result.messages += 1;
        lastProviderEventAt = metadata.internalDate;
      }
      const nextCursor = JSON.stringify({
        historyId: page.historyId, startHistoryId: page.nextPageToken ? startHistoryId : page.historyId,
        pageToken: page.nextPageToken ?? null,
      });
      const nextVersion = (authority.cursor?.version ?? 0) + 1;
      const checkpointHash = stablePayloadHash({ historyId: page.historyId, pageToken: page.nextPageToken ?? null });
      await input.repository.commit({
        job, workerId: input.workerId, expectedVersion: authority.cursor?.version ?? null,
        cursorEnvelope: encryptedGoogleCursor(nextCursor, {
          workspaceId: job.workspaceId, connectionId: job.connectionId, stream: 'google.gmail-history',
          version: nextVersion, resolver,
        }), checkpointHash, hasMore: Boolean(page.nextPageToken),
        ...(lastProviderEventAt ? { lastProviderEventAt } : {}), occurredAt: clock().toISOString(),
      });
      result.succeeded += 1;
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'lease-lost') continue;
      const occurredAt = clock();
      const errorCategory = category(error);
      const cursorExpired = error instanceof GoogleCursorExpiredError;
      const terminal = !cursorExpired && (errorCategory === 'validation_failed'
        || errorCategory === 'authorization_revoked' || errorCategory === 'configuration_required'
        || job.attemptCount >= job.maxAttempts);
      try {
        await input.repository.transition({
          job, workerId: input.workerId, outcome: cursorExpired ? 'cursor_expired' : terminal ? 'failed' : 'retry',
          errorCategory, ...(!cursorExpired && !terminal ? { nextAttemptAt: retryAt(occurredAt, job.attemptCount) } : {}),
          occurredAt: occurredAt.toISOString(),
        });
        result[terminal ? 'failed' : 'deferred'] += 1;
      } catch (transitionError) {
        if (!(transitionError instanceof ConnectorError && transitionError.code === 'lease-lost')) throw transitionError;
      }
    }
  }
  return result;
}
