import {
  archiveSmartList,
  parseSmartListDefinition,
  parseSmartListName,
  restoreSmartList,
  SmartListValidationError,
  type SmartList,
} from '../domain/smart-list.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { SmartListRepository } from './smart-list-repository.ts';

export interface MemorySmartListRepositoryOptions {
  readonly initialLists?: readonly SmartList[];
  readonly idPrefix?: string;
}

function clone(list: SmartList): SmartList {
  return {
    ...list,
    definition: parseSmartListDefinition(list.definition),
  };
}

export function createMemorySmartListRepository(
  options: MemorySmartListRepositoryOptions = {},
): SmartListRepository {
  const rows = (options.initialLists ?? []).map(clone);
  let sequence = rows.length + 1;
  const idPrefix = options.idPrefix ?? 'smart-list';

  function scoped(scope: WorkspaceScope): WorkspaceScope {
    return validateWorkspaceScope(scope);
  }

  function indexFor(scope: WorkspaceScope, id: string): number {
    const authorized = scoped(scope);
    return rows.findIndex((row) => row.id === id && row.workspaceId === authorized.workspaceId);
  }

  function requireList(scope: WorkspaceScope, id: string): { index: number; list: SmartList } {
    const index = indexFor(scope, id);
    const list = rows[index];
    if (index < 0 || !list) {
      throw new SmartListValidationError('Smart List not found.', {}, 'conflict');
    }
    return { index, list };
  }

  return {
    async list(scope, status = 'active') {
      const authorized = scoped(scope);
      return rows
        .filter((row) => row.workspaceId === authorized.workspaceId && (status === 'all' || row.status === status))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        .map(clone);
    },

    async get(scope, id) {
      const index = indexFor(scope, id);
      const list = rows[index];
      return list ? clone(list) : undefined;
    },

    async create(scope, input) {
      const authorized = scoped(scope);
      if (input.createdByMembershipId !== authorized.membershipId) {
        throw new SmartListValidationError('Smart List actor does not match workspace authority.', {}, 'conflict');
      }
      const list: SmartList = {
        id: `${idPrefix}-${String(sequence++).padStart(4, '0')}`,
        workspaceId: authorized.workspaceId,
        name: parseSmartListName(input.name),
        definition: parseSmartListDefinition(input.definition),
        status: 'active',
        createdByMembershipId: authorized.membershipId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      rows.push(list);
      return clone(list);
    },

    async update(scope, id, input) {
      const current = requireList(scope, id);
      const next: SmartList = {
        ...current.list,
        ...(input.name === undefined ? {} : { name: parseSmartListName(input.name) }),
        ...(input.definition === undefined ? {} : {
          definition: parseSmartListDefinition(input.definition),
        }),
        updatedAt: input.updatedAt,
      };
      rows[current.index] = next;
      return clone(next);
    },

    async archive(scope, id, input) {
      const authorized = scoped(scope);
      if (input.actorMembershipId !== authorized.membershipId) {
        throw new SmartListValidationError('Smart List actor does not match workspace authority.', {}, 'conflict');
      }
      const current = requireList(scope, id);
      const result = archiveSmartList(
        current.list,
        input.actorMembershipId,
        input.archivedAt,
        input.reason,
      );
      rows[current.index] = result.list;
      return { list: clone(result.list), noOp: result.noOp };
    },

    async restore(scope, id, restoredAt) {
      const current = requireList(scope, id);
      const result = restoreSmartList(current.list, restoredAt);
      rows[current.index] = result.list;
      return { list: clone(result.list), noOp: result.noOp };
    },
  };
}
