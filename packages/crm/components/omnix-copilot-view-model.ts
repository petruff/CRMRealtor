export type OmnixCopilotMessageState =
  | 'success'
  | 'empty'
  | 'unsupported'
  | 'unavailable'
  | 'error';

export interface OmnixCopilotCitationView {
  id: string;
  entityType: 'contact' | 'task' | 'activity' | 'mailer' | 'mailer-send' | 'connector';
  recordId: string;
  factKeys: string[];
  sourceTimestamp?: string;
  asOf: string;
  target: string;
  rule?: string;
  displayLabel?: string;
}

export interface OmnixCopilotAnswerBlockView {
  id: string;
  kind: 'summary' | 'metric' | 'list' | 'empty' | 'capability';
  title?: string;
  detail: string;
  items: OmnixCopilotAnswerItemView[];
  citationIds: string[];
}

export interface OmnixCopilotAnswerItemView {
  id: string;
  label: string;
  detail?: string;
  value?: string | number;
  href?: string;
  citationIds: string[];
}

export interface OmnixCopilotSuggestionView {
  id: string;
  label: string;
  detail?: string;
  href?: string;
  commandPreview?: string;
  citationIds: string[];
}

export interface OmnixCopilotAlertView {
  id: string;
  category: string;
  priority: string;
  reason: string;
  recordId: string;
  href: string;
  citationIds: string[];
}

export interface OmnixCopilotUiResult {
  status: OmnixCopilotMessageState;
  question: string;
  correlationId?: string;
  intent?: string;
  dataMode?: 'sample' | 'live';
  asOf?: string;
  answerBlocks: OmnixCopilotAnswerBlockView[];
  citations: OmnixCopilotCitationView[];
  suggestions: OmnixCopilotSuggestionView[];
  alerts: OmnixCopilotAlertView[];
  warnings: string[];
  message?: string;
  model?: {
    state: 'available' | 'unconfigured' | 'failed';
    provider: 'google-gemini' | 'anthropic-claude';
    model?: string;
    routed: boolean;
  };
}

export type OmnixCopilotAction = (
  question: string,
) => Promise<OmnixCopilotUiResult>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function validateCopilotQuestion(question: string): string | null {
  const normalized = question.trim();
  if (!normalized) return 'Enter one of the supported questions.';
  if (normalized.length > 200) return 'Keep the question to 200 characters or fewer.';
  if (CONTROL_CHARACTERS.test(normalized)) {
    return 'Use printable characters only.';
  }
  return null;
}

export function isSafeInProductTarget(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//');
}

export function mapOmnixCopilotEnvelope(
  question: string,
  envelope: OmnixCopilotEnvelope,
): OmnixCopilotUiResult {
  if (!envelope.ok) {
    const status: OmnixCopilotMessageState = envelope.code === 'unsupported-intent'
      ? 'unsupported'
      : envelope.code === 'capability-unavailable'
        ? 'unavailable'
        : envelope.code === 'not-found'
          ? 'empty'
          : 'error';
    return {
      status,
      question,
      correlationId: envelope.correlationId,
      dataMode: envelope.dataMode,
      asOf: envelope.asOf,
      answerBlocks: envelope.code === 'unsupported-intent' ? [{
        id: 'supported-examples',
        kind: 'list',
        title: 'Try asking in one of these ways',
        detail: 'I can help with today’s priorities, follow-ups, people who need attention, and your pipeline.',
        items: [
          'What are my priorities today?',
          'Who needs my attention?',
          'Which tasks are overdue?',
          'Show me my pipeline',
        ].map((example) => ({
          id: `example-${example}`,
          label: example,
          citationIds: [],
        })),
        citationIds: [],
      }] : [],
      citations: [],
      suggestions: [],
      alerts: [],
      warnings: envelope.warnings.map((warning) => warning.message),
      message: envelope.code === 'unsupported-intent'
        ? "I couldn't match that wording yet. Nothing was changed."
        : envelope.message,
    };
  }

  const unavailable = envelope.answerBlocks.some((block) => block.kind === 'capability')
    || envelope.warnings.some((warning) => warning.code === 'capability-unavailable');
  const empty = envelope.answerBlocks.length > 0
    && envelope.answerBlocks.every((block) => block.kind === 'empty');

  const answerBlocks = envelope.answerBlocks.map((block) => ({
    id: block.id,
    kind: block.kind,
    title: block.title,
    detail: block.detail,
    items: block.items.map((item) => ({
      id: item.id,
      label: item.label,
      detail: item.detail,
      value: item.value,
      href: item.href,
      citationIds: item.citations.map((citation) => citation.id),
    })),
    citationIds: block.citations.map((citation) => citation.id),
  }));
  const citationLabels = new Map<string, string>();
  for (const block of answerBlocks) {
    for (const item of block.items) {
      if (!item.href) continue;
      for (const citationId of item.citationIds) {
        if (!citationLabels.has(citationId)) citationLabels.set(citationId, item.label);
      }
    }
  }

  return {
    status: unavailable ? 'unavailable' : empty ? 'empty' : 'success',
    question,
    correlationId: envelope.correlationId,
    intent: envelope.resolvedIntent.kind,
    dataMode: envelope.dataMode,
    asOf: envelope.asOf,
    answerBlocks,
    citations: envelope.citations.map((citation) => ({
      id: citation.id,
      entityType: citation.entityType,
      recordId: citation.recordId,
      factKeys: [...citation.factKeys],
      sourceTimestamp: citation.sourceTimestamp,
      asOf: citation.responseAsOf,
      target: citation.target,
      rule: citation.rule,
      displayLabel: citationLabels.get(citation.id),
    })),
    suggestions: envelope.suggestions.map((suggestion) => ({
      id: suggestion.id,
      label: suggestion.title,
      detail: suggestion.detail,
      href: suggestion.href,
      commandPreview: suggestion.preview,
      citationIds: suggestion.citations.map((citation) => citation.id),
    })),
    alerts: envelope.alerts.map((alert) => ({
      id: alert.id,
      category: alert.category,
      priority: alert.priority,
      reason: alert.reason,
      recordId: alert.recordId,
      href: alert.href,
      citationIds: alert.citations.map((citation) => citation.id),
    })),
    warnings: envelope.warnings.map((warning) => warning.message),
  };
}
import type { OmnixCopilotEnvelope } from '@/lib/domain/omnix-copilot';
