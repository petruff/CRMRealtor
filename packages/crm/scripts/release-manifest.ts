import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_WIDTHS = [390, 414, 768, 1440] as const;
const REQUIRED_ROUTES = ['contacts', 'import', 'pipeline', 'omnix', 'connections', 'insights', 'sign-in-theme'] as const;
const REQUIRED_GATES = ['dependency-audit', 'secret-scan', 'lint', 'typecheck', 'test', 'build'] as const;
const PROVIDER_SOURCE_PATH = 'packages/crm/lib/domain/connector.ts';
const EXCLUDED_PROVIDER_IDS = new Set(['contract-test']);

type JsonObject = Record<string, unknown>;

export interface ReceiptReference {
  path: string;
  sha256: string;
}

export interface ReleaseManifest extends JsonObject {
  schemaVersion: 1;
  candidate: { sha: string; branch: string; clean: true; createdAt: string };
  artifact: {
    digest: string;
      deployment: { id: string; digest: string; candidateSha: string; environment: string; receipt: ReceiptReference };
  };
  scheduler: {
    platform: 'vercel';
    projectId: string;
    teamId: string;
    plan: 'hobby' | 'pro' | 'enterprise';
    schedule: string;
    supported: true;
    operationalMode: 'daily-maintenance-only' | 'interactive-worker';
    interactiveConnectorSloMet: boolean;
    liveConnectorPromotionAllowed: boolean;
    receipt: ReceiptReference;
  };
  migrations: {
    files: Array<{ path: string; sha256: string }>;
    historyReceipt: ReceiptReference;
    replayReceipt: ReceiptReference;
    postApplyReceipt: ReceiptReference;
  };
  rollback: {
    targetDeploymentId: string;
    targetSha: string;
    knownGoodReceipt: ReceiptReference;
    applicationReceipt: ReceiptReference;
    databaseReceipt: ReceiptReference;
    authorityRegressionReceipt: ReceiptReference;
  };
  providerInventory: string[];
  providers: Array<{
    provider: string;
    lifecycle: 'ready' | 'blocked-external' | 'disabled';
    actorClassification: 'canonical-owner';
    observedAt: string;
    facts: JsonObject;
    receipt: ReceiptReference;
  }>;
  uat: {
    authenticated: true;
    testerRole: 'canonical-owner';
    workspaceIdHash: string;
    results: Array<{
      route: string;
      width: number;
      device: string;
      browser: string;
      browserVersion: string;
      displayMode: 'browser' | 'standalone';
      orientation: 'portrait' | 'landscape';
      safeArea: { top: number; right: number; bottom: number; left: number; respected: true };
      overflow: { horizontal: 'none'; clippedControls: false };
      outcome: 'pass';
      health: 'healthy';
      readiness: 'ready';
      evidence: ReceiptReference;
    }>;
    iphone11: {
      safariBrowser: UatDeviceModeEvidence;
      installedPwa: UatDeviceModeEvidence;
    };
  };
  gates: Array<{ name: string; result: 'pass'; candidateSha: string; receipt: ReceiptReference }>;
}

interface UatDeviceModeEvidence extends JsonObject {
  device: 'iPhone 11';
  browser: 'Mobile Safari';
  browserVersion: string;
  viewportWidth: 414;
  displayMode: 'browser' | 'standalone';
  orientation: 'portrait';
  safeArea: { top: number; right: number; bottom: number; left: number; respected: true };
  overflow: { horizontal: 'none'; clippedControls: false };
  evidence: ReceiptReference;
}

export class ManifestValidationError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Release manifest rejected:\n- ${failures.join('\n- ')}`);
    this.name = 'ManifestValidationError';
    this.failures = failures;
  }
}

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function sha256(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function asObject(value: unknown, label: string, failures: string[]): JsonObject {
  if (!isObject(value)) {
    failures.push(`${label} must be an object.`);
    return {};
  }
  return value;
}

function assertExactSet(actual: unknown, expected: readonly string[] | readonly number[], label: string, failures: string[]): void {
  if (!Array.isArray(actual)) {
    failures.push(`${label} must be an array.`);
    return;
  }
  const actualSet = new Set(actual);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expected.includes(item as never));
  if (missing.length || extra.length || actual.length !== actualSet.size) {
    failures.push(`${label} must contain exactly ${expected.join(', ')}.`);
  }
}

function assertExactSequence(actual: unknown, expected: readonly string[], label: string, failures: string[]): void {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    failures.push(`${label} must match the complete ordered candidate inventory.`);
  }
}

function validateUatEnvironment(value: JsonObject, label: string, failures: string[]): void {
  if (typeof value.device !== 'string' || !value.device.trim()) failures.push(`${label}.device is required.`);
  if (typeof value.browser !== 'string' || !value.browser.trim()) failures.push(`${label}.browser is required.`);
  if (typeof value.browserVersion !== 'string' || !/^\d+(?:\.\d+){1,3}$/u.test(value.browserVersion)) {
    failures.push(`${label}.browserVersion must be an explicit dotted browser version.`);
  }
  if (!['browser', 'standalone'].includes(String(value.displayMode))) failures.push(`${label}.displayMode must be browser or standalone.`);
  if (!['portrait', 'landscape'].includes(String(value.orientation))) failures.push(`${label}.orientation must be portrait or landscape.`);
  const safeArea = asObject(value.safeArea, `${label}.safeArea`, failures);
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    if (typeof safeArea[edge] !== 'number' || !Number.isFinite(safeArea[edge]) || Number(safeArea[edge]) < 0) {
      failures.push(`${label}.safeArea.${edge} must be a non-negative number.`);
    }
  }
  if (safeArea.respected !== true) failures.push(`${label}.safeArea.respected must be true.`);
  const overflow = asObject(value.overflow, `${label}.overflow`, failures);
  if (overflow.horizontal !== 'none') failures.push(`${label}.overflow.horizontal must be none.`);
  if (overflow.clippedControls !== false) failures.push(`${label}.overflow.clippedControls must be false.`);
}

function listCandidateProviders(repoRoot: string, candidateSha: string): string[] {
  const source = execFileSync('git', ['-C', repoRoot, 'show', `${candidateSha}:${PROVIDER_SOURCE_PATH}`], { encoding: 'utf8' });
  const declaration = source.match(/export const CONNECTOR_PROVIDERS\s*=\s*\[([\s\S]*?)\]\s*as const/u);
  if (!declaration) throw new Error(`Unable to derive provider inventory from ${PROVIDER_SOURCE_PATH}.`);
  const providers = [...declaration[1]!.matchAll(/['"]([a-z0-9-]+)['"]/gu)]
    .map((match) => match[1]!)
    .filter((provider) => !EXCLUDED_PROVIDER_IDS.has(provider));
  if (!providers.length || providers.length !== new Set(providers).size) {
    throw new Error(`Candidate provider inventory in ${PROVIDER_SOURCE_PATH} is empty or duplicated.`);
  }
  return providers;
}

export function canonicalManifestPath(candidateSha: string): string {
  return `docs/qa/releases/${candidateSha}/release-manifest.json`;
}

export function validateManifestPath(repoRoot: string, manifestPath: string, candidateSha: string): string {
  if (!SHA_PATTERN.test(candidateSha)) throw new Error('Manifest candidate SHA must be a full lowercase 40-character Git SHA.');
  const required = canonicalManifestPath(candidateSha);
  if (manifestPath.replaceAll('\\', '/') !== required) {
    throw new Error(`Manifest path must be exactly ${required}.`);
  }
  const absolute = resolve(repoRoot, manifestPath);
  if (relative(resolve(repoRoot), absolute).replaceAll('\\', '/') !== required) {
    throw new Error(`Manifest path must be exactly ${required}.`);
  }
  return absolute;
}

function safeEvidencePath(repoRoot: string, value: unknown, label: string, failures: string[]): string | null {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\')
    || value.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
    failures.push(`${label}.path must be a non-empty repository-relative path.`);
    return null;
  }
  const absolute = resolve(repoRoot, value);
  const fromRoot = relative(repoRoot, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    failures.push(`${label}.path escapes the repository.`);
    return null;
  }
  return absolute;
}

async function loadReceipt(
  repoRoot: string,
  referenceValue: unknown,
  label: string,
  failures: string[],
): Promise<JsonObject | null> {
  const reference = asObject(referenceValue, label, failures);
  const absolute = safeEvidencePath(repoRoot, reference.path, label, failures);
  if (!DIGEST_PATTERN.test(String(reference.sha256 ?? ''))) failures.push(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  if (!absolute || !existsSync(absolute)) {
    if (absolute) failures.push(`${label}.path does not exist: ${String(reference.path)}.`);
    return null;
  }
  const contents = await readFile(absolute);
  if (sha256(contents) !== reference.sha256) failures.push(`${label} checksum does not match ${String(reference.path)}.`);
  try {
    return asObject(JSON.parse(contents.toString('utf8')), `${label} content`, failures);
  } catch {
    failures.push(`${label}.path must contain valid JSON.`);
    return null;
  }
}

function validateReceiptEnvelope(
  receipt: JsonObject | null,
  expectedKind: string,
  candidateSha: string,
  failures: string[],
  label: string,
  deploymentId?: string,
): void {
  if (!receipt) return;
  if (receipt.kind !== expectedKind) failures.push(`${label} kind must be ${expectedKind}.`);
  if (receipt.result !== 'pass') failures.push(`${label} result must be pass.`);
  if (receipt.candidateSha !== candidateSha) failures.push(`${label} candidateSha does not match the manifest candidate.`);
  if (deploymentId && receipt.deploymentId !== deploymentId) failures.push(`${label} deploymentId does not match the manifest deployment.`);
  if (typeof receipt.observedAt !== 'string' || Number.isNaN(Date.parse(receipt.observedAt))) {
    failures.push(`${label} observedAt must be an ISO date-time.`);
  }
}

function listCandidateMigrations(repoRoot: string, candidateSha: string): Array<{ path: string; sha256: string }> {
  const prefix = 'packages/crm/supabase/migrations';
  const names = runGit(repoRoot, ['ls-tree', '-r', '--name-only', candidateSha, '--', prefix])
    .split(/\r?\n/u)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  return names.map((path) => ({ path, sha256: sha256(execFileSync('git', ['-C', repoRoot, 'show', `${candidateSha}:${path}`])) }));
}

function validateMigrationInventory(
  manifestFiles: unknown,
  actualFiles: Array<{ path: string; sha256: string }>,
  failures: string[],
): void {
  if (!Array.isArray(manifestFiles) || manifestFiles.length === 0) {
    failures.push('migrations.files must contain the complete ordered migration inventory.');
    return;
  }
  const normalized = manifestFiles.map((entry) => asObject(entry, 'migrations.files entry', failures));
  if (normalized.length !== actualFiles.length) {
    failures.push(`migrations.files has ${normalized.length} entries; candidate has ${actualFiles.length}.`);
  }
  actualFiles.forEach((actual, index) => {
    const recorded = normalized[index];
    if (recorded?.path !== actual.path) failures.push(`migrations.files[${index}].path must be ${actual.path}.`);
    if (recorded?.sha256 !== actual.sha256) failures.push(`Migration checksum mismatch for ${actual.path}.`);
  });
}

export async function validateReleaseManifest(
  manifestValue: unknown,
  options: { repoRoot: string; expectedSha?: string },
): Promise<ReleaseManifest> {
  const failures: string[] = [];
  const repoRoot = resolve(options.repoRoot);
  const manifest = asObject(manifestValue, 'manifest', failures);
  const candidate = asObject(manifest.candidate, 'candidate', failures);
  const candidateSha = String(candidate.sha ?? '');

  if (manifest.schemaVersion !== 1) failures.push('schemaVersion must be 1.');
  if (!SHA_PATTERN.test(candidateSha)) failures.push('candidate.sha must be a full lowercase 40-character Git SHA.');
  if (options.expectedSha && candidateSha !== options.expectedSha.toLowerCase()) failures.push('candidate.sha does not match --expected-sha.');
  if (candidate.clean !== true) failures.push('candidate.clean must be true.');
  if (typeof candidate.branch !== 'string' || !candidate.branch) failures.push('candidate.branch is required.');
  if (typeof candidate.createdAt !== 'string' || Number.isNaN(Date.parse(String(candidate.createdAt)))) failures.push('candidate.createdAt must be an ISO date-time.');

  try {
    if (runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) failures.push('Evidence checkout is dirty; validation requires a clean worktree.');
    if (SHA_PATTERN.test(candidateSha)) runGit(repoRoot, ['cat-file', '-e', `${candidateSha}^{commit}`]);
  } catch {
    failures.push('candidate.sha is not an available commit in this repository.');
  }

  let actualMigrations: Array<{ path: string; sha256: string }> = [];
  let actualProviders: string[] = [];
  if (SHA_PATTERN.test(candidateSha)) {
    try {
      actualMigrations = listCandidateMigrations(repoRoot, candidateSha);
    } catch {
      failures.push('Unable to read migrations from candidate.sha.');
    }
    try {
      actualProviders = listCandidateProviders(repoRoot, candidateSha);
    } catch {
      failures.push(`Unable to derive provider inventory from candidate ${PROVIDER_SOURCE_PATH}.`);
    }
  }
  const migrations = asObject(manifest.migrations, 'migrations', failures);
  validateMigrationInventory(migrations.files, actualMigrations, failures);
  const migrationNames = actualMigrations.map(({ path }) => path.split('/').at(-1) ?? path);

  const artifact = asObject(manifest.artifact, 'artifact', failures);
  if (!DIGEST_PATTERN.test(String(artifact.digest ?? ''))) failures.push('artifact.digest must be a SHA-256 digest.');
  const deployment = asObject(artifact.deployment, 'artifact.deployment', failures);
  const deploymentId = String(deployment.id ?? '');
  if (!deploymentId) failures.push('artifact.deployment.id is required.');
  if (deployment.candidateSha !== candidateSha) failures.push('artifact.deployment.candidateSha must match candidate.sha.');
  if (deployment.digest !== artifact.digest) failures.push('artifact.deployment.digest must match artifact.digest.');
  if (deployment.environment !== 'production') failures.push('artifact.deployment.environment must be production for the promotion gate.');

  const deploymentReceipt = await loadReceipt(repoRoot, deployment.receipt, 'artifact.deployment.receipt', failures);
  validateReceiptEnvelope(deploymentReceipt, 'deployment', candidateSha, failures, 'deployment receipt', deploymentId);
  if (deploymentReceipt && deploymentReceipt.deploymentDigest !== artifact.digest) failures.push('Deployment receipt digest does not match artifact.digest.');

  const scheduler = asObject(manifest.scheduler, 'scheduler', failures);
  const schedulerPlan = String(scheduler.plan ?? '');
  const schedulerSchedule = String(scheduler.schedule ?? '');
  if (scheduler.platform !== 'vercel') failures.push('scheduler.platform must be vercel.');
  if (typeof scheduler.projectId !== 'string' || !scheduler.projectId.startsWith('prj_')) failures.push('scheduler.projectId must identify the linked Vercel project.');
  if (typeof scheduler.teamId !== 'string' || !scheduler.teamId.startsWith('team_')) failures.push('scheduler.teamId must identify the linked Vercel account or team.');
  if (!['hobby', 'pro', 'enterprise'].includes(schedulerPlan)) failures.push('scheduler.plan must be hobby, pro, or enterprise.');
  if (scheduler.supported !== true) failures.push('scheduler.supported must be true; unsupported schedules cannot authorize deployment.');
  const hobbyScheduler = schedulerPlan === 'hobby';
  if (hobbyScheduler) {
    if (schedulerSchedule !== '0 6 * * *') failures.push('Hobby scheduler must use the supported daily 0 6 * * * maintenance sweep.');
    if (scheduler.operationalMode !== 'daily-maintenance-only') failures.push('Hobby scheduler operationalMode must be daily-maintenance-only.');
    if (scheduler.interactiveConnectorSloMet !== false) failures.push('Hobby scheduler cannot claim the interactive connector SLO is met.');
    if (scheduler.liveConnectorPromotionAllowed !== false) failures.push('Hobby scheduler must block live connector promotion.');
  } else if (schedulerPlan === 'pro' || schedulerPlan === 'enterprise') {
    if (schedulerSchedule !== '*/2 * * * *') failures.push('Pro or Enterprise interactive scheduler must use the intended two-minute cadence.');
    if (scheduler.operationalMode !== 'interactive-worker') failures.push('Pro or Enterprise scheduler operationalMode must be interactive-worker.');
    if (scheduler.interactiveConnectorSloMet !== true) failures.push('Interactive scheduler must affirm the connector SLO.');
    if (scheduler.liveConnectorPromotionAllowed !== true) failures.push('Interactive scheduler must explicitly allow live connector promotion.');
  }
  const schedulerReceipt = await loadReceipt(repoRoot, scheduler.receipt, 'scheduler.receipt', failures);
  validateReceiptEnvelope(schedulerReceipt, 'scheduler-plan-support', candidateSha, failures, 'scheduler receipt', deploymentId);
  if (schedulerReceipt) {
    if (schedulerReceipt.platform !== 'vercel' || schedulerReceipt.projectId !== scheduler.projectId
      || schedulerReceipt.teamId !== scheduler.teamId || schedulerReceipt.plan !== scheduler.plan
      || schedulerReceipt.schedule !== scheduler.schedule) {
      failures.push('Scheduler receipt project, account, plan, and schedule must match the manifest.');
    }
    if (schedulerReceipt.supported !== true || schedulerReceipt.verifiedReadOnly !== true) {
      failures.push('Scheduler receipt must prove read-only plan verification and supported cadence.');
    }
    if (schedulerReceipt.liveConnectorPromotionAllowed !== scheduler.liveConnectorPromotionAllowed) {
      failures.push('Scheduler receipt live connector promotion decision mismatch.');
    }
  }

  const historyReceipt = await loadReceipt(repoRoot, migrations.historyReceipt, 'migrations.historyReceipt', failures);
  validateReceiptEnvelope(historyReceipt, 'migration-history', candidateSha, failures, 'migration history receipt');
  if (historyReceipt) assertExactSequence(historyReceipt.observedVersions, migrationNames, 'migration history observedVersions', failures);

  const replayReceipt = await loadReceipt(repoRoot, migrations.replayReceipt, 'migrations.replayReceipt', failures);
  validateReceiptEnvelope(replayReceipt, 'migration-replay', candidateSha, failures, 'migration replay receipt');
  if (replayReceipt) {
    const replayChecksums = Array.isArray(replayReceipt.migrations) ? replayReceipt.migrations : [];
    validateMigrationInventory(replayChecksums, actualMigrations, failures);
  }

  const postApplyReceipt = await loadReceipt(repoRoot, migrations.postApplyReceipt, 'migrations.postApplyReceipt', failures);
  validateReceiptEnvelope(postApplyReceipt, 'post-apply-schema-check', candidateSha, failures, 'post-apply receipt', deploymentId);

  const rollback = asObject(manifest.rollback, 'rollback', failures);
  if (!rollback.targetDeploymentId || typeof rollback.targetDeploymentId !== 'string') failures.push('rollback.targetDeploymentId is required.');
  const rollbackTargetSha = String(rollback.targetSha ?? '');
  if (!SHA_PATTERN.test(rollbackTargetSha)) failures.push('rollback.targetSha must be a full Git SHA.');
  if (SHA_PATTERN.test(rollbackTargetSha) && SHA_PATTERN.test(candidateSha)) {
    try {
      runGit(repoRoot, ['cat-file', '-e', `${rollbackTargetSha}^{commit}`]);
    } catch {
      failures.push('rollback.targetSha is not an available commit in this repository.');
    }
    try {
      runGit(repoRoot, ['merge-base', '--is-ancestor', rollbackTargetSha, candidateSha]);
      if (rollbackTargetSha === candidateSha) throw new Error('equal commits are not strict ancestors');
    } catch {
      failures.push('rollback.targetSha must be a strict ancestor of candidate.sha; equal, descendant, and sibling commits are forbidden.');
    }
  }
  const knownGoodReceipt = await loadReceipt(repoRoot, rollback.knownGoodReceipt, 'rollback.knownGoodReceipt', failures);
  validateReceiptEnvelope(knownGoodReceipt, 'known-good-deployment', rollbackTargetSha, failures, 'rollback.knownGoodReceipt', String(rollback.targetDeploymentId ?? ''));
  if (knownGoodReceipt && knownGoodReceipt.candidateSha !== rollbackTargetSha) failures.push('rollback.knownGoodReceipt must identify rollback.targetSha as the known-good candidate.');
  if (knownGoodReceipt && knownGoodReceipt.deploymentId !== rollback.targetDeploymentId) failures.push('rollback.knownGoodReceipt must identify rollback.targetDeploymentId as the known-good deployment.');
  const knownGoodTime = Date.parse(String(knownGoodReceipt?.observedAt));
  const candidateDeploymentTime = Date.parse(String(deploymentReceipt?.observedAt));
  if (!Number.isNaN(knownGoodTime) && !Number.isNaN(candidateDeploymentTime) && knownGoodTime > candidateDeploymentTime) {
    failures.push('rollback.knownGoodReceipt must predate the candidate Production deployment evidence.');
  }
  for (const [field, kind] of [
    ['applicationReceipt', 'application-rollback-rehearsal'],
    ['databaseReceipt', 'database-recovery-rehearsal'],
    ['authorityRegressionReceipt', 'rollback-authority-regression'],
  ] as const) {
    const receipt = await loadReceipt(repoRoot, rollback[field], `rollback.${field}`, failures);
    validateReceiptEnvelope(receipt, kind, candidateSha, failures, `rollback.${field}`, deploymentId);
    if (receipt && receipt.rollbackTargetSha !== rollback.targetSha) failures.push(`rollback.${field} target SHA mismatch.`);
    if (receipt && receipt.rollbackTargetDeploymentId !== rollback.targetDeploymentId) failures.push(`rollback.${field} target deployment mismatch.`);
  }

  assertExactSequence(manifest.providerInventory, actualProviders, 'providerInventory', failures);
  if (!Array.isArray(manifest.providers)) failures.push('providers must be an array.');
  const providerRecords = Array.isArray(manifest.providers) ? manifest.providers : [];
  assertExactSet(providerRecords.map((value) => isObject(value) ? value.provider : undefined), actualProviders, 'provider evidence records', failures);
  for (const [index, providerValue] of providerRecords.entries()) {
    const provider = asObject(providerValue, `providers[${index}]`, failures);
    if (typeof provider.provider !== 'string' || !provider.provider) failures.push(`providers[${index}].provider is required.`);
    if (scheduler.liveConnectorPromotionAllowed === true && provider.lifecycle !== 'ready') {
      failures.push(`providers[${index}].lifecycle must be ready when live connector promotion is allowed.`);
    }
    if (scheduler.liveConnectorPromotionAllowed === false && !['blocked-external', 'disabled'].includes(String(provider.lifecycle))) {
      failures.push(`providers[${index}].lifecycle must be blocked-external or disabled while the scheduler blocks live connector promotion.`);
    }
    if (provider.actorClassification !== 'canonical-owner') failures.push(`providers[${index}].actorClassification must be canonical-owner.`);
    if (typeof provider.observedAt !== 'string' || Number.isNaN(Date.parse(String(provider.observedAt)))) failures.push(`providers[${index}].observedAt is invalid.`);
    const providerTime = Date.parse(String(provider.observedAt));
    const manifestTime = Date.parse(String(candidate.createdAt));
    if (!Number.isNaN(providerTime) && !Number.isNaN(manifestTime) && (providerTime > manifestTime || manifestTime - providerTime > 86_400_000)) {
      failures.push(`providers[${index}] evidence must be no more than 24 hours old when the manifest is created.`);
    }
    const receipt = await loadReceipt(repoRoot, provider.receipt, `providers[${index}].receipt`, failures);
    const providerReceiptKind = provider.provider === 'twilio'
      ? 'twilio-readiness'
      : provider.provider === 'meta' ? 'meta-readiness' : 'provider-lifecycle';
    validateReceiptEnvelope(receipt, providerReceiptKind, candidateSha, failures, `providers[${index}] receipt`, deploymentId);
    if (receipt && receipt.provider !== provider.provider) failures.push(`providers[${index}] provider receipt mismatch.`);
    if (receipt && receipt.actorClassification !== 'canonical-owner') failures.push(`providers[${index}] receipt actor must be canonical-owner.`);
    if (receipt && receipt.observedAt !== provider.observedAt) failures.push(`providers[${index}] receipt observedAt mismatch.`);
    const facts = asObject(provider.facts, `providers[${index}].facts`, failures);
    if (receipt && stableJson(receipt.facts) !== stableJson(facts)) failures.push(`providers[${index}] receipt facts mismatch.`);
    if (provider.provider === 'google') {
      const requiredScopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.metadata',
        'https://www.googleapis.com/auth/calendar.app.created',
      ];
      assertExactSet(facts.requiredScopes, requiredScopes, 'Google requiredScopes', failures);
      const grantedScopes = Array.isArray(facts.grantedScopes) ? facts.grantedScopes : [];
      const missingScopes = Array.isArray(facts.missingScopes) ? facts.missingScopes : [];
      if (!Array.isArray(facts.grantedScopes) || !Array.isArray(facts.missingScopes)) failures.push('Google facts must declare grantedScopes and missingScopes.');
      assertExactSet(missingScopes, requiredScopes.filter((scope) => !grantedScopes.includes(scope)), 'Google missingScopes', failures);
      if (!['approved', 'pending', 'rejected'].includes(String(facts.scopeReview))) failures.push('Google facts scopeReview is invalid.');
      if (!['pass', 'not-run', 'fail'].includes(String(facts.realAccountUat))) failures.push('Google facts realAccountUat is invalid.');
      if (!['healthy', 'degraded', 'unknown'].includes(String(facts.capabilityHealth))) failures.push('Google facts capabilityHealth is invalid.');
      if (provider.lifecycle === 'ready' && (facts.scopeReview !== 'approved' || facts.realAccountUat !== 'pass'
        || facts.capabilityHealth !== 'healthy' || missingScopes.length !== 0)) {
        failures.push('Ready Google evidence requires approved scope review, passing real-account UAT, healthy capabilities, and no missing scopes.');
      }
    }
    if (provider.provider === 'mailchimp') {
      if (!['selected', 'missing', 'unknown'].includes(String(facts.audienceBinding))) failures.push('Mailchimp facts audienceBinding is invalid.');
      if (!['active', 'pending', 'unknown'].includes(String(facts.webhook))) failures.push('Mailchimp facts webhook is invalid.');
      if (!['complete', 'pending', 'running', 'review', 'unknown'].includes(String(facts.baseline))) failures.push('Mailchimp facts baseline is invalid.');
      if (!['complete', 'running', 'review', 'failed', 'unknown'].includes(String(facts.reconciliation))) failures.push('Mailchimp facts reconciliation is invalid.');
      if (!['pass', 'not-run', 'fail'].includes(String(facts.realAccountUat))) failures.push('Mailchimp facts realAccountUat is invalid.');
      if (provider.lifecycle === 'ready' && (facts.audienceBinding !== 'selected' || facts.webhook !== 'active'
        || facts.baseline !== 'complete' || facts.reconciliation !== 'complete' || facts.realAccountUat !== 'pass')) {
        failures.push('Ready Mailchimp evidence requires a selected audience, active webhook, complete baseline/reconciliation, and passing real-account UAT.');
      }
    }
    if (provider.provider === 'twilio') {
      if (!['active', 'suspended', 'unknown'].includes(String(facts.accountStatus))) failures.push('Twilio facts accountStatus is invalid.');
      if (!['configured', 'missing', 'unknown'].includes(String(facts.messagingService))) failures.push('Twilio facts messagingService is invalid.');
      if (!['approved', 'pending', 'rejected', 'not-required', 'unknown'].includes(String(facts.a2pRegistration))) failures.push('Twilio facts a2pRegistration is invalid.');
      if (!['verified', 'missing', 'unknown'].includes(String(facts.senderNumber))) failures.push('Twilio facts senderNumber is invalid.');
      if (!['active', 'pending', 'unknown'].includes(String(facts.inboundWebhook))) failures.push('Twilio facts inboundWebhook is invalid.');
      if (!['active', 'pending', 'unknown'].includes(String(facts.statusCallback))) failures.push('Twilio facts statusCallback is invalid.');
      if (!['verified', 'not-verified', 'unknown'].includes(String(facts.consentStopHelpQuietHours))) failures.push('Twilio facts consentStopHelpQuietHours is invalid.');
      if (!['pass', 'not-run', 'fail'].includes(String(facts.realNumberUat))) failures.push('Twilio facts realNumberUat is invalid.');
      if (provider.lifecycle === 'ready' && (facts.accountStatus !== 'active' || facts.messagingService !== 'configured'
        || !['approved', 'not-required'].includes(String(facts.a2pRegistration)) || facts.senderNumber !== 'verified'
        || facts.inboundWebhook !== 'active' || facts.statusCallback !== 'active'
        || facts.consentStopHelpQuietHours !== 'verified' || facts.realNumberUat !== 'pass')) {
        failures.push('Ready Twilio evidence requires active account/service/webhooks, verified sender and consent controls, applicable A2P approval, and passing real-number UAT.');
      }
    }
    if (provider.provider === 'meta') {
      const requiredPermissions = [
        'pages_manage_metadata',
        'pages_messaging',
        'pages_show_list',
        'instagram_business_basic',
        'instagram_business_manage_messages',
      ];
      assertExactSet(facts.requiredPermissions, requiredPermissions, 'Meta requiredPermissions', failures);
      const grantedPermissions = Array.isArray(facts.grantedPermissions) ? facts.grantedPermissions : [];
      const missingPermissions = Array.isArray(facts.missingPermissions) ? facts.missingPermissions : [];
      if (!Array.isArray(facts.grantedPermissions) || !Array.isArray(facts.missingPermissions)) failures.push('Meta facts must declare grantedPermissions and missingPermissions.');
      assertExactSet(missingPermissions, requiredPermissions.filter((permission) => !grantedPermissions.includes(permission)), 'Meta missingPermissions', failures);
      if (!['approved', 'pending', 'rejected', 'unknown'].includes(String(facts.businessVerification))) failures.push('Meta facts businessVerification is invalid.');
      if (!['approved', 'pending', 'rejected', 'unknown'].includes(String(facts.appReview))) failures.push('Meta facts appReview is invalid.');
      if (!['selected', 'missing', 'unknown'].includes(String(facts.assetBinding))) failures.push('Meta facts assetBinding is invalid.');
      if (!['active', 'pending', 'unknown'].includes(String(facts.signedWebhook))) failures.push('Meta facts signedWebhook is invalid.');
      if (!['healthy', 'expired', 'unknown'].includes(String(facts.tokenHealth))) failures.push('Meta facts tokenHealth is invalid.');
      if (!['pass', 'not-run', 'fail'].includes(String(facts.realAccountUat))) failures.push('Meta facts realAccountUat is invalid.');
      if (provider.lifecycle === 'ready' && (facts.businessVerification !== 'approved' || facts.appReview !== 'approved'
        || missingPermissions.length !== 0 || facts.assetBinding !== 'selected' || facts.signedWebhook !== 'active'
        || facts.tokenHealth !== 'healthy' || facts.realAccountUat !== 'pass')) {
        failures.push('Ready Meta evidence requires approved business/App Review, all required permissions, selected assets, active signed webhook, healthy token, and passing real-account UAT.');
      }
    }
  }

  const uat = asObject(manifest.uat, 'uat', failures);
  if (uat.authenticated !== true) failures.push('uat.authenticated must be true.');
  if (uat.testerRole !== 'canonical-owner') failures.push('uat.testerRole must be canonical-owner.');
  if (!DIGEST_PATTERN.test(String(uat.workspaceIdHash ?? ''))) failures.push('uat.workspaceIdHash must be a redacted SHA-256 hash.');
  const uatResults = Array.isArray(uat.results) ? uat.results : [];
  if (!Array.isArray(uat.results)) failures.push('uat.results must be an array.');
  const expectedCells = REQUIRED_ROUTES.flatMap((route) => REQUIRED_WIDTHS.map((width) => `${route}@${width}`));
  assertExactSet(uatResults.map((value) => isObject(value) ? `${String(value.route)}@${String(value.width)}` : undefined), expectedCells, 'UAT route-width results', failures);
  for (const [index, resultValue] of uatResults.entries()) {
    const result = asObject(resultValue, `uat.results[${index}]`, failures);
    validateUatEnvironment(result, `uat.results[${index}]`, failures);
    if (result.outcome !== 'pass') failures.push(`uat.results[${index}].outcome must be pass.`);
    if (result.health !== 'healthy') failures.push(`uat.results[${index}].health must be healthy.`);
    if (result.readiness !== 'ready') failures.push(`uat.results[${index}].readiness must be ready.`);
    const uatReceipt = await loadReceipt(repoRoot, result.evidence, `uat.results[${index}].evidence`, failures);
    validateReceiptEnvelope(uatReceipt, 'authenticated-uat-route', candidateSha, failures, `uat.results[${index}] receipt`, deploymentId);
    if (!uatReceipt) continue;
    if (uatReceipt.authenticated !== true || uatReceipt.testerRole !== 'canonical-owner') failures.push(`uat.results[${index}] receipt must prove authenticated canonical-owner UAT.`);
    if (uatReceipt.workspaceIdHash !== uat.workspaceIdHash) failures.push(`uat.results[${index}] receipt workspace hash mismatch.`);
    if (uatReceipt.route !== result.route || uatReceipt.width !== result.width) failures.push(`uat.results[${index}] receipt route/width mismatch.`);
    if (uatReceipt.outcome !== result.outcome || uatReceipt.health !== result.health || uatReceipt.readiness !== result.readiness) failures.push(`uat.results[${index}] receipt result mismatch.`);
    for (const field of ['device', 'browser', 'browserVersion', 'displayMode', 'orientation'] as const) {
      if (uatReceipt[field] !== result[field]) failures.push(`uat.results[${index}] receipt ${field} mismatch.`);
    }
    if (stableJson(uatReceipt.safeArea) !== stableJson(result.safeArea) || stableJson(uatReceipt.overflow) !== stableJson(result.overflow)) {
      failures.push(`uat.results[${index}] receipt safe-area or overflow mismatch.`);
    }
    const deploymentTime = Date.parse(String(deploymentReceipt?.observedAt));
    const uatTime = Date.parse(String(uatReceipt.observedAt));
    if (!Number.isNaN(deploymentTime) && !Number.isNaN(uatTime) && uatTime < deploymentTime) {
      failures.push('Authenticated UAT must be observed after the exact Production deployment.');
    }
  }

  const iphone11 = asObject(uat.iphone11, 'uat.iphone11', failures);
  for (const [field, displayMode] of [['safariBrowser', 'browser'], ['installedPwa', 'standalone']] as const) {
    const mode = asObject(iphone11[field], `uat.iphone11.${field}`, failures);
    validateUatEnvironment(mode, `uat.iphone11.${field}`, failures);
    if (mode.device !== 'iPhone 11' || mode.browser !== 'Mobile Safari' || mode.viewportWidth !== 414
      || mode.displayMode !== displayMode || mode.orientation !== 'portrait') {
      failures.push(`uat.iphone11.${field} must prove iPhone 11 Mobile Safari at 414px in ${displayMode} portrait mode.`);
    }
    const receipt = await loadReceipt(repoRoot, mode.evidence, `uat.iphone11.${field}.evidence`, failures);
    validateReceiptEnvelope(receipt, 'authenticated-uat-device-mode', candidateSha, failures, `uat.iphone11.${field} receipt`, deploymentId);
    if (receipt) {
      if (receipt.authenticated !== true || receipt.testerRole !== 'canonical-owner' || receipt.workspaceIdHash !== uat.workspaceIdHash) {
        failures.push(`uat.iphone11.${field} receipt must prove authenticated canonical-owner UAT in the manifest workspace.`);
      }
      for (const environmentField of ['device', 'browser', 'browserVersion', 'viewportWidth', 'displayMode', 'orientation'] as const) {
        if (receipt[environmentField] !== mode[environmentField]) failures.push(`uat.iphone11.${field} receipt ${environmentField} mismatch.`);
      }
      if (stableJson(receipt.safeArea) !== stableJson(mode.safeArea) || stableJson(receipt.overflow) !== stableJson(mode.overflow)) {
        failures.push(`uat.iphone11.${field} receipt safe-area or overflow mismatch.`);
      }
      const deploymentTime = Date.parse(String(deploymentReceipt?.observedAt));
      const receiptTime = Date.parse(String(receipt.observedAt));
      if (!Number.isNaN(deploymentTime) && !Number.isNaN(receiptTime) && receiptTime < deploymentTime) {
        failures.push(`uat.iphone11.${field} must be observed after the exact Production deployment.`);
      }
    }
  }

  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  if (!Array.isArray(manifest.gates)) failures.push('gates must be an array.');
  assertExactSet(gates.map((gate) => isObject(gate) ? gate.name : undefined), REQUIRED_GATES, 'gate names', failures);
  for (const [index, gateValue] of gates.entries()) {
    const gate = asObject(gateValue, `gates[${index}]`, failures);
    if (gate.result !== 'pass') failures.push(`gates[${index}].result must be pass.`);
    if (gate.candidateSha !== candidateSha) failures.push(`gates[${index}].candidateSha mismatch.`);
    const receipt = await loadReceipt(repoRoot, gate.receipt, `gates[${index}].receipt`, failures);
    validateReceiptEnvelope(receipt, 'quality-gate', candidateSha, failures, `gates[${index}] receipt`);
    if (receipt && receipt.gate !== gate.name) failures.push(`gates[${index}] receipt gate name mismatch.`);
  }

  if (failures.length) throw new ManifestValidationError(failures);
  return manifestValue as ReleaseManifest;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

export async function validateReleaseManifestTree(options: { repoRoot: string; requireManifest?: boolean; expectedSha?: string }): Promise<number> {
  const repoRoot = resolve(options.repoRoot);
  const expectedSha = options.expectedSha?.toLowerCase();
  if (expectedSha && !SHA_PATTERN.test(expectedSha)) throw new Error('Manifest tree expected SHA must be a full lowercase 40-character Git SHA.');
  if (options.requireManifest && !expectedSha) throw new Error('Required manifest-tree validation must declare the exact expected candidate SHA.');
  const tracked = runGit(repoRoot, ['ls-files', '--', 'docs/qa/releases'])
    .split(/\r?\n/u)
    .filter(Boolean);
  const manifestFiles = tracked.filter((path) => path.endsWith('release-manifest.json'));
  if (options.requireManifest && expectedSha && !manifestFiles.includes(canonicalManifestPath(expectedSha))) {
    throw new Error(`Release gate requires the tracked canonical manifest for exact candidate ${expectedSha}; historical manifests do not satisfy this gate.`);
  }
  for (const manifestFile of manifestFiles) {
    const match = manifestFile.match(/^docs\/qa\/releases\/([a-f0-9]{40})\/release-manifest\.json$/u);
    if (!match) throw new Error(`Release manifest path is not canonical: ${manifestFile}.`);
    const manifest = await readJson(validateManifestPath(repoRoot, manifestFile, match[1]!));
    await validateReleaseManifest(manifest, { repoRoot, expectedSha: match[1] });
  }
  return manifestFiles.length;
}

function parseArguments(arguments_: string[]): { command: string; values: Map<string, string> } {
  const [command = '', ...rest] = arguments_;
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    values.set(key.slice(2), value);
  }
  return { command, values };
}

async function main(): Promise<void> {
  const { command, values } = parseArguments(process.argv.slice(2));
  const repoRoot = resolve(values.get('repo') ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
  if (command === 'validate') {
    const manifestArgument = values.get('manifest');
    if (!manifestArgument) throw new Error('validate requires --manifest at the canonical exact-SHA path.');
    const preliminary = await readJson(resolve(repoRoot, manifestArgument));
    const preliminaryCandidate = asObject(asObject(preliminary, 'manifest', []).candidate, 'candidate', []);
    const manifestPath = validateManifestPath(repoRoot, manifestArgument, String(preliminaryCandidate.sha ?? ''));
    const manifest = await readJson(manifestPath);
    await validateReleaseManifest(manifest, { repoRoot, expectedSha: values.get('expected-sha') });
    process.stdout.write(`Release manifest accepted: ${(manifest as ReleaseManifest).candidate.sha}\n`);
    return;
  }
  if (command === 'validate-tree') {
    const requireManifestValue = values.get('require-manifest');
    if (requireManifestValue && !['true', 'false'].includes(requireManifestValue)) {
      throw new Error('validate-tree --require-manifest must be true or false.');
    }
    const count = await validateReleaseManifestTree({
      repoRoot,
      requireManifest: requireManifestValue === 'true',
      expectedSha: values.get('expected-sha'),
    });
    process.stdout.write(`Validated ${count} canonical release manifest(s).\n`);
    return;
  }
  if (command === 'create') {
    if (runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('Refusing to create a release manifest from a dirty worktree.');
    const candidateSha = String(values.get('candidate-sha') ?? '').toLowerCase();
    const candidateBranch = values.get('candidate-branch');
    if (!SHA_PATTERN.test(candidateSha)) throw new Error('create requires --candidate-sha with a full lowercase 40-character Git SHA.');
    if (!candidateBranch) throw new Error('create requires --candidate-branch <branch>.');
    runGit(repoRoot, ['cat-file', '-e', `${candidateSha}^{commit}`]);
    runGit(repoRoot, ['rev-parse', '--verify', `${candidateBranch}^{commit}`]);
    try {
      runGit(repoRoot, ['merge-base', '--is-ancestor', candidateSha, candidateBranch]);
    } catch {
      throw new Error(`Candidate SHA is not contained in candidate branch ${candidateBranch}.`);
    }
    const inputPath = values.get('evidence');
    if (!inputPath) throw new Error('create requires --evidence <assembled-evidence.json>.');
    const assembled = asObject(await readJson(resolve(repoRoot, inputPath)), 'assembled evidence', []);
    const manifest: unknown = {
      ...assembled,
      schemaVersion: 1,
      candidate: {
        sha: candidateSha,
        branch: candidateBranch,
        clean: true,
        createdAt: new Date().toISOString(),
      },
      migrations: {
        ...asObject(assembled.migrations, 'migrations', []),
        files: listCandidateMigrations(repoRoot, candidateSha),
      },
      providerInventory: listCandidateProviders(repoRoot, candidateSha),
    };
    await validateReleaseManifest(manifest, { repoRoot, expectedSha: candidateSha });
    const requiredOutput = resolve(repoRoot, canonicalManifestPath(candidateSha));
    const output = resolve(repoRoot, values.get('output') ?? relative(repoRoot, requiredOutput));
    if (output !== requiredOutput) throw new Error(`Manifest output must be docs/qa/releases/${candidateSha}/release-manifest.json.`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`Created immutable release manifest: ${relative(repoRoot, output)}\n`);
    return;
  }
  throw new Error('Usage: release-manifest.ts <create|validate|validate-tree> [options]; release gates must pass --require-manifest true.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
