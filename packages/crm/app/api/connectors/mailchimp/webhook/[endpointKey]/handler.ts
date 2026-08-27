import { NextResponse } from 'next/server';
import type { SupabaseMailchimpWebhookRepository } from '@/lib/data/supabase-mailchimp-webhook-repository';
import { ConnectorError } from '@/lib/domain/connector';
import type { ConnectorKekResolver } from '@/lib/security/connector-secret-envelope';
import {
  ingestMailchimpWebhook,
} from '@/lib/application/mailchimp-webhook-service';

export interface MailchimpWebhookRouteDependencies {
  readonly repository: SupabaseMailchimpWebhookRepository;
  readonly now?: Date;
  readonly resolver?: ConnectorKekResolver;
}

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

export async function handleMailchimpWebhookValidation(
  endpointKey: string,
) {
  // Mailchimp probes the callback before its create-webhook response returns
  // the one-time signing secret. At that point there cannot be persisted
  // signing authority yet. Accept only the exact high-entropy key shape that
  // Omnix generates; POST delivery still requires persisted authority and a
  // valid provider signature before any payload is processed.
  if (!/^[a-f0-9]{64}$/i.test(endpointKey)) {
    return new NextResponse('not found', { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }
  return new NextResponse('ok', { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function handleMailchimpWebhookPost(
  request: Request,
  endpointKey: string,
  dependencies: MailchimpWebhookRouteDependencies,
) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    return response({ ok: false, code: 'invalid-content-type' }, 415);
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > 1_048_576) {
    return response({ ok: false, code: 'payload-too-large' }, 413);
  }
  try {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const result = await ingestMailchimpWebhook({
      repository: dependencies.repository,
      endpointKey,
      rawBody,
      signatureHeader: request.headers.get('x-mailchimp-signature') ?? '',
      now: dependencies.now,
      resolver: dependencies.resolver,
    });
    return response({
      ok: result.accepted,
      schemaVersion: 'mailchimp-webhook-receipt.v1',
      accepted: result.accepted,
      duplicate: result.duplicate,
    }, result.accepted ? 202 : 400);
  } catch (error) {
    const status = error instanceof ConnectorError
      ? error.code === 'not-found' ? 404
        : error.code === 'forbidden' ? 401
          : error.code === 'conflict' ? 202 : 400
      : 503;
    return response({
      ok: status === 202,
      schemaVersion: 'mailchimp-webhook-receipt.v1',
      code: status === 202 ? 'duplicate' : status === 404 ? 'not-found'
        : status === 401 ? 'verification-failed' : status === 503 ? 'unavailable' : 'invalid-event',
    }, status);
  }
}
