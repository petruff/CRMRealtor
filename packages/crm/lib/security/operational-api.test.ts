import { describe, expect, it } from 'vitest';
import { createOperationalApiPlaintext, idempotencyHash, operationalApiVerifier, parseOperationalApiPlaintext, safeEqualHex } from './operational-api.ts';

describe('operational API key security', () => {
  it('creates one-time parseable random keys and HMAC verifiers', () => {
    const key = createOperationalApiPlaintext(); expect(parseOperationalApiPlaintext(key.plaintext).prefix).toBe(key.prefix);
    const verifier = operationalApiVerifier(key.plaintext, 'a'.repeat(32)); expect(verifier).toMatch(/^[a-f0-9]{64}$/); expect(safeEqualHex(verifier, verifier)).toBe(true);
  });
  it('rejects malformed keys, weak peppers, and unsafe idempotency keys', () => {
    expect(() => parseOperationalApiPlaintext('bad')).toThrow('malformed'); expect(() => operationalApiVerifier('x','weak')).toThrow('32'); expect(() => idempotencyHash('bad key')).toThrow('invalid');
  });
});
