'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { TRANSACTION_MILESTONE_KINDS, type TransactionMilestoneKind, type TransactionMilestoneState } from '@/lib/domain/operational-signal';

const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function createTransactionMilestoneAction(formData: FormData): Promise<void> {
  const kind = value(formData, 'kind') as TransactionMilestoneKind;
  const date = value(formData, 'dueDate');
  if (!TRANSACTION_MILESTONE_KINDS.includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid deadline type and date.');
  const context = await getRepository();
  await context.operationalSignalRepository.createMilestone(context.workspaceScope, {
    transactionId: value(formData, 'transactionId'), kind, label: value(formData, 'label'),
    dueAt: `${date}T12:00:00.000Z`, idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/approvals'); revalidatePath('/');
}

export async function transitionTransactionMilestoneAction(formData: FormData): Promise<void> {
  const state = value(formData, 'state') as Exclude<TransactionMilestoneState, 'open'>;
  const id = value(formData, 'milestoneId'); const version = Number(value(formData, 'version'));
  if (!['completed', 'waived', 'cancelled'].includes(state) || !Number.isInteger(version) || version < 1) throw new Error('The deadline action is invalid.');
  const context = await getRepository();
  await context.operationalSignalRepository.transitionMilestone(context.workspaceScope, id, version, state, `deadline:${id}:v${version}:${state}`, new Date().toISOString());
  revalidatePath('/transactions'); revalidatePath('/approvals'); revalidatePath('/');
}
