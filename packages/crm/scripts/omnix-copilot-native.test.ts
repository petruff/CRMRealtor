import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const script = fileURLToPath(new URL('./omnix-copilot.ts', import.meta.url));
describe('native copilot module parity', () => {
  it.each(['workspace overview', 'client status Alicia', 'transactions', 'properties', 'finances', 'nurture', 'proposals'])('runs %s through the real Node CLI with truthful sample coverage', (question) => {
    const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', script, 'ask', '--question', question], { encoding: 'utf8', timeout: 15000 });
    expect(result.status, result.stderr).toBe(0);
    const answer = JSON.parse(result.stdout);
    expect(answer.ok).toBe(true); expect(answer.dataMode).toBe('sample');
    expect(answer.answerBlocks.length).toBeGreaterThan(0);
    expect(answer.warnings.every((warning: { message: string }) => !warning.message.includes('secret'))).toBe(true);
  });
});
