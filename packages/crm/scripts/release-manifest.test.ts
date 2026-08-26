import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ManifestValidationError,
  canonicalManifestPath,
  type ReleaseManifest,
  validateManifestPath,
  validateReleaseManifest,
  validateReleaseManifestTree,
} from './release-manifest';

const temporaryRoots: string[] = [];
const observedAt = new Date(Date.now() - 60_000).toISOString();
const knownGoodObservedAt = new Date(Date.parse(observedAt) - 60_000).toISOString();
const artifactDigest = 'a'.repeat(64);
const workspaceIdHash = 'b'.repeat(64);

vi.setConfig({ testTimeout: 15_000 });

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function digest(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function writeJson(repoRoot: string, relativePath: string, value: unknown) {
  const absolutePath = join(repoRoot, relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(absolutePath, contents);
  return { path: relativePath.replaceAll('\\', '/'), sha256: digest(contents) };
}

async function createFixture(plan: 'hobby' | 'pro' = 'pro'): Promise<{ repoRoot: string; manifest: ReleaseManifest }> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'crm-release-manifest-'));
  temporaryRoots.push(repoRoot);
  git(repoRoot, 'init', '--quiet');
  git(repoRoot, 'config', 'user.email', 'release-validator@example.invalid');
  git(repoRoot, 'config', 'user.name', 'Release Validator');

  await writeFile(join(repoRoot, 'baseline.txt'), 'known good\n');
  git(repoRoot, 'add', 'baseline.txt');
  git(repoRoot, 'commit', '--quiet', '-m', 'baseline');
  const rollbackSha = git(repoRoot, 'rev-parse', 'HEAD');

  const migrationPath = 'packages/crm/supabase/migrations/0001_init.sql';
  const providerSourcePath = 'packages/crm/lib/domain/connector.ts';
  await mkdir(join(repoRoot, 'packages/crm/supabase/migrations'), { recursive: true });
  await mkdir(join(repoRoot, 'packages/crm/lib/domain'), { recursive: true });
  await writeFile(join(repoRoot, migrationPath), 'select 1;\n');
  await writeFile(join(repoRoot, providerSourcePath), `export const CONNECTOR_PROVIDERS = [\n  'contract-test',\n  'google',\n  'mailchimp',\n  'twilio',\n  'meta',\n] as const;\n`);
  git(repoRoot, 'add', migrationPath, providerSourcePath);
  git(repoRoot, 'commit', '--quiet', '-m', 'candidate');
  const candidateSha = git(repoRoot, 'rev-parse', 'HEAD');
  const migration = { path: migrationPath, sha256: digest(await readFile(join(repoRoot, migrationPath))) };
  const deploymentId = 'dpl_candidate_exact';
  const rollbackTargetDeploymentId = 'dpl_known_good';
  const knownGoodReceipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/known-good-deployment.json', {
    kind: 'known-good-deployment', result: 'pass', candidateSha: rollbackSha,
    deploymentId: rollbackTargetDeploymentId, observedAt: knownGoodObservedAt,
  });

  const deploymentReceipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/deployment.json', {
    kind: 'deployment', result: 'pass', candidateSha, deploymentId, deploymentDigest: artifactDigest, observedAt,
  });
  const hobbyScheduler = plan === 'hobby';
  const scheduler = {
    platform: 'vercel' as const,
    projectId: 'prj_release_fixture',
    teamId: 'team_release_fixture',
    plan,
    schedule: hobbyScheduler ? '0 6 * * *' : '*/2 * * * *',
    supported: true as const,
    operationalMode: hobbyScheduler ? 'daily-maintenance-only' as const : 'interactive-worker' as const,
    interactiveConnectorSloMet: !hobbyScheduler,
    liveConnectorPromotionAllowed: !hobbyScheduler,
  };
  const schedulerReceipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/scheduler-plan-support.json', {
    kind: 'scheduler-plan-support', result: 'pass', candidateSha, deploymentId, observedAt,
    platform: scheduler.platform, projectId: scheduler.projectId, teamId: scheduler.teamId,
    plan: scheduler.plan, schedule: scheduler.schedule,
    supported: true, verifiedReadOnly: true, liveConnectorPromotionAllowed: scheduler.liveConnectorPromotionAllowed,
  });
  const historyReceipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/migration-history.json', {
    kind: 'migration-history', result: 'pass', candidateSha, observedVersions: ['0001_init.sql'], observedAt,
  });
  const replayReceipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/migration-replay.json', {
    kind: 'migration-replay', result: 'pass', candidateSha, migrations: [migration], observedAt,
  });
  const postApplyReceipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/post-apply.json', {
    kind: 'post-apply-schema-check', result: 'pass', candidateSha, deploymentId, observedAt,
  });

  const rollbackReceipts = Object.fromEntries(await Promise.all([
    ['applicationReceipt', 'application-rollback-rehearsal'],
    ['databaseReceipt', 'database-recovery-rehearsal'],
    ['authorityRegressionReceipt', 'rollback-authority-regression'],
  ].map(async ([field, kind]) => [field, await writeJson(repoRoot, `docs/qa/releases/evidence/${kind}.json`, {
    kind, result: 'pass', candidateSha, deploymentId, rollbackTargetSha: rollbackSha,
    rollbackTargetDeploymentId, observedAt,
  })])));

  const providerInventory = ['google', 'mailchimp', 'twilio', 'meta'];
  const providerFacts: Record<string, Record<string, unknown>> = {
    google: {
      requiredScopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.metadata',
        'https://www.googleapis.com/auth/calendar.app.created',
      ],
      grantedScopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.metadata',
        'https://www.googleapis.com/auth/calendar.app.created',
      ],
      missingScopes: [], scopeReview: 'approved', realAccountUat: 'pass', capabilityHealth: 'healthy',
    },
    mailchimp: {
      audienceBinding: 'selected', webhook: 'active', baseline: 'complete', reconciliation: 'complete', realAccountUat: 'pass',
    },
    twilio: {
      accountStatus: 'active', messagingService: 'configured', a2pRegistration: 'approved',
      senderNumber: 'verified', inboundWebhook: 'active', statusCallback: 'active',
      consentStopHelpQuietHours: 'verified', realNumberUat: 'pass',
    },
    meta: {
      businessVerification: 'approved', appReview: 'approved',
      requiredPermissions: ['pages_manage_metadata', 'pages_messaging', 'pages_show_list', 'instagram_business_basic', 'instagram_business_manage_messages'],
      grantedPermissions: ['pages_manage_metadata', 'pages_messaging', 'pages_show_list', 'instagram_business_basic', 'instagram_business_manage_messages'],
      missingPermissions: [], assetBinding: 'selected', signedWebhook: 'active', tokenHealth: 'healthy', realAccountUat: 'pass',
    },
  };
  const providers = await Promise.all(providerInventory.map(async (provider) => {
    const facts = providerFacts[provider]!;
    const receipt = await writeJson(repoRoot, `docs/qa/releases/evidence/${provider}-provider.json`, {
      kind: provider === 'twilio' ? 'twilio-readiness' : provider === 'meta' ? 'meta-readiness' : 'provider-lifecycle',
      result: 'pass', candidateSha, deploymentId, provider,
      actorClassification: 'canonical-owner', observedAt, facts,
    });
    return {
      provider, lifecycle: hobbyScheduler ? 'blocked-external' as const : 'ready' as const,
      actorClassification: 'canonical-owner' as const, observedAt, facts, receipt,
    };
  }));
  const routes = ['contacts', 'import', 'pipeline', 'omnix', 'connections', 'insights', 'sign-in-theme'];
  const widths = [390, 414, 768, 1440];
  const uatResults = await Promise.all(routes.flatMap((route) => widths.map(async (width) => {
    const environment = {
      device: width === 414 ? 'iPhone 11' : width === 768 ? 'Tablet viewport' : width === 1440 ? 'Desktop viewport' : 'Responsive mobile viewport',
      browser: width === 414 ? 'Mobile Safari' : 'Chromium', browserVersion: width === 414 ? '18.6' : '128.0',
      displayMode: 'browser' as const, orientation: width >= 768 ? 'landscape' as const : 'portrait' as const,
      safeArea: { top: width === 414 ? 47 : 0, right: 0, bottom: width === 414 ? 34 : 0, left: 0, respected: true as const },
      overflow: { horizontal: 'none' as const, clippedControls: false as const },
    };
    const evidence = await writeJson(repoRoot, `docs/qa/releases/evidence/uat-${route}-${width}.json`, {
      kind: 'authenticated-uat-route', result: 'pass', candidateSha, deploymentId, authenticated: true,
      testerRole: 'canonical-owner', workspaceIdHash, route, width,
      ...environment, outcome: 'pass', health: 'healthy', readiness: 'ready', observedAt,
    });
    return { route, width, ...environment, outcome: 'pass' as const, health: 'healthy' as const, readiness: 'ready' as const, evidence };
  })));
  const iphoneEnvironment = {
    device: 'iPhone 11' as const, browser: 'Mobile Safari' as const, browserVersion: '18.6', viewportWidth: 414 as const,
    orientation: 'portrait' as const, safeArea: { top: 47, right: 0, bottom: 34, left: 0, respected: true as const },
    overflow: { horizontal: 'none' as const, clippedControls: false as const },
  };
  const iphone11 = {
    safariBrowser: {
      ...iphoneEnvironment, displayMode: 'browser' as const,
      evidence: await writeJson(repoRoot, 'docs/qa/releases/evidence/uat-iphone11-safari.json', {
        kind: 'authenticated-uat-device-mode', result: 'pass', candidateSha, deploymentId, authenticated: true,
        testerRole: 'canonical-owner', workspaceIdHash, ...iphoneEnvironment, displayMode: 'browser', observedAt,
      }),
    },
    installedPwa: {
      ...iphoneEnvironment, displayMode: 'standalone' as const,
      evidence: await writeJson(repoRoot, 'docs/qa/releases/evidence/uat-iphone11-installed-pwa.json', {
        kind: 'authenticated-uat-device-mode', result: 'pass', candidateSha, deploymentId, authenticated: true,
        testerRole: 'canonical-owner', workspaceIdHash, ...iphoneEnvironment, displayMode: 'standalone', observedAt,
      }),
    },
  };

  const gates = await Promise.all(['dependency-audit', 'secret-scan', 'lint', 'typecheck', 'test', 'build'].map(async (name) => ({
    name,
    result: 'pass' as const,
    candidateSha,
    receipt: await writeJson(repoRoot, `docs/qa/releases/evidence/gate-${name}.json`, {
      kind: 'quality-gate', gate: name, result: 'pass', candidateSha, observedAt,
    }),
  })));

  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    candidate: { sha: candidateSha, branch: 'release/candidate', clean: true, createdAt: observedAt },
    artifact: {
      digest: artifactDigest,
      deployment: { id: deploymentId, digest: artifactDigest, candidateSha, environment: 'production', receipt: deploymentReceipt },
    },
    scheduler: { ...scheduler, receipt: schedulerReceipt },
    migrations: { files: [migration], historyReceipt, replayReceipt, postApplyReceipt },
    rollback: {
      targetDeploymentId: rollbackTargetDeploymentId,
      targetSha: rollbackSha,
      knownGoodReceipt,
      applicationReceipt: rollbackReceipts.applicationReceipt,
      databaseReceipt: rollbackReceipts.databaseReceipt,
      authorityRegressionReceipt: rollbackReceipts.authorityRegressionReceipt,
    },
    providerInventory,
    providers,
    uat: {
      authenticated: true, testerRole: 'canonical-owner', workspaceIdHash,
      results: uatResults, iphone11,
    },
    gates,
  };

  git(repoRoot, 'add', 'docs');
  git(repoRoot, 'commit', '--quiet', '-m', 'evidence');
  return { repoRoot, manifest };
}

function cloneManifest(manifest: ReleaseManifest): ReleaseManifest {
  return structuredClone(manifest);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('release manifest validation', () => {
  it('publishes closed Twilio, Meta, and authenticated UAT fact schemas', async () => {
    type ProviderRule = {
      if?: { properties?: { provider?: { const?: string } } };
      then?: { properties?: { facts?: { additionalProperties?: boolean; required?: string[] } } };
    };
    type ManifestSchema = {
      properties: {
        providers: { items: { allOf: ProviderRule[] } };
        uat: { required: string[]; properties: { results: { items: { required: string[] } } } };
      };
    };
    const schema = JSON.parse(await readFile(fileURLToPath(new URL('./release-manifest.schema.json', import.meta.url)), 'utf8')) as ManifestSchema;
    const providerRules = schema.properties.providers.items.allOf;
    const factsFor = (provider: string) => providerRules
      .find((rule) => rule.if?.properties?.provider?.const === provider)?.then?.properties?.facts;
    const twilioFacts = factsFor('twilio');
    const metaFacts = factsFor('meta');
    expect(twilioFacts).toMatchObject({ additionalProperties: false });
    expect(twilioFacts?.required).toEqual([
      'accountStatus', 'messagingService', 'a2pRegistration', 'senderNumber', 'inboundWebhook',
      'statusCallback', 'consentStopHelpQuietHours', 'realNumberUat',
    ]);
    expect(metaFacts).toMatchObject({ additionalProperties: false });
    expect(metaFacts?.required).toEqual([
      'businessVerification', 'appReview', 'requiredPermissions', 'grantedPermissions', 'missingPermissions',
      'assetBinding', 'signedWebhook', 'tokenHealth', 'realAccountUat',
    ]);
    expect(schema.properties.uat.required).toContain('iphone11');
    expect(schema.properties.uat.properties.results.items.required).toEqual(expect.arrayContaining([
      'device', 'browser', 'browserVersion', 'displayMode', 'orientation', 'safeArea', 'overflow',
    ]));
  });

  it('accepts complete exact-SHA evidence from a clean evidence checkout', async () => {
    const { repoRoot, manifest } = await createFixture();
    await expect(validateReleaseManifest(manifest, { repoRoot, expectedSha: manifest.candidate.sha })).resolves.toEqual(manifest);
  });

  it('accepts the supported Hobby daily fallback only with live connector promotion blocked', async () => {
    const { repoRoot, manifest } = await createFixture('hobby');
    await expect(validateReleaseManifest(manifest, { repoRoot })).resolves.toEqual(manifest);
  });

  it('rejects a two-minute Hobby schedule that Vercel would reject at deployment', async () => {
    const { repoRoot, manifest } = await createFixture('hobby');
    const invalid = cloneManifest(manifest);
    invalid.scheduler.schedule = '*/2 * * * *';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/Hobby scheduler must use the supported daily/i);
  });

  it('keeps the Hobby daily fallback fail-closed for live connector promotion', async () => {
    const { repoRoot, manifest } = await createFixture('hobby');
    const invalid = cloneManifest(manifest);
    invalid.scheduler.liveConnectorPromotionAllowed = true;
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/Hobby scheduler must block live connector promotion/i);
  });

  it('creates the immutable manifest for an explicit candidate Git object', async () => {
    const { repoRoot, manifest } = await createFixture();
    const assembled = cloneManifest(manifest) as Record<string, unknown>;
    delete assembled.schemaVersion;
    delete assembled.candidate;
    delete (assembled.migrations as Record<string, unknown>).files;
    delete assembled.providerInventory;
    await writeJson(repoRoot, 'assembled-evidence.json', assembled);
    git(repoRoot, 'add', 'assembled-evidence.json');
    git(repoRoot, 'commit', '--quiet', '-m', 'assembled evidence input');
    const branch = git(repoRoot, 'branch', '--show-current');
    const cliPath = fileURLToPath(new URL('./release-manifest.ts', import.meta.url));

    execFileSync(process.execPath, [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', cliPath, 'create',
      '--repo', repoRoot, '--candidate-sha', manifest.candidate.sha, '--candidate-branch', branch,
      '--evidence', 'assembled-evidence.json',
    ]);

    const output = join(repoRoot, 'docs/qa/releases', manifest.candidate.sha, 'release-manifest.json');
    const created = JSON.parse(await readFile(output, 'utf8')) as ReleaseManifest;
    expect(created.candidate.sha).toBe(manifest.candidate.sha);
    expect(created.migrations.files).toEqual(manifest.migrations.files);
  });

  it('fails closed on a dirty evidence checkout', async () => {
    const { repoRoot, manifest } = await createFixture();
    await writeFile(join(repoRoot, 'untracked.txt'), 'dirty\n');
    await expect(validateReleaseManifest(manifest, { repoRoot })).rejects.toThrow(/evidence checkout is dirty/i);
  });

  it('rejects an expected candidate SHA mismatch', async () => {
    const { repoRoot, manifest } = await createFixture();
    await expect(validateReleaseManifest(manifest, { repoRoot, expectedSha: 'f'.repeat(40) })).rejects.toThrow(/expected-sha/i);
  });

  it('rejects migration checksum drift', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.migrations.files[0]!.sha256 = '0'.repeat(64);
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/migration checksum mismatch/i);
  });

  it('rejects missing migration replay evidence', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.migrations.replayReceipt.path = 'docs/qa/releases/evidence/missing.json';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/does not exist/i);
  });

  it('rejects deployment evidence bound to another deployment', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.artifact.deployment.id = 'dpl_wrong';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/deploymentId does not match/i);
  });

  it('rejects missing rollback rehearsal evidence', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.rollback.databaseReceipt.path = 'docs/qa/releases/evidence/missing-database-rollback.json';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/does not exist/i);
  });

  it('rejects equal, descendant, and sibling rollback targets instead of accepting any different commit', async () => {
    const { repoRoot, manifest } = await createFixture();
    const currentBranch = git(repoRoot, 'branch', '--show-current');
    const evidenceHead = git(repoRoot, 'rev-parse', 'HEAD');

    const equal = cloneManifest(manifest);
    equal.rollback.targetSha = manifest.candidate.sha;
    await expect(validateReleaseManifest(equal, { repoRoot })).rejects.toThrow(/strict ancestor/i);

    const descendant = cloneManifest(manifest);
    descendant.rollback.targetSha = evidenceHead;
    await expect(validateReleaseManifest(descendant, { repoRoot })).rejects.toThrow(/strict ancestor/i);

    git(repoRoot, 'checkout', '--quiet', '-b', 'sibling-rollback', manifest.rollback.targetSha);
    await writeFile(join(repoRoot, 'sibling.txt'), 'sibling\n');
    git(repoRoot, 'add', 'sibling.txt');
    git(repoRoot, 'commit', '--quiet', '-m', 'sibling rollback target');
    const siblingSha = git(repoRoot, 'rev-parse', 'HEAD');
    git(repoRoot, 'checkout', '--quiet', currentBranch);
    const sibling = cloneManifest(manifest);
    sibling.rollback.targetSha = siblingSha;
    await expect(validateReleaseManifest(sibling, { repoRoot })).rejects.toThrow(/strict ancestor/i);
  });

  it('binds rollback recovery to declared known-good prior deployment evidence', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.rollback.targetDeploymentId = 'dpl_unproven';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/known-good deployment|target deployment mismatch/i);
  });

  it('rejects provider evidence from a non-owner actor', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.providers[0]!.actorClassification = 'support-admin' as 'canonical-owner';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/canonical-owner/i);
  });

  it('rejects an omitted applicable provider and its evidence record', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.providerInventory = invalid.providerInventory.filter((provider) => provider !== 'meta');
    invalid.providers = invalid.providers.filter((provider) => provider.provider !== 'meta');
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/providerInventory|provider evidence records/i);
  });

  it('rejects duplicate evidence records for one provider', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.providers.push(cloneManifest(manifest).providers[0]!);
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/provider evidence records/i);
  });

  it('rejects missing Google-specific facts', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    delete invalid.providers.find((provider) => provider.provider === 'google')!.facts.missingScopes;
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/Google facts/i);
  });

  it('rejects missing Mailchimp-specific facts', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    delete invalid.providers.find((provider) => provider.provider === 'mailchimp')!.facts.audienceBinding;
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/Mailchimp facts/i);
  });

  it('rejects generic lifecycle receipts for Twilio readiness', async () => {
    const { repoRoot, manifest } = await createFixture();
    const twilio = manifest.providers.find((provider) => provider.provider === 'twilio')!;
    twilio.receipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/twilio-generic.json', {
      kind: 'provider-lifecycle', result: 'pass', candidateSha: manifest.candidate.sha,
      deploymentId: manifest.artifact.deployment.id, provider: 'twilio', actorClassification: 'canonical-owner',
      observedAt, facts: twilio.facts,
    });
    git(repoRoot, 'add', 'docs/qa/releases/evidence/twilio-generic.json');
    git(repoRoot, 'commit', '--quiet', '-m', 'generic Twilio receipt');
    await expect(validateReleaseManifest(manifest, { repoRoot })).rejects.toThrow(/twilio-readiness/i);
  });

  it('rejects incomplete or false-green Twilio-specific readiness facts', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    const twilio = invalid.providers.find((provider) => provider.provider === 'twilio')!;
    delete twilio.facts.statusCallback;
    twilio.facts.realNumberUat = 'not-run';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/Twilio facts|Ready Twilio evidence/i);
  });

  it('rejects generic lifecycle receipts and incomplete facts for Meta readiness', async () => {
    const { repoRoot, manifest } = await createFixture();
    const meta = manifest.providers.find((provider) => provider.provider === 'meta')!;
    meta.receipt = await writeJson(repoRoot, 'docs/qa/releases/evidence/meta-generic.json', {
      kind: 'provider-lifecycle', result: 'pass', candidateSha: manifest.candidate.sha,
      deploymentId: manifest.artifact.deployment.id, provider: 'meta', actorClassification: 'canonical-owner',
      observedAt, facts: { businessVerification: 'approved', appReview: 'approved', realAccountUat: 'pass' },
    });
    meta.facts = { businessVerification: 'approved', appReview: 'approved', realAccountUat: 'pass' };
    git(repoRoot, 'add', 'docs/qa/releases/evidence/meta-generic.json');
    git(repoRoot, 'commit', '--quiet', '-m', 'generic Meta receipt');
    await expect(validateReleaseManifest(manifest, { repoRoot })).rejects.toThrow(/meta-readiness|Meta facts/i);
  });

  it('rejects stale provider evidence', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.providers[0]!.observedAt = new Date(Date.parse(invalid.candidate.createdAt) - 86_400_001).toISOString();
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/24 hours old/i);
  });

  it('rejects incomplete authenticated responsive UAT', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.uat.results = invalid.uat.results.filter((result) => !(result.route === 'connections' && result.width === 414));
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/UAT route-width results/i);
  });

  it('rejects a UAT cell without outcome, health, readiness, and bound evidence', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.uat.results[0]!.health = 'degraded' as 'healthy';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/health must be healthy/i);
  });

  it('rejects UAT cells without explicit browser, device, safe-area, and overflow evidence', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.uat.results[0]!.browserVersion = '';
    invalid.uat.results[0]!.safeArea.respected = false as true;
    invalid.uat.results[0]!.overflow.horizontal = 'present' as 'none';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/browserVersion|safeArea|overflow/i);
  });

  it('requires separate iPhone 11 Safari browser and installed-PWA proof', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.uat.iphone11.installedPwa.displayMode = 'browser' as 'standalone';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/installedPwa.*standalone/i);
  });

  it('fails required manifest-tree validation when no canonical manifest is tracked', async () => {
    const { repoRoot, manifest } = await createFixture();
    await expect(validateReleaseManifestTree({ repoRoot, requireManifest: true, expectedSha: manifest.candidate.sha }))
      .rejects.toThrow(/requires the tracked canonical manifest for exact candidate/i);
    await expect(validateReleaseManifestTree({ repoRoot, requireManifest: true })).rejects.toThrow(/must declare the exact expected candidate SHA/i);
    await expect(validateReleaseManifestTree({ repoRoot })).resolves.toBe(0);
  });

  it('does not let a valid historical manifest satisfy an exact expected-SHA CI gate', async () => {
    const { repoRoot, manifest } = await createFixture();
    await writeJson(repoRoot, canonicalManifestPath(manifest.candidate.sha), manifest);
    git(repoRoot, 'add', canonicalManifestPath(manifest.candidate.sha));
    git(repoRoot, 'commit', '--quiet', '-m', 'historical release manifest');
    const expectedSha = git(repoRoot, 'rev-parse', 'HEAD');

    await expect(validateReleaseManifestTree({ repoRoot, requireManifest: true, expectedSha }))
      .rejects.toThrow(/historical manifests do not satisfy/i);
    await expect(validateReleaseManifestTree({ repoRoot, requireManifest: true, expectedSha: manifest.candidate.sha }))
      .resolves.toBe(1);
  });

  it('accepts only the canonical exact-SHA manifest path', async () => {
    const { repoRoot, manifest } = await createFixture();
    expect(validateManifestPath(repoRoot, canonicalManifestPath(manifest.candidate.sha), manifest.candidate.sha))
      .toBe(join(repoRoot, canonicalManifestPath(manifest.candidate.sha)));
    expect(() => validateManifestPath(repoRoot, `docs/qa/releases/${manifest.candidate.sha}/other.json`, manifest.candidate.sha))
      .toThrow(/must be exactly/i);
    expect(() => validateManifestPath(repoRoot, `docs/qa/releases/${manifest.candidate.sha}/../${manifest.candidate.sha}/release-manifest.json`, manifest.candidate.sha))
      .toThrow(/must be exactly/i);
    expect(() => validateManifestPath(repoRoot, `docs/qa/releases/${manifest.candidate.sha}%2frelease-manifest.json`, manifest.candidate.sha))
      .toThrow(/must be exactly/i);
  });

  it('rejects receipt traversal even when it resolves inside the repository', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.providers[0]!.receipt.path = 'docs/qa/releases/evidence/../evidence/google-provider.json';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toThrow(/path/i);
  });

  it('reports all failures as a fail-closed validation error', async () => {
    const { repoRoot, manifest } = await createFixture();
    const invalid = cloneManifest(manifest);
    invalid.candidate.clean = false as true;
    invalid.gates[0]!.result = 'fail' as 'pass';
    await expect(validateReleaseManifest(invalid, { repoRoot })).rejects.toBeInstanceOf(ManifestValidationError);
  });
});
