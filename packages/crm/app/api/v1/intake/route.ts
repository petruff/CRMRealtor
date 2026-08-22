import { executeOperationalApiRequest } from '@/lib/data/operational-api-server-context';

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { payload = {}; }
  const result = await executeOperationalApiRequest({
    action: 'intake.create',
    payload,
    idempotencyKey: request.headers.get('idempotency-key'),
    correlationId: request.headers.get('x-correlation-id'),
  }, request);
  return Response.json(result.body, { status: result.status });
}
