import {
  OMNIX_COPILOT_COMMANDS,
  createOmnixCopilotCorrelationId,
  createOmnixCopilotErrorResponse,
  createOmnixCopilotRequest,
  type OmnixCopilotCommand,
  type OmnixCopilotDataMode,
  type OmnixCopilotErrorCode,
  type OmnixCopilotExecutor,
} from '../lib/domain/omnix-copilot.ts';
import { buildOmnixCopilotTelemetryEvent } from '../lib/observability/omnix-copilot-telemetry.ts';

export const OMNIX_COPILOT_CLI_EXIT = Object.freeze({
  success: 0,
  internal: 1,
  usage: 2,
  forbidden: 3,
  notFound: 4,
  conflict: 5,
  unavailable: 6,
});

export interface OmnixCopilotCliDependencies {
  readonly execute: OmnixCopilotExecutor;
  readonly now?: () => Date;
  readonly correlationId?: () => string;
  readonly monotonicNow?: () => number;
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
}

interface ParsedOptions {
  readonly command: OmnixCopilotCommand;
  readonly live: boolean;
  readonly question?: string;
  readonly today?: string;
}

export function omnixCopilotUsage(): string {
  return [
    'Usage: npm run omnix:copilot -- <brief|ask|alerts|help> [options]',
    '  brief [--today <YYYY-MM-DD>] [--live]',
    '  ask --question <text> [--live]',
    '  alerts [--today <YYYY-MM-DD>] [--live]',
    '  help',
    'Default mode is explicit, non-durable sample data. --live requires authenticated end-user Supabase credentials.',
  ].join('\n');
}

function usageError(message: string): never {
  const error = new Error(`${message}\n${omnixCopilotUsage()}`) as Error & { code: string };
  error.code = 'invalid-input';
  throw error;
}

function optionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) usageError(`Missing value for ${option}.`);
  return value;
}

function parseOptions(argv: readonly string[]): ParsedOptions {
  const rawCommand = argv[0] === '--help' || argv[0] === '-h' ? 'help' : argv[0];
  if (!OMNIX_COPILOT_COMMANDS.includes(rawCommand as OmnixCopilotCommand)) {
    usageError('Choose brief, ask, alerts, or help.');
  }
  const command = rawCommand as OmnixCopilotCommand;
  let live = false;
  let question: string | undefined;
  let today: string | undefined;
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--live' && argument !== '--question' && argument !== '--today') {
      usageError(`Unknown option: ${argument ?? ''}`);
    }
    if (seen.has(argument)) usageError(`Option ${argument} may be provided only once.`);
    seen.add(argument);
    if (argument === '--live') live = true;
    else if (argument === '--question') {
      question = optionValue(argv, index, '--question');
      index += 1;
    } else {
      today = optionValue(argv, index, '--today');
      index += 1;
    }
  }
  if (command === 'ask' && question === undefined) usageError('ask requires exactly one --question value.');
  if (command !== 'ask' && question !== undefined) usageError('--question is valid only for ask.');
  if (command !== 'brief' && command !== 'alerts' && today !== undefined) {
    usageError('--today is valid only for brief or alerts.');
  }
  if (command === 'help' && live) usageError('--live is not valid for help.');
  return { command, live, ...(question ? { question } : {}), ...(today ? { today } : {}) };
}

function exitCode(code: OmnixCopilotErrorCode): number {
  if (code === 'invalid-input' || code === 'unsupported-intent') return OMNIX_COPILOT_CLI_EXIT.usage;
  if (code === 'forbidden') return OMNIX_COPILOT_CLI_EXIT.forbidden;
  if (code === 'not-found') return OMNIX_COPILOT_CLI_EXIT.notFound;
  if (code === 'conflict') return OMNIX_COPILOT_CLI_EXIT.conflict;
  if (code === 'capability-unavailable') return OMNIX_COPILOT_CLI_EXIT.unavailable;
  return OMNIX_COPILOT_CLI_EXIT.internal;
}

/** CLI adapter over the same injectable read service used by UI; it owns no repositories or writes. */
export async function runOmnixCopilotCli(
  argv: readonly string[],
  dependencies: OmnixCopilotCliDependencies,
): Promise<number> {
  const monotonicNow = dependencies.monotonicNow ?? Date.now;
  const startedAt = monotonicNow();
  const now = (dependencies.now ?? (() => new Date()))();
  const correlationId = createOmnixCopilotCorrelationId(
    dependencies.correlationId ?? (() => globalThis.crypto.randomUUID()),
  );
  const dataMode: OmnixCopilotDataMode = argv.includes('--live') ? 'live' : 'sample';
  const rawCommand = argv[0] === '--help' || argv[0] === '-h' ? 'help' : argv[0];
  const command = OMNIX_COPILOT_COMMANDS.includes(rawCommand as OmnixCopilotCommand)
    ? rawCommand as OmnixCopilotCommand
    : null;
  let requestDispatched = false;
  try {
    const selected = parseOptions(argv);
    const request = createOmnixCopilotRequest({
      command: selected.command,
      live: selected.live,
      question: selected.question,
      today: selected.today,
      correlationId,
      now,
    });
    requestDispatched = true;
    const response = await dependencies.execute(request);
    (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${JSON.stringify(response, null, 2)}\n`);
    return OMNIX_COPILOT_CLI_EXIT.success;
  } catch (error) {
    const response = createOmnixCopilotErrorResponse({
      command,
      correlationId,
      dataMode,
      asOf: Number.isFinite(now.getTime()) ? now.toISOString() : new Date(0).toISOString(),
      error,
    });
    if (!requestDispatched) {
      const telemetry = buildOmnixCopilotTelemetryEvent({
        correlationId,
        workspaceId: 'unresolved',
        membershipId: 'unresolved',
        resolvedIntent: 'unresolved',
        mode: dataMode,
        asOf: response.asOf,
        outcome: 'failure',
        resultCount: 0,
        citationCount: 0,
        durationMs: monotonicNow() - startedAt,
        errorCategory: response.code,
      });
      (dependencies.stderr ?? ((value) => process.stderr.write(value)))(`${JSON.stringify(telemetry)}\n`);
    }
    // The versioned envelope always stays on stdout. Redacted telemetry, when
    // configured by the composition root, uses stderr as a separate JSONL stream.
    (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${JSON.stringify(response, null, 2)}\n`);
    return exitCode(response.code);
  }
}
