'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { TRANSACTION_MILESTONE_KINDS, TRANSACTION_MILESTONE_SOURCE_TYPES, TRANSACTION_MILESTONE_VERIFICATION_STATES, zonedLocalDateTimeToUtc, type TransactionMilestoneKind, type TransactionMilestoneSourceType, type TransactionMilestoneVerificationState } from '@/lib/domain/operational-signal';
import { TRANSACTION_KINDS, TRANSACTION_PARTY_ROLES, TRANSACTION_SIDES, TRANSACTION_STATUSES, type TransactionKind, type TransactionPartyRole, type TransactionSide, type TransactionStatus } from '@/lib/domain/transaction';
import { FINANCIAL_SOURCE_TYPES, FINANCIAL_VERIFICATION_STATES, type FinancialSourceType, type FinancialVerificationState } from '@/lib/domain/transaction-finance';
import { WORKFLOW_STEP_STATES, type WorkflowStepState } from '@/lib/domain/workflow-pack';
import { recordReadinessCommand } from '@/lib/application/florida-readiness-commands';

const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const cents = (data: FormData, key: string) => {
  const parsed = Number(value(data, key) || '0');
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Financial amounts must be zero or greater.');
  return Math.round(parsed * 100);
};
const optionalCents = (data: FormData, key: string) => {
  const raw = value(data, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Financial amounts must be zero or greater.');
  return Math.round(parsed * 100);
};

const optionalInstant = (data: FormData, key: string) => {
  const raw = value(data, key);
  return raw ? new Date(raw).toISOString() : undefined;
};

export async function createTransactionMilestoneAction(formData: FormData): Promise<void> {
  const kind = value(formData, 'kind') as TransactionMilestoneKind;
  const timezone = value(formData, 'timezone'); const localDueAt = value(formData, 'localDueAt');
  const sourceType = value(formData, 'sourceType') as TransactionMilestoneSourceType;
  const verificationState = value(formData, 'verificationState') as Exclude<TransactionMilestoneVerificationState, 'contradictory'>;
  if (!TRANSACTION_MILESTONE_KINDS.includes(kind) || !TRANSACTION_MILESTONE_SOURCE_TYPES.includes(sourceType)
    || !['unverified', 'verified'].includes(verificationState)) throw new Error('Choose a valid deadline type, source, and verification state.');
  const context = await getRepository();
  await context.operationalSignalRepository.createMilestone(context.workspaceScope, {
    transactionId: value(formData, 'transactionId'), kind, label: value(formData, 'label'),
    dueAt: zonedLocalDateTimeToUtc(localDueAt, timezone), timezone,
    responsibleMembershipId: value(formData, 'responsibleMembershipId') || context.workspaceScope.membershipId,
    sourceType, sourceReference: value(formData, 'sourceReference'), sourceDate: value(formData, 'sourceDate'),
    verificationState, idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/approvals'); revalidatePath('/');
}

export async function transitionTransactionMilestoneAction(formData: FormData): Promise<void> {
  const state = value(formData, 'state') as 'completed' | 'waived' | 'cancelled';
  const id = value(formData, 'milestoneId'); const version = Number(value(formData, 'version'));
  if (!['completed', 'waived', 'cancelled'].includes(state) || !Number.isInteger(version) || version < 1) throw new Error('The deadline action is invalid.');
  const context = await getRepository();
  await context.operationalSignalRepository.transitionMilestone(context.workspaceScope, {
    milestoneId: id, expectedVersion: version, nextState: state,
    reasonCode: value(formData, 'reasonCode') || `realtor-${state}`,
    idempotencyKey: `deadline:${id}:v${version}:${state}`,
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/approvals'); revalidatePath('/');
}

export async function updateTransactionMilestoneAction(formData: FormData): Promise<void> {
  const kind = value(formData, 'kind') as TransactionMilestoneKind;
  const sourceType = value(formData, 'sourceType') as TransactionMilestoneSourceType;
  const verificationState = value(formData, 'verificationState') as TransactionMilestoneVerificationState;
  const expectedVersion = Number(value(formData, 'expectedVersion')); const timezone = value(formData, 'timezone');
  if (!TRANSACTION_MILESTONE_KINDS.includes(kind) || !TRANSACTION_MILESTONE_SOURCE_TYPES.includes(sourceType)
    || !TRANSACTION_MILESTONE_VERIFICATION_STATES.includes(verificationState)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('The deadline correction is invalid.');
  const context = await getRepository();
  await context.operationalSignalRepository.updateMilestone(context.workspaceScope, {
    milestoneId: value(formData, 'milestoneId'), expectedVersion, kind, label: value(formData, 'label'),
    dueAt: zonedLocalDateTimeToUtc(value(formData, 'localDueAt'), timezone), timezone,
    responsibleMembershipId: value(formData, 'responsibleMembershipId') || context.workspaceScope.membershipId,
    sourceType, sourceReference: value(formData, 'sourceReference'), sourceDate: value(formData, 'sourceDate'),
    verificationState, reasonCode: value(formData, 'reasonCode') || 'realtor-correction',
    idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/approvals'); revalidatePath('/alerts'); revalidatePath('/');
}

export async function transitionTransactionAction(formData: FormData): Promise<void> {
  const status = value(formData, 'status') as TransactionStatus;
  const transactionId = value(formData, 'transactionId');
  const expectedVersion = Number(value(formData, 'expectedVersion'));
  const closedAt = value(formData, 'closedAt') || undefined;
  if (!TRANSACTION_STATUSES.includes(status) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('The transaction change is invalid.');
  }
  const context = await getRepository();
  await context.transactionRepository.transition(context.workspaceScope, {
    transactionId, expectedVersion, status, closedAt,
    reasonCode: 'realtor-status-update', idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/insights'); revalidatePath('/');
}

export async function updateTransactionAction(formData: FormData): Promise<void> {
  const kind = value(formData, 'kind') as TransactionKind;
  const side = value(formData, 'side') as TransactionSide;
  const expectedVersion = Number(value(formData, 'expectedVersion'));
  if (!TRANSACTION_KINDS.includes(kind) || !TRANSACTION_SIDES.includes(side)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('The transaction details are invalid.');
  }
  const context = await getRepository();
  await context.transactionRepository.update(context.workspaceScope, {
    transactionId: value(formData, 'transactionId'),
    expectedVersion,
    kind,
    title: value(formData, 'title'),
    side,
    propertyAddress: value(formData, 'propertyAddress'),
    expectedCloseDate: value(formData, 'expectedCloseDate') || undefined,
    salePriceCents: cents(formData, 'salePrice'),
    grossCommissionCents: cents(formData, 'grossCommission'),
    netCommissionCents: cents(formData, 'netCommission'),
    marketingCostCents: cents(formData, 'marketingCost'),
    expenseCents: cents(formData, 'otherExpenses'),
    nextAction: value(formData, 'nextAction') || undefined,
    nextActionDueAt: optionalInstant(formData, 'nextActionDueAt'),
    reasonCode: 'realtor-details-update',
    idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/insights'); revalidatePath('/');
}

export async function upsertTransactionFinancialsAction(formData: FormData): Promise<void> {
  const sourceType = value(formData, 'sourceType') as FinancialSourceType;
  const verificationState = value(formData, 'verificationState') as FinancialVerificationState;
  const expectedVersion = Number(value(formData, 'expectedVersion'));
  if (!FINANCIAL_SOURCE_TYPES.includes(sourceType) || !FINANCIAL_VERIFICATION_STATES.includes(verificationState)
    || verificationState === 'contradictory' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error('The financial record is invalid.');
  }
  const context = await getRepository();
  await context.transactionRepository.upsertFinancials(context.workspaceScope, {
    transactionId: value(formData, 'transactionId'), expectedVersion,
    transactionValueCents: optionalCents(formData, 'transactionValue'),
    volumeBasisCents: optionalCents(formData, 'volumeBasis'),
    grossCommissionCents: optionalCents(formData, 'grossCommission'),
    brokerageSplitCents: optionalCents(formData, 'brokerageSplit'),
    referralFeeCents: optionalCents(formData, 'referralFee'),
    netCommissionCents: optionalCents(formData, 'netCommission'),
    marketingCostCents: optionalCents(formData, 'marketingCost'),
    otherExpenseCents: optionalCents(formData, 'otherExpense'),
    sourceType, sourceReference: value(formData, 'sourceReference'),
    effectiveDate: value(formData, 'effectiveDate'), verificationState,
    reasonCode: 'realtor-financial-review', idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/insights');
}

export async function startTransactionWorkflowAction(formData: FormData): Promise<void> {
  const context=await getRepository();
  await context.transactionRepository.startWorkflowPlan(context.workspaceScope,{
    transactionId:value(formData,'transactionId'),packDefinitionId:value(formData,'packDefinitionId'),
    responsibleMembershipId:value(formData,'responsibleMembershipId')||context.workspaceScope.membershipId,
    idempotencyKey:value(formData,'idempotencyKey'),
  },new Date().toISOString());
  revalidatePath('/transactions');
}

export async function transitionTransactionWorkflowStepAction(formData: FormData): Promise<void> {
  const state=value(formData,'state') as WorkflowStepState; const expectedVersion=Number(value(formData,'expectedVersion'));
  if(!WORKFLOW_STEP_STATES.includes(state)||state==='proposed'||!Number.isSafeInteger(expectedVersion)||expectedVersion<1) throw new Error('The workflow step change is invalid.');
  const context=await getRepository();
  await context.transactionRepository.transitionWorkflowStep(context.workspaceScope,{
    stepId:value(formData,'stepId'),expectedVersion,state,evidenceReference:value(formData,'evidenceReference')||undefined,
    acknowledged:formData.get('acknowledged')==='on',reasonCode:'realtor-workflow-update',idempotencyKey:value(formData,'idempotencyKey'),
  },new Date().toISOString());
  revalidatePath('/transactions');
}

export async function addTransactionPartyAction(formData: FormData): Promise<void> {
  const role = value(formData, 'role') as TransactionPartyRole;
  if (!TRANSACTION_PARTY_ROLES.includes(role)) throw new Error('Choose a valid party role.');
  const context = await getRepository();
  await context.transactionRepository.addParty(context.workspaceScope, {
    transactionId: value(formData, 'transactionId'), contactId: value(formData, 'contactId') || undefined, role,
    displayLabel: value(formData, 'displayLabel'), participatesInCommunication: formData.get('participatesInCommunication') === 'on',
    idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions');
}

export async function updateTransactionPartyAction(formData: FormData): Promise<void> {
  const role = value(formData, 'role') as TransactionPartyRole;
  const expectedVersion = Number(value(formData, 'expectedVersion'));
  if (!TRANSACTION_PARTY_ROLES.includes(role) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('The participant change is invalid.');
  }
  const context = await getRepository();
  await context.transactionRepository.updateParty(context.workspaceScope, {
    partyId: value(formData, 'partyId'),
    expectedVersion,
    role,
    displayLabel: value(formData, 'displayLabel'),
    participatesInCommunication: formData.get('participatesInCommunication') === 'on',
    idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions');
}

export async function archiveTransactionPartyAction(formData: FormData): Promise<void> {
  const expectedVersion = Number(value(formData, 'expectedVersion'));
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('The participant archive request is invalid.');
  const context = await getRepository();
  await context.transactionRepository.archiveParty(context.workspaceScope, {
    partyId: value(formData, 'partyId'),
    expectedVersion,
    reasonCode: 'realtor-removed-participant',
    idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions');
}

export async function recordReadinessAction(formData: FormData): Promise<void> {
  const key = value(formData, 'key');
  if (key !== 'buyer-agreement' && key !== 'flood-disclosure') throw new Error('Choose a readiness item.');
  const context = await getRepository();
  await recordReadinessCommand(context.operationalSignalRepository, context.workspaceScope, {
    transactionId: value(formData, 'transactionId'),
    key,
    outcome: value(formData, 'outcome') === 'not-applicable' ? 'not-applicable' : 'on-file',
    reference: value(formData, 'reference'),
    sourceDate: value(formData, 'sourceDate'),
    timeZone: process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
    requestId: value(formData, 'requestId'),
  });
  revalidatePath('/transactions'); revalidatePath('/inbox'); revalidatePath('/');
}
