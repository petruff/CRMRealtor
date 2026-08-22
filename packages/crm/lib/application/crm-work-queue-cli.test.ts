import { describe, expect, it } from 'vitest';
import { CRM_WORK_QUEUE_CLI_EXIT } from '../../scripts/crm-work-queue-cli';
import { runActivityCli } from '../../scripts/manage-activities';
import { runIncompleteRecordCli } from '../../scripts/manage-incomplete-records';
import { runSmartListCli } from '../../scripts/manage-smart-lists';

function outputHarness() {
  let stdout = '';
  let stderr = '';
  return {
    dependencies: {
      stdout: (value: string) => { stdout += value; },
      stderr: (value: string) => { stderr += value; },
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('CRM work queue CLI', () => {
  it('runs Smart List operations in explicit process-only sample mode', async () => {
    const harness = outputHarness();
    expect(await runSmartListCli(['apply', '--id', 'smart-list-sample-hot'], harness.dependencies))
      .toBe(CRM_WORK_QUEUE_CLI_EXIT.success);
    expect(JSON.parse(harness.stdout())).toMatchObject({
      ok: true,
      schemaVersion: 'crm-work-queue-cli.v1',
      mode: 'sample-process-only',
      durable: false,
      resource: 'smart-lists',
      command: 'apply',
      result: { contactIds: ['contact-hot'], resultLimit: 500 },
    });
    expect(harness.stderr()).toBe('');
  });

  it('does not print incomplete-record PII until show explicitly requests detail', async () => {
    const listHarness = outputHarness();
    expect(await runIncompleteRecordCli(['list'], listHarness.dependencies)).toBe(0);
    expect(listHarness.stdout()).not.toMatch(/Sample|needs-correction@|3055550100/);
    expect(JSON.parse(listHarness.stdout()).result[0]).toMatchObject({
      id: 'incomplete-sample-1', identitySignals: { name: true, email: true, phone: true },
    });

    const showHarness = outputHarness();
    expect(await runIncompleteRecordCli([
      'show', '--id', 'incomplete-sample-1', '--detail',
    ], showHarness.dependencies)).toBe(0);
    expect(showHarness.stdout()).toContain('needs-correction@');
    expect(JSON.parse(showHarness.stdout()).result.detailRequested).toBe(true);
  });

  it('refuses to convert the invalid sample record without an explicit correction', async () => {
    const invalid = outputHarness();
    expect(await runIncompleteRecordCli([
      'convert', '--id', 'incomplete-sample-1', '--idempotency-key', 'invalid-sample',
    ], invalid.dependencies)).toBe(CRM_WORK_QUEUE_CLI_EXIT.usage);
    expect(JSON.parse(invalid.stderr())).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });

    const corrected = outputHarness();
    expect(await runIncompleteRecordCli([
      'convert', '--id', 'incomplete-sample-1', '--idempotency-key', 'corrected-sample',
      '--correction-json', '{"email":"sample@example.com"}',
    ], corrected.dependencies)).toBe(CRM_WORK_QUEUE_CLI_EXIT.success);
    expect(JSON.parse(corrected.stdout())).toMatchObject({
      ok: true,
      result: { action: 'create', status: 'converted', noOp: false },
    });
  });

  it('creates a sample task without a browser and returns one stable JSON document', async () => {
    const harness = outputHarness();
    const exit = await runActivityCli([
      'create', '--title', 'Call lead', '--due-at', '2026-08-12T12:00:00Z',
      '--idempotency-key', 'cli-task-1',
    ], harness.dependencies);
    expect(exit).toBe(0);
    expect(JSON.parse(harness.stdout())).toMatchObject({
      ok: true, mode: 'sample-process-only', resource: 'activities', command: 'create',
      result: { task: { id: 'task-0002', status: 'open' }, event: { type: 'task-created' }, noOp: false },
    });
    expect(harness.stderr()).toBe('');
  });

  it('rejects a sample task assigned to a membership outside the active allowlist', async () => {
    const harness = outputHarness();
    const exit = await runActivityCli([
      'create', '--title', 'Call lead', '--due-at', '2026-08-12T12:00:00Z',
      '--idempotency-key', 'cli-task-revoked',
      '--assignee-membership-id', 'revoked-member',
    ], harness.dependencies);
    expect(exit).toBe(CRM_WORK_QUEUE_CLI_EXIT.forbidden);
    expect(JSON.parse(harness.stderr())).toMatchObject({ ok: false, code: 'forbidden' });
    expect(harness.stdout()).toBe('');
  });

  it('uses stable non-zero exit codes for usage and never silently falls back from live mode', async () => {
    const invalid = outputHarness();
    expect(await runSmartListCli(['create', '--name', 'Bad', '--definition-json', '{'], invalid.dependencies))
      .toBe(CRM_WORK_QUEUE_CLI_EXIT.usage);
    expect(JSON.parse(invalid.stderr())).toMatchObject({ ok: false, code: 'invalid-input' });

    const live = outputHarness();
    expect(await runIncompleteRecordCli(['list', '--live'], live.dependencies))
      .toBe(CRM_WORK_QUEUE_CLI_EXIT.usage);
    expect(JSON.parse(live.stderr())).toMatchObject({
      ok: false, mode: 'live-authenticated', durable: true, code: 'invalid-input',
    });
    expect(live.stdout()).toBe('');
  });

  it('rejects empty and oversized bulk selections before repository mutation', async () => {
    const empty = outputHarness();
    expect(await runActivityCli(['bulk-complete', '--ids', ','], empty.dependencies))
      .toBe(CRM_WORK_QUEUE_CLI_EXIT.usage);
    expect(JSON.parse(empty.stderr())).toMatchObject({ ok: false, code: 'invalid-input' });

    const oversized = outputHarness();
    const ids = Array.from({ length: 101 }, (_, index) => `task-${index}`).join(',');
    expect(await runActivityCli(['bulk-archive', '--ids', ids], oversized.dependencies))
      .toBe(CRM_WORK_QUEUE_CLI_EXIT.usage);
  });
});
