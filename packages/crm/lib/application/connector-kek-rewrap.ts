import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type {
  ConnectorKekRewrapRepository,
  ConnectorKekVersionCount,
} from '../data/supabase-connector-rewrap-repository.ts';
import { supabaseConnectorKekRewrapRepository } from '../data/supabase-connector-rewrap-repository.ts';
import { ConnectorError } from '../domain/connector.ts';
import {
  createEnvironmentKekResolver,
  rewrapConnectorSecret,
  type ConnectorKekResolver,
  type ConnectorSecretEnvelope,
} from '../security/connector-secret-envelope.ts';

export interface ConnectorKekRewrapResult {
  readonly sourceKekVersion?: string;
  readonly targetKekVersion: string;
  readonly claimed: number;
  readonly rewrapped: number;
  readonly noOp: number;
  readonly remaining: number;
  readonly counts: readonly ConnectorKekVersionCount[];
}

function configuredInteger(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConnectorError('configuration-required', `${name} must be ${min}–${max}.`);
  }
  return value;
}

function sourceVersion(
  counts: readonly ConnectorKekVersionCount[],
  activeVersion: string,
): string | undefined {
  return counts
    .filter((count) => count.kekVersion !== activeVersion && count.activeCount > 0)
    .sort((left, right) => left.kekVersion.localeCompare(right.kekVersion))[0]?.kekVersion;
}

function countVersion(counts: readonly ConnectorKekVersionCount[], version: string): number {
  return counts.filter((count) => count.kekVersion === version)
    .reduce((sum, count) => sum + count.activeCount, 0);
}

export async function rewrapConnectorKekBatch(dependencies: {
  readonly repository: ConnectorKekRewrapRepository;
  readonly resolver: ConnectorKekResolver;
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly now?: () => Date;
}): Promise<ConnectorKekRewrapResult> {
  const clock = dependencies.now ?? (() => new Date());
  const before = await dependencies.repository.listVersionCounts(clock().toISOString());
  const source = sourceVersion(before, dependencies.resolver.activeVersion);
  if (!source) return {
    targetKekVersion: dependencies.resolver.activeVersion,
    claimed: 0, rewrapped: 0, noOp: 0, remaining: 0, counts: before,
  };
  // Fail before claiming if the retiring KEK is not loaded in this server process.
  dependencies.resolver.resolve(source);
  const candidates = await dependencies.repository.claim({
    workerId: dependencies.workerId,
    sourceKekVersion: source,
    targetKekVersion: dependencies.resolver.activeVersion,
    batchSize: dependencies.batchSize,
    leaseSeconds: dependencies.leaseSeconds,
    now: clock().toISOString(),
  });
  let rewrapped = 0;
  let noOp = 0;
  for (const candidate of candidates) {
    if (candidate.sourceKekVersion !== source
      || candidate.targetKekVersion !== dependencies.resolver.activeVersion) {
      throw new ConnectorError('conflict', 'Connector KEK candidate version binding changed.');
    }
    const rotated = rewrapConnectorSecret({
      schemaVersion: 'connector-secret-envelope.v1',
      algorithm: 'AES-256-GCM',
      kekVersion: candidate.sourceKekVersion,
      aadHash: candidate.aadHash,
      encryptedDek: candidate.wrappedDek,
      encryptedDekIv: candidate.wrapNonce,
      encryptedDekTag: candidate.wrapAuthTag,
      ciphertext: '', iv: '', tag: '',
    } satisfies ConnectorSecretEnvelope, {
      workspaceId: candidate.workspaceId,
      connectionId: candidate.connectionId,
      provider: candidate.provider,
      secretType: candidate.secretType,
      recordVersion: candidate.recordVersion,
    }, dependencies.resolver);
    const completed = await dependencies.repository.complete({
      candidate,
      workerId: dependencies.workerId,
      wrappedDek: rotated.encryptedDek,
      wrapNonce: rotated.encryptedDekIv,
      wrapAuthTag: rotated.encryptedDekTag,
      kekVersion: rotated.kekVersion,
      aadHash: rotated.aadHash,
      now: clock().toISOString(),
    });
    if (completed.noOp) noOp += 1;
    else rewrapped += 1;
  }
  const after = await dependencies.repository.listVersionCounts(clock().toISOString());
  return {
    sourceKekVersion: source,
    targetKekVersion: dependencies.resolver.activeVersion,
    claimed: candidates.length,
    rewrapped,
    noOp,
    remaining: countVersion(after, source),
    counts: after,
  };
}

export async function rewrapConfiguredConnectorKekBatch(
  environment: Record<string, string | undefined> = process.env,
): Promise<ConnectorKekRewrapResult> {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey
    || (!serviceRoleKey.startsWith('ey') && !serviceRoleKey.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Connector service-role KEK rotation configuration is missing.');
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return rewrapConnectorKekBatch({
    repository: supabaseConnectorKekRewrapRepository(client),
    resolver: createEnvironmentKekResolver(environment),
    workerId: randomUUID(),
    batchSize: configuredInteger(environment, 'OMNIX_CONNECTOR_REWRAP_BATCH_SIZE', 25, 1, 100),
    leaseSeconds: configuredInteger(environment, 'OMNIX_CONNECTOR_REWRAP_LEASE_SECONDS', 90, 30, 900),
  });
}
