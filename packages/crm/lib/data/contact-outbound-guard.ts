import type { WorkspaceScope } from '../domain/workspace.ts';

export interface ContactOutboundTarget {
  readonly contactId: string;
  readonly contactPointId?: string;
  readonly aliasEpoch: number;
}

/** Must be called at review and again immediately before provider dispatch. */
export interface ContactOutboundGuard {
  assertTarget(
    scope: WorkspaceScope,
    contactId: string,
    contactPointId?: string,
    reviewedAliasEpoch?: number,
  ): Promise<ContactOutboundTarget>;
}
