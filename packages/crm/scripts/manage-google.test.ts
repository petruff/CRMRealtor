import { describe, expect, it } from 'vitest';
import { runGoogleCli } from './manage-google';

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, deps: {
    stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value),
  } };
}

describe('Google connector CLI', () => {
  it('separates identity sign-in from disabled connector capability', async () => {
    const capture = output();
    expect(await runGoogleCli(['status'], capture.deps)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      command: 'google.status', result: {
        enabled: false, mode: 'provider-disabled', identitySignInIsConnectorAccess: false,
      },
    });
  });

  it('lists the reviewed incremental scopes and their guided aggregate', async () => {
    const capture = output();
    expect(await runGoogleCli(['scopes'], capture.deps)).toBe(0);
    const result = JSON.parse(capture.stdout[0]!).result;
    expect(result.featureBundles).toHaveLength(5);
    expect(result.featureBundles).toEqual(expect.arrayContaining([
      expect.objectContaining({ bundle: 'workspace-core' }),
    ]));
    expect(result.featureBundles).toEqual(expect.arrayContaining([
      expect.objectContaining({ bundle: 'gmail-insights', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }),
    ]));
    expect(result.restrictedOptIn).toEqual(['gmail-insights']);
  });

  it('starts one injected live feature authorization without leaking credentials', async () => {
    const capture = output();
    expect(await runGoogleCli([
      'oauth-start', '--live', '--bundle', 'gmail-send', '--connection-id', 'connection-a',
    ], { ...capture.deps, liveOAuthStart: async (input) => ({ ...input, authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?...' }) }))
      .toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      command: 'google.oauth-start', durable: true,
      result: { bundle: 'gmail-send', connectionId: 'connection-a' },
    });
    expect(capture.stdout[0]).not.toMatch(/client_secret|refresh_token|access_token/i);
  });

  it('fails closed before provider access when live authority is absent', async () => {
    const capture = output();
    expect(await runGoogleCli(['probe', '--live', '--connection-id', 'connection-a'], capture.deps)).not.toBe(0);
    expect(JSON.parse(capture.stderr[0]!)).toMatchObject({ ok: false });
  });
});
