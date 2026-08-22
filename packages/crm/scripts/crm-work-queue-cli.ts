import { WorkspaceAuthorityError } from '../lib/domain/workspace.ts';

export const CRM_WORK_QUEUE_CLI_EXIT = Object.freeze({
  success: 0,
  internal: 1,
  usage: 2,
  forbidden: 3,
  notFound: 4,
  conflict: 5,
});

export interface CliOutput {
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
}

export interface CliEnvelopeInput {
  readonly ok: boolean;
  readonly resource: 'smart-lists' | 'incomplete-records' | 'activities' | 'connectors' | 'rich-contacts';
  readonly command?: string;
  readonly live: boolean;
  readonly mode?: 'live-authenticated' | 'live-server-only' | 'sample-process-only';
  readonly result?: unknown;
  readonly error?: unknown;
}

interface CodedError extends Error {
  readonly code?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export function optionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new WorkspaceAuthorityError('invalid-input', `Missing value for ${option}.`);
  }
  return value;
}

export function parseJsonOption(value: string | undefined, option: string): unknown {
  if (!value) throw new WorkspaceAuthorityError('invalid-input', `${option} is required.`);
  try {
    return JSON.parse(value);
  } catch {
    throw new WorkspaceAuthorityError('invalid-input', `${option} must contain valid JSON.`);
  }
}

export function commaIds(value: string | undefined): string[] {
  if (!value) throw new WorkspaceAuthorityError('invalid-input', '--ids is required.');
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function cliUsageError(message: string): never {
  throw new WorkspaceAuthorityError('invalid-input', message);
}

function code(error: unknown): string {
  const value = error as CodedError;
  return typeof value?.code === 'string' ? value.code : 'internal-error';
}

export function cliExitCode(error: unknown): number {
  const errorCode = code(error);
  if (errorCode === 'invalid-input') return CRM_WORK_QUEUE_CLI_EXIT.usage;
  if (
    errorCode === 'forbidden'
    || errorCode === 'scope-mismatch'
    || errorCode === 'revoked-membership'
    || errorCode === 'provider-disabled'
  ) {
    return CRM_WORK_QUEUE_CLI_EXIT.forbidden;
  }
  if (errorCode === 'not-found') return CRM_WORK_QUEUE_CLI_EXIT.notFound;
  if (
    errorCode === 'conflict'
    || errorCode === 'invariant-violation'
    || errorCode === 'lease-lost'
  ) return CRM_WORK_QUEUE_CLI_EXIT.conflict;
  return CRM_WORK_QUEUE_CLI_EXIT.internal;
}

export function writeCliEnvelope(
  output: CliOutput,
  input: CliEnvelopeInput,
): number {
  const write = input.ok
    ? output.stdout ?? ((value: string) => process.stdout.write(value))
    : output.stderr ?? ((value: string) => process.stderr.write(value));
  const error = input.error as CodedError | undefined;
  const mode = input.mode ?? (input.live ? 'live-authenticated' : 'sample-process-only');
  const body = input.ok ? {
    ok: true,
    schemaVersion: 'crm-work-queue-cli.v1',
    mode,
    durable: input.live,
    resource: input.resource,
    command: input.command,
    result: input.result,
  } : {
    ok: false,
    schemaVersion: 'crm-work-queue-cli.v1',
    mode,
    durable: input.live,
    resource: input.resource,
    code: code(input.error),
    message: error instanceof Error ? error.message : 'CRM work queue operation failed safely.',
    ...(error?.fieldErrors && Object.keys(error.fieldErrors).length ? { fieldErrors: error.fieldErrors } : {}),
  };
  write(`${JSON.stringify(body, null, 2)}\n`);
  return input.ok ? CRM_WORK_QUEUE_CLI_EXIT.success : cliExitCode(input.error);
}

export function liveNotWired(resource: string): never {
  throw new WorkspaceAuthorityError(
    'invalid-input',
    `Live ${resource} CLI requires the configured authenticated Supabase repository context.`,
  );
}
