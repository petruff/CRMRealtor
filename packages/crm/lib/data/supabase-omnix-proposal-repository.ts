import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OMNIX_PROPOSAL_KINDS,
  OMNIX_PROPOSAL_STATES,
  OmnixOperationalError,
  compareOmnixApprovalQueue,
  validateCreateOmnixProposal,
  validateOmnixPriorityFactors,
  type OmnixActionProposal,
  type OmnixProposalCitation,
  type OmnixProposalVersion,
  type OmnixRelationshipMemory,
} from '../domain/omnix-operational-brain.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalAutomationRepository, OmnixProposalRepository } from './omnix-proposal-repository.ts';

interface ProposalRow {
  id: string; workspace_id: string; contact_id: string | null; transaction_id: string | null;
  attention_item_id: string | null; kind: string; state: string; origin: string; approval_mode: string;
  priority: string; priority_score: number; priority_factors: unknown; title: string; rationale: string;
  current_version: number; correlation_id: string; due_at: string | null; expires_at: string;
  created_at: string; updated_at: string; decided_at: string | null; execution_reference: string | null;
  executed_at: string | null; last_error_category: string | null;
}

interface VersionRow {
  proposal_id: string; version: number; payload: unknown; content_hash: string; citations: unknown; created_at: string;
}

interface MemoryRow {
  contact_id: string; deterministic_summary: string; generated_summary: string | null; next_best_action: string;
  citations: unknown; policy_version: string; model: string | null; refreshed_at: string;
}

const PROPOSAL_COLUMNS = 'id,workspace_id,contact_id,transaction_id,attention_item_id,kind,state,origin,approval_mode,priority,priority_score,priority_factors,title,rationale,current_version,correlation_id,due_at,expires_at,created_at,updated_at,decided_at,execution_reference,executed_at,last_error_category';
const ACTIVE_STATES = ['pending', 'approved', 'failed'];

function liveScope(input: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(input);
  if (scope.mode !== 'live') throw new OmnixOperationalError('invalid-input', 'Live proposals require a live workspace.');
  return scope;
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new OmnixOperationalError('invalid-input', 'Proposal limit must be 1–500.');
  }
  return value;
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new OmnixOperationalError('forbidden', message);
  if (error.code === 'P0002') return new OmnixOperationalError('not-found', message);
  if (error.code === '40001' || error.code === '23505') return new OmnixOperationalError('conflict', message);
  if (error.code === '22023' || error.code === '23514') return new OmnixOperationalError('invalid-input', message);
  return new OmnixOperationalError('unavailable', `${message}: persistence failed.`);
}

function citations(value: unknown): readonly OmnixProposalCitation[] {
  if (!Array.isArray(value) || value.length < 1) throw new OmnixOperationalError('conflict', 'Proposal citations are invalid.');
  return value as OmnixProposalCitation[];
}

export function omnixProposalFromRow(row: ProposalRow): OmnixActionProposal {
  if (!OMNIX_PROPOSAL_KINDS.includes(row.kind as OmnixActionProposal['kind'])
    || !OMNIX_PROPOSAL_STATES.includes(row.state as OmnixActionProposal['state'])
    || !['deterministic', 'gemini'].includes(row.origin)
    || !['active-member', 'owner'].includes(row.approval_mode)
    || !['p0', 'p1', 'p2', 'p3', 'p4'].includes(row.priority)) {
    throw new OmnixOperationalError('conflict', 'Proposal persistence returned an invalid record.');
  }
  return {
    id: row.id, workspaceId: row.workspace_id,
    ...(row.contact_id ? { contactId: row.contact_id } : {}),
    ...(row.transaction_id ? { transactionId: row.transaction_id } : {}),
    ...(row.attention_item_id ? { attentionItemId: row.attention_item_id } : {}),
    kind: row.kind as OmnixActionProposal['kind'], state: row.state as OmnixActionProposal['state'],
    origin: row.origin as OmnixActionProposal['origin'], approvalMode: row.approval_mode as OmnixActionProposal['approvalMode'],
    priority: row.priority as OmnixActionProposal['priority'], priorityScore: row.priority_score,
    priorityFactors: validateOmnixPriorityFactors(row.priority_factors as OmnixActionProposal['priorityFactors']),
    title: row.title, rationale: row.rationale, currentVersion: row.current_version,
    correlationId: row.correlation_id, ...(row.due_at ? { dueAt: row.due_at } : {}),
    expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.execution_reference ? { executionReference: row.execution_reference } : {}),
    ...(row.executed_at ? { executedAt: row.executed_at } : {}),
    ...(row.last_error_category ? { lastErrorCategory: row.last_error_category } : {}),
  };
}

function proposalVersionFromRow(row: VersionRow): OmnixProposalVersion {
  if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) {
    throw new OmnixOperationalError('conflict', 'Proposal payload is invalid.');
  }
  return {
    proposalId: row.proposal_id, version: row.version,
    payload: row.payload as Readonly<Record<string, unknown>>, contentHash: row.content_hash,
    citations: citations(row.citations), createdAt: row.created_at,
  };
}

function memoryFromRow(row: MemoryRow): OmnixRelationshipMemory {
  return {
    contactId: row.contact_id, deterministicSummary: row.deterministic_summary,
    ...(row.generated_summary ? { generatedSummary: row.generated_summary } : {}),
    nextBestAction: row.next_best_action, citations: citations(row.citations),
    policyVersion: row.policy_version, ...(row.model ? { model: row.model } : {}),
    refreshedAt: row.refreshed_at,
  };
}

export function supabaseOmnixProposalRepository(client: SupabaseClient): OmnixProposalRepository {
  return {
    async list(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      let request = client.from('omnix_action_proposals').select(PROPOSAL_COLUMNS).eq('workspace_id', scope.workspaceId);
      if (query.state === 'active' || query.state === undefined) request = request.in('state', ACTIVE_STATES);
      else if (query.state !== 'all') request = request.eq('state', query.state);
      if (query.contactId) request = request.eq('contact_id', query.contactId);
      const { data, error } = await request.limit(boundedLimit(query.limit));
      if (error) throw persistenceError('Failed to list Omnix proposals', error);
      return ((data ?? []) as unknown as ProposalRow[]).map(omnixProposalFromRow).sort(compareOmnixApprovalQueue);
    },
    async get(untrustedScope, proposalId) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await client.from('omnix_action_proposals').select(PROPOSAL_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', proposalId).maybeSingle();
      if (error) throw persistenceError('Failed to load Omnix proposal', error);
      return data ? omnixProposalFromRow(data as unknown as ProposalRow) : undefined;
    },
    async getVersion(untrustedScope, proposalId, version) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await client.from('omnix_action_proposal_versions')
        .select('proposal_id,version,payload,content_hash,citations,created_at')
        .eq('workspace_id', scope.workspaceId).eq('proposal_id', proposalId).eq('version', version).maybeSingle();
      if (error) throw persistenceError('Failed to load Omnix proposal version', error);
      return data ? proposalVersionFromRow(data as unknown as VersionRow) : undefined;
    },
    async create(untrustedScope, untrustedInput) {
      const scope = liveScope(untrustedScope);
      const input = validateCreateOmnixProposal(untrustedInput);
      const { data, error } = await client.rpc('create_omnix_action_proposal', {
        target_workspace_id: scope.workspaceId, target_contact_id: input.contactId ?? null,
        target_transaction_id: input.transactionId ?? null, target_attention_item_id: input.attentionItemId ?? null,
        target_kind: input.kind, target_origin: input.origin, target_approval_mode: input.approvalMode,
        target_priority: input.priority, target_priority_score: input.priorityScore,
        target_priority_factors: input.factors, target_title: input.title, target_rationale: input.rationale,
        target_payload: input.payload, target_content_hash: input.contentHash, target_citations: input.citations,
        target_due_at: input.dueAt ?? null, target_expires_at: input.expiresAt,
        target_created_by_membership_id: scope.membershipId, target_correlation_id: input.correlationId,
        target_idempotency_key: input.idempotencyKey, target_created_at: input.createdAt,
      });
      if (error) throw persistenceError('Failed to create Omnix proposal', error);
      const receipt = data as { proposalId?: string; version?: number; noOp?: boolean } | null;
      if (!receipt?.proposalId || !receipt.version || typeof receipt.noOp !== 'boolean') {
        throw new OmnixOperationalError('conflict', 'Proposal receipt is incomplete.');
      }
      return { proposalId: receipt.proposalId, version: receipt.version, noOp: receipt.noOp };
    },
    async decide(untrustedScope, proposalId, input) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await client.rpc('decide_omnix_action_proposal', {
        target_workspace_id: scope.workspaceId, target_proposal_id: proposalId,
        target_expected_version: input.expectedVersion, target_decision: input.decision,
        target_actor_membership_id: scope.membershipId, target_idempotency_key: input.idempotencyKey,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to decide Omnix proposal', error);
      const receipt = data as { proposalId?: string; version?: number; state?: OmnixActionProposal['state']; noOp?: boolean } | null;
      if (!receipt?.proposalId || !receipt.version || !receipt.state || typeof receipt.noOp !== 'boolean') {
        throw new OmnixOperationalError('conflict', 'Proposal decision receipt is incomplete.');
      }
      return { proposalId: receipt.proposalId, version: receipt.version, state: receipt.state, noOp: receipt.noOp };
    },
    async transitionExecution(untrustedScope, proposalId, input) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await client.rpc('transition_omnix_proposal_execution', {
        target_workspace_id: scope.workspaceId, target_proposal_id: proposalId,
        target_expected_state: input.expectedState, target_next_state: input.nextState,
        target_actor_membership_id: scope.membershipId,
        target_execution_reference: input.executionReference ?? null,
        target_error_category: input.errorCategory ?? null,
        target_idempotency_key: input.idempotencyKey, target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to transition Omnix execution', error);
      const receipt = data as { proposalId?: string; state?: OmnixActionProposal['state']; noOp?: boolean } | null;
      if (!receipt?.proposalId || !receipt.state || typeof receipt.noOp !== 'boolean') {
        throw new OmnixOperationalError('conflict', 'Proposal execution receipt is incomplete.');
      }
      return { proposalId: receipt.proposalId, state: receipt.state, noOp: receipt.noOp };
    },
    async getRelationshipMemory(untrustedScope, contactId) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await client.from('omnix_relationship_memories')
        .select('contact_id,deterministic_summary,generated_summary,next_best_action,citations,policy_version,model,refreshed_at')
        .eq('workspace_id', scope.workspaceId).eq('contact_id', contactId).maybeSingle();
      if (error) throw persistenceError('Failed to load relationship memory', error);
      return data ? memoryFromRow(data as unknown as MemoryRow) : undefined;
    },
  };
}

export function supabaseOmnixProposalAutomationRepository(
  client: SupabaseClient,
): OmnixProposalAutomationRepository {
  return {
    async createSystem(untrustedScope, untrustedInput) {
      const scope = liveScope(untrustedScope);
      const input = validateCreateOmnixProposal(untrustedInput);
      const { data, error } = await client.rpc('create_omnix_action_proposal', {
        target_workspace_id: scope.workspaceId, target_contact_id: input.contactId ?? null,
        target_transaction_id: input.transactionId ?? null, target_attention_item_id: input.attentionItemId ?? null,
        target_kind: input.kind, target_origin: input.origin, target_approval_mode: input.approvalMode,
        target_priority: input.priority, target_priority_score: input.priorityScore,
        target_priority_factors: input.factors, target_title: input.title, target_rationale: input.rationale,
        target_payload: input.payload, target_content_hash: input.contentHash, target_citations: input.citations,
        target_due_at: input.dueAt ?? null, target_expires_at: input.expiresAt,
        target_created_by_membership_id: null, target_correlation_id: input.correlationId,
        target_idempotency_key: input.idempotencyKey, target_created_at: input.createdAt,
      });
      if (error) throw persistenceError('Failed to materialize Omnix proposal', error);
      const receipt = data as { proposalId?: string; version?: number; noOp?: boolean } | null;
      if (!receipt?.proposalId || !receipt.version || typeof receipt.noOp !== 'boolean') {
        throw new OmnixOperationalError('conflict', 'Proposal materialization receipt is incomplete.');
      }
      return { proposalId: receipt.proposalId, version: receipt.version, noOp: receipt.noOp };
    },
    async upsertRelationshipMemory(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      const { error } = await client.from('omnix_relationship_memories').upsert({
        workspace_id: scope.workspaceId, contact_id: input.contactId, source_hash: input.sourceHash,
        deterministic_summary: input.deterministicSummary, generated_summary: input.generatedSummary ?? null,
        next_best_action: input.nextBestAction, citations: input.citations, model: input.model ?? null,
        policy_version: input.policyVersion, refreshed_at: input.refreshedAt, updated_at: input.refreshedAt,
      }, { onConflict: 'workspace_id,contact_id' });
      if (error) throw persistenceError('Failed to refresh relationship memory', error);
    },
  };
}
