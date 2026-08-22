import { describe, expect, it } from 'vitest';
import { runMetaCli } from './manage-meta';

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, target: {
    stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value),
  } };
}

describe('Meta CLI', () => {
  it('reports inbound-only provider-disabled truth without a guessed version', async () => {
    const capture = output();
    expect(await runMetaCli(['status'], capture.target)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!).result).toMatchObject({
      enabled: false, inboundOnly: true, graphVersion: 'NOT_AVAILABLE',
      leadAds: false, outboundReplies: false, personalAccounts: false,
    });
  });

  it('shows exact least-privilege permissions per selected business channel', async () => {
    const capture = output();
    expect(await runMetaCli(['permissions', '--channels', 'instagram-business'], capture.target)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!).result.requestedPermissions).toEqual([
      'instagram_business_basic', 'instagram_business_manage_messages',
    ]);
  });

  it('fails closed when version authority is unavailable', async () => {
    const capture = output();
    expect(await runMetaCli(['version', '--live'], capture.target)).not.toBe(0);
    expect(JSON.parse(capture.stderr[0]!)).toMatchObject({ ok: false });
  });
});
