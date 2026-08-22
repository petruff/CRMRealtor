import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ConnectorError, sha256Hex } from '@/lib/domain/connector';
import {
  verifyAndNormalizeMetaWebhook,
  verifyMetaWebhookChallenge,
  type MetaInboundMessage,
} from '@/lib/domain/meta';

export interface MetaWebhookAuthority {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly graphVersion: string;
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly selectedAssetIds: readonly string[];
}

export interface MetaWebhookHandlerRepository {
  resolveAuthority(input: { readonly endpointKey: string; readonly occurredAt: string }): Promise<MetaWebhookAuthority>;
  confirmChallenge(input: {
    readonly endpointKeyHash: string;
    readonly challengeEvidenceHash: string;
    readonly occurredAt: string;
  }): Promise<void>;
  ingest(input: {
    readonly authority: MetaWebhookAuthority;
    readonly endpointKeyHash: string;
    readonly bodyHash: string;
    readonly messages: readonly MetaInboundMessage[];
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<{ readonly accepted: number; readonly duplicate: number; readonly review: number }>;
}

export interface MetaWebhookHandlerDependencies {
  readonly repository: MetaWebhookHandlerRepository;
  readonly endpointKey: string;
  readonly now?: () => Date;
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

function endpointKey(value: string): string {
  const clean = value.trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(clean)) {
    throw new ConnectorError('not-found', 'Meta webhook endpoint is unavailable.');
  }
  return clean;
}

function occurredAt(now?: () => Date): string {
  const date = (now ?? (() => new Date()))();
  if (!Number.isFinite(date.getTime())) throw new ConnectorError('invalid-input', 'Meta webhook timestamp is invalid.');
  return date.toISOString();
}

export async function handleMetaWebhookChallenge(
  request: Request,
  dependencies: MetaWebhookHandlerDependencies,
): Promise<Response> {
  try {
    const key = endpointKey(dependencies.endpointKey);
    const authority = await dependencies.repository.resolveAuthority({ endpointKey: key, occurredAt: occurredAt(dependencies.now) });
    const url = new URL(request.url);
    const challenge = verifyMetaWebhookChallenge({
      mode: url.searchParams.get('hub.mode'),
      verifyToken: url.searchParams.get('hub.verify_token'),
      challenge: url.searchParams.get('hub.challenge'),
      expectedVerifyToken: authority.verifyToken,
    });
    await dependencies.repository.confirmChallenge({
      endpointKeyHash: sha256Hex(key),
      challengeEvidenceHash: sha256Hex(`${authority.connectionId}|${challenge}`),
      occurredAt: occurredAt(dependencies.now),
    });
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof ConnectorError && error.code === 'not-found' ? 404 : 403;
    return json({ ok: false, code: status === 404 ? 'not-found' : 'verification-failed' }, status);
  }
}

export async function handleMetaWebhookDelivery(
  request: Request,
  dependencies: MetaWebhookHandlerDependencies,
): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > 1_048_576) return json({ ok: false, code: 'payload-too-large' }, 413);
  try {
    const key = endpointKey(dependencies.endpointKey);
    const receivedAt = occurredAt(dependencies.now);
    const authority = await dependencies.repository.resolveAuthority({ endpointKey: key, occurredAt: receivedAt });
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const normalized = verifyAndNormalizeMetaWebhook({
      rawBody,
      signature: request.headers.get('x-hub-signature-256') ?? '',
      appSecret: authority.appSecret,
    });
    const allowedAssets = new Set(authority.selectedAssetIds);
    if (!normalized.messages.every((message) => allowedAssets.has(message.assetId))) {
      throw new ConnectorError('forbidden', 'Meta webhook asset binding failed.');
    }
    const result = await dependencies.repository.ingest({
      authority,
      endpointKeyHash: sha256Hex(key),
      bodyHash: normalized.bodyHash,
      messages: normalized.messages,
      correlationId: randomUUID(),
      occurredAt: receivedAt,
    });
    return json({
      ok: true,
      schemaVersion: 'meta-webhook-receipt.v1',
      accepted: result.accepted,
      duplicate: result.duplicate,
      review: result.review,
      inboundOnly: true,
    }, 202);
  } catch (error) {
    const status = error instanceof ConnectorError
      ? error.code === 'forbidden' ? 401 : error.code === 'not-found' ? 404 : error.code === 'conflict' ? 202 : 400
      : 503;
    return json({
      ok: status === 202,
      schemaVersion: 'meta-webhook-receipt.v1',
      code: status === 202 ? 'duplicate' : status === 401 ? 'verification-failed'
        : status === 404 ? 'not-found' : status === 503 ? 'unavailable' : 'invalid-event',
    }, status);
  }
}
