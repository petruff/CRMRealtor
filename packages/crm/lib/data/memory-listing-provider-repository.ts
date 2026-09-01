import { randomUUID } from 'node:crypto';
import { validateListingProviderAuthority } from '@/lib/domain/licensed-listing-provider';
import { validateWorkspaceScope } from '@/lib/domain/workspace';
import type { ListingProviderRepository, StoredListingProviderAuthority } from './listing-provider-repository';

export function createMemoryListingProviderRepository(): ListingProviderRepository {
  const authorities = new Map<string, StoredListingProviderAuthority>();
  return {
    async listAuthorities(scopeValue) {
      const scope = validateWorkspaceScope(scopeValue);
      return [...authorities.values()].filter((item) => item.workspaceId === scope.workspaceId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async configureAuthority(scopeValue, authorityValue, occurredAt) {
      const scope = validateWorkspaceScope(scopeValue);
      if (scope.role !== 'owner') throw new Error('Only the workspace owner can configure licensed listing access.');
      const authority = validateListingProviderAuthority(authorityValue);
      const existing = [...authorities.values()].find((item) => item.workspaceId === scope.workspaceId && item.providerKey === authority.providerKey);
      const saved: StoredListingProviderAuthority = Object.freeze({ ...authority,id:existing?.id??randomUUID(),workspaceId:scope.workspaceId,createdByMembershipId:existing?.createdByMembershipId??scope.membershipId,updatedByMembershipId:scope.membershipId,createdAt:existing?.createdAt??occurredAt,updatedAt:occurredAt });
      authorities.set(saved.id,saved); return saved;
    },
    async revokeAuthority(scopeValue, authorityId, reasonCode, occurredAt) {
      const scope = validateWorkspaceScope(scopeValue);
      if (scope.role !== 'owner') throw new Error('Only the workspace owner can revoke licensed listing access.');
      if (!/^[a-z][a-z0-9._-]{1,79}$/u.test(reasonCode)) throw new Error('Revocation reason is invalid.');
      const existing = authorities.get(authorityId);
      if (!existing || existing.workspaceId !== scope.workspaceId) throw new Error('Listing provider authority was not found.');
      const saved = Object.freeze({ ...existing,state:'revoked' as const,credentialBindingReference:undefined,updatedByMembershipId:scope.membershipId,updatedAt:occurredAt });
      authorities.set(saved.id,saved); return saved;
    },
  };
}
