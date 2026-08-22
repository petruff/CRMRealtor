import type { Contact } from '../domain/contact.ts';
import type { SmartList, SmartListDefinitionV1, SmartListStatus } from '../domain/smart-list.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface SmartListContactSource {
  list(scope: WorkspaceScope): Promise<readonly Contact[]>;
}

export interface CreateSmartListRecord {
  readonly name: string;
  readonly definition: SmartListDefinitionV1;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
}

export interface UpdateSmartListRecord {
  readonly name?: string;
  readonly definition?: SmartListDefinitionV1;
  readonly updatedAt: string;
}

export interface ArchiveSmartListRecord {
  readonly actorMembershipId: string;
  readonly archivedAt: string;
  readonly reason?: string;
}

export interface SmartListRepository {
  list(scope: WorkspaceScope, status?: SmartListStatus | 'all'): Promise<readonly SmartList[]>;
  get(scope: WorkspaceScope, id: string): Promise<SmartList | undefined>;
  create(scope: WorkspaceScope, input: CreateSmartListRecord): Promise<SmartList>;
  update(scope: WorkspaceScope, id: string, input: UpdateSmartListRecord): Promise<SmartList>;
  archive(
    scope: WorkspaceScope,
    id: string,
    input: ArchiveSmartListRecord,
  ): Promise<{ list: SmartList; noOp: boolean }>;
  restore(
    scope: WorkspaceScope,
    id: string,
    restoredAt: string,
  ): Promise<{ list: SmartList; noOp: boolean }>;
}
