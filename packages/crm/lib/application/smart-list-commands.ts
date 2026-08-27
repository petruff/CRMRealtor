import type {
  SmartListContactSource,
  SmartListRepository,
} from '../data/smart-list-repository.ts';
import {
  applySmartListDefinition,
  parseSmartListDefinition,
  parseSmartListName,
  type SmartList,
  type SmartListStatus,
} from '../domain/smart-list.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';

export class SmartListCommandError extends Error {
  readonly code: 'invalid-input' | 'not-found' | 'conflict';
  constructor(code: SmartListCommandError['code'], message: string) {
    super(message);
    this.name = 'SmartListCommandError';
    this.code = code;
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw new SmartListCommandError('invalid-input', `${label} is invalid.`);
  }
  return value.trim();
}

function timestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new SmartListCommandError('invalid-input', 'Timestamp is invalid.');
  return now.toISOString();
}

export async function createSmartListCommand(
  repository: SmartListRepository,
  untrustedScope: WorkspaceScope,
  input: { name?: unknown; definition?: unknown },
  now = new Date(),
): Promise<SmartList> {
  const scope = validateWorkspaceScope(untrustedScope);
  return repository.create(scope, {
    name: parseSmartListName(input.name),
    definition: parseSmartListDefinition(input.definition),
    createdByMembershipId: scope.membershipId,
    createdAt: timestamp(now),
  });
}

export async function listSmartListsCommand(
  repository: SmartListRepository,
  untrustedScope: WorkspaceScope,
  status: SmartListStatus | 'all' = 'active',
): Promise<readonly SmartList[]> {
  return repository.list(validateWorkspaceScope(untrustedScope), status);
}

export async function showSmartListCommand(
  repository: SmartListRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
): Promise<SmartList> {
  const list = await repository.get(validateWorkspaceScope(untrustedScope), identifier(id, 'Smart List ID'));
  if (!list) throw new SmartListCommandError('not-found', 'Smart List not found.');
  return list;
}

export async function updateSmartListCommand(
  repository: SmartListRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  input: { name?: unknown; definition?: unknown },
  now = new Date(),
): Promise<SmartList> {
  if (input.name === undefined && input.definition === undefined) {
    throw new SmartListCommandError('invalid-input', 'Provide a name or definition to update.');
  }
  return repository.update(
    validateWorkspaceScope(untrustedScope),
    identifier(id, 'Smart List ID'),
    {
      ...(input.name === undefined ? {} : { name: parseSmartListName(input.name) }),
      ...(input.definition === undefined ? {} : {
        definition: parseSmartListDefinition(input.definition),
      }),
      updatedAt: timestamp(now),
    },
  );
}

export async function archiveSmartListCommand(
  repository: SmartListRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  reason?: unknown,
  now = new Date(),
): Promise<{ list: SmartList; noOp: boolean }> {
  const scope = validateWorkspaceScope(untrustedScope);
  const cleanReason = typeof reason === 'string' ? reason.trim() : undefined;
  if (cleanReason && cleanReason.length > 500) {
    throw new SmartListCommandError('invalid-input', 'Archive reason must be 500 characters or fewer.');
  }
  return repository.archive(scope, identifier(id, 'Smart List ID'), {
    actorMembershipId: scope.membershipId,
    archivedAt: timestamp(now),
    ...(cleanReason ? { reason: cleanReason } : {}),
  });
}

export async function restoreSmartListCommand(
  repository: SmartListRepository,
  untrustedScope: WorkspaceScope,
  id: unknown,
  now = new Date(),
): Promise<{ list: SmartList; noOp: boolean }> {
  return repository.restore(
    validateWorkspaceScope(untrustedScope),
    identifier(id, 'Smart List ID'),
    timestamp(now),
  );
}

export interface AppliedSmartList {
  readonly list: SmartList;
  readonly activeCriteria: SmartList['definition'];
  readonly contactIds: readonly string[];
  readonly clear: Readonly<{ criteria: readonly []; sort: null }>;
}

export async function applySmartListCommand(
  repository: SmartListRepository,
  contacts: SmartListContactSource,
  untrustedScope: WorkspaceScope,
  id: unknown,
): Promise<AppliedSmartList> {
  const scope = validateWorkspaceScope(untrustedScope);
  const list = await showSmartListCommand(repository, scope, id);
  if (list.status !== 'active') {
    throw new SmartListCommandError('conflict', 'Archived Smart Lists must be restored before use.');
  }
  const matches = applySmartListDefinition(await contacts.list(scope), list.definition);
  return {
    list,
    activeCriteria: list.definition,
    contactIds: matches.map((contact) => contact.id),
    clear: { criteria: [], sort: null },
  };
}
