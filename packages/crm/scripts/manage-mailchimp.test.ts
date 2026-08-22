import { describe, expect, it } from 'vitest';
import { runMailchimpCli } from './manage-mailchimp';

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, deps: {
    stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value),
    now: () => new Date('2026-08-11T12:00:00Z'),
  } };
}

describe('Mailchimp CLI', () => {
  it('reports truthful provider-disabled status', async () => {
    const capture = output();
    expect(await runMailchimpCli(['status'], capture.deps)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      ok: true, command: 'mailchimp.status', durable: false,
      result: { enabled: false, mode: 'provider-disabled' },
    });
  });

  it('creates an email-free preview through the CLI contract', async () => {
    const capture = output();
    const binding = JSON.stringify({
      connectionId: 'connection-a', accountIdHash: 'a'.repeat(64), dataCenter: 'us21',
      audienceId: 'audience-a', audienceName: 'Primary', mappingVersion: 1,
      selectedAt: '2026-08-11T12:00:00Z',
    });
    const contacts = JSON.stringify([{ normalizedEmail: 'buyer@example.com', leadType: 'hot' }]);
    expect(await runMailchimpCli(['preview', '--binding-json', binding, '--contacts-json', contacts], capture.deps)).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({ result: { count: 1, containsRawEmails: false } });
    expect(capture.stdout[0]).not.toContain('buyer@example.com');
  });

  it('fails closed before any live provider operation', async () => {
    const capture = output();
    expect(await runMailchimpCli(['preview', '--live'], capture.deps)).toBe(3);
    expect(JSON.parse(capture.stderr[0]!)).toMatchObject({
      ok: false, durable: true, code: 'provider-disabled',
    });
  });

  it('uses an injected authenticated live seam for bounded audience listing', async () => {
    const capture = output();
    const liveList = async () => [{ id: 'audience-a', name: 'Primary', memberCount: 12 }];
    expect(await runMailchimpCli([
      'audiences', '--live', '--connection-id', 'connection-a', '--limit', '25',
    ], { ...capture.deps, liveList })).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      durable: true,
      command: 'mailchimp.audiences',
      result: [{ id: 'audience-a', name: 'Primary' }],
    });
  });

  it('uses an injected live provider probe and returns only redacted health', async () => {
    const capture = output();
    expect(await runMailchimpCli([
      'probe', '--live', '--connection-id', 'connection-a',
    ], { ...capture.deps, liveProbe: async () => ({
      connectionId: 'connection-a', healthy: true, status: 'active',
      probedAt: '2026-08-11T12:00:00.000Z',
    }) })).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      command: 'mailchimp.probe',
      result: { connectionId: 'connection-a', healthy: true, status: 'active' },
    });
    expect(capture.stdout[0]).not.toMatch(/token|secret|email/i);
  });

  it('previews count-only backfill and approves the exact snapshot through live seams', async () => {
    const preview = output();
    expect(await runMailchimpCli([
      'preview-backfill', '--live', '--connection-id', 'connection-a', '--mode', 'tag-reconcile', '--limit', '50',
    ], { ...preview.deps, liveBackfillPreview: async (input) => ({
      ...input, runId: 'run-a', snapshotHash: 'a'.repeat(64), mappingVersion: 1,
      eligibleCount: 20, containsRawEmails: false,
    }) })).toBe(0);
    expect(JSON.parse(preview.stdout[0]!)).toMatchObject({
      command: 'mailchimp.preview-backfill',
      result: { runId: 'run-a', eligibleCount: 20, containsRawEmails: false },
    });

    const approve = output();
    expect(await runMailchimpCli([
      'approve-backfill', '--live', '--run-id', 'run-a', '--snapshot-hash', 'a'.repeat(64), '--mapping-version', '1',
    ], { ...approve.deps, liveBackfillApprove: async (input) => ({ ...input, state: 'approved' }) })).toBe(0);
    expect(JSON.parse(approve.stdout[0]!)).toMatchObject({
      command: 'mailchimp.approve-backfill', result: { runId: 'run-a', state: 'approved' },
    });
  });

  it('reports redacted live connection, audience, webhook and reconciliation health', async () => {
    const capture = output();
    expect(await runMailchimpCli(['status', '--live', '--connection-id', 'connection-a'], {
      ...capture.deps,
      liveHealth: async (connectionId) => ({
        provider: 'mailchimp',
        connection: { id: connectionId, status: 'active', accountIdHash: 'a'.repeat(64), grantedScopes: [] },
        audience: { id: 'audience-a', name: 'Primary', mappingVersion: 1 },
        webhook: { endpointBound: true, registrationRequired: false, secretVersion: 2 },
        lastReconciliation: { id: 'run-a', state: 'succeeded', itemsApplied: 12 },
      }),
    })).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      durable: true,
      command: 'mailchimp.status',
      result: {
        connection: { id: 'connection-a', status: 'active' },
        audience: { id: 'audience-a', mappingVersion: 1 },
        webhook: { endpointBound: true },
        lastReconciliation: { state: 'succeeded', itemsApplied: 12 },
      },
    });
  });

  it('uses explicit server-only seams for webhook setup and a bounded baseline page', async () => {
    const setupCapture = output();
    expect(await runMailchimpCli([
      'setup-webhook', '--live', '--connection-id', 'connection-a',
    ], { ...setupCapture.deps, liveWebhookSetup: async () => ({ ready: true }) })).toBe(0);
    expect(JSON.parse(setupCapture.stdout[0]!)).toMatchObject({
      command: 'mailchimp.setup-webhook', result: { ready: true },
    });

    const baselineCapture = output();
    expect(await runMailchimpCli([
      'baseline', '--live', '--connection-id', 'connection-a', '--offset', '0', '--limit', '50',
    ], { ...baselineCapture.deps, liveBaseline: async (input) => input })).toBe(0);
    expect(JSON.parse(baselineCapture.stdout[0]!)).toMatchObject({
      command: 'mailchimp.baseline', result: { connectionId: 'connection-a', offset: 0, limit: 50 },
    });

    const invalidOffset = output();
    expect(await runMailchimpCli([
      'baseline', '--live', '--connection-id', 'connection-a', '--offset', '100', '--limit', '50',
    ], { ...invalidOffset.deps, liveBaseline: async (input) => input })).toBe(2);
    expect(JSON.parse(invalidOffset.stderr[0]!)).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
  });

  it('exposes redacted CLI-first OAuth start and completion seams', async () => {
    const start = output();
    expect(await runMailchimpCli(['oauth-start', '--live'], {
      ...start.deps,
      liveOAuthStart: async () => ({
        connectionId: 'connection-a',
        authorizationUrl: 'https://login.mailchimp.com/oauth2/authorize?state=opaque',
        expiresAt: '2026-08-11T12:10:00.000Z',
      }),
    })).toBe(0);
    expect(JSON.parse(start.stdout[0]!)).toMatchObject({
      command: 'mailchimp.oauth-start',
      result: { connectionId: 'connection-a' },
    });

    const complete = output();
    expect(await runMailchimpCli([
      'oauth-complete', '--live', '--state', 'state-a', '--code', 'code-a',
    ], {
      ...complete.deps,
      liveOAuthComplete: async () => ({
        connectionId: 'connection-a', accountName: 'Brokerage', dataCenter: 'us21',
      }),
    })).toBe(0);
    expect(JSON.parse(complete.stdout[0]!)).toMatchObject({
      command: 'mailchimp.oauth-complete',
      result: { connectionId: 'connection-a', dataCenter: 'us21' },
    });
    expect(complete.stdout[0]).not.toContain('code-a');
  });

  it('queues a periodic reconciliation through the authenticated CLI seam', async () => {
    const capture = output();
    expect(await runMailchimpCli([
      'reconcile', '--live', '--connection-id', 'connection-a', '--limit', '200',
    ], {
      ...capture.deps,
      liveReconcileRequest: async (input) => ({ runId: 'run-a', ...input }),
    })).toBe(0);
    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      command: 'mailchimp.reconcile',
      result: { runId: 'run-a', connectionId: 'connection-a', limit: 200 },
    });
  });
});
