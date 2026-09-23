import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Omnix AI evaluation script', () => {
  it('loads through the production Node entrypoint and prints help without workspace authority', () => {
    const result = spawnSync(process.execPath, [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--experimental-strip-types',
      join(process.cwd(), 'scripts', 'evaluate-omnix-ai.ts'),
      '--help',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: npm run omnix:ai:eval');
  });
});
