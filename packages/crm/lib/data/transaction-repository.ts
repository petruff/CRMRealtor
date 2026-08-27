import type { CreateRealEstateTransactionInput, RealEstateTransaction } from '@/lib/domain/transaction';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface TransactionRepository {
  list(scope: WorkspaceScope): Promise<readonly RealEstateTransaction[]>;
  create(scope: WorkspaceScope, input: CreateRealEstateTransactionInput): Promise<RealEstateTransaction>;
}
