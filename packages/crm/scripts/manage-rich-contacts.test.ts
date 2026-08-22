import { describe, expect, it } from 'vitest';
import { runRichContactCli } from './manage-rich-contacts.ts';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, writeOut: (value: string) => stdout.push(value), writeErr: (value: string) => stderr.push(value) };
}

describe('rich contact lifecycle CLI', () => {
  it('lists canonical legacy contact points in a stable envelope', async () => {
    const output = capture();
    const code = await runRichContactCli(['points-list', '--contact-id', 'c-monroe'], {
      stdout: output.writeOut,
      stderr: output.writeErr,
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    });
    const envelope = JSON.parse(output.stdout[0] ?? '{}') as { ok?: boolean; resource?: string; result?: unknown[] };
    expect(code).toBe(0);
    expect(envelope).toMatchObject({ ok: true, resource: 'rich-contacts' });
    expect(envelope.result?.length).toBeGreaterThan(0);
    expect(output.stderr).toEqual([]);
  });

  it('fails closed for live execution until the authenticated adapter is wired', async () => {
    const output = capture();
    const code = await runRichContactCli(['points-list', '--contact-id', 'c-monroe', '--live'], {
      stdout: output.writeOut,
      stderr: output.writeErr,
    });
    expect(code).toBe(2);
    expect(JSON.parse(output.stderr[0] ?? '{}')).toMatchObject({ ok: false, mode: 'live-authenticated' });
  });

  it('rejects an unknown command with the usage exit code', async () => {
    const output = capture();
    const code = await runRichContactCli(['destroy'], { stdout: output.writeOut, stderr: output.writeErr });
    expect(code).toBe(2);
    expect(JSON.parse(output.stderr[0] ?? '{}')).toMatchObject({ ok: false, code: 'invalid-input' });
  });
});
