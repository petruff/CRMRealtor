import type { SupabaseClient } from '@supabase/supabase-js';
import { validateTransactionMilestoneInput, validateTransactionMilestoneTransition, validateTransactionMilestoneUpdate, type InboundResponseSignal, type TransactionMilestone, type TransactionMilestoneKind, type TransactionMilestoneSourceType, type TransactionMilestoneState, type TransactionMilestoneVerificationState } from '@/lib/domain/operational-signal';
import { validateWorkspaceScope } from '@/lib/domain/workspace';
import type { OperationalSignalRepository } from './operational-signal-repository';

type NameRow = { first_name: string; last_name: string; preferred_name: string | null };
type InboundRow = { id: string; workspace_id: string; contact_id: string; activity_event_id: string; resource_hash: string; received_at: string; intelligence_state: InboundResponseSignal['intelligenceState']; intent: string | null; sentiment: string | null; urgency: string | null; summary: string | null; unknowns: string[]; analyzed_at: string | null; acknowledged_at: string | null; created_at: string; contacts: NameRow | null };
type MilestoneRow = { id: string; workspace_id: string; transaction_id: string; contact_id: string; kind: TransactionMilestoneKind; label: string; state: TransactionMilestoneState; due_at: string; timezone: string; responsible_membership_id: string; source: 'manual' | 'transaction-expected-close'; source_type: TransactionMilestoneSourceType; source_reference: string; source_date: string; verification_state: TransactionMilestoneVerificationState; current_version: number; completed_at: string | null; created_at: string; updated_at: string; contacts: NameRow | null; real_estate_transactions: { property_address: string; gross_commission_cents: number } | null };
const inboundColumns = 'id,workspace_id,contact_id,activity_event_id,resource_hash,received_at,intelligence_state,intent,sentiment,urgency,summary,unknowns,analyzed_at,acknowledged_at,created_at,contacts(first_name,last_name,preferred_name)';
const milestoneColumns = 'id,workspace_id,transaction_id,contact_id,kind,label,state,due_at,timezone,responsible_membership_id,source,source_type,source_reference,source_date,verification_state,current_version,completed_at,created_at,updated_at,contacts(first_name,last_name,preferred_name),real_estate_transactions(property_address,gross_commission_cents)';
const name = (row: NameRow | null) => row ? `${row.preferred_name ?? row.first_name} ${row.last_name}`.trim() : 'Contact record';
const inbound = (row: InboundRow): InboundResponseSignal => ({ id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id, activityEventId: row.activity_event_id, contactName: name(row.contacts), resourceHash: row.resource_hash, receivedAt: row.received_at, intelligenceState: row.intelligence_state, intent: row.intent ?? undefined, sentiment: row.sentiment ?? undefined, urgency: row.urgency ?? undefined, summary: row.summary ?? undefined, unknowns: row.unknowns ?? [], analyzedAt: row.analyzed_at ?? undefined, acknowledgedAt: row.acknowledged_at ?? undefined, createdAt: row.created_at });
const milestone = (row: MilestoneRow): TransactionMilestone => ({ id: row.id, workspaceId: row.workspace_id, transactionId: row.transaction_id, contactId: row.contact_id, contactName: name(row.contacts), propertyAddress: row.real_estate_transactions?.property_address ?? 'Property record', potentialValueCents: row.real_estate_transactions?.gross_commission_cents ?? 0, kind: row.kind, label: row.label, state: row.state, dueAt: row.due_at, timezone: row.timezone, responsibleMembershipId: row.responsible_membership_id, source: row.source, sourceType: row.source_type, sourceReference: row.source_reference, sourceDate: row.source_date, verificationState: row.verification_state, currentVersion: row.current_version, completedAt: row.completed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at });

export function supabaseOperationalSignalRepository(client: SupabaseClient): OperationalSignalRepository {
  return {
    async listInbound(untrustedScope, options = {}) {
      const scope = validateWorkspaceScope(untrustedScope); let query = client.from('omnix_inbound_response_signals').select(inboundColumns).eq('workspace_id', scope.workspaceId).order('received_at', { ascending: true }).limit(options.limit ?? 500);
      if (options.unacknowledgedOnly) query = query.is('acknowledged_at', null);
      const { data, error } = await query; if (error) throw new Error(`Inbound response signals are unavailable: ${error.message}`);
      return (data as unknown as InboundRow[]).map(inbound);
    },
    async acknowledgeInbound(untrustedScope, signalId, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const { error } = await client.rpc('acknowledge_omnix_inbound_response', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_signal_id: signalId, target_occurred_at: occurredAt });
      if (error) throw new Error(`Inbound response could not be acknowledged: ${error.message}`);
    },
    async listMilestones(untrustedScope, options = {}) {
      const scope = validateWorkspaceScope(untrustedScope); let query = client.from('transaction_milestones').select(milestoneColumns).eq('workspace_id', scope.workspaceId).order('due_at', { ascending: true }).limit(options.limit ?? 1000);
      if (options.openOnly) query = query.eq('state', 'open');
      const { data, error } = await query; if (error) throw new Error(`Transaction deadlines are unavailable: ${error.message}`);
      return (data as unknown as MilestoneRow[]).map(milestone);
    },
    async createMilestone(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const input = validateTransactionMilestoneInput(untrustedInput);
      const { data, error } = await client.rpc('create_transaction_milestone_v2', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_transaction_id: input.transactionId, target_kind: input.kind, target_label: input.label, target_due_at: input.dueAt, target_timezone: input.timezone, target_responsible_membership_id: input.responsibleMembershipId, target_source_type: input.sourceType, target_source_reference: input.sourceReference, target_source_date: input.sourceDate, target_verification_state: input.verificationState, target_idempotency_key: input.idempotencyKey, target_occurred_at: occurredAt });
      if (error) throw new Error(`Transaction deadline could not be saved: ${error.message}`);
      const id = (data as { milestoneId?: string } | null)?.milestoneId; if (!id) throw new Error('Transaction deadline receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_milestones').select(milestoneColumns).eq('workspace_id', scope.workspaceId).eq('id', id).single();
      if (readError || !row) throw new Error('Transaction deadline was saved but could not be loaded.'); return milestone(row as unknown as MilestoneRow);
    },
    async updateMilestone(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const input = validateTransactionMilestoneUpdate(untrustedInput);
      const { data, error } = await client.rpc('update_transaction_milestone', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_milestone_id: input.milestoneId, target_expected_version: input.expectedVersion, target_kind: input.kind, target_label: input.label, target_due_at: input.dueAt, target_timezone: input.timezone, target_responsible_membership_id: input.responsibleMembershipId, target_source_type: input.sourceType, target_source_reference: input.sourceReference, target_source_date: input.sourceDate, target_verification_state: input.verificationState, target_reason_code: input.reasonCode, target_idempotency_key: input.idempotencyKey, target_occurred_at: occurredAt });
      if (error) throw new Error(`Transaction deadline could not be corrected: ${error.message}`);
      const id = (data as { milestoneId?: string } | null)?.milestoneId; if (!id) throw new Error('Transaction deadline correction receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_milestones').select(milestoneColumns).eq('workspace_id', scope.workspaceId).eq('id', id).single();
      if (readError || !row) throw new Error('Transaction deadline was corrected but could not be loaded.'); return milestone(row as unknown as MilestoneRow);
    },
    async transitionMilestone(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const input = validateTransactionMilestoneTransition(untrustedInput);
      const { data, error } = await client.rpc('transition_transaction_milestone_v2', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_milestone_id: input.milestoneId, target_expected_version: input.expectedVersion, target_next_state: input.nextState, target_reason_code: input.reasonCode, target_idempotency_key: input.idempotencyKey, target_occurred_at: occurredAt });
      if (error) throw new Error(`Transaction deadline could not be updated: ${error.message}`);
      const id = (data as { milestoneId?: string } | null)?.milestoneId; if (!id) throw new Error('Transaction deadline transition receipt was incomplete.');
      const { data: row, error: readError } = await client.from('transaction_milestones').select(milestoneColumns).eq('workspace_id', scope.workspaceId).eq('id', id).single();
      if (readError || !row) throw new Error('Transaction deadline was updated but could not be loaded.'); return milestone(row as unknown as MilestoneRow);
    },
  };
}
