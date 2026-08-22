import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const OPERATIONAL_API_SCHEMA_VERSION = 'operational-api.v1';
export const OPERATIONAL_API_SCOPES = ['contacts.create','contacts.read','contacts.update','contacts.archive','contacts.search','status.read','intake.create'] as const;
export type OperationalApiScope = typeof OPERATIONAL_API_SCOPES[number];

export function createOperationalApiPlaintext(): { plaintext: string; prefix: string } {
  const identifier = randomBytes(9).toString('base64url'); const secret = randomBytes(32).toString('base64url');
  return { plaintext: `omx_${identifier}.${secret}`, prefix: `omx_${identifier}` };
}

export function parseOperationalApiPlaintext(value: string): { prefix: string; secret: string } {
  const match = value.trim().match(/^(omx_[A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/);
  if (!match) throw new Error('API key is malformed.'); return { prefix: match[1]!, secret: match[2]! };
}

export function operationalApiVerifier(plaintext: string, pepper: string): string {
  if (pepper.length < 32) throw new Error('OMNIX_API_KEY_PEPPER must contain at least 32 characters.');
  return createHmac('sha256', pepper).update(plaintext).digest('hex');
}

export function idempotencyHash(value: string | null): string | undefined {
  if (value === null) return undefined; if (!/^[A-Za-z0-9:_-]{8,160}$/.test(value)) throw new Error('Idempotency-Key is invalid.');
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function correlationId(value: string | null): string {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : randomUUID();
}
