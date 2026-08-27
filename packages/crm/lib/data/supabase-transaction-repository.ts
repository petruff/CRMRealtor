import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadSource } from '../domain/contact.ts';
import { validateTransactionInput, type RealEstateTransaction, type TransactionSide, type TransactionStatus } from '../domain/transaction.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import type { TransactionRepository } from './transaction-repository.ts';

interface TransactionRow {
  id: string; workspace_id: string; contact_id: string; status: TransactionStatus; side: TransactionSide;
  property_address: string; source: LeadSource; expected_close_date: string | null; closed_at: string | null;
  sale_price_cents: number; gross_commission_cents: number; net_commission_cents: number;
  marketing_cost_cents: number; expense_cents: number; created_by_membership_id: string;
  created_at: string; updated_at: string; contacts: { first_name: string; last_name: string; preferred_name: string | null } | null;
}

function fromRow(row: TransactionRow): RealEstateTransaction {
  const contact = row.contacts;
  return {
    id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id,
    contactName: contact ? `${contact.preferred_name ?? contact.first_name} ${contact.last_name}`.trim() : 'Contact record',
    status: row.status, side: row.side, propertyAddress: row.property_address, source: row.source,
    expectedCloseDate: row.expected_close_date ?? undefined, closedAt: row.closed_at ?? undefined,
    salePriceCents: row.sale_price_cents, grossCommissionCents: row.gross_commission_cents,
    netCommissionCents: row.net_commission_cents, marketingCostCents: row.marketing_cost_cents,
    expenseCents: row.expense_cents, createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const COLUMNS = 'id,workspace_id,contact_id,status,side,property_address,source,expected_close_date,closed_at,sale_price_cents,gross_commission_cents,net_commission_cents,marketing_cost_cents,expense_cents,created_by_membership_id,created_at,updated_at,contacts(first_name,last_name,preferred_name)';

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
    async create(untrustedScope, untrustedInput) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Live transactions require a live workspace.');
      const input = validateTransactionInput(untrustedInput);
      const { data, error } = await client.rpc('create_real_estate_transaction', {
        target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId,
        target_contact_id: input.contactId, target_status: input.status, target_side: input.side,
        target_property_address: input.propertyAddress, target_expected_close_date: input.expectedCloseDate ?? null,
        target_closed_at: input.closedAt ?? null, target_sale_price_cents: input.salePriceCents,
        target_gross_commission_cents: input.grossCommissionCents,
        target_net_commission_cents: input.netCommissionCents,
        target_marketing_cost_cents: input.marketingCostCents, target_expense_cents: input.expenseCents,
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
  };
}
