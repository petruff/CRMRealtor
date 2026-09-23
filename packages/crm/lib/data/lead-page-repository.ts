import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAD_PAGE_KEY_PREFIX, isLeadPageKey } from '../domain/lead-page.ts';
import { createAutomationRepositories, resolveServerWorkspaceScope } from './automation-context.ts';
import type { WebsiteIntakeContext } from '../application/website-intake-processor.ts';

export interface PublicLeadPage {
  readonly endpointKey: string;
  readonly workspaceId: string;
  readonly agentName: string;
}

export function serviceClient(environment: Record<string, string | undefined> = process.env): SupabaseClient | undefined {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return undefined;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

/** Resolves an enabled hosted lead page; server-only (service role), never exposes internal ids to the browser. */
export async function findPublicLeadPage(client: SupabaseClient, endpointKey: string): Promise<PublicLeadPage | undefined> {
  if (!isLeadPageKey(endpointKey)) return undefined;
  const { data, error } = await client.from('website_intake_endpoints').select('workspace_id, enabled').eq('endpoint_key', endpointKey).maybeSingle();
  if (error || !data || data.enabled === false) return undefined;
  const { data: workspace } = await client.from('workspaces').select('name').eq('id', data.workspace_id).maybeSingle();
  return { endpointKey, workspaceId: String(data.workspace_id), agentName: String(workspace?.name ?? 'your agent') };
}

export async function leadPageIntakeContext(client: SupabaseClient, workspaceId: string): Promise<WebsiteIntakeContext> {
  const workspaceScope = await resolveServerWorkspaceScope(client, { workspaceId });
  return { ...createAutomationRepositories(client, workspaceScope), workspaceScope };
}

export interface LeadPageSummary {
  readonly endpointKey: string;
  readonly enabled: boolean;
  readonly responseSlaMinutes: number;
  readonly createdAt: string;
}

/** Member-side read under RLS: the workspace's hosted lead pages. */
export async function listLeadPages(client: SupabaseClient, workspaceId: string): Promise<LeadPageSummary[]> {
  const { data, error } = await client.from('website_intake_endpoints')
    .select('endpoint_key, enabled, response_sla_minutes, created_at')
    .eq('workspace_id', workspaceId).like('endpoint_key', `${LEAD_PAGE_KEY_PREFIX}%`).order('created_at', { ascending: true });
  if (error) throw new Error(`Lead pages could not be loaded: ${error.message}`);
  return (data ?? []).map((row) => ({
    endpointKey: String(row.endpoint_key), enabled: row.enabled !== false,
    responseSlaMinutes: Number(row.response_sla_minutes), createdAt: String(row.created_at),
  }));
}

export async function countLeadPageSubmissions(client: SupabaseClient, workspaceId: string, endpointKey: string): Promise<number> {
  const { data: endpoint } = await client.from('website_intake_endpoints').select('id').eq('workspace_id', workspaceId).eq('endpoint_key', endpointKey).maybeSingle();
  if (!endpoint) return 0;
  const { count } = await client.from('website_intake_submissions').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('endpoint_id', endpoint.id).eq('status', 'completed');
  return count ?? 0;
}
