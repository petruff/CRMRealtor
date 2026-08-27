import type { WorkspaceScope } from '../domain/workspace.ts';

export interface ContactAliasGroup {
  readonly requestedContactId: string;
  readonly canonicalContactId: string;
  readonly memberContactIds: readonly string[];
  readonly aliasEpoch: number;
}

/**
 * Canonical contact identity boundary used by repositories and outbound flows.
 * Implementations must remain workspace-scoped and return a one-level alias star.
 */
export interface ContactIdentityMap {
  resolveCanonical(scope: WorkspaceScope, contactId: string): Promise<string>;
  listGroupMembers(scope: WorkspaceScope, contactId: string): Promise<ContactAliasGroup>;
  /** One bounded lookup for list/search pages; never one RPC per contact. */
  resolvePage(scope: WorkspaceScope, contactIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Allows bounded list reads to use direct ranges when no active donor aliases exist. */
  hasActiveAliases?(scope: WorkspaceScope): Promise<boolean>;
}

export function passthroughContactIdentityMap(): ContactIdentityMap {
  return {
    async resolveCanonical(_scope, contactId) { return contactId; },
    async listGroupMembers(_scope, contactId) {
      return {
        requestedContactId: contactId,
        canonicalContactId: contactId,
        memberContactIds: [contactId],
        aliasEpoch: 0,
      };
    },
    async resolvePage(_scope, contactIds) {
      return new Map(contactIds.map((contactId) => [contactId, contactId]));
    },
    async hasActiveAliases() { return false; },
  };
}
