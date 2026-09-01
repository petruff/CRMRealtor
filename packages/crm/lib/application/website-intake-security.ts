import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { intakeConfiguration, type IntakeConfiguration } from './intake-security';

export const MAX_WEBSITE_INTAKE_BYTES = 64_000;
export const WEBSITE_SIGNATURE_MAX_AGE_SECONDS = 300;

export interface WebsiteIntakeConfiguration extends IntakeConfiguration {
  readonly endpointKey: string;
  readonly signingSecret: string;
}

export function websiteIntakeConfiguration(env: NodeJS.ProcessEnv = process.env): WebsiteIntakeConfiguration | undefined {
  const base = intakeConfiguration(env);
  const endpointKey = env.OMNIX_WEBSITE_INTAKE_ENDPOINT_KEY?.trim();
  const signingSecret = env.OMNIX_WEBSITE_INTAKE_SECRET?.trim();
  if (!base || !endpointKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(endpointKey) || !signingSecret || signingSecret.length < 32) return undefined;
  return { ...base, endpointKey, signingSecret };
}

export function websiteRequestHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function websiteSignature(secret: string, timestampSeconds: number, idempotencyKey: string, origin: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestampSeconds}.${idempotencyKey}.${origin}.${body}`, 'utf8').digest('hex')}`;
}

export function validWebsiteSignature(input: { readonly signature: string | null; readonly timestamp: string | null; readonly idempotencyKey: string; readonly origin: string; readonly body: string; readonly secret: string; readonly now?: Date }): boolean {
  if (!input.signature || !/^v1=[a-f0-9]{64}$/.test(input.signature) || !input.timestamp || !/^\d{10}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > WEBSITE_SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = websiteSignature(input.secret, timestamp, input.idempotencyKey, input.origin, input.body);
  const suppliedBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function requestFingerprint(value: string | null | undefined): string {
  return createHash('sha256').update(value?.trim().slice(0, 500) || 'unknown', 'utf8').digest('hex');
}
