import type {
  ArchivePropertyInterestInput,
  CreateManualPropertyInput,
  LinkPropertyInterestInput,
  LinkTransactionPropertyInput,
  PropertyFact,
  PropertyIdentity,
  PropertyInterest,
  TransactionPropertyLink,
  UpdatePropertyIdentityInput,
  UpsertPropertyFactInput,
} from '@/lib/domain/property';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface PropertyRepository {
  list(scope: WorkspaceScope, options?: { readonly limit?: number }): Promise<readonly PropertyIdentity[]>;
  listFacts(scope: WorkspaceScope, propertyIds?: readonly string[]): Promise<readonly PropertyFact[]>;
  listInterests(scope: WorkspaceScope, options?: { readonly propertyId?: string; readonly contactId?: string; readonly includeArchived?: boolean }): Promise<readonly PropertyInterest[]>;
  listTransactionLinks(scope: WorkspaceScope, propertyIds?: readonly string[]): Promise<readonly TransactionPropertyLink[]>;
  createManual(scope: WorkspaceScope, input: CreateManualPropertyInput, occurredAt: string): Promise<PropertyIdentity>;
  updateIdentity(scope: WorkspaceScope, input: UpdatePropertyIdentityInput, occurredAt: string): Promise<PropertyIdentity>;
  upsertFact(scope: WorkspaceScope, input: UpsertPropertyFactInput, occurredAt: string): Promise<PropertyFact>;
  linkInterest(scope: WorkspaceScope, input: LinkPropertyInterestInput, occurredAt: string): Promise<PropertyInterest>;
  archiveInterest(scope: WorkspaceScope, input: ArchivePropertyInterestInput, occurredAt: string): Promise<PropertyInterest>;
  linkTransaction(scope: WorkspaceScope, input: LinkTransactionPropertyInput, occurredAt: string): Promise<TransactionPropertyLink>;
}
