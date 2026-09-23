import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePortalSnapshot, type ClientPortalLink, type ClientPortalSnapshot } from '../domain/client-portal.ts';
import type { TransactionMilestone } from '../domain/operational-signal.ts';
import type { RealEstateTransaction } from '../domain/transaction.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface NewPortalLink {
  readonly transactionId: string;
  readonly audienceLabel: string;
  readonly expiresAt: string;
}

export interface ClientPortalRepository {
  listForTransactions(scope: WorkspaceScope, transactionIds: readonly string[]): Promise<readonly ClientPortalLink[]>;
  /** Returns the raw token once; only its hash is stored. */
  create(scope: WorkspaceScope, input: NewPortalLink): Promise<{ readonly link: ClientPortalLink; readonly token: string }>;
  revoke(scope: WorkspaceScope, linkId: string, occurredAt: string): Promise<void>;
}

export function newPortalToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

interface LinkRow {
  id: string; transaction_id: string; audience_label: string; created_at: string; expires_at: string;
  revoked_at: string | null; last_viewed_at: string | null; view_count: number;
}
const COLUMNS = 'id, transaction_id, audience_label, created_at, expires_at, revoked_at, last_viewed_at, view_count';

function fromRow(row: LinkRow): ClientPortalLink {
  return {
    id: row.id, transactionId: row.transaction_id, audienceLabel: row.audience_label, createdAt: row.created_at,
    expiresAt: row.expires_at, viewCount: Number(row.view_count ?? 0),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.last_viewed_at ? { lastViewedAt: row.last_viewed_at } : {}),
  };
}

/** Member-side management under RLS (workspace members only). */
export function supabaseClientPortalRepository(client: SupabaseClient): ClientPortalRepository {
  return {
    async listForTransactions(scope, transactionIds) {
      if (!transactionIds.length) return [];
      const { data, error } = await client.from('client_portal_links').select(COLUMNS)
        .eq('workspace_id', scope.workspaceId).in('transaction_id', [...transactionIds])
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Client portal links could not be loaded: ${error.message}`);
      return (data as LinkRow[] | null ?? []).map(fromRow);
    },
    async create(scope, input) {
      const token = newPortalToken();
      const { data, error } = await client.from('client_portal_links').insert({
        workspace_id: scope.workspaceId, transaction_id: input.transactionId, token_hash: hashPortalToken(token),
        audience_label: input.audienceLabel, created_by_membership_id: scope.membershipId, expires_at: input.expiresAt,
      }).select(COLUMNS).single();
      if (error || !data) throw new Error(`Client portal link could not be created: ${error?.message ?? 'no receipt'}`);
      return { link: fromRow(data as LinkRow), token };
    },
    async revoke(scope, linkId, occurredAt) {
      const { error } = await client.from('client_portal_links').update({ revoked_at: occurredAt })
        .eq('workspace_id', scope.workspaceId).eq('id', linkId).is('revoked_at', null);
      if (error) throw new Error(`Client portal link could not be turned off: ${error.message}`);
    },
  };
}

/** Anonymous visitor read through the allowlisted SECURITY DEFINER RPC. */
export async function openSupabasePortal(anonClient: SupabaseClient, token: string): Promise<ClientPortalSnapshot | undefined> {
  const { data, error } = await anonClient.rpc('get_client_portal', { target_token_hash: hashPortalToken(token) });
  if (error) throw new Error('Client portal is unavailable.');
  return parsePortalSnapshot(data);
}

interface MemorySources {
  readonly transactions: (scope: WorkspaceScope) => Promise<readonly RealEstateTransaction[]>;
  readonly milestones: (scope: WorkspaceScope) => Promise<readonly TransactionMilestone[]>;
  readonly scope: WorkspaceScope;
  readonly agentName?: string;
}

/** Demo workspace: links live only for this server process. */
export function memoryClientPortalRepository(sources: MemorySources): ClientPortalRepository & { open(token: string, now?: Date): Promise<ClientPortalSnapshot | undefined> } {
  const links: (ClientPortalLink & { workspaceId: string; tokenHash: string })[] = [];
  return {
    async listForTransactions(scope, transactionIds) {
      const ids = new Set(transactionIds);
      return links.filter((link) => link.workspaceId === scope.workspaceId && ids.has(link.transactionId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(({ workspaceId: _w, tokenHash: _t, ...link }) => { void _w; void _t; return link; });
    },
    async create(scope, input) {
      const deal = (await sources.transactions(scope)).find((row) => row.id === input.transactionId);
      if (!deal) throw new Error('Transaction not found.');
      const token = newPortalToken();
      const link = { id: randomUUID(), transactionId: input.transactionId, audienceLabel: input.audienceLabel, createdAt: new Date().toISOString(), expiresAt: input.expiresAt, viewCount: 0 };
      links.push({ ...link, workspaceId: scope.workspaceId, tokenHash: hashPortalToken(token) });
      return { link, token };
    },
    async revoke(scope, linkId, occurredAt) {
      const link = links.find((item) => item.workspaceId === scope.workspaceId && item.id === linkId);
      if (link && !link.revokedAt) Object.assign(link, { revokedAt: occurredAt });
    },
    async open(token, now = new Date()) {
      const hash = hashPortalToken(token);
      const link = links.find((item) => item.tokenHash === hash);
      if (!link || link.revokedAt || Date.parse(link.expiresAt) <= now.getTime()) return undefined;
      const deal = (await sources.transactions(sources.scope)).find((row) => row.id === link.transactionId);
      if (!deal || deal.status === 'lost' || deal.status === 'cancelled') return undefined;
      Object.assign(link, { viewCount: link.viewCount + 1, lastViewedAt: now.toISOString() });
      const milestones = (await sources.milestones(sources.scope))
        .filter((item) => item.transactionId === deal.id && item.state !== 'cancelled')
        .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
      return parsePortalSnapshot({
        audience: link.audienceLabel, agentName: sources.agentName, propertyAddress: deal.propertyAddress, status: deal.status,
        side: deal.side, expectedCloseDate: deal.expectedCloseDate, closedAt: deal.closedAt, expiresAt: link.expiresAt,
        milestones: milestones.map((item) => ({ kind: item.kind, label: item.label, dueAt: item.dueAt, state: item.state, timezone: item.timezone })),
      });
    },
  };
}
