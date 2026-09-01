import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadSource } from '../domain/contact.ts';
import { validateTransactionInput, validateTransactionPartyArchive, validateTransactionPartyInput, validateTransactionPartyUpdate, validateTransactionTransition, validateTransactionUpdate, type RealEstateTransaction, type StoredTransactionKind, type TransactionParty, type TransactionPartyRole, type TransactionSide, type TransactionStatus } from '../domain/transaction.ts';
import { validateFinancialAuthorityInput, type FinancialSourceType, type FinancialVerificationState, type TransactionFinancialAuthority } from '../domain/transaction-finance.ts';
import { validateWorkflowStepTransition, type TransactionWorkflowPlan, type TransactionWorkflowStep, type WorkflowPackDefinition, type WorkflowPackType, type WorkflowReviewState, type WorkflowStepState } from '../domain/workflow-pack.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import type { TransactionRepository } from './transaction-repository.ts';

interface TransactionRow {
  id: string; workspace_id: string; contact_id: string; status: TransactionStatus; side: TransactionSide;
  transaction_kind: StoredTransactionKind; kind_verified: boolean; title: string;
  property_address: string; source: LeadSource; expected_close_date: string | null; closed_at: string | null;
  sale_price_cents: number; gross_commission_cents: number; net_commission_cents: number;
  marketing_cost_cents: number; expense_cents: number; responsible_membership_id: string;
  next_action: string | null; next_action_due_at: string | null; current_version: number; created_by_membership_id: string;
  created_at: string; updated_at: string; contacts: { first_name: string; last_name: string; preferred_name: string | null } | null;
}

interface PartyRow {
  id: string; workspace_id: string; transaction_id: string; contact_id: string | null;
  role: TransactionPartyRole; display_label: string; participates_in_communication: boolean;
  current_version: number; archived_at: string | null; created_by_membership_id: string;
  created_at: string; updated_at: string;
}

interface FinancialRow {
  id: string; workspace_id: string; transaction_id: string;
  transaction_value_cents: number | null; volume_basis_cents: number | null; gross_commission_cents: number | null;
  brokerage_split_cents: number | null; referral_fee_cents: number | null; net_commission_cents: number | null;
  marketing_cost_cents: number | null; other_expense_cents: number | null; source_type: FinancialSourceType;
  source_reference: string; effective_date: string; verification_state: FinancialVerificationState;
  current_version: number; updated_by_membership_id: string; created_at: string; updated_at: string;
}
interface WorkflowPackRow { id:string;pack_type:WorkflowPackType;name:string;version:number;effective_date:string;source_title:string;source_url:string;review_state:WorkflowReviewState;is_current:boolean;legal_boundary:string;created_at:string;workflow_pack_steps:{step_key:string;title:string;position:number;responsible_role:'owner'|'assistant'|'either';evidence_requirement:string;acknowledgement_required:boolean;legal_boundary:string}[] }
interface WorkflowPlanRow { id:string;workspace_id:string;transaction_id:string;pack_definition_id:string;pack_type:WorkflowPackType;pack_name:string;pack_version:number;definition_snapshot:WorkflowPackDefinition;status:'active'|'completed'|'cancelled';current_version:number;started_by_membership_id:string;created_at:string;updated_at:string }
interface WorkflowStepRow { id:string;workspace_id:string;plan_id:string;step_key:string;title:string;state:WorkflowStepState;responsible_membership_id:string;evidence_requirement:string;evidence_reference:string|null;acknowledgement_required:boolean;acknowledged_at:string|null;legal_boundary:string;current_version:number;updated_at:string }

function fromRow(row: TransactionRow): RealEstateTransaction {
  const contact = row.contacts;
  return {
    id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id,
    contactName: contact ? `${contact.preferred_name ?? contact.first_name} ${contact.last_name}`.trim() : 'Contact record',
    kind: row.transaction_kind, kindVerified: row.kind_verified, title: row.title,
    status: row.status, side: row.side, propertyAddress: row.property_address, source: row.source,
    expectedCloseDate: row.expected_close_date ?? undefined, closedAt: row.closed_at ?? undefined,
    salePriceCents: row.sale_price_cents, grossCommissionCents: row.gross_commission_cents,
    netCommissionCents: row.net_commission_cents, marketingCostCents: row.marketing_cost_cents,
    expenseCents: row.expense_cents, responsibleMembershipId: row.responsible_membership_id,
    nextAction: row.next_action ?? undefined, nextActionDueAt: row.next_action_due_at ?? undefined,
    version: row.current_version, createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const COLUMNS = 'id,workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,property_address,source,expected_close_date,closed_at,sale_price_cents,gross_commission_cents,net_commission_cents,marketing_cost_cents,expense_cents,responsible_membership_id,next_action,next_action_due_at,current_version,created_by_membership_id,created_at,updated_at,contacts(first_name,last_name,preferred_name)';
const PARTY_COLUMNS = 'id,workspace_id,transaction_id,contact_id,role,display_label,participates_in_communication,current_version,archived_at,created_by_membership_id,created_at,updated_at';
const FINANCIAL_COLUMNS = 'id,workspace_id,transaction_id,transaction_value_cents,volume_basis_cents,gross_commission_cents,brokerage_split_cents,referral_fee_cents,net_commission_cents,marketing_cost_cents,other_expense_cents,source_type,source_reference,effective_date,verification_state,current_version,updated_by_membership_id,created_at,updated_at';
const WORKFLOW_PLAN_COLUMNS = 'id,workspace_id,transaction_id,pack_definition_id,pack_type,pack_name,pack_version,definition_snapshot,status,current_version,started_by_membership_id,created_at,updated_at';
const WORKFLOW_STEP_COLUMNS = 'id,workspace_id,plan_id,step_key,title,state,responsible_membership_id,evidence_requirement,evidence_reference,acknowledgement_required,acknowledged_at,legal_boundary,current_version,updated_at';
const fromParty = (row: PartyRow): TransactionParty => ({
  id: row.id, workspaceId: row.workspace_id, transactionId: row.transaction_id,
  contactId: row.contact_id ?? undefined, role: row.role, displayLabel: row.display_label,
  participatesInCommunication: row.participates_in_communication, version: row.current_version,
  archivedAt: row.archived_at ?? undefined, createdByMembershipId: row.created_by_membership_id,
  createdAt: row.created_at, updatedAt: row.updated_at,
});
const fromFinancial = (row: FinancialRow): TransactionFinancialAuthority => ({
  id: row.id, workspaceId: row.workspace_id, transactionId: row.transaction_id,
  transactionValueCents: row.transaction_value_cents ?? undefined, volumeBasisCents: row.volume_basis_cents ?? undefined,
  grossCommissionCents: row.gross_commission_cents ?? undefined, brokerageSplitCents: row.brokerage_split_cents ?? undefined,
  referralFeeCents: row.referral_fee_cents ?? undefined, netCommissionCents: row.net_commission_cents ?? undefined,
  marketingCostCents: row.marketing_cost_cents ?? undefined, otherExpenseCents: row.other_expense_cents ?? undefined,
  sourceType: row.source_type, sourceReference: row.source_reference, effectiveDate: row.effective_date,
  verificationState: row.verification_state, version: row.current_version,
  updatedByMembershipId: row.updated_by_membership_id, createdAt: row.created_at, updatedAt: row.updated_at,
});
const fromWorkflowPack = (row: WorkflowPackRow): WorkflowPackDefinition => ({
  id:row.id,packType:row.pack_type,name:row.name,version:row.version,effectiveDate:row.effective_date,sourceTitle:row.source_title,
  sourceUrl:row.source_url,reviewState:row.review_state,isCurrent:row.is_current,legalBoundary:row.legal_boundary,
  steps:row.workflow_pack_steps.slice().sort((a,b)=>a.position-b.position).map((step)=>({key:step.step_key,title:step.title,
    responsibleRole:step.responsible_role,evidenceRequirement:step.evidence_requirement,acknowledgementRequired:step.acknowledgement_required,legalBoundary:step.legal_boundary})),createdAt:row.created_at,
});
const fromWorkflowPlan=(row:WorkflowPlanRow):TransactionWorkflowPlan=>({id:row.id,workspaceId:row.workspace_id,transactionId:row.transaction_id,
  packDefinitionId:row.pack_definition_id,packType:row.pack_type,packName:row.pack_name,packVersion:row.pack_version,
  definitionSnapshot:row.definition_snapshot,status:row.status,version:row.current_version,startedByMembershipId:row.started_by_membership_id,
  createdAt:row.created_at,updatedAt:row.updated_at});
const fromWorkflowStep=(row:WorkflowStepRow):TransactionWorkflowStep=>({id:row.id,workspaceId:row.workspace_id,planId:row.plan_id,
  stepKey:row.step_key,title:row.title,state:row.state,responsibleMembershipId:row.responsible_membership_id,
  evidenceRequirement:row.evidence_requirement,evidenceReference:row.evidence_reference??undefined,
  acknowledgementRequired:row.acknowledgement_required,acknowledgedAt:row.acknowledged_at??undefined,legalBoundary:row.legal_boundary,
  version:row.current_version,updatedAt:row.updated_at});

export function supabaseTransactionRepository(client: SupabaseClient): TransactionRepository {
  return {
    async list(untrustedScope) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transactions require a live workspace.');
      const { data, error } = await client.from('real_estate_transactions').select(COLUMNS)
        .eq('workspace_id', scope.workspaceId).order('updated_at', { ascending: false }).limit(1000);
      if (error) throw new Error(`Transaction ledger is unavailable: ${error.message}`);
      return (data as unknown as TransactionRow[]).map(fromRow);
    },
    async listParties(untrustedScope, transactionIds) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transaction parties require a live workspace.');
      let query = client.from('transaction_parties').select(PARTY_COLUMNS)
        .eq('workspace_id', scope.workspaceId).is('archived_at', null).order('created_at', { ascending: true }).limit(1000);
      if (transactionIds?.length) query = query.in('transaction_id', [...transactionIds]);
      const { data, error } = await query;
      if (error) throw new Error(`Transaction parties are unavailable: ${error.message}`);
      return (data as unknown as PartyRow[]).map(fromParty);
    },
    async listFinancials(untrustedScope, transactionIds) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transaction financials require a live workspace.');
      let query = client.from('transaction_financial_authorities').select(FINANCIAL_COLUMNS)
        .eq('workspace_id', scope.workspaceId).order('updated_at', { ascending: false }).limit(1000);
      if (transactionIds?.length) query = query.in('transaction_id', [...transactionIds]);
      const { data, error } = await query;
      if (error) throw new Error(`Transaction financial records are unavailable: ${error.message}`);
      return (data as unknown as FinancialRow[]).map(fromFinancial);
    },
    async listWorkflowPacks(untrustedScope) {
      const scope=validateWorkspaceScope(untrustedScope); if(scope.mode!=='live') throw new Error('Live workflow packs require a live workspace.');
      const {data,error}=await client.from('workflow_pack_definitions').select('id,pack_type,name,version,effective_date,source_title,source_url,review_state,is_current,legal_boundary,created_at,workflow_pack_steps(step_key,title,position,responsible_role,evidence_requirement,acknowledgement_required,legal_boundary)').order('pack_type').order('version',{ascending:false});
      if(error) throw new Error(`Workflow pack library is unavailable: ${error.message}`); return (data as unknown as WorkflowPackRow[]).map(fromWorkflowPack);
    },
    async listWorkflowPlans(untrustedScope,transactionIds) {
      const scope=validateWorkspaceScope(untrustedScope); if(scope.mode!=='live') throw new Error('Live workflow plans require a live workspace.');
      let query=client.from('transaction_workflow_plans').select(WORKFLOW_PLAN_COLUMNS).eq('workspace_id',scope.workspaceId).order('updated_at',{ascending:false}).limit(500);
      if(transactionIds?.length) query=query.in('transaction_id',[...transactionIds]); const {data,error}=await query;
      if(error) throw new Error(`Transaction workflows are unavailable: ${error.message}`); return (data as unknown as WorkflowPlanRow[]).map(fromWorkflowPlan);
    },
    async listWorkflowSteps(untrustedScope,planIds) {
      const scope=validateWorkspaceScope(untrustedScope); if(scope.mode!=='live') throw new Error('Live workflow steps require a live workspace.');
      let query=client.from('transaction_workflow_steps').select(WORKFLOW_STEP_COLUMNS).eq('workspace_id',scope.workspaceId).order('position',{ascending:true}).limit(1000);
      if(planIds?.length) query=query.in('plan_id',[...planIds]); const {data,error}=await query;
      if(error) throw new Error(`Transaction workflow steps are unavailable: ${error.message}`); return (data as unknown as WorkflowStepRow[]).map(fromWorkflowStep);
    },
    async create(untrustedScope, untrustedInput) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transactions require a live workspace.');
      const input = validateTransactionInput(untrustedInput);
      const { data, error } = await client.rpc('create_real_estate_transaction_v2', {
        target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId,
        target_contact_id: input.contactId, target_transaction_kind: input.kind, target_title: input.title,
        target_status: input.status, target_side: input.side,
        target_property_address: input.propertyAddress, target_expected_close_date: input.expectedCloseDate ?? null,
        target_closed_at: input.closedAt ?? null, target_sale_price_cents: input.salePriceCents,
        target_gross_commission_cents: input.grossCommissionCents,
        target_net_commission_cents: input.netCommissionCents,
        target_marketing_cost_cents: input.marketingCostCents, target_expense_cents: input.expenseCents,
        target_responsible_membership_id: scope.membershipId, target_next_action: input.nextAction ?? null,
        target_next_action_due_at: input.nextActionDueAt ?? null,
        target_idempotency_key: input.idempotencyKey,
      });
      if (error) throw new Error(`Transaction could not be saved: ${error.message}`);
      const receipt = data as { transactionId?: string } | null;
      if (!receipt?.transactionId) throw new Error('Transaction receipt was incomplete.');
      const { data: row, error: readError } = await client.from('real_estate_transactions').select(COLUMNS)
        .eq('id', receipt.transactionId).eq('workspace_id', scope.workspaceId).single();
      if (readError || !row) throw new Error('Transaction was saved but its receipt could not be loaded.');
      return fromRow(row as unknown as TransactionRow);
    },
    async update(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transactions require a live workspace.');
      const input = validateTransactionUpdate(untrustedInput);
      const { data, error } = await client.rpc('update_real_estate_transaction', {
        target_workspace_id: scope.workspaceId,
        target_membership_id: scope.membershipId,
        target_transaction_id: input.transactionId,
        target_expected_version: input.expectedVersion,
        target_transaction_kind: input.kind,
        target_title: input.title,
        target_side: input.side,
        target_property_address: input.propertyAddress,
        target_expected_close_date: input.expectedCloseDate ?? null,
        target_sale_price_cents: input.salePriceCents,
        target_gross_commission_cents: input.grossCommissionCents,
        target_net_commission_cents: input.netCommissionCents,
        target_marketing_cost_cents: input.marketingCostCents,
        target_expense_cents: input.expenseCents,
        target_next_action: input.nextAction ?? null,
        target_next_action_due_at: input.nextActionDueAt ?? null,
        target_reason_code: input.reasonCode,
        target_idempotency_key: input.idempotencyKey,
        target_occurred_at: occurredAt,
      });
      if (error) throw new Error(`Transaction details could not be saved: ${error.message}`);
      const receipt = data as { transactionId?: string } | null;
      if (!receipt?.transactionId) throw new Error('Transaction update receipt was incomplete.');
      const { data: row, error: readError } = await client.from('real_estate_transactions').select(COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', receipt.transactionId).single();
      if (readError || !row) throw new Error('Transaction was updated but could not be loaded.');
      return fromRow(row as unknown as TransactionRow);
    },
    async addParty(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transaction parties require a live workspace.');
      const input = validateTransactionPartyInput(untrustedInput);
      const { data, error } = await client.rpc('add_transaction_party', {
        target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId,
        target_transaction_id: input.transactionId, target_contact_id: input.contactId ?? null,
        target_role: input.role, target_display_label: input.displayLabel,
        target_participates_in_communication: input.participatesInCommunication,
        target_idempotency_key: input.idempotencyKey, target_occurred_at: occurredAt,
      });
      if (error) throw new Error(`Transaction party could not be saved: ${error.message}`);
      const receipt = data as { partyId?: string } | null;
      if (!receipt?.partyId) throw new Error('Transaction party receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_parties').select(PARTY_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', receipt.partyId).single();
      if (readError || !row) throw new Error('Transaction party was saved but could not be loaded.');
      return fromParty(row as unknown as PartyRow);
    },
    async updateParty(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transaction parties require a live workspace.');
      const input = validateTransactionPartyUpdate(untrustedInput);
      const { data, error } = await client.rpc('update_transaction_party', {
        target_workspace_id: scope.workspaceId,
        target_membership_id: scope.membershipId,
        target_party_id: input.partyId,
        target_expected_version: input.expectedVersion,
        target_role: input.role,
        target_display_label: input.displayLabel,
        target_participates_in_communication: input.participatesInCommunication,
        target_idempotency_key: input.idempotencyKey,
        target_occurred_at: occurredAt,
      });
      if (error) throw new Error(`Transaction party could not be updated: ${error.message}`);
      const receipt = data as { partyId?: string } | null;
      if (!receipt?.partyId) throw new Error('Transaction party update receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_parties').select(PARTY_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', receipt.partyId).single();
      if (readError || !row) throw new Error('Transaction party was updated but could not be loaded.');
      return fromParty(row as unknown as PartyRow);
    },
    async archiveParty(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transaction parties require a live workspace.');
      const input = validateTransactionPartyArchive(untrustedInput);
      const { data, error } = await client.rpc('archive_transaction_party', {
        target_workspace_id: scope.workspaceId,
        target_membership_id: scope.membershipId,
        target_party_id: input.partyId,
        target_expected_version: input.expectedVersion,
        target_reason_code: input.reasonCode,
        target_idempotency_key: input.idempotencyKey,
        target_occurred_at: occurredAt,
      });
      if (error) throw new Error(`Transaction party could not be archived: ${error.message}`);
      const receipt = data as { partyId?: string } | null;
      if (!receipt?.partyId) throw new Error('Transaction party archive receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_parties').select(PARTY_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', receipt.partyId).single();
      if (readError || !row) throw new Error('Transaction party was archived but could not be loaded.');
      return fromParty(row as unknown as PartyRow);
    },
    async upsertFinancials(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transaction financials require a live workspace.');
      const input = validateFinancialAuthorityInput(untrustedInput);
      const { data, error } = await client.rpc('upsert_transaction_financial_authority', {
        target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId,
        target_transaction_id: input.transactionId, target_expected_version: input.expectedVersion,
        target_transaction_value_cents: input.transactionValueCents ?? null, target_volume_basis_cents: input.volumeBasisCents ?? null,
        target_gross_commission_cents: input.grossCommissionCents ?? null, target_brokerage_split_cents: input.brokerageSplitCents ?? null,
        target_referral_fee_cents: input.referralFeeCents ?? null, target_net_commission_cents: input.netCommissionCents ?? null,
        target_marketing_cost_cents: input.marketingCostCents ?? null, target_other_expense_cents: input.otherExpenseCents ?? null,
        target_source_type: input.sourceType, target_source_reference: input.sourceReference,
        target_effective_date: input.effectiveDate, target_verification_state: input.verificationState,
        target_reason_code: input.reasonCode, target_idempotency_key: input.idempotencyKey, target_occurred_at: occurredAt,
      });
      if (error) throw new Error(`Transaction financial record could not be saved: ${error.message}`);
      const receipt = data as { financialAuthorityId?: string } | null;
      if (!receipt?.financialAuthorityId) throw new Error('Transaction financial receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_financial_authorities').select(FINANCIAL_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', receipt.financialAuthorityId).single();
      if (readError || !row) throw new Error('Transaction financial record was saved but could not be loaded.');
      return fromFinancial(row as unknown as FinancialRow);
    },
    async startWorkflowPlan(untrustedScope,input,occurredAt) {
      const scope=validateWorkspaceScope(untrustedScope); if(scope.mode!=='live') throw new Error('Live workflow plans require a live workspace.');
      const {data,error}=await client.rpc('start_transaction_workflow_plan',{target_workspace_id:scope.workspaceId,target_membership_id:scope.membershipId,
        target_transaction_id:input.transactionId,target_pack_definition_id:input.packDefinitionId,target_responsible_membership_id:input.responsibleMembershipId,
        target_idempotency_key:input.idempotencyKey,target_occurred_at:occurredAt});
      if(error) throw new Error(`Workflow plan could not be started: ${error.message}`); const receipt=data as {planId?:string}|null;
      if(!receipt?.planId) throw new Error('Workflow plan receipt was incomplete.'); const {data:row,error:readError}=await client.from('transaction_workflow_plans').select(WORKFLOW_PLAN_COLUMNS).eq('workspace_id',scope.workspaceId).eq('id',receipt.planId).single();
      if(readError||!row) throw new Error('Workflow plan started but could not be loaded.'); return fromWorkflowPlan(row as unknown as WorkflowPlanRow);
    },
    async transitionWorkflowStep(untrustedScope,untrustedInput,occurredAt) {
      const scope=validateWorkspaceScope(untrustedScope); if(scope.mode!=='live') throw new Error('Live workflow steps require a live workspace.');
      const {data:current,error:currentError}=await client.from('transaction_workflow_steps').select(WORKFLOW_STEP_COLUMNS).eq('workspace_id',scope.workspaceId).eq('id',untrustedInput.stepId).single();
      if(currentError||!current) throw new Error('Workflow step was not found.'); const input=validateWorkflowStepTransition(fromWorkflowStep(current as unknown as WorkflowStepRow),untrustedInput);
      const {data,error}=await client.rpc('transition_transaction_workflow_step',{target_workspace_id:scope.workspaceId,target_membership_id:scope.membershipId,
        target_step_id:input.stepId,target_expected_version:input.expectedVersion,target_state:input.state,target_evidence_reference:input.evidenceReference??null,
        target_acknowledged:input.acknowledged,target_reason_code:input.reasonCode,target_idempotency_key:input.idempotencyKey,target_occurred_at:occurredAt});
      if(error) throw new Error(`Workflow step could not be updated: ${error.message}`); const receipt=data as {stepId?:string}|null;
      if(!receipt?.stepId) throw new Error('Workflow step receipt was incomplete.'); const {data:row,error:readError}=await client.from('transaction_workflow_steps').select(WORKFLOW_STEP_COLUMNS).eq('workspace_id',scope.workspaceId).eq('id',receipt.stepId).single();
      if(readError||!row) throw new Error('Workflow step updated but could not be loaded.'); return fromWorkflowStep(row as unknown as WorkflowStepRow);
    },
    async transition(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transactions require a live workspace.');
      const input = validateTransactionTransition(untrustedInput);
      const { data, error } = await client.rpc('transition_real_estate_transaction', {
        target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId,
        target_transaction_id: input.transactionId, target_expected_version: input.expectedVersion,
        target_status: input.status, target_closed_at: input.closedAt ?? null,
        target_reason_code: input.reasonCode, target_idempotency_key: input.idempotencyKey,
        target_occurred_at: occurredAt,
      });
      if (error) throw new Error(`Transaction could not be updated: ${error.message}`);
      const receipt = data as { transactionId?: string } | null;
      if (!receipt?.transactionId) throw new Error('Transaction update receipt was incomplete.');
      const { data: row, error: readError } = await client.from('real_estate_transactions').select(COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', receipt.transactionId).single();
      if (readError || !row) throw new Error('Transaction was updated but could not be loaded.');
      return fromRow(row as unknown as TransactionRow);
    },
  };
}
