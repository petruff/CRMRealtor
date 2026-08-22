import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface ConnectorSecretAad {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly secretType: string;
  readonly recordVersion: number;
}

export interface ConnectorSecretEnvelope {
  readonly schemaVersion: 'connector-secret-envelope.v1';
  readonly algorithm: 'AES-256-GCM';
  readonly kekVersion: string;
  readonly aadHash: string;
  readonly encryptedDek: string;
  readonly encryptedDekIv: string;
  readonly encryptedDekTag: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

export interface ConnectorKekResolver {
  readonly activeVersion: string;
  resolve(version: string): Uint8Array;
}

function assertKey(key: Uint8Array): Buffer {
  if (key.byteLength !== KEY_BYTES) {
    throw new ConnectorError('configuration-required', 'Connector KEK must be 32 bytes.');
  }
  return Buffer.from(key);
}

function canonicalAad(aad: ConnectorSecretAad): string {
  if (!Number.isInteger(aad.recordVersion) || aad.recordVersion < 1) {
    throw new ConnectorError('invalid-input', 'Secret record version is invalid.');
  }
  const fields = [aad.workspaceId, aad.connectionId, aad.provider, aad.secretType];
  if (fields.some((field) => !field || /[\u0000-\u001f\u007f|]/.test(field))) {
    throw new ConnectorError('invalid-input', 'Secret authority binding is invalid.');
  }
  return `${fields.join('|')}|${aad.recordVersion}`;
}

function encryptBytes(plaintext: Uint8Array, key: Buffer, aad: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptBytes(
  ciphertext: string,
  iv: string,
  tag: string,
  key: Buffer,
  aad: string,
): Buffer {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  } catch {
    throw new ConnectorError('forbidden', 'Connector secret envelope authentication failed.');
  }
}

function assertAadHash(envelope: ConnectorSecretEnvelope, aad: string): void {
  const actual = Buffer.from(sha256Hex(aad), 'hex');
  const expected = Buffer.from(envelope.aadHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ConnectorError('forbidden', 'Connector secret authority binding failed.');
  }
}

function decryptDek(
  envelope: ConnectorSecretEnvelope,
  aad: string,
  resolver: ConnectorKekResolver,
): Buffer {
  const kek = assertKey(resolver.resolve(envelope.kekVersion));
  return decryptBytes(
    envelope.encryptedDek,
    envelope.encryptedDekIv,
    envelope.encryptedDekTag,
    kek,
    `dek|${aad}`,
  );
}

export function encryptConnectorSecret(
  plaintext: string,
  aadInput: ConnectorSecretAad,
  resolver: ConnectorKekResolver,
): ConnectorSecretEnvelope {
  if (!plaintext || plaintext.length > 65_536) {
    throw new ConnectorError('invalid-input', 'Connector secret value is invalid.');
  }
  const aad = canonicalAad(aadInput);
  const dek = randomBytes(KEY_BYTES);
  const secret = encryptBytes(Buffer.from(plaintext, 'utf8'), dek, aad);
  const wrapped = encryptBytes(dek, assertKey(resolver.resolve(resolver.activeVersion)), `dek|${aad}`);
  dek.fill(0);
  return {
    schemaVersion: 'connector-secret-envelope.v1',
    algorithm: 'AES-256-GCM',
    kekVersion: resolver.activeVersion,
    aadHash: sha256Hex(aad),
    encryptedDek: wrapped.ciphertext,
    encryptedDekIv: wrapped.iv,
    encryptedDekTag: wrapped.tag,
    ciphertext: secret.ciphertext,
    iv: secret.iv,
    tag: secret.tag,
  };
}

export function decryptConnectorSecret(
  envelope: ConnectorSecretEnvelope,
  aadInput: ConnectorSecretAad,
  resolver: ConnectorKekResolver,
): string {
  if (envelope.schemaVersion !== 'connector-secret-envelope.v1'
    || envelope.algorithm !== 'AES-256-GCM') {
    throw new ConnectorError('invalid-input', 'Connector secret envelope is unsupported.');
  }
  const aad = canonicalAad(aadInput);
  assertAadHash(envelope, aad);
  const dek = decryptDek(envelope, aad, resolver);
  try {
    return decryptBytes(envelope.ciphertext, envelope.iv, envelope.tag, dek, aad).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Rewraps only the DEK; provider plaintext is never decrypted during rotation. */
export function rewrapConnectorSecret(
  envelope: ConnectorSecretEnvelope,
  aadInput: ConnectorSecretAad,
  resolver: ConnectorKekResolver,
): ConnectorSecretEnvelope {
  const aad = canonicalAad(aadInput);
  assertAadHash(envelope, aad);
  if (envelope.kekVersion === resolver.activeVersion) return { ...envelope };
  const dek = decryptDek(envelope, aad, resolver);
  try {
    const wrapped = encryptBytes(
      dek,
      assertKey(resolver.resolve(resolver.activeVersion)),
      `dek|${aad}`,
    );
    return {
      ...envelope,
      kekVersion: resolver.activeVersion,
      encryptedDek: wrapped.ciphertext,
      encryptedDekIv: wrapped.iv,
      encryptedDekTag: wrapped.tag,
    };
  } finally {
    dek.fill(0);
  }
}

export function createEnvironmentKekResolver(
  environment: Record<string, string | undefined> = process.env,
): ConnectorKekResolver {
  const activeVersion = environment.OMNIX_CONNECTOR_KEK_ACTIVE_VERSION?.trim();
  if (!activeVersion || !/^[A-Za-z0-9_-]{1,32}$/.test(activeVersion)) {
    throw new ConnectorError('configuration-required', 'Active connector KEK version is missing.');
  }
  return {
    activeVersion,
    resolve(version) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(version)) {
        throw new ConnectorError('configuration-required', 'Connector KEK version is invalid.');
      }
      const encoded = environment[`OMNIX_CONNECTOR_KEK_${version}`]?.trim();
      if (!encoded) throw new ConnectorError('configuration-required', `Connector KEK ${version} is missing.`);
      const key = Buffer.from(encoded, 'base64');
      assertKey(key);
      return key;
    },
  };
}
