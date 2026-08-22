#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  addWorkspaceMembershipCommand,
  bootstrapWorkspaceCommand,
  listWorkspaceMembershipsCommand,
  revokeWorkspaceMembershipCommand,
  showWorkspaceCommand,
  workspaceHealthCommand,
} from '../lib/application/workspace-commands.ts';
import {
  createMemoryWorkspaceRepository,
  createSampleWorkspaceRepository,
} from '../lib/data/memory-workspace-repository.ts';
import { supabaseWorkspaceRepository } from '../lib/data/supabase-workspace-repository.ts';
import { resolveSupabaseWorkspaceScope } from '../lib/data/supabase-workspace-scope.ts';
import type {
  WorkspaceAuthoritySnapshot,
  WorkspaceHealthReport,
  WorkspaceRepository,
} from '../lib/data/workspace-repository.ts';
import {
  SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  SAMPLE_OWNER_USER_ID,
  SAMPLE_WORKSPACE_SCOPE,
  WorkspaceAuthorityError,
  type WorkspaceMembership,
  type WorkspaceScope,
} from '../lib/domain/workspace.ts';

export type WorkspaceCliCommand =
  | 'bootstrap'
  | 'show'
  | 'members'
  | 'add-member'
  | 'revoke-member'
  | 'health';

interface Options {
  command: WorkspaceCliCommand;
  live: boolean;
  name?: string;
  userId?: string;
  role?: string;
  membershipId?: string;
  correlationId?: string;
}

export interface LiveWorkspaceConfiguration {
  url: string;
  anonKey: string;
  accessToken: string;
}

export interface LiveWorkspaceContext {
  repository: WorkspaceRepository;
  authenticatedUserId: string;
  scope?: WorkspaceScope;
}

export interface WorkspaceCliDependencies {
  env?: NodeJS.ProcessEnv;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
  liveContext?: (
    configuration: LiveWorkspaceConfiguration,
    command: WorkspaceCliCommand,
  ) => Promise<LiveWorkspaceContext>;
}

export const WORKSPACE_CLI_EXIT = Object.freeze({
  success: 0,
  internal: 1,
  usage: 2,
  forbidden: 3,
  notFound: 4,
  conflict: 5,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMANDS: readonly WorkspaceCliCommand[] = [
  'bootstrap',
  'show',
  'members',
  'add-member',
  'revoke-member',
  'health',
];

function usage(): string {
  return [
    'Usage: npm run workspace -- <command> [options] [--live]',
    '',
    'Commands:',
    '  bootstrap [--name <workspace-name>]',
    '  show',
    '  members',
    '  add-member --user-id <authenticated-user-id> [--role assistant]',
    `  revoke-member [--membership-id <id>]  (sample default: ${SAMPLE_ASSISTANT_MEMBERSHIP_ID})`,
    '  health',
    '',
    'Shared option: --correlation-id <uuid>',
    'Default mode is explicit, non-durable sample data.',
    'Live mode requires --live and authenticated end-user environment values.',
  ].join('\n');
}

function optionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new WorkspaceAuthorityError('invalid-input', `Missing value for ${option}.`);
  }
  return value;
}

function parseOptions(argv: readonly string[]): Options | { help: true } {
  const first = argv[0];
  if (first === '--help' || first === '-h') return { help: true };
  if (!first || !COMMANDS.includes(first as WorkspaceCliCommand)) {
    throw new WorkspaceAuthorityError('invalid-input', usage());
  }
  const selected: Options = { command: first as WorkspaceCliCommand, live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--name') selected.name = optionValue(argv, index++, '--name');
    else if (argument === '--user-id') selected.userId = optionValue(argv, index++, '--user-id');
    else if (argument === '--role') selected.role = optionValue(argv, index++, '--role');
    else if (argument === '--membership-id') {
      selected.membershipId = optionValue(argv, index++, '--membership-id');
    } else if (argument === '--correlation-id') {
      selected.correlationId = optionValue(argv, index++, '--correlation-id');
    } else {
      throw new WorkspaceAuthorityError('invalid-input', `Unknown option: ${argument}\n${usage()}`);
    }
  }
  return selected;
}

function decodedJwtRole(value: string): string | undefined {
  const segments = value.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || !payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

function validSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    return !url.username
      && !url.password
      && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback));
  } catch {
    return false;
  }
}

export function liveWorkspaceConfiguration(env: NodeJS.ProcessEnv): LiveWorkspaceConfiguration {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
  const accessToken = env.OMNIX_SUPABASE_ACCESS_TOKEN?.trim() ?? '';
  if (!url || !anonKey || !accessToken) {
    throw new WorkspaceAuthorityError(
      'invalid-input',
      'Live mode requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and OMNIX_SUPABASE_ACCESS_TOKEN.',
    );
  }
  if (!validSupabaseUrl(url)) {
    throw new WorkspaceAuthorityError('invalid-input', 'Supabase URL must be HTTPS or a local loopback URL.');
  }
  const keyRole = decodedJwtRole(anonKey);
  if (
    anonKey.startsWith('sb_secret_')
    || keyRole === 'service_role'
    || env.SUPABASE_SERVICE_ROLE_KEY === anonKey
  ) {
    throw new WorkspaceAuthorityError(
      'forbidden',
      'Live workspace CLI refuses service-role or secret Supabase keys.',
    );
  }
  if (accessToken === anonKey || accessToken.startsWith('sb_')) {
    throw new WorkspaceAuthorityError(
      'forbidden',
      'OMNIX_SUPABASE_ACCESS_TOKEN must be an authenticated end-user access token.',
    );
  }
  return { url, anonKey, accessToken };
}

export async function createAuthenticatedLiveWorkspaceContext(
  configuration: LiveWorkspaceConfiguration,
  command: WorkspaceCliCommand,
  overrides: {
    client?: SupabaseClient;
    resolveScope?: typeof resolveSupabaseWorkspaceScope;
    repositoryFactory?: typeof supabaseWorkspaceRepository;
  } = {},
): Promise<LiveWorkspaceContext> {
  const client = overrides.client ?? createClient(configuration.url, configuration.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${configuration.accessToken}` },
    },
  });
  const { data, error } = await client.auth.getUser(configuration.accessToken);
  if (error || !data.user) {
    throw new WorkspaceAuthorityError(
      'forbidden',
      'Authenticated end-user access token was rejected or expired.',
    );
  }

  const repositoryFactory = overrides.repositoryFactory ?? supabaseWorkspaceRepository;
  const repository = repositoryFactory(client);
  if (command === 'bootstrap') {
    return { repository, authenticatedUserId: data.user.id };
  }

  // Do not turn show/list/health/mutations into an implicit bootstrap. The
  // explicit bootstrap command is the only CLI operation allowed to create.
  const { data: membershipRows, error: membershipError } = await client
    .from('workspace_members')
    .select('id')
    .eq('user_id', data.user.id)
    .eq('status', 'active')
    .limit(1);
  if (membershipError) {
    throw new WorkspaceAuthorityError('forbidden', 'Active workspace membership could not be verified.');
  }
  if (!membershipRows || membershipRows.length === 0) {
    throw new WorkspaceAuthorityError(
      'not-found',
      'No active workspace membership exists; run the bootstrap command first.',
    );
  }

  const resolveScope = overrides.resolveScope ?? resolveSupabaseWorkspaceScope;
  const scope = await resolveScope(client, data.user.id);
  return { repository, authenticatedUserId: data.user.id, scope };
}

function uuidOption(value: string | undefined, label: string): void {
  if (value !== undefined && !UUID_PATTERN.test(value)) {
    throw new WorkspaceAuthorityError('invalid-input', `${label} must be a UUID in live mode.`);
  }
}

async function executeSample(selected: Options): Promise<unknown> {
  if (selected.command === 'bootstrap') {
    return bootstrapWorkspaceCommand(
      createMemoryWorkspaceRepository({ mode: 'sample', durable: false }),
      { authenticatedUserId: SAMPLE_OWNER_USER_ID, mode: 'sample' },
      {
        name: selected.name ?? 'Omnix Sample Workspace',
        correlationId: selected.correlationId,
      },
    );
  }

  const repository = createSampleWorkspaceRepository(
    selected.command === 'members' || selected.command === 'revoke-member',
  );
  if (selected.command === 'show') return showWorkspaceCommand(repository, SAMPLE_WORKSPACE_SCOPE);
  if (selected.command === 'members') {
    return listWorkspaceMembershipsCommand(repository, SAMPLE_WORKSPACE_SCOPE);
  }
  if (selected.command === 'add-member') {
    return addWorkspaceMembershipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      userId: selected.userId,
      role: selected.role,
      correlationId: selected.correlationId,
    });
  }
  if (selected.command === 'revoke-member') {
    return revokeWorkspaceMembershipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      membershipId: selected.membershipId ?? SAMPLE_ASSISTANT_MEMBERSHIP_ID,
      correlationId: selected.correlationId,
    });
  }
  return workspaceHealthCommand(repository, SAMPLE_WORKSPACE_SCOPE);
}

async function executeLive(
  selected: Options,
  configuration: LiveWorkspaceConfiguration,
  contextFactory: NonNullable<WorkspaceCliDependencies['liveContext']>,
): Promise<unknown> {
  uuidOption(selected.correlationId, 'Correlation ID');
  if (selected.command === 'add-member') uuidOption(selected.userId, 'User ID');
  if (selected.command === 'revoke-member') uuidOption(selected.membershipId, 'Membership ID');

  const context = await contextFactory(configuration, selected.command);
  if (selected.command === 'bootstrap') {
    return bootstrapWorkspaceCommand(
      context.repository,
      { authenticatedUserId: context.authenticatedUserId, mode: 'live' },
      {
        name: selected.name ?? 'My Omnix Workspace',
        correlationId: selected.correlationId,
      },
    );
  }
  if (!context.scope) {
    throw new WorkspaceAuthorityError('scope-mismatch', 'Authenticated workspace scope is unavailable.');
  }
  if (selected.command === 'show') return showWorkspaceCommand(context.repository, context.scope);
  if (selected.command === 'members') {
    return listWorkspaceMembershipsCommand(context.repository, context.scope);
  }
  if (selected.command === 'add-member') {
    return addWorkspaceMembershipCommand(context.repository, context.scope, {
      userId: selected.userId,
      role: selected.role,
      correlationId: selected.correlationId,
    });
  }
  if (selected.command === 'revoke-member') {
    return revokeWorkspaceMembershipCommand(context.repository, context.scope, {
      membershipId: selected.membershipId,
      correlationId: selected.correlationId,
    });
  }
  return workspaceHealthCommand(context.repository, context.scope);
}

function userReference(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

function redactedMembership(membership: WorkspaceMembership) {
  return {
    id: membership.id,
    workspaceId: membership.workspaceId,
    userRef: userReference(membership.userId),
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
    updatedAt: membership.updatedAt,
    ...(membership.revokedAt ? { revokedAt: membership.revokedAt } : {}),
  };
}

function redactedSnapshot(snapshot: WorkspaceAuthoritySnapshot) {
  return {
    workspace: snapshot.workspace,
    currentMembership: redactedMembership(snapshot.currentMembership),
    scope: {
      membershipId: snapshot.scope.membershipId,
      workspaceId: snapshot.scope.workspaceId,
      role: snapshot.scope.role,
      mode: snapshot.scope.mode,
    },
    durable: snapshot.durable,
  };
}

function redactedLiveResult(command: WorkspaceCliCommand, result: unknown): unknown {
  if (command === 'bootstrap' || command === 'show') {
    return redactedSnapshot(result as WorkspaceAuthoritySnapshot);
  }
  if (command === 'members') {
    return (result as readonly WorkspaceMembership[]).map(redactedMembership);
  }
  if (command === 'add-member' || command === 'revoke-member') {
    return redactedMembership(result as WorkspaceMembership);
  }
  return result as WorkspaceHealthReport;
}

function exitCode(error: unknown): number {
  if (!(error instanceof WorkspaceAuthorityError)) return WORKSPACE_CLI_EXIT.internal;
  if (error.code === 'invalid-input') return WORKSPACE_CLI_EXIT.usage;
  if (
    error.code === 'forbidden'
    || error.code === 'revoked-membership'
    || error.code === 'scope-mismatch'
  ) {
    return WORKSPACE_CLI_EXIT.forbidden;
  }
  if (error.code === 'not-found') return WORKSPACE_CLI_EXIT.notFound;
  return WORKSPACE_CLI_EXIT.conflict;
}

function safeErrorMessage(error: unknown, live: boolean): string {
  if (!live) return error instanceof Error ? error.message : 'Unexpected workspace command failure.';
  if (!(error instanceof WorkspaceAuthorityError)) return 'Live workspace operation failed safely.';
  const messages: Record<typeof error.code, string> = {
    'invalid-input': error.message,
    forbidden: 'Authenticated owner authority is required for this workspace operation.',
    'not-found': 'The requested workspace authority record was not found.',
    conflict: 'The workspace operation conflicts with current authority state.',
    'invariant-violation': 'Workspace authority invariants rejected the operation.',
    'revoked-membership': 'The authenticated workspace membership is revoked.',
    'scope-mismatch': 'Authenticated workspace scope verification failed.',
  };
  return messages[error.code];
}

export async function runWorkspaceCli(
  argv: readonly string[],
  dependencies: WorkspaceCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  let live = argv.includes('--live');
  try {
    const selected = parseOptions(argv);
    if ('help' in selected) {
      stdout(`${usage()}\n`);
      return WORKSPACE_CLI_EXIT.success;
    }
    live = selected.live;
    const result = live
      ? await executeLive(
        selected,
        liveWorkspaceConfiguration(dependencies.env ?? process.env),
        dependencies.liveContext ?? createAuthenticatedLiveWorkspaceContext,
      )
      : await executeSample(selected);
    stdout(`${JSON.stringify({
      ok: true,
      schemaVersion: 'workspace-cli.v1',
      mode: live ? 'live-authenticated' : 'sample-process-only',
      durable: live,
      command: selected.command,
      result: live ? redactedLiveResult(selected.command, result) : result,
    }, null, 2)}\n`);
    return WORKSPACE_CLI_EXIT.success;
  } catch (error) {
    stderr(`${JSON.stringify({
      ok: false,
      schemaVersion: 'workspace-cli.v1',
      mode: live ? 'live-authenticated' : 'sample-process-only',
      code: error instanceof WorkspaceAuthorityError ? error.code : 'internal-error',
      message: safeErrorMessage(error, live),
    }, null, 2)}\n`);
    return exitCode(error);
  }
}

const entryPoint = process.argv[1];
const isMain = entryPoint
  ? import.meta.url === pathToFileURL(entryPoint).href
  : false;

if (isMain) {
  runWorkspaceCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
