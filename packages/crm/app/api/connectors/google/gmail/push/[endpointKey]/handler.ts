import { NextResponse } from 'next/server';
import { ConnectorError } from '@/lib/domain/connector';
import { ingestGoogleGmailPush, type GoogleGmailPushRepository } from '@/lib/application/google-gmail-push-service';
import type { GoogleGmailPushConfiguration } from '@/lib/config/google-gmail-push';

export async function handleGoogleGmailPush(
  request: Request,
  input: {
    readonly endpointKey: string;
    readonly configuration: GoogleGmailPushConfiguration;
    readonly repository: GoogleGmailPushRepository;
    readonly fetcher?: typeof fetch;
    readonly now?: Date;
  },
) {
  if (input.endpointKey !== input.configuration.endpointKey) {
    return NextResponse.json({ ok: false, code: 'not-found' }, { status: 404 });
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > 256_000) {
    return NextResponse.json({ ok: false, code: 'payload-too-large' }, { status: 413 });
  }
  try {
    const result = await ingestGoogleGmailPush({
      authorization: request.headers.get('authorization') ?? '',
      rawBody: new Uint8Array(await request.arrayBuffer()), externalUrl: request.url,
      configuration: input.configuration, repository: input.repository,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}), ...(input.now ? { now: input.now } : {}),
    });
    void result;
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const status = error instanceof ConnectorError
      ? error.code === 'forbidden' ? 401 : error.code === 'conflict' ? 204 : 400
      : 503;
    if (status === 204) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ ok: false, code: status === 401 ? 'verification-failed'
      : status === 400 ? 'invalid-event' : 'unavailable' }, { status });
  }
}
