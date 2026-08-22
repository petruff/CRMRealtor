import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  rewrapConnectorSecret,
  type ConnectorSecretAad,
} from './connector-secret-envelope';

const aad: ConnectorSecretAad = {
  workspaceId: 'workspace-a',
  connectionId: 'connection-a',
  provider: 'mailchimp',
  secretType: 'oauth-refresh-token',
  recordVersion: 1,
};

describe('connector secret envelope', () => {
  it('encrypts with a per-secret DEK and authenticates the authority binding', () => {
    const resolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1',
      OMNIX_CONNECTOR_KEK_v1: randomBytes(32).toString('base64'),
    });
    const envelope = encryptConnectorSecret('provider-secret-value', aad, resolver);
    expect(envelope).toMatchObject({ algorithm: 'AES-256-GCM', kekVersion: 'v1' });
    expect(JSON.stringify(envelope)).not.toContain('provider-secret-value');
    expect(decryptConnectorSecret(envelope, aad, resolver)).toBe('provider-secret-value');
    expect(() => decryptConnectorSecret(envelope, { ...aad, workspaceId: 'workspace-b' }, resolver))
      .toThrow(/authority binding/i);
  });

  it('detects ciphertext tampering and rewraps the DEK without changing ciphertext', () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    const oldResolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1',
      OMNIX_CONNECTOR_KEK_v1: oldKey,
    });
    const envelope = encryptConnectorSecret('rotate-me', aad, oldResolver);
    expect(() => decryptConnectorSecret({ ...envelope, tag: randomBytes(16).toString('base64') }, aad, oldResolver))
      .toThrow(/authentication failed/i);

    const rotatingResolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v2',
      OMNIX_CONNECTOR_KEK_v1: oldKey,
      OMNIX_CONNECTOR_KEK_v2: newKey,
    });
    const rotated = rewrapConnectorSecret(envelope, aad, rotatingResolver);
    expect(rotated.kekVersion).toBe('v2');
    expect(rotated.ciphertext).toBe(envelope.ciphertext);
    expect(decryptConnectorSecret(rotated, aad, rotatingResolver)).toBe('rotate-me');
  });

  it('fails closed for missing or malformed key configuration', () => {
    expect(() => createEnvironmentKekResolver({})).toThrow(/active connector KEK/i);
    const resolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1',
      OMNIX_CONNECTOR_KEK_v1: Buffer.from('short').toString('base64'),
    });
    expect(() => encryptConnectorSecret('secret', aad, resolver)).toThrow(/32 bytes/i);
  });
});
