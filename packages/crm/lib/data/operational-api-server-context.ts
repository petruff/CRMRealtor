import { createClient } from '@supabase/supabase-js';
import { correlationId, idempotencyHash, operationalApiVerifier, parseOperationalApiPlaintext } from '../security/operational-api.ts';

export interface OperationalApiRequest { action: string; payload: Record<string, unknown>; idempotencyKey?: string | null; correlationId?: string | null }

export async function executeOperationalApiRequest(input: OperationalApiRequest, request: Request): Promise<{ status: number; body: unknown }> {
  const raw = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(); const pepper = process.env.OMNIX_API_KEY_PEPPER?.trim();
  if (!raw || !url || !key || !pepper) return { status: 401, body: { error: { code: 'unauthorized', message: 'Operational API authorization failed.', correlationId: correlationId(input.correlationId ?? null) } } };
  try {
    const parsed = parseOperationalApiPlaintext(raw); const verifier = operationalApiVerifier(raw, pepper); const idempotency = idempotencyHash(input.idempotencyKey ?? null); const id = correlationId(input.correlationId ?? null);
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc('execute_operational_contacts_api', { target_prefix: parsed.prefix, target_verifier: verifier, target_action: input.action, target_payload: input.payload, target_idempotency_hash: idempotency ?? null, target_correlation_id: id, target_now: new Date().toISOString() });
    if (error) { const code = error.code === '42501' ? 'forbidden' : error.code === '40001' ? 'version-conflict' : error.code === 'P0002' ? 'not-found' : error.code === 'P0001' ? 'rate-limited' : 'invalid-request'; const status = code === 'forbidden' ? 403 : code === 'not-found' ? 404 : code === 'version-conflict' ? 409 : code === 'rate-limited' ? 429 : 400; const messages: Record<string,string>={forbidden:'The API key does not authorize this operation.', 'version-conflict':'The resource changed. Read it again before updating.', 'not-found':'The requested resource was not found.', 'rate-limited':'The API rate limit was reached.', 'invalid-request':'The request is invalid.'}; return { status, body: { error: { code, message: messages[code], correlationId: id } } }; }
    return { status: input.action === 'contacts.create' ? 201 : input.action === 'intake.create' ? 202 : 200, body: data };
  } catch { const id = correlationId(input.correlationId ?? null); return { status: 401, body: { error: { code: 'unauthorized', message: 'Operational API authorization failed.', correlationId: id } } }; }
}
