import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { memoryPushSubscriptionRepository, validatePushSubscription } from './push-subscription-repository';

const valid = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

describe('push subscription validation', () => {
  it('accepts browser-issued https endpoints and base64url keys', () => {
    expect(validatePushSubscription({ ...valid, showNames: true })).toEqual({ ...valid, showNames: true });
    expect(validatePushSubscription(valid).showNames).toBe(false);
  });

  it('rejects insecure endpoints and malformed keys', () => {
    expect(() => validatePushSubscription({ ...valid, endpoint: 'http://evil.example/x' })).toThrow(/invalid notification address/);
    expect(() => validatePushSubscription({ ...valid, endpoint: 'javascript:alert(1)' })).toThrow();
    expect(() => validatePushSubscription({ ...valid, p256dh: 'short' })).toThrow(/invalid notification keys/);
    expect(() => validatePushSubscription({ ...valid, auth: 'has spaces and=padding' })).toThrow();
    expect(() => validatePushSubscription(undefined)).toThrow();
  });

  it('keeps each member to their own devices in the demo store', async () => {
    const repository = memoryPushSubscriptionRepository();
    await repository.save(SAMPLE_WORKSPACE_SCOPE, validatePushSubscription(valid));
    expect(await repository.listMine(SAMPLE_WORKSPACE_SCOPE)).toHaveLength(1);
    const other = { ...SAMPLE_WORKSPACE_SCOPE, membershipId: 'someone-else' };
    expect(await repository.listMine(other)).toHaveLength(0);
    await repository.remove(other, valid.endpoint);
    expect(await repository.listMine(SAMPLE_WORKSPACE_SCOPE)).toHaveLength(1);
    await repository.remove(SAMPLE_WORKSPACE_SCOPE, valid.endpoint);
    expect(await repository.listMine(SAMPLE_WORKSPACE_SCOPE)).toHaveLength(0);
  });
});
