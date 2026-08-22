import { createHash, timingSafeEqual } from 'node:crypto';
import type { IntakeReceipt } from '@/lib/data/import-gateway';

export const MAX_INTAKE_BYTES = 256_000;

export interface IntakeConfiguration {
  url: string;
  serviceRoleKey: string;
  /** Canonical server-side tenant binding. Never accepted from request data. */
  workspaceId?: string;
  /** Temporary compatibility alias resolved to one active owner workspace. */
  ownerId?: string;
  token: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function intakeConfiguration(env: NodeJS.ProcessEnv = process.env): IntakeConfiguration | undefined {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const workspaceId = (env.OMNIX_INTAKE_WORKSPACE_ID ?? env.CRM_INTAKE_WORKSPACE_ID)?.trim();
  const ownerId = (env.OMNIX_INTAKE_OWNER_ID ?? env.CRM_INTAKE_OWNER_ID)?.trim();
  const token = (env.OMNIX_INTAKE_TOKEN ?? env.CRM_INTAKE_TOKEN)?.trim();
  if (!url || !serviceRoleKey || (!workspaceId && !ownerId) || !token) return undefined;
  if (workspaceId && !UUID_PATTERN.test(workspaceId)) return undefined;
  if (ownerId && !UUID_PATTERN.test(ownerId)) return undefined;
  if (token.length < 24) return undefined;
  return { url, serviceRoleKey, workspaceId, ownerId, token };
}

export function bearerTokenIsValid(header: string | null, expected: string): boolean {
  const supplied = header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validIdempotencyKey(value: string | null): value is string {
  return Boolean(value && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value));
}

export function requestHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function receiptReplayState(
  receipt: IntakeReceipt | undefined,
  hash: string,
): 'miss' | 'replay' | 'conflict' {
  if (!receipt) return 'miss';
  return receipt.requestHash === hash ? 'replay' : 'conflict';
}
