import { NextResponse } from 'next/server';
import type { ConnectorServiceDrainResult } from '@/lib/application/connector-service-worker';
import { ConnectorError } from '@/lib/domain/connector';
import { authorizeConnectorCronRequest } from '@/lib/security/connector-cron-auth';

export interface DrainRouteDependencies {
  readonly cronSecret?: string;
  readonly drain: () => Promise<ConnectorServiceDrainResult>;
}

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

export async function handleConnectorDrainRequest(
  request: Request,
  dependencies: DrainRouteDependencies,
) {
  try {
    authorizeConnectorCronRequest(request.headers.get('authorization'), dependencies.cronSecret);
  } catch (error) {
    const unavailable = error instanceof ConnectorError && error.code === 'configuration-required';
    return response({
      ok: false,
      schemaVersion: 'connector-drain.v1',
      code: unavailable ? 'configuration-required' : 'unauthorized',
      message: unavailable
        ? 'Connector worker authentication is not configured.'
        : 'Connector worker authorization failed.',
    }, unavailable ? 503 : 401);
  }

  try {
    const result = await dependencies.drain();
    console.info(JSON.stringify({
      schemaVersion: 'connector-drain-result.v1',
      result,
    }));
    return response({
      ok: true,
      schemaVersion: 'connector-drain.v1',
      result,
    }, 200);
  } catch (error) {
    const configuration = error instanceof ConnectorError && error.code === 'configuration-required';
    console.error(JSON.stringify({
      schemaVersion: 'connector-drain-error.v1',
      category: configuration ? 'configuration-required' : 'internal-error',
    }));
    return response({
      ok: false,
      schemaVersion: 'connector-drain.v1',
      code: configuration ? 'configuration-required' : 'internal-error',
      message: 'Connector worker is unavailable.',
    }, 503);
  }
}
