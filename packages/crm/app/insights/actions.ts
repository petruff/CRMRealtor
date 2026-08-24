'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { TRANSACTION_SIDES, TRANSACTION_STATUSES, type TransactionSide, type TransactionStatus } from '@/lib/domain/transaction';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function money(formData: FormData, key: string): number {
  const raw = text(formData, key).replace(/[$,\s]/g, '');
  if (!raw) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${key} must be a valid dollar amount.`);
  const [whole, decimal = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error(`${key} is too large.`);
  return cents;
}

function date(formData: FormData, key: string): string | undefined {
  const value = text(formData, key);
  if (!value) return undefined;
  const label = key === 'expectedCloseDate' ? 'Expected close date' : 'Closed date';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : undefined;
  if (!match || !parsed || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() !== Number(match[2]) - 1 || parsed.getUTCDate() !== Number(match[3])) {
    throw new Error(`${label} must be a valid date.`);
  }
  return value;
}

function idempotencyKey(formData: FormData): string {
  const value = text(formData, 'idempotencyKey');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('This deal form expired. Refresh Insights and try again.');
  }
  return value;
}

function friendlyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/contact|close date|closed date|property address|dollar amount|choose a|form expired/i.test(message)) return message;
  if (/ledger is unavailable|schema cache|relation/i.test(message)) {
    return 'Financial setup is still finishing. Nothing was saved; please try again shortly.';
  }
  return 'We could not save this deal. Nothing changed; please review the fields and try again.';
}

export async function createTransactionAction(formData: FormData): Promise<never> {
  const returnPeriod = ['30', '90', '365'].includes(text(formData, 'period')) ? text(formData, 'period') : '90';
  try {
    const status = text(formData, 'status') as TransactionStatus;
    const side = text(formData, 'side') as TransactionSide;
    if (!TRANSACTION_STATUSES.includes(status)) throw new Error('Choose a transaction status.');
    if (!TRANSACTION_SIDES.includes(side)) throw new Error('Choose a representation side.');
    const context = await getRepository();
    await context.transactionRepository.create(context.workspaceScope, {
      contactId: text(formData, 'contactId'), status, side,
      propertyAddress: text(formData, 'propertyAddress'),
      expectedCloseDate: date(formData, 'expectedCloseDate'), closedAt: date(formData, 'closedAt'),
      salePriceCents: money(formData, 'salePrice'), grossCommissionCents: money(formData, 'grossCommission'),
      netCommissionCents: money(formData, 'netCommission'), marketingCostCents: money(formData, 'marketingCost'),
      expenseCents: money(formData, 'expenses'), idempotencyKey: idempotencyKey(formData),
    });
    revalidatePath('/insights'); revalidatePath('/pipeline'); revalidatePath('/');
  } catch (error) {
    const message = friendlyFailure(error);
    redirect(`/insights?period=${returnPeriod}&transaction=error&message=${encodeURIComponent(message.slice(0, 180))}#transaction-intelligence`);
  }
  redirect(`/insights?period=${returnPeriod}&transaction=saved#transaction-intelligence`);
}
