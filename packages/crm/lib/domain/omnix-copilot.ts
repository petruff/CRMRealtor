export const OMNIX_COPILOT_SCHEMA_VERSION = 'omnix-copilot.v1' as const;
export const OMNIX_CITATION_SCHEMA_VERSION = 'citation.v1' as const;
export const OMNIX_COPILOT_QUESTION_MAX = 200;
export const OMNIX_COPILOT_RECORD_ID_MAX = 128;

export const OMNIX_COPILOT_COMMANDS = ['brief', 'ask', 'alerts', 'help'] as const;
export type OmnixCopilotCommand = (typeof OMNIX_COPILOT_COMMANDS)[number];
export type OmnixCopilotDataMode = 'sample' | 'live';

export const OMNIX_COPILOT_SUPPORTED_EXAMPLES = [
  'brief today',
  'brief 2026-08-12',
  'alerts today',
  'find contact Alicia',
  'contact profile Alicia',
  'pipeline',
  'tasks overdue',
  'tasks today',
  'tasks upcoming',
  'tasks from 2026-08-12 to 2026-08-19',
  'dates today',
  'dates upcoming',
  'mailers',
  'mailers m-dec',
  'activity contact-sample-1',
  'connections',
  'email campaigns',
  'help',
] as const;

export const OMNIX_COPILOT_FIXED_ALIASES = [
  { phrase: 'what should I do today', canonical: 'brief today' },
  { phrase: 'what are my priorities today', canonical: 'brief today' },
  { phrase: 'show me my priorities today', canonical: 'brief today' },
  { phrase: 'what do I need to do today', canonical: 'brief today' },
  { phrase: 'what needs my attention today', canonical: 'brief today' },
  { phrase: 'who needs attention', canonical: 'alerts today' },
  { phrase: 'who needs my attention', canonical: 'alerts today' },
  { phrase: 'who needs my attention today', canonical: 'alerts today' },
  { phrase: 'show overdue follow-ups', canonical: 'tasks overdue' },
  { phrase: 'which tasks are overdue', canonical: 'tasks overdue' },
  { phrase: 'what tasks are overdue', canonical: 'tasks overdue' },
  { phrase: "show today's tasks", canonical: 'tasks today' },
  { phrase: 'show upcoming dates', canonical: 'dates upcoming' },
  { phrase: 'show pipeline', canonical: 'pipeline' },
  { phrase: 'show me my pipeline', canonical: 'pipeline' },
  { phrase: 'what does my pipeline look like', canonical: 'pipeline' },
  { phrase: 'what is my pipeline', canonical: 'pipeline' },
  { phrase: 'show mailers', canonical: 'mailers' },
  { phrase: 'show recent activity for <contact-id>', canonical: 'activity <contact-id>' },
  { phrase: 'connection status', canonical: 'connections' },
  { phrase: 'create a bulk email', canonical: 'email campaigns' },
  { phrase: 'send an email to all contacts', canonical: 'email campaigns' },
  { phrase: 'create an email campaign', canonical: 'email campaigns' },
] as const;

export type OmnixCopilotDateReference = 'today' | string;

export type OmnixCopilotIntent =
  | Readonly<{ kind: 'brief'; date: OmnixCopilotDateReference }>
  | Readonly<{ kind: 'alerts'; date: OmnixCopilotDateReference }>
  | Readonly<{ kind: 'find-contact'; query: string }>
  | Readonly<{ kind: 'contact-profile'; query: string }>
  | Readonly<{ kind: 'pipeline' }>
  | Readonly<{ kind: 'tasks'; window: 'overdue' | 'today' | 'upcoming' }>
  | Readonly<{ kind: 'tasks-range'; from: string; to: string }>
  | Readonly<{ kind: 'dates'; window: 'today' | 'upcoming' }>
  | Readonly<{ kind: 'mailers'; campaignId?: string }>
  | Readonly<{ kind: 'activity'; contactId: string }>
  | Readonly<{ kind: 'connections' }>
  | Readonly<{ kind: 'campaigns' }>
  | Readonly<{ kind: 'help' }>;

export interface OmnixCopilotRequest {
  readonly schemaVersion: typeof OMNIX_COPILOT_SCHEMA_VERSION;
  readonly command: OmnixCopilotCommand;
  readonly intent: OmnixCopilotIntent;
  readonly correlationId: string;
  readonly dataMode: OmnixCopilotDataMode;
  readonly asOf: string;
}

export const OMNIX_COPILOT_ENTITY_TYPES = [
  'contact', 'task', 'activity', 'mailer', 'mailer-send', 'connector',
] as const;
export type OmnixCopilotEntityType = (typeof OMNIX_COPILOT_ENTITY_TYPES)[number];

export interface OmnixCopilotCitation {
  readonly id: string;
  readonly schemaVersion: typeof OMNIX_CITATION_SCHEMA_VERSION;
  readonly entityType: OmnixCopilotEntityType;
  readonly recordId: string;
  readonly factKeys: readonly string[];
  readonly sourceTimestamp?: string;
  readonly responseAsOf: string;
  readonly target: string;
  readonly rule?: string;
}

export interface OmnixCopilotAnswerItem {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly value?: string | number;
  readonly href?: string;
  readonly citations: readonly OmnixCopilotCitation[];
}

export interface OmnixCopilotAnswerBlock {
  readonly id: string;
  readonly kind: 'summary' | 'metric' | 'list' | 'empty' | 'capability';
  readonly title: string;
  readonly detail: string;
  readonly items: readonly OmnixCopilotAnswerItem[];
  readonly citations: readonly OmnixCopilotCitation[];
}

export const OMNIX_COPILOT_ALERT_RULES = [
  'needs-first-contact',
  'overdue-follow-up',
  'due-today-follow-up',
  'upcoming-follow-up',
  'birthday',
  'homeaversary',
  'pipeline-missing-next-touch',
  'mailer-missing-address',
  'task-overdue',
  'task-due-today',
] as const;
export type OmnixCopilotAlertRule = (typeof OMNIX_COPILOT_ALERT_RULES)[number];
export const OMNIX_COPILOT_ALERT_CATEGORIES = [
  'follow-up', 'celebration', 'pipeline', 'mailer', 'task',
] as const;
export type OmnixCopilotAlertCategory = (typeof OMNIX_COPILOT_ALERT_CATEGORIES)[number];
export const OMNIX_COPILOT_ALERT_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type OmnixCopilotAlertPriority = (typeof OMNIX_COPILOT_ALERT_PRIORITIES)[number];

export interface OmnixCopilotAlert {
  readonly id: string;
  readonly rule: OmnixCopilotAlertRule;
  readonly category: OmnixCopilotAlertCategory;
  readonly priority: OmnixCopilotAlertPriority;
  readonly order: number;
  readonly reason: string;
  readonly asOf: string;
  readonly recordId: string;
  readonly href: string;
  readonly citations: readonly OmnixCopilotCitation[];
  /** Stable operational identity; absent only on legacy fixtures/readers. */
  readonly occurrenceKey?: string;
  /** SHA-256 of the authoritative facts that define this occurrence. */
  readonly sourceFingerprint?: string;
  readonly dueAt?: string;
  readonly dismissAllowed?: boolean;
}

export interface OmnixCopilotSuggestion {
  readonly id: string;
  readonly kind: 'review-link' | 'copy-preview';
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly readOnly: true;
  readonly preview?: string;
  readonly citations: readonly OmnixCopilotCitation[];
}

export interface OmnixCopilotWarning {
  readonly code: string;
  readonly message: string;
}

export interface OmnixCopilotSuccessResponse {
  readonly ok: true;
  readonly schemaVersion: typeof OMNIX_COPILOT_SCHEMA_VERSION;
  readonly command: OmnixCopilotCommand;
  readonly resolvedIntent: OmnixCopilotIntent;
  readonly correlationId: string;
  readonly dataMode: OmnixCopilotDataMode;
  readonly asOf: string;
  readonly answerBlocks: readonly OmnixCopilotAnswerBlock[];
  readonly citations: readonly OmnixCopilotCitation[];
  readonly suggestions: readonly OmnixCopilotSuggestion[];
  readonly warnings: readonly OmnixCopilotWarning[];
  readonly alerts: readonly OmnixCopilotAlert[];
}

export const OMNIX_COPILOT_ERROR_CODES = [
  'invalid-input',
  'unsupported-intent',
  'capability-unavailable',
  'forbidden',
  'not-found',
  'conflict',
  'internal-error',
] as const;
export type OmnixCopilotErrorCode = (typeof OMNIX_COPILOT_ERROR_CODES)[number];

export interface OmnixCopilotErrorResponse {
  readonly ok: false;
  readonly schemaVersion: typeof OMNIX_COPILOT_SCHEMA_VERSION;
  readonly command: OmnixCopilotCommand | null;
  readonly correlationId: string;
  readonly dataMode: OmnixCopilotDataMode;
  readonly asOf: string;
  readonly code: OmnixCopilotErrorCode;
  readonly message: string;
  readonly supportedExamples: readonly string[];
  readonly warnings: readonly OmnixCopilotWarning[];
}

export type OmnixCopilotEnvelope = OmnixCopilotSuccessResponse | OmnixCopilotErrorResponse;
export type OmnixCopilotExecutor = (
  request: OmnixCopilotRequest,
) => Promise<OmnixCopilotSuccessResponse>;

export class OmnixCopilotError extends Error {
  readonly code: OmnixCopilotErrorCode;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    code: OmnixCopilotErrorCode,
    message: string,
    fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'OmnixCopilotError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function printable(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new OmnixCopilotError('invalid-input', `${field} is required.`, {
      [field]: `Use 1–${max} printable characters.`,
    });
  }
  const clean = value.trim();
  if (/[\u0000-\u001f\u007f]/u.test(clean)) {
    throw new OmnixCopilotError('invalid-input', `${field} contains control characters.`, {
      [field]: `Use 1–${max} printable characters without control characters.`,
    });
  }
  if (!clean || clean.length > max) {
    throw new OmnixCopilotError('invalid-input', `${field} is invalid.`, {
      [field]: `Use 1–${max} printable characters without control characters.`,
    });
  }
  return clean;
}

function identifier(value: unknown, field: string): string {
  const clean = printable(value, field, OMNIX_COPILOT_RECORD_ID_MAX);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(clean)) {
    throw new OmnixCopilotError('invalid-input', `${field} is invalid.`, {
      [field]: 'Use 1–128 letters, numbers, dashes, or underscores.',
    });
  }
  return clean;
}

function responseIdentifier(value: unknown, field: string): string {
  const clean = printable(value, field, 256);
  if (!/^[A-Za-z0-9._:+-]{1,256}$/u.test(clean)) {
    throw new OmnixCopilotError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

function instant(value: unknown, field: string): string {
  const clean = printable(value, field, 64);
  const parsed = new Date(clean);
  if (!Number.isFinite(parsed.getTime())) {
    throw new OmnixCopilotError('invalid-input', `${field} must be a valid ISO date/time.`);
  }
  return parsed.toISOString();
}

function safeTarget(value: unknown, field: string): string {
  const clean = printable(value, field, 240);
  if (
    !clean.startsWith('/')
    || clean.startsWith('//')
    || clean.includes('\\')
    || /(?:^|\/)\.\.(?:\/|$)/u.test(clean)
    || /[<>"']/u.test(clean)
  ) {
    throw new OmnixCopilotError('invalid-input', `${field} must be a safe in-product path.`);
  }
  return clean;
}

export function parseOmnixCopilotDate(value: unknown, field = 'date'): string {
  const clean = printable(value, field, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(clean);
  if (!match) {
    throw new OmnixCopilotError('invalid-input', `${field} must use YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new OmnixCopilotError('invalid-input', `${field} is not a valid calendar date.`);
  }
  return clean;
}

function dateReference(value: string): OmnixCopilotDateReference {
  return value === 'today' ? value : parseOmnixCopilotDate(value);
}

function normalizedQuestion(value: unknown): string {
  return printable(value, 'question', OMNIX_COPILOT_QUESTION_MAX)
    .replace(/\s+/gu, ' ')
    .replace(/[.!?]+$/gu, '')
    .trim();
}

/** Parse the documented grammar and a bounded set of common user phrasings. */
export function parseOmnixCopilotQuestion(value: unknown): OmnixCopilotIntent {
  let question = normalizedQuestion(value);
  let folded = question.toLocaleLowerCase('en-US');
  const staticAlias = OMNIX_COPILOT_FIXED_ALIASES.find((alias) => (
    !alias.phrase.includes('<') && alias.phrase.toLocaleLowerCase('en-US') === folded
  ));
  if (staticAlias) {
    question = staticAlias.canonical;
    folded = question;
  }

  const activityAlias = /^show recent activity for ([a-z0-9_-]+)$/iu.exec(question);
  if (activityAlias?.[1]) return { kind: 'activity', contactId: identifier(activityAlias[1], 'contactId') };

  if (folded === 'brief') return { kind: 'brief', date: 'today' };
  const brief = /^brief (today|\d{4}-\d{2}-\d{2})$/iu.exec(question);
  if (brief?.[1]) return { kind: 'brief', date: dateReference(brief[1].toLocaleLowerCase('en-US')) };

  if (folded === 'alerts') return { kind: 'alerts', date: 'today' };
  const alerts = /^alerts (today|\d{4}-\d{2}-\d{2})$/iu.exec(question);
  if (alerts?.[1]) return { kind: 'alerts', date: dateReference(alerts[1].toLocaleLowerCase('en-US')) };

  const findContact = /^find contact (.+)$/iu.exec(question);
  if (findContact?.[1]) return { kind: 'find-contact', query: printable(findContact[1], 'query', 200) };
  const contactProfile = /^contact profile (.+)$/iu.exec(question);
  if (contactProfile?.[1]) return { kind: 'contact-profile', query: printable(contactProfile[1], 'query', 200) };
  if (folded === 'pipeline') return { kind: 'pipeline' };

  const tasks = /^tasks (overdue|today|upcoming)$/iu.exec(question);
  if (tasks?.[1]) {
    return { kind: 'tasks', window: tasks[1].toLocaleLowerCase('en-US') as 'overdue' | 'today' | 'upcoming' };
  }
  const taskRange = /^tasks from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/iu.exec(question);
  if (taskRange?.[1] && taskRange[2]) {
    const from = parseOmnixCopilotDate(taskRange[1], 'from');
    const to = parseOmnixCopilotDate(taskRange[2], 'to');
    if (from > to) throw new OmnixCopilotError('invalid-input', 'Task date range must end on or after it starts.');
    return { kind: 'tasks-range', from, to };
  }

  const dates = /^dates (today|upcoming)$/iu.exec(question);
  if (dates?.[1]) {
    return { kind: 'dates', window: dates[1].toLocaleLowerCase('en-US') as 'today' | 'upcoming' };
  }

  if (folded === 'mailers') return { kind: 'mailers' };
  const mailers = /^mailers ([a-z0-9_-]+)$/iu.exec(question);
  if (mailers?.[1]) return { kind: 'mailers', campaignId: identifier(mailers[1], 'campaignId') };

  const activity = /^activity ([a-z0-9_-]+)$/iu.exec(question);
  if (activity?.[1]) return { kind: 'activity', contactId: identifier(activity[1], 'contactId') };
  if (folded === 'connections') return { kind: 'connections' };
  if (folded === 'email campaigns' || folded === 'campaigns') return { kind: 'campaigns' };
  if (folded === 'help') return { kind: 'help' };

  throw new OmnixCopilotError(
    'unsupported-intent',
    "I couldn't match that wording yet.",
  );
}

export interface CreateOmnixCopilotRequestInput {
  readonly command: OmnixCopilotCommand;
  readonly question?: unknown;
  readonly today?: unknown;
  readonly live?: boolean;
  readonly correlationId?: unknown;
  readonly now?: Date;
}

export function createOmnixCopilotCorrelationId(
  factory: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return responseIdentifier(factory(), 'correlationId');
}

export function createOmnixCopilotRequest(
  input: CreateOmnixCopilotRequestInput,
): OmnixCopilotRequest {
  if (!OMNIX_COPILOT_COMMANDS.includes(input.command)) {
    throw new OmnixCopilotError('invalid-input', 'Command is invalid.');
  }
  if (input.live !== undefined && typeof input.live !== 'boolean') {
    throw new OmnixCopilotError('invalid-input', 'live must be a boolean.');
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new OmnixCopilotError('invalid-input', 'asOf is invalid.');
  const correlationId = input.correlationId === undefined
    ? createOmnixCopilotCorrelationId()
    : responseIdentifier(input.correlationId, 'correlationId');

  let intent: OmnixCopilotIntent;
  if (input.command === 'ask') {
    if (input.today !== undefined) throw new OmnixCopilotError('invalid-input', '--today is not valid for ask.');
    intent = parseOmnixCopilotQuestion(input.question);
  } else {
    if (input.question !== undefined) {
      throw new OmnixCopilotError('invalid-input', '--question is valid only for ask.');
    }
    if (input.command === 'help') {
      if (input.today !== undefined) throw new OmnixCopilotError('invalid-input', '--today is not valid for help.');
      intent = { kind: 'help' };
    } else {
      const selectedDate = input.today === undefined ? 'today' : parseOmnixCopilotDate(input.today, 'today');
      intent = { kind: input.command, date: selectedDate };
    }
  }

  return Object.freeze({
    schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
    command: input.command,
    intent,
    correlationId,
    dataMode: input.live ? 'live' : 'sample',
    asOf: now.toISOString(),
  });
}

export interface CreateOmnixCopilotCitationInput {
  readonly entityType: OmnixCopilotEntityType;
  readonly recordId: unknown;
  readonly factKeys: readonly unknown[];
  readonly sourceTimestamp?: unknown;
  readonly responseAsOf: unknown;
  readonly target: unknown;
  readonly rule?: unknown;
}

export function createOmnixCopilotCitation(
  input: CreateOmnixCopilotCitationInput,
): OmnixCopilotCitation {
  if (!OMNIX_COPILOT_ENTITY_TYPES.includes(input.entityType)) {
    throw new OmnixCopilotError('invalid-input', 'Citation entity type is invalid.');
  }
  const recordId = identifier(input.recordId, 'recordId');
  if (!Array.isArray(input.factKeys) || input.factKeys.length === 0 || input.factKeys.length > 32) {
    throw new OmnixCopilotError('invalid-input', 'Citation must name 1–32 fact keys.');
  }
  const factKeys = Array.from(new Set(input.factKeys.map((value) => {
    const key = printable(value, 'factKey', 128);
    if (!/^[A-Za-z][A-Za-z0-9.-]{0,127}$/u.test(key)) {
      throw new OmnixCopilotError('invalid-input', 'Citation fact key is invalid.');
    }
    return key;
  })));
  const responseAsOf = instant(input.responseAsOf, 'responseAsOf');
  const rule = input.rule === undefined ? undefined : identifier(input.rule, 'rule');
  const tokenSource = `${factKeys.join('+')}${rule ? `:${rule}` : ''}`;
  let token = 2_166_136_261;
  for (const character of tokenSource) {
    token ^= character.codePointAt(0) ?? 0;
    token = Math.imul(token, 16_777_619);
  }
  const id = `citation:${input.entityType}:${recordId}:${(token >>> 0).toString(16).padStart(8, '0')}`;
  return Object.freeze({
    id,
    schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
    entityType: input.entityType,
    recordId,
    factKeys,
    ...(input.sourceTimestamp === undefined
      ? {}
      : { sourceTimestamp: instant(input.sourceTimestamp, 'sourceTimestamp') }),
    responseAsOf,
    target: safeTarget(input.target, 'target'),
    ...(rule ? { rule } : {}),
  });
}

export interface CreateOmnixCopilotAlertInput {
  readonly rule: OmnixCopilotAlertRule;
  readonly category: OmnixCopilotAlertCategory;
  readonly priority: OmnixCopilotAlertPriority;
  readonly order: number;
  readonly reason: unknown;
  readonly asOf: unknown;
  readonly recordId: unknown;
  readonly href: unknown;
  readonly citations: readonly OmnixCopilotCitation[];
  readonly occurrenceKey?: unknown;
  readonly sourceFingerprint?: unknown;
  readonly dueAt?: unknown;
  readonly dismissAllowed?: unknown;
}

export function createOmnixCopilotAlert(input: CreateOmnixCopilotAlertInput): OmnixCopilotAlert {
  if (!OMNIX_COPILOT_ALERT_RULES.includes(input.rule)) {
    throw new OmnixCopilotError('invalid-input', 'Alert rule is invalid.');
  }
  if (!OMNIX_COPILOT_ALERT_CATEGORIES.includes(input.category)) {
    throw new OmnixCopilotError('invalid-input', 'Alert category is invalid.');
  }
  if (!OMNIX_COPILOT_ALERT_PRIORITIES.includes(input.priority)) {
    throw new OmnixCopilotError('invalid-input', 'Alert priority is invalid.');
  }
  if (!Number.isSafeInteger(input.order) || input.order < 0 || input.order > 10_000) {
    throw new OmnixCopilotError('invalid-input', 'Alert order must be an integer from 0 to 10000.');
  }
  if (!Array.isArray(input.citations) || input.citations.length === 0) {
    throw new OmnixCopilotError('invalid-input', 'Every alert requires at least one citation.');
  }
  const asOf = instant(input.asOf, 'asOf');
  const recordId = identifier(input.recordId, 'recordId');
  const occurrenceKey = input.occurrenceKey === undefined
    ? undefined
    : printable(input.occurrenceKey, 'occurrenceKey', 200);
  if (occurrenceKey && !/^[A-Za-z0-9._:-]{1,200}$/.test(occurrenceKey)) {
    throw new OmnixCopilotError('invalid-input', 'Alert occurrence key is invalid.');
  }
  if (input.sourceFingerprint !== undefined
    && (typeof input.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceFingerprint))) {
    throw new OmnixCopilotError('invalid-input', 'Alert source fingerprint is invalid.');
  }
  if (input.dismissAllowed !== undefined && typeof input.dismissAllowed !== 'boolean') {
    throw new OmnixCopilotError('invalid-input', 'Alert dismissal policy is invalid.');
  }
  return Object.freeze({
    id: `alert:${input.rule}:${recordId}:${asOf.slice(0, 10)}`,
    rule: input.rule,
    category: input.category,
    priority: input.priority,
    order: input.order,
    reason: printable(input.reason, 'reason', 500),
    asOf,
    recordId,
    href: safeTarget(input.href, 'href'),
    citations: dedupeOmnixCopilotCitations(input.citations),
    ...(occurrenceKey ? { occurrenceKey } : {}),
    ...(typeof input.sourceFingerprint === 'string'
      ? { sourceFingerprint: input.sourceFingerprint }
      : {}),
    ...(input.dueAt === undefined ? {} : { dueAt: instant(input.dueAt, 'dueAt') }),
    ...(typeof input.dismissAllowed === 'boolean' ? { dismissAllowed: input.dismissAllowed } : {}),
  });
}

export function dedupeOmnixCopilotCitations(
  citations: readonly OmnixCopilotCitation[],
): OmnixCopilotCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.id)) return false;
    seen.add(citation.id);
    return true;
  });
}

export function dedupeOmnixCopilotAlerts(alerts: readonly OmnixCopilotAlert[]): OmnixCopilotAlert[] {
  const seen = new Set<string>();
  return alerts
    .filter((alert) => {
      if (seen.has(alert.id)) return false;
      seen.add(alert.id);
      return true;
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

interface OmnixCopilotSuccessPayload {
  readonly answerBlocks: readonly OmnixCopilotAnswerBlock[];
  readonly citations?: readonly OmnixCopilotCitation[];
  readonly suggestions?: readonly OmnixCopilotSuggestion[];
  readonly warnings?: readonly OmnixCopilotWarning[];
  readonly alerts?: readonly OmnixCopilotAlert[];
}

export function createOmnixCopilotSuccessResponse(
  request: OmnixCopilotRequest,
  payload: OmnixCopilotSuccessPayload,
): OmnixCopilotSuccessResponse {
  const suggestions = payload.suggestions ?? [];
  const alerts = dedupeOmnixCopilotAlerts(payload.alerts ?? []);
  const nested = [
    ...payload.answerBlocks.flatMap((block) => [
      ...block.citations,
      ...block.items.flatMap((item) => item.citations),
    ]),
    ...suggestions.flatMap((suggestion) => suggestion.citations),
    ...alerts.flatMap((alert) => alert.citations),
  ];
  return Object.freeze({
    ok: true,
    schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
    command: request.command,
    resolvedIntent: request.intent,
    correlationId: request.correlationId,
    dataMode: request.dataMode,
    asOf: request.asOf,
    answerBlocks: payload.answerBlocks,
    citations: dedupeOmnixCopilotCitations([...(payload.citations ?? []), ...nested]),
    suggestions,
    warnings: payload.warnings ?? [],
    alerts,
  });
}

interface CreateOmnixCopilotErrorResponseInput {
  readonly command: OmnixCopilotCommand | null;
  readonly correlationId: string;
  readonly dataMode: OmnixCopilotDataMode;
  readonly asOf: string;
  readonly error: unknown;
  readonly warnings?: readonly OmnixCopilotWarning[];
}

function safeError(error: unknown): { code: OmnixCopilotErrorCode; message: string } {
  if (error instanceof OmnixCopilotError) return { code: error.code, message: error.message };
  const coded = error as { code?: unknown };
  if (coded?.code === 'forbidden' || coded?.code === 'scope-mismatch' || coded?.code === 'revoked-membership') {
    return { code: 'forbidden', message: 'The requested CRM records are not available to this membership.' };
  }
  if (coded?.code === 'not-found') return { code: 'not-found', message: 'No authorized record matched.' };
  if (coded?.code === 'conflict') return { code: 'conflict', message: 'The request conflicts with the current CRM state.' };
  if (coded?.code === 'invalid-input') {
    return { code: 'invalid-input', message: error instanceof Error ? error.message : 'The request is invalid.' };
  }
  return { code: 'internal-error', message: 'The Omnix copilot request failed safely.' };
}

export function createOmnixCopilotErrorResponse(
  input: CreateOmnixCopilotErrorResponseInput,
): OmnixCopilotErrorResponse {
  const error = safeError(input.error);
  return Object.freeze({
    ok: false,
    schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
    command: input.command,
    correlationId: responseIdentifier(input.correlationId, 'correlationId'),
    dataMode: input.dataMode,
    asOf: instant(input.asOf, 'asOf'),
    code: error.code,
    message: error.message,
    supportedExamples: OMNIX_COPILOT_SUPPORTED_EXAMPLES,
    warnings: input.warnings ?? [],
  });
}
