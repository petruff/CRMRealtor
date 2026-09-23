import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const sourceScript = fileURLToPath(new URL('./run-supabase-ci.sh', import.meta.url));
const ordinaryCiWorkflow = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const releaseEvidenceWorkflow = fileURLToPath(new URL('../../../.github/workflows/release-evidence.yml', import.meta.url));

function bashExecutable(): string {
  if (process.platform !== 'win32') return 'bash';
  const gitCommand = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).split(/\r?\n/u).find(Boolean);
  const gitBash = gitCommand ? resolve(dirname(gitCommand), '..', 'bin', 'bash.exe') : '';
  if (!gitBash || !existsSync(gitBash)) throw new Error('Git for Windows Bash is required for the Supabase CI shell tests.');
  return gitBash;
}

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

async function fixture(includeForwardRepair: boolean) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'crm-supabase-recovery-'));
  temporaryRoots.push(repoRoot);
  const packageRoot = join(repoRoot, 'packages/crm');
  await mkdir(join(packageRoot, 'scripts'), { recursive: true });
  await mkdir(join(packageRoot, 'supabase/migrations'), { recursive: true });
  await mkdir(join(packageRoot, 'supabase/rollbacks'), { recursive: true });
  await writeFile(join(packageRoot, 'scripts/run-supabase-ci.sh'), await readFile(sourceScript));
  await writeFile(join(repoRoot, 'baseline.txt'), 'baseline\n');
  git(repoRoot, 'init', '--quiet');
  git(repoRoot, 'config', 'user.email', 'supabase-ci@example.invalid');
  git(repoRoot, 'config', 'user.name', 'Supabase CI Test');
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '--quiet', '-m', 'baseline');
  const baseSha = git(repoRoot, 'rev-parse', 'HEAD');

  const migrationName = '20260826000100_candidate_recovery';
  await writeFile(join(packageRoot, `supabase/migrations/${migrationName}.sql`), 'select 1;\n');
  await writeFile(join(packageRoot, `supabase/rollbacks/${migrationName}.rollback.sql`), 'select 1;\n');
  if (includeForwardRepair) {
    await writeFile(join(packageRoot, `supabase/rollbacks/${migrationName}.forward-repair.sql`), 'select 1;\n');
  }
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '--quiet', '-m', 'candidate migration');
  return { repoRoot, packageRoot, baseSha, candidateSha: git(repoRoot, 'rev-parse', 'HEAD'), migrationName };
}

function recoveryPlan(packageRoot: string, baseSha: string, candidateSha: string) {
  return spawnSync(bashExecutable(), ['scripts/run-supabase-ci.sh'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, MIGRATION_BASE_SHA: baseSha, MIGRATION_CANDIDATE_SHA: candidateSha, SUPABASE_CI_RECOVERY_PLAN_ONLY: 'true' },
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })));
});

describe('Supabase candidate recovery planning', () => {
  it('reasserts local database readiness before recovery rehearsal', async () => {
    const script = await readFile(sourceScript, 'utf8');
    const initialDatabaseTests = script.lastIndexOf('\nrun_database_tests\n', script.indexOf('if (( ${#candidate_migrations[@]} > 0 ));'));
    const readinessCheck = script.indexOf('ensure_local_database_ready', initialDatabaseTests);
    const rollbackRehearsal = script.indexOf('Rehearsing containment rollback', initialDatabaseTests);

    expect(initialDatabaseTests).toBeGreaterThan(-1);
    expect(readinessCheck).toBeGreaterThan(initialDatabaseTests);
    expect(rollbackRehearsal).toBeGreaterThan(readinessCheck);
    expect(script).toContain('set jit = off;');
    expect(script).toContain("grep -E '^1\\.\\.[0-9]+$'");
    expect(script).toContain('Database TAP plan mismatch');
    expect(script).toContain('status -o json');
    expect(script).not.toContain('127.0.0.1:54322');
  });

  it('selects candidate migrations and requires paired rollback plus forward repair', async () => {
    const { packageRoot, baseSha, candidateSha, migrationName } = await fixture(true);
    const result = recoveryPlan(packageRoot, baseSha, candidateSha);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`supabase/migrations/${migrationName}.sql`);
  }, 15_000);

  it('fails closed when a candidate migration has no forward repair', async () => {
    const { packageRoot, baseSha, candidateSha, migrationName } = await fixture(false);
    const result = recoveryPlan(packageRoot, baseSha, candidateSha);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${migrationName}.forward-repair.sql`);
  }, 15_000);

  it('rejects equal, descendant, and sibling recovery bases', async () => {
    const { repoRoot, packageRoot, baseSha, candidateSha } = await fixture(true);
    expect(recoveryPlan(packageRoot, candidateSha, candidateSha).stderr).toContain('strict ancestor');
    expect(recoveryPlan(packageRoot, candidateSha, baseSha).stderr).toContain('strict ancestor');

    const currentBranch = git(repoRoot, 'branch', '--show-current');
    git(repoRoot, 'checkout', '--quiet', '-b', 'sibling-base', baseSha);
    await writeFile(join(repoRoot, 'sibling.txt'), 'sibling\n');
    git(repoRoot, 'add', 'sibling.txt');
    git(repoRoot, 'commit', '--quiet', '-m', 'sibling base');
    const siblingSha = git(repoRoot, 'rev-parse', 'HEAD');
    git(repoRoot, 'checkout', '--quiet', currentBranch);
    expect(recoveryPlan(packageRoot, siblingSha, candidateSha).stderr).toContain('strict ancestor');
  }, 15_000);

  it('fails closed on deleted and renamed migrations', async () => {
    const deletion = await fixture(true);
    await rm(join(deletion.packageRoot, `supabase/migrations/${deletion.migrationName}.sql`));
    git(deletion.repoRoot, 'add', '-u');
    git(deletion.repoRoot, 'commit', '--quiet', '-m', 'delete migration');
    const deletionSha = git(deletion.repoRoot, 'rev-parse', 'HEAD');
    expect(recoveryPlan(deletion.packageRoot, deletion.candidateSha, deletionSha).stderr).toContain('Migration deletion is forbidden');

    const rename = await fixture(true);
    const renamedMigration = `${rename.migrationName}_renamed.sql`;
    git(rename.repoRoot, 'mv',
      `packages/crm/supabase/migrations/${rename.migrationName}.sql`,
      `packages/crm/supabase/migrations/${renamedMigration}`);
    git(rename.repoRoot, 'commit', '--quiet', '-m', 'rename migration');
    const renameSha = git(rename.repoRoot, 'rev-parse', 'HEAD');
    expect(recoveryPlan(rename.packageRoot, rename.candidateSha, renameSha).stderr).toContain('Migration rename is forbidden');
  }, 15_000);

  it('fails when the migration tree differs without a candidate migration SQL file', async () => {
    const { repoRoot, packageRoot, candidateSha } = await fixture(true);
    await mkdir(join(packageRoot, 'supabase/migrations/notes'), { recursive: true });
    await writeFile(join(packageRoot, 'supabase/migrations/notes/README.md'), 'not a migration\n');
    git(repoRoot, 'add', '.');
    git(repoRoot, 'commit', '--quiet', '-m', 'non-migration tree change');
    const changedTreeSha = git(repoRoot, 'rev-parse', 'HEAD');
    const result = recoveryPlan(packageRoot, candidateSha, changedTreeSha);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Migration tree differs without a candidate migration SQL file');
  }, 15_000);
});

describe('Release evidence workflow authority', () => {
  it('keeps ordinary candidate CI free of an impossible in-tree SHA self-reference', async () => {
    const workflow = await readFile(ordinaryCiWorkflow, 'utf8');
    const manifestStep = workflow.slice(workflow.indexOf('Validate any tracked release manifests'));
    expect(manifestStep).toContain('release-manifest.ts validate-tree');
    expect(manifestStep).not.toContain('--require-manifest true');
    expect(manifestStep).not.toContain('--expected-sha "${GITHUB_SHA}"');
  });

  it('keeps exact candidate manifest enforcement in the separate evidence checkout', async () => {
    const workflow = await readFile(releaseEvidenceWorkflow, 'utf8');
    expect(workflow).toContain('Checkout immutable evidence');
    expect(workflow).toContain('Checkout exact candidate');
    expect(workflow).toContain('--expected-sha "${CANDIDATE_SHA}"');
    expect(workflow).toContain('evidence/packages/crm/scripts/release-manifest.ts validate');
  });
});
