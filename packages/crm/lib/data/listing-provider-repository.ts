import type { ListingProviderAuthority } from '@/lib/domain/licensed-listing-provider';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface StoredListingProviderAuthority extends ListingProviderAuthority {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByMembershipId: string;
  readonly updatedByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListingProviderRepository {
  listAuthorities(scope: WorkspaceScope): Promise<readonly StoredListingProviderAuthority[]>;
  configureAuthority(scope: WorkspaceScope, authority: ListingProviderAuthority, occurredAt: string): Promise<StoredListingProviderAuthority>;
  revokeAuthority(scope: WorkspaceScope, authorityId: string, reasonCode: string, occurredAt: string): Promise<StoredListingProviderAuthority>;
}
