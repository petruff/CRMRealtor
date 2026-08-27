import { describe, expect, it } from 'vitest';
import {
  OMNIX_CITATION_SCHEMA_VERSION,
  OMNIX_COPILOT_FIXED_ALIASES,
  OMNIX_COPILOT_SCHEMA_VERSION,
  createOmnixCopilotAlert,
  createOmnixCopilotCitation,
  createOmnixCopilotErrorResponse,
  createOmnixCopilotRequest,
  createOmnixCopilotSuccessResponse,
  dedupeOmnixCopilotAlerts,
  parseOmnixCopilotDate,
  parseOmnixCopilotQuestion,
  type OmnixCopilotAnswerBlock,
  type OmnixCopilotRequest,
} from './omnix-copilot';
import { runOmnixCopilotCli } from '../../scripts/omnix-copilot-cli';

const asOf = '2026-08-11T14:30:00.000Z';

describe('Omnix copilot fixed grammar', () => {
  it.each([
    ['brief', { kind: 'brief', date: 'today' }],
    ['brief today', { kind: 'brief', date: 'today' }],
    ['brief 2026-08-12', { kind: 'brief', date: '2026-08-12' }],
    ['alerts', { kind: 'alerts', date: 'today' }],
    ['alerts 2026-08-12', { kind: 'alerts', date: '2026-08-12' }],
    ['find contact Alicia Monroe', { kind: 'find-contact', query: 'Alicia Monroe' }],
    ['pipeline', { kind: 'pipeline' }],
    ['tasks overdue', { kind: 'tasks', window: 'overdue' }],
    ['send an email to all contacts', { kind: 'campaigns' }],
    ['tasks today', { kind: 'tasks', window: 'today' }],
    ['tasks upcoming', { kind: 'tasks', window: 'upcoming' }],
    ['tasks from 2026-08-12 to 2026-08-19', {
      kind: 'tasks-range', from: '2026-08-12', to: '2026-08-19',
    }],
    ['dates today', { kind: 'dates', window: 'today' }],
    ['dates upcoming', { kind: 'dates', window: 'upcoming' }],
    ['mailers', { kind: 'mailers' }],
    ['mailers m-dec', { kind: 'mailers', campaignId: 'm-dec' }],
    ['activity contact-1', { kind: 'activity', contactId: 'contact-1' }],
    ['connections', { kind: 'connections' }],
    ['help', { kind: 'help' }],
  ])('parses canonical phrase %s', (question, intent) => {
    expect(parseOmnixCopilotQuestion(question)).toEqual(intent);
  });

  it.each([
    ['what should I do today', { kind: 'brief', date: 'today' }],
    ['what are my priorities today?', { kind: 'brief', date: 'today' }],
    ['Show me my priorities today', { kind: 'brief', date: 'today' }],
    ['what do I need to do today?', { kind: 'brief', date: 'today' }],
    ['what needs my attention today?', { kind: 'brief', date: 'today' }],
    ['who needs attention', { kind: 'alerts', date: 'today' }],
    ['who needs my attention?', { kind: 'alerts', date: 'today' }],
    ['who needs my attention today?', { kind: 'alerts', date: 'today' }],
    ['show overdue follow-ups', { kind: 'tasks', window: 'overdue' }],
    ['which tasks are overdue?', { kind: 'tasks', window: 'overdue' }],
    ['what tasks are overdue?', { kind: 'tasks', window: 'overdue' }],
    ["show today's tasks", { kind: 'tasks', window: 'today' }],
    ['show upcoming dates', { kind: 'dates', window: 'upcoming' }],
    ['show pipeline', { kind: 'pipeline' }],
    ['show me my pipeline', { kind: 'pipeline' }],
    ['what does my pipeline look like?', { kind: 'pipeline' }],
    ['what is my pipeline?', { kind: 'pipeline' }],
    ['show mailers', { kind: 'mailers' }],
    ['show recent activity for contact-1', { kind: 'activity', contactId: 'contact-1' }],
    ['connection status', { kind: 'connections' }],
  ])('maps exact alias %s', (question, intent) => {
    expect(parseOmnixCopilotQuestion(question)).toEqual(intent);
  });

  it('documents the exact fixed alias table', () => {
    expect(OMNIX_COPILOT_FIXED_ALIASES).toHaveLength(23);
  });

  it('normalizes case, whitespace and terminal punctuation only', () => {
    expect(parseOmnixCopilotQuestion('  SHOW   PIPELINE?!  ')).toEqual({ kind: 'pipeline' });
    expect(parseOmnixCopilotQuestion('Find Contact José da Silva.')).toEqual({
      kind: 'find-contact', query: 'José da Silva',
    });
    expect(parseOmnixCopilotQuestion('contact profile Judith Serna')).toEqual({
      kind: 'contact-profile', query: 'Judith Serna',
    });
    expect(parseOmnixCopilotQuestion('Activity Contact-ABC')).toEqual({
      kind: 'activity', contactId: 'Contact-ABC',
    });
  });

  it('keeps HTML, path and SQL-looking payloads inert inside an explicit contact query', () => {
    for (const query of ['<script>alert(1)</script>', '../../contacts', 'select * from contacts']) {
      expect(parseOmnixCopilotQuestion(`find contact ${query}`)).toEqual({
        kind: 'find-contact', query,
      });
    }
  });

  it('rejects unsupported, ambiguous, empty, control and oversized input', () => {
    expect(() => parseOmnixCopilotQuestion('show everything')).toThrow(/couldn't match/i);
    expect(() => parseOmnixCopilotQuestion('show pipeline and mailers')).toThrow(/couldn't match/i);
    expect(() => parseOmnixCopilotQuestion('')).toThrow(/question is invalid/i);
    expect(() => parseOmnixCopilotQuestion('pipeline\nmailers')).toThrow(/control characters/i);
    expect(() => parseOmnixCopilotQuestion(`find contact ${'x'.repeat(190)}`)).toThrow(/question is invalid/i);
  });

  it('validates calendar dates and ordered task ranges', () => {
    expect(parseOmnixCopilotDate('2028-02-29')).toBe('2028-02-29');
    expect(() => parseOmnixCopilotDate('2026-02-29')).toThrow(/valid calendar date/i);
    expect(() => parseOmnixCopilotQuestion('tasks from 2026-08-20 to 2026-08-12'))
      .toThrow(/end on or after/i);
  });
});

describe('Omnix copilot contracts', () => {
  it('creates a stable request without retaining the raw question', () => {
    const request = createOmnixCopilotRequest({
      command: 'ask',
      question: 'show pipeline',
      live: true,
      correlationId: 'corr-1',
      now: new Date(asOf),
    });
    expect(request).toEqual({
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask',
      intent: { kind: 'pipeline' },
      correlationId: 'corr-1',
      dataMode: 'live',
      asOf,
    });
    expect(request).not.toHaveProperty('question');
  });

  it('enforces command-specific options', () => {
    expect(() => createOmnixCopilotRequest({
      command: 'ask', question: 'pipeline', today: '2026-08-11', correlationId: 'corr-1',
    })).toThrow(/not valid for ask/i);
    expect(() => createOmnixCopilotRequest({ command: 'brief', question: 'pipeline', correlationId: 'corr-1' }))
      .toThrow(/only for ask/i);
    expect(() => createOmnixCopilotRequest({ command: 'help', today: '2026-08-11', correlationId: 'corr-1' }))
      .toThrow(/not valid for help/i);
  });

  it('constructs record citations with exact fact keys and safe product targets', () => {
    const citation = createOmnixCopilotCitation({
      entityType: 'contact',
      recordId: 'contact-1',
      factKeys: ['pipelineStage', 'nextTouchAt', 'pipelineStage'],
      sourceTimestamp: '2026-08-10T10:00:00.000Z',
      responseAsOf: asOf,
      target: '/contacts/contact-1',
      rule: 'pipeline-missing-next-touch',
    });
    expect(citation).toMatchObject({
      schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
      entityType: 'contact',
      recordId: 'contact-1',
      factKeys: ['pipelineStage', 'nextTouchAt'],
      responseAsOf: asOf,
      target: '/contacts/contact-1',
    });
    expect(() => createOmnixCopilotCitation({
      entityType: 'contact', recordId: 'contact-1', factKeys: ['id'], responseAsOf: asOf,
      target: 'https://example.com',
    })).toThrow(/safe in-product path/i);
  });

  it('derives deterministic alert IDs and deduplicates by rule, record and day', () => {
    const citation = createOmnixCopilotCitation({
      entityType: 'task', recordId: 'task-1', factKeys: ['dueAt'], responseAsOf: asOf,
      target: '/workspace', rule: 'task-overdue',
    });
    const create = (order: number) => createOmnixCopilotAlert({
      rule: 'task-overdue', category: 'task', priority: 'urgent', order,
      reason: 'Task due time is before the response clock.', asOf, recordId: 'task-1',
      href: '/workspace', citations: [citation],
    });
    expect(create(2).id).toBe('alert:task-overdue:task-1:2026-08-11');
    expect(dedupeOmnixCopilotAlerts([create(2), create(1)])).toEqual([create(2)]);
  });

  it('builds the stable success envelope and aggregates nested citations', () => {
    const request = createOmnixCopilotRequest({
      command: 'brief', correlationId: 'corr-1', now: new Date(asOf),
    });
    const citation = createOmnixCopilotCitation({
      entityType: 'contact', recordId: 'contact-1', factKeys: ['id'], responseAsOf: asOf,
      target: '/contacts/contact-1', rule: 'workspace-snapshot',
    });
    const block: OmnixCopilotAnswerBlock = {
      id: 'brief-summary', kind: 'summary', title: 'Today', detail: 'One contact needs review.',
      items: [], citations: [citation],
    };
    expect(createOmnixCopilotSuccessResponse(request, { answerBlocks: [block] })).toMatchObject({
      ok: true,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'brief',
      resolvedIntent: { kind: 'brief', date: 'today' },
      correlationId: 'corr-1',
      dataMode: 'sample',
      asOf,
      citations: [citation],
      suggestions: [],
      warnings: [],
      alerts: [],
    });
  });

  it('redacts unknown failures while retaining stable error metadata', () => {
    const envelope = createOmnixCopilotErrorResponse({
      command: 'ask', correlationId: 'corr-1', dataMode: 'sample', asOf,
      error: new Error('contact PII and implementation detail'),
    });
    expect(envelope).toMatchObject({
      ok: false,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask',
      code: 'internal-error',
      message: 'The Omnix copilot request failed safely.',
    });
    expect(JSON.stringify(envelope)).not.toContain('contact PII');
  });
});

describe('Omnix copilot CLI adapter', () => {
  it('emits the stable sample success envelope through an injectable executor', async () => {
    const output: string[] = [];
    const requests: OmnixCopilotRequest[] = [];
    const code = await runOmnixCopilotCli(['brief', '--today', '2026-08-11'], {
      execute: async (request) => {
        requests.push(request);
        return createOmnixCopilotSuccessResponse(request, { answerBlocks: [] });
      },
      now: () => new Date(asOf),
      correlationId: () => 'corr-cli-1',
      stdout: (value) => output.push(value),
    });
    expect(code).toBe(0);
    expect(requests).toEqual([expect.objectContaining({
      command: 'brief', dataMode: 'sample', correlationId: 'corr-cli-1',
      intent: { kind: 'brief', date: '2026-08-11' },
    })]);
    expect(JSON.parse(output.join(''))).toMatchObject({
      ok: true, schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION, dataMode: 'sample',
    });
  });

  it('passes explicit live mode to the application-service seam', async () => {
    let received: OmnixCopilotRequest | undefined;
    const code = await runOmnixCopilotCli(['ask', '--question', 'show pipeline', '--live'], {
      execute: async (request) => {
        received = request;
        return createOmnixCopilotSuccessResponse(request, { answerBlocks: [] });
      },
      now: () => new Date(asOf),
      correlationId: () => 'corr-cli-live',
      stdout: () => {},
    });
    expect(code).toBe(0);
    expect(received).toMatchObject({ dataMode: 'live', intent: { kind: 'pipeline' } });
  });

  it('returns a non-zero unsupported-intent envelope without invoking the service', async () => {
    const errors: string[] = [];
    const telemetry: string[] = [];
    let calls = 0;
    const code = await runOmnixCopilotCli(['ask', '--question', 'do everything'], {
      execute: async (request) => {
        calls += 1;
        return createOmnixCopilotSuccessResponse(request, { answerBlocks: [] });
      },
      now: () => new Date(asOf),
      correlationId: () => 'corr-cli-error',
      stdout: (value) => errors.push(value),
      stderr: (value) => telemetry.push(value),
      monotonicNow: (() => {
        const values = [10, 14];
        return () => values.shift() ?? 14;
      })(),
    });
    expect(code).toBe(2);
    expect(calls).toBe(0);
    expect(JSON.parse(errors.join(''))).toMatchObject({
      ok: false, code: 'unsupported-intent', command: 'ask', dataMode: 'sample',
    });
    expect(JSON.parse(telemetry.join(''))).toMatchObject({
      schema: 'omnix-copilot-telemetry.v1',
      correlationId: 'corr-cli-error',
      workspaceId: 'unresolved',
      membershipId: 'unresolved',
      resolvedIntent: 'unresolved',
      mode: 'sample',
      outcome: 'failure',
      resultCount: 0,
      citationCount: 0,
      durationMs: 4,
      errorCategory: 'unsupported-intent',
    });
    expect(telemetry.join('')).not.toContain('do everything');
  });

  it('rejects duplicate, missing and command-incompatible options', async () => {
    const invalid = [
      ['ask', '--question', 'pipeline', '--question', 'mailers'],
      ['ask'],
      ['brief', '--question', 'pipeline'],
      ['help', '--live'],
    ];
    for (const argv of invalid) {
      const code = await runOmnixCopilotCli(argv, {
        execute: async (request) => createOmnixCopilotSuccessResponse(request, { answerBlocks: [] }),
        now: () => new Date(asOf),
        correlationId: () => 'corr-cli-invalid',
        stdout: () => {},
        stderr: () => {},
      });
      expect(code).toBe(2);
    }
  });

  it('redacts unexpected executor failures', async () => {
    const errors: string[] = [];
    const telemetry: string[] = [];
    const code = await runOmnixCopilotCli(['ask', '--question', 'pipeline'], {
      execute: async () => { throw new Error('secret contact note'); },
      now: () => new Date(asOf),
      correlationId: () => 'corr-cli-failure',
      stdout: (value) => errors.push(value),
      stderr: (value) => telemetry.push(value),
    });
    expect(code).toBe(1);
    expect(errors.join('')).not.toContain('secret contact note');
    expect(JSON.parse(errors.join(''))).toMatchObject({ code: 'internal-error' });
    expect(telemetry).toEqual([]);
  });
});
