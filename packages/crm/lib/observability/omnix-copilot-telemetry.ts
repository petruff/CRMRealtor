export const OMNIX_COPILOT_TELEMETRY_SCHEMA = 'omnix-copilot-telemetry.v1' as const;

export type OmnixCopilotTelemetryMode = 'sample' | 'live';
export type OmnixCopilotTelemetryOutcome = 'success' | 'failure';

export const OMNIX_COPILOT_TELEMETRY_ERROR_CATEGORIES = [
  'invalid-input',
  'unsupported-intent',
  'capability-unavailable',
  'forbidden',
  'not-found',
  'conflict',
  'internal-error',
] as const;
export type OmnixCopilotTelemetryErrorCategory =
  (typeof OMNIX_COPILOT_TELEMETRY_ERROR_CATEGORIES)[number];

const AUTHORITY_ERROR_ALIASES = new Set(['revoked-membership', 'scope-mismatch']);
const SAFE_ERROR_CATEGORIES = new Set<string>(OMNIX_COPILOT_TELEMETRY_ERROR_CATEGORIES);

export function normalizeOmnixCopilotTelemetryErrorCategory(
  value: unknown,
): OmnixCopilotTelemetryErrorCategory {
  if (typeof value === 'string') {
    if (AUTHORITY_ERROR_ALIASES.has(value)) return 'forbidden';
    if (SAFE_ERROR_CATEGORIES.has(value)) return value as OmnixCopilotTelemetryErrorCategory;
  }
  return 'internal-error';
}

export function omnixCopilotTelemetryErrorCategory(
  error: unknown,
): OmnixCopilotTelemetryErrorCategory {
  if (error && typeof error === 'object' && 'code' in error) {
    return normalizeOmnixCopilotTelemetryErrorCategory(error.code);
  }
  return 'internal-error';
}

export interface OmnixCopilotTelemetryEvent {
  readonly schema: typeof OMNIX_COPILOT_TELEMETRY_SCHEMA;
  readonly correlationId: string;
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly resolvedIntent: string;
  readonly mode: OmnixCopilotTelemetryMode;
  readonly asOf: string;
  readonly outcome: OmnixCopilotTelemetryOutcome;
  readonly resultCount: number;
  readonly citationCount: number;
  readonly durationMs: number;
  readonly errorCategory?: OmnixCopilotTelemetryErrorCategory;
}

export type OmnixCopilotTelemetrySink = (
  event: OmnixCopilotTelemetryEvent,
) => void | Promise<void>;

/** Default server-observable sink: one already-redacted JSON event per line. */
export const defaultOmnixCopilotTelemetrySink: OmnixCopilotTelemetrySink = (event) => {
  console.info(JSON.stringify(event));
};

export interface OmnixCopilotTelemetryInput {
  readonly correlationId: string;
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly resolvedIntent: string;
  readonly mode: OmnixCopilotTelemetryMode;
  readonly asOf: string;
  readonly outcome: OmnixCopilotTelemetryOutcome;
  readonly resultCount: number;
  readonly citationCount: number;
  readonly durationMs: number;
  readonly errorCategory?: unknown;
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Produces the complete telemetry allowlist. Accepting individual safe fields,
 * instead of a request or response object, prevents question bodies and CRM
 * record content from entering logs by accidental object spreading.
 */
export function buildOmnixCopilotTelemetryEvent(
  input: OmnixCopilotTelemetryInput,
): OmnixCopilotTelemetryEvent {
  return Object.freeze({
    schema: OMNIX_COPILOT_TELEMETRY_SCHEMA,
    correlationId: input.correlationId,
    workspaceId: input.workspaceId,
    membershipId: input.membershipId,
    resolvedIntent: input.resolvedIntent,
    mode: input.mode,
    asOf: input.asOf,
    outcome: input.outcome,
    resultCount: safeCount(input.resultCount),
    citationCount: safeCount(input.citationCount),
    durationMs: safeCount(input.durationMs),
    ...(input.errorCategory === undefined
      ? {}
      : { errorCategory: normalizeOmnixCopilotTelemetryErrorCategory(input.errorCategory) }),
  });
}

/** Observability is best-effort and never changes a copilot answer or error. */
export async function emitOmnixCopilotTelemetry(
  sink: OmnixCopilotTelemetrySink | undefined,
  input: OmnixCopilotTelemetryInput,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(buildOmnixCopilotTelemetryEvent(input));
  } catch {
    // Telemetry must not become a data-path dependency for this read-only service.
  }
}
