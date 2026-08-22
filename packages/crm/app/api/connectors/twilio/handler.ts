import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { ReturnTypeOfTwilioWebhookRepository } from './types';
import { ConnectorError } from '@/lib/domain/connector';
import { verifyAndNormalizeTwilioWebhook } from '@/lib/application/twilio-webhook-service';

export interface TwilioWebhookDependencies {
  readonly repository: ReturnTypeOfTwilioWebhookRepository;
  readonly externalBaseUrl: string;
  readonly endpointKey: string;
  readonly now?: () => Date;
}

function response(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function handleTwilioWebhook(
  request: Request,
  kind: 'inbound' | 'status',
  dependencies: TwilioWebhookDependencies,
) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    !== 'application/x-www-form-urlencoded') {
    return response({ ok: false, code: 'invalid-content-type' }, 415);
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > 1_048_576) return response({ ok: false, code: 'payload-too-large' }, 413);
  try {
    const rawBody = await request.text();
    const endpointKey = dependencies.endpointKey.trim();
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(endpointKey)) {
      throw new ConnectorError('configuration-required', 'Twilio callback endpoint authority is unavailable.');
    }
    const externalUrl = `${dependencies.externalBaseUrl.replace(/\/$/, '')}/api/connectors/twilio/${endpointKey}/${kind}`;
    const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const authority = await dependencies.repository.resolveVerification({
      endpointKey, callbackKind: kind, occurredAt,
    });
    const event = verifyAndNormalizeTwilioWebhook({
      kind, rawBody, externalUrl, authToken: authority.authToken,
      signature: request.headers.get('x-twilio-signature') ?? '',
      receivedAt: occurredAt,
    });
    const receipt = await dependencies.repository.ingest({
      event, endpointKey, authority, correlationId: randomUUID(), occurredAt,
    });
    return response({
      ok: receipt.accepted, schemaVersion: 'twilio-webhook-receipt.v1',
      accepted: receipt.accepted, duplicate: receipt.duplicate, outcome: receipt.outcome,
    }, receipt.accepted ? 202 : 400);
  } catch (error) {
    const status = error instanceof ConnectorError
      ? error.code === 'forbidden' ? 401 : error.code === 'conflict' ? 202 : error.code === 'not-found' ? 404 : 400
      : 503;
    return response({ ok: status === 202, schemaVersion: 'twilio-webhook-receipt.v1',
      code: status === 202 ? 'duplicate' : status === 401 ? 'verification-failed'
        : status === 404 ? 'not-found' : status === 503 ? 'unavailable' : 'invalid-event' }, status);
  }
}
