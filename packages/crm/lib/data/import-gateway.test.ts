import { describe, expect, it } from 'vitest';
import { memoryImportGateway } from './import-gateway';

describe('intake receipt reservations', () => {
  it('claims a key atomically, completes it, and replays the final receipt', async () => {
    const gateway = memoryImportGateway();
    const key = 'atomic:unique-test-20260810';
    const pending = { idempotencyKey: key, requestHash: 'hash-a', statusCode: 202, response: { ok: false }, createdAt: '2026-08-10T00:00:00Z' };
    expect(await gateway.claimReceipt(pending)).toBe(true);
    expect(await gateway.claimReceipt(pending)).toBe(false);
    await gateway.completeReceipt({ ...pending, statusCode: 200, response: { ok: true } });
    expect(await gateway.getReceipt(key)).toMatchObject({ statusCode: 200, response: { ok: true } });
  });

  it('releases only the matching failed reservation so the request can retry', async () => {
    const gateway = memoryImportGateway();
    const key = 'atomic:release-test-20260810';
    const pending = { idempotencyKey: key, requestHash: 'hash-b', statusCode: 202, response: {}, createdAt: '2026-08-10T00:00:00Z' };
    expect(await gateway.claimReceipt(pending)).toBe(true);
    await gateway.releaseReceipt(key, 'different-hash');
    expect(await gateway.claimReceipt(pending)).toBe(false);
    await gateway.releaseReceipt(key, 'hash-b');
    expect(await gateway.claimReceipt(pending)).toBe(true);
  });
});
