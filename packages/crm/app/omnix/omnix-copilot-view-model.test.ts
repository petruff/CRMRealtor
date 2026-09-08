import { describe, expect, it } from 'vitest';
import {
  isSafeInProductTarget,
  isSafeExternalSourceTarget,
  mapOmnixCopilotEnvelope,
  validateCopilotQuestion,
} from '@/components/omnix-copilot-view-model';
import {
  OMNIX_COPILOT_SCHEMA_VERSION,
  OMNIX_CITATION_SCHEMA_VERSION,
} from '@/lib/domain/omnix-copilot';

describe('validateCopilotQuestion', () => {
  it('accepts a supported printable question', () => {
    expect(validateCopilotQuestion("show today's tasks")).toBeNull();
  });

  it('rejects empty, control-character and oversized questions', () => {
    expect(validateCopilotQuestion('   ')).toMatch(/Enter/);
    expect(validateCopilotQuestion('tasks\nupcoming')).toMatch(/printable/);
    expect(validateCopilotQuestion('x'.repeat(201))).toMatch(/200/);
  });
});

describe('isSafeInProductTarget', () => {
  it('allows only relative in-product targets', () => {
    expect(isSafeInProductTarget('/contacts/c-1')).toBe(true);
    expect(isSafeInProductTarget('//example.com')).toBe(false);
    expect(isSafeInProductTarget('https://example.com')).toBe(false);
  });
});

describe('isSafeExternalSourceTarget', () => {
  it('allows only credential-free HTTPS links', () => {
    expect(isSafeExternalSourceTarget('https://example.gov/report')).toBe(true);
    expect(isSafeExternalSourceTarget('http://example.gov/report')).toBe(false);
    expect(isSafeExternalSourceTarget('https://user:secret@example.gov/report')).toBe(false);
    expect(isSafeExternalSourceTarget('/contacts/c-1')).toBe(false);
  });
});

describe('mapOmnixCopilotEnvelope', () => {
  it('preserves answer evidence and read-only navigation', () => {
    const asOf = '2026-08-11T15:00:00.000Z';
    const citation = {
      id: 'citation:task:t-1:dueAt',
      schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
      entityType: 'task' as const,
      recordId: 't-1',
      factKeys: ['dueAt'],
      responseAsOf: asOf,
      target: '/workspace',
    };
    const result = mapOmnixCopilotEnvelope("show today's tasks", {
      ok: true,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask',
      resolvedIntent: { kind: 'tasks', window: 'today' },
      correlationId: 'corr-1',
      dataMode: 'live',
      asOf,
      answerBlocks: [{
        id: 'tasks-today',
        kind: 'list',
        title: "Today's tasks",
        detail: 'One authorized task is due today.',
        items: [{ id: 't-1', label: 'Call Alicia Morgan', href: '/workspace', citations: [citation] }],
        citations: [citation],
      }],
      citations: [citation],
      suggestions: [{
        id: 'review-tasks',
        kind: 'review-link',
        title: 'Review tasks',
        detail: 'Open the existing work queue.',
        href: '/workspace',
        readOnly: true,
        citations: [citation],
      }],
      warnings: [],
      alerts: [],
    });

    expect(result).toMatchObject({
      status: 'success',
      dataMode: 'live',
      answerBlocks: [{ items: [{ href: '/workspace', citationIds: [citation.id] }] }],
      citations: [{ target: '/workspace', recordId: 't-1', displayLabel: 'Call Alicia Morgan' }],
      suggestions: [{ href: '/workspace' }],
    });
  });

  it('turns an unsupported envelope into a visible supported-question state', () => {
    const result = mapOmnixCopilotEnvelope('invent a campaign', {
      ok: false,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask',
      correlationId: 'corr-2',
      dataMode: 'sample',
      asOf: '2026-08-11T15:00:00.000Z',
      code: 'unsupported-intent',
      message: 'Choose Public web to research this topic.',
      supportedExamples: ['brief today', 'pipeline'],
      warnings: [],
    });

    expect(result.status).toBe('unsupported');
    expect(result.message).toBe('Choose Public web to research this topic.');
    expect(result.answerBlocks[0]).toMatchObject({
      title: 'Try asking in one of these ways',
      items: [
        { label: 'What are my priorities today?' },
        { label: 'Who needs my attention?' },
        { label: 'Which tasks are overdue?' },
        { label: 'Show me my pipeline' },
      ],
    });
  });

  it('distinguishes honest empty and capability-unavailable results', () => {
    const base = {
      ok: true as const,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask' as const,
      correlationId: 'corr-3',
      dataMode: 'sample' as const,
      asOf: '2026-08-11T15:00:00.000Z',
      citations: [],
      suggestions: [],
      alerts: [],
    };

    const empty = mapOmnixCopilotEnvelope('find contact Nobody', {
      ...base,
      resolvedIntent: { kind: 'find-contact', query: 'Nobody' },
      answerBlocks: [{
        id: 'contact-results-empty',
        kind: 'empty',
        title: 'Contact results',
        detail: 'No authorized record matched.',
        items: [],
        citations: [],
      }],
      warnings: [],
    });
    const unavailable = mapOmnixCopilotEnvelope('connections', {
      ...base,
      resolvedIntent: { kind: 'connections' },
      answerBlocks: [{
        id: 'connections-unavailable',
        kind: 'capability',
        title: 'Connections unavailable',
        detail: 'Persisted workspace connection status is unavailable.',
        items: [],
        citations: [],
      }],
      warnings: [{ code: 'capability-unavailable', message: 'Connection status is unavailable.' }],
    });

    expect(empty.status).toBe('empty');
    expect(unavailable).toMatchObject({
      status: 'unavailable',
      warnings: ['Connection status is unavailable.'],
    });
  });
});
