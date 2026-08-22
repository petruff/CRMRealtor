import { describe, expect, it } from 'vitest';
import { runTextingCli } from './manage-texting';

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, deps: {
    stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value),
  } };
}

describe('texting CLI', () => {
  it('reports provider-disabled truth separately from the device sms fallback', async () => {
    const capture = output();
    expect(await runTextingCli(['status'], capture.deps)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({ result: {
      enabled: false, mode: 'provider-disabled', deviceSmsFallbackIsProviderSend: false,
    } });
  });

  it('offers deterministic quiet-hours preview before any provider access', async () => {
    const capture = output();
    expect(await runTextingCli([
      'quiet-hours', '--time-zone', 'America/New_York', '--start', '20:00', '--end', '08:00',
      '--at', '2026-08-13T02:00:00Z',
    ], capture.deps)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!).result).toMatchObject({ allowed: false, reason: 'inside-quiet-hours' });
  });

  it('fails closed before a live probe when provider approvals/configuration are absent', async () => {
    const capture = output();
    expect(await runTextingCli(['probe', '--live'], capture.deps)).not.toBe(0);
    expect(JSON.parse(capture.stderr[0]!)).toMatchObject({ ok: false });
  });

  it('exposes consent, prepare, approve, conversation, reconcile and disable as live-only CLI commands', async () => {
    const commands = ['configure', 'consent', 'prepare', 'approve', 'uat', 'conversation', 'reconcile', 'disable'] as const;
    for (const command of commands) {
      const capture = output();
      expect(await runTextingCli([command], capture.deps)).not.toBe(0);
      expect(JSON.parse(capture.stderr[0]!)).toMatchObject({ ok: false, resource: 'connectors', code: 'provider-disabled' });
    }
    const capture = output();
    const calls: string[] = [];
    expect(await runTextingCli(['reconcile', '--live'], {
      ...capture.deps, liveOperation: async (command) => { calls.push(command); return { scheduled: 1 }; },
    })).toBe(0);
    expect(calls).toEqual(['reconcile']);
  });
});
