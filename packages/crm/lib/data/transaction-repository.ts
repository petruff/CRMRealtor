import type { AddTransactionPartyInput, ArchiveTransactionPartyInput, CreateRealEstateTransactionInput, RealEstateTransaction, TransactionParty, TransitionRealEstateTransactionInput, UpdateRealEstateTransactionInput, UpdateTransactionPartyInput } from '@/lib/domain/transaction';
import type { TransactionFinancialAuthority, UpsertTransactionFinancialAuthorityInput } from '@/lib/domain/transaction-finance';
import type { StartWorkflowPlanInput, TransactionWorkflowPlan, TransactionWorkflowStep, TransitionWorkflowStepInput, WorkflowPackDefinition } from '@/lib/domain/workflow-pack';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface TransactionRepository {
  list(scope: WorkspaceScope): Promise<readonly RealEstateTransaction[]>;
  listParties(scope: WorkspaceScope, transactionIds?: readonly string[]): Promise<readonly TransactionParty[]>;
  listFinancials(scope: WorkspaceScope, transactionIds?: readonly string[]): Promise<readonly TransactionFinancialAuthority[]>;
  listWorkflowPacks(scope: WorkspaceScope): Promise<readonly WorkflowPackDefinition[]>;
  listWorkflowPlans(scope: WorkspaceScope, transactionIds?: readonly string[]): Promise<readonly TransactionWorkflowPlan[]>;
  listWorkflowSteps(scope: WorkspaceScope, planIds?: readonly string[]): Promise<readonly TransactionWorkflowStep[]>;
  create(scope: WorkspaceScope, input: CreateRealEstateTransactionInput): Promise<RealEstateTransaction>;
  update(scope: WorkspaceScope, input: UpdateRealEstateTransactionInput, occurredAt: string): Promise<RealEstateTransaction>;
  addParty(scope: WorkspaceScope, input: AddTransactionPartyInput, occurredAt: string): Promise<TransactionParty>;
  updateParty(scope: WorkspaceScope, input: UpdateTransactionPartyInput, occurredAt: string): Promise<TransactionParty>;
  archiveParty(scope: WorkspaceScope, input: ArchiveTransactionPartyInput, occurredAt: string): Promise<TransactionParty>;
  upsertFinancials(scope: WorkspaceScope, input: UpsertTransactionFinancialAuthorityInput, occurredAt: string): Promise<TransactionFinancialAuthority>;
  startWorkflowPlan(scope: WorkspaceScope, input: StartWorkflowPlanInput, occurredAt: string): Promise<TransactionWorkflowPlan>;
  transitionWorkflowStep(scope: WorkspaceScope, input: TransitionWorkflowStepInput, occurredAt: string): Promise<TransactionWorkflowStep>;
  transition(scope: WorkspaceScope, input: TransitionRealEstateTransactionInput, occurredAt: string): Promise<RealEstateTransaction>;
}
