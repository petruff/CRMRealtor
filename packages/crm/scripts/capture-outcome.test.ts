import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCaptureOutcomeCli } from './capture-outcome';
vi.mock('server-only', () => ({}));
describe('Capture Outcome CLI boundary', () => {
  it('runs the actual Node strip-types CLI help without runtime syntax errors', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./capture-outcome.ts', import.meta.url)), '--help'], { encoding: 'utf8', timeout: 15000 });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('Usage: npm run omnix:capture');
  });
  it('shows help without loading credentials or reading input', async () => {
    const deps = { context: vi.fn(), readInput: vi.fn(), stdout: vi.fn() };
    expect(await runCaptureOutcomeCli(['--help'], deps)).toBe(0);
    expect(deps.context).not.toHaveBeenCalled(); expect(deps.readInput).not.toHaveBeenCalled();
  });
  it('rejects caller-supplied workspace authority without loading the service', async () => {
    const deps = { context: vi.fn(), readInput: vi.fn().mockResolvedValue('{"workspaceId":"other"}'), stdout: vi.fn() };
    expect(await runCaptureOutcomeCli(['--live', 'analyze'], deps)).toBe(1);
    expect(deps.context).not.toHaveBeenCalled();
  });
});
