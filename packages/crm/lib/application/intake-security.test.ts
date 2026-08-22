import { describe, expect, it } from 'vitest';
import { bearerTokenIsValid, intakeConfiguration, receiptReplayState, requestHash, validIdempotencyKey } from './intake-security';

describe('automatic intake security', () => {
  it('fails closed until every live credential is present and valid', () => {
    expect(intakeConfiguration({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(intakeConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      OMNIX_INTAKE_WORKSPACE_ID: '223e4567-e89b-42d3-a456-426614174000',
      OMNIX_INTAKE_OWNER_ID: '123e4567-e89b-42d3-a456-426614174000',
      OMNIX_INTAKE_TOKEN: 'a-secure-token-with-24-chars',
    } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      workspaceId: '223e4567-e89b-42d3-a456-426614174000',
      ownerId: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(intakeConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      CRM_INTAKE_OWNER_ID: '123e4567-e89b-42d3-a456-426614174000',
      CRM_INTAKE_TOKEN: 'legacy-token-with-at-least-24-chars',
    } as unknown as NodeJS.ProcessEnv)).toBeDefined();

    expect(intakeConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      CRM_INTAKE_WORKSPACE_ID: 'not-a-uuid',
      CRM_INTAKE_TOKEN: 'legacy-token-with-at-least-24-chars',
    } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('requires an exact bearer token and bounded idempotency key', () => {
    const token = 'a-secure-token-with-24-chars';
    expect(bearerTokenIsValid(`Bearer ${token}`, token)).toBe(true);
    expect(bearerTokenIsValid('Bearer wrong', token)).toBe(false);
    expect(validIdempotencyKey('website:lead-123')).toBe(true);
    expect(validIdempotencyKey('../bad key')).toBe(false);
  });

  it('produces stable request hashes', () => {
    expect(requestHash('{"a":1}')).toMatch(/^[a-f0-9]{64}$/);
    expect(requestHash('{"a":1}')).toBe(requestHash('{"a":1}'));
    expect(requestHash('{"a":1}')).not.toBe(requestHash('{"a":2}'));
  });

  it('distinguishes an exact replay from a conflicting payload', () => {
    const receipt = { idempotencyKey: 'website:1', requestHash: 'hash-a', statusCode: 200, response: { ok: true }, createdAt: '2026-08-10T00:00:00Z' };
    expect(receiptReplayState(undefined, 'hash-a')).toBe('miss');
    expect(receiptReplayState(receipt, 'hash-a')).toBe('replay');
    expect(receiptReplayState(receipt, 'hash-b')).toBe('conflict');
  });
});
