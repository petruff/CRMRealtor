import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly showNames: boolean;
}

export interface StoredPushDevice {
  readonly endpoint: string;
  readonly showNames: boolean;
  readonly createdAt: string;
}

export class PushSubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushSubscriptionError';
  }
}

/** Validates browser-issued push credentials before anything is stored. */
export function validatePushSubscription(input: unknown): PushSubscriptionInput {
  const candidate = (input ?? {}) as Record<string, unknown>;
  const endpoint = typeof candidate.endpoint === 'string' ? candidate.endpoint.trim() : '';
  const p256dh = typeof candidate.p256dh === 'string' ? candidate.p256dh.trim() : '';
  const auth = typeof candidate.auth === 'string' ? candidate.auth.trim() : '';
  let url: URL | undefined;
  try { url = new URL(endpoint); } catch { url = undefined; }
  if (!url || url.protocol !== 'https:' || endpoint.length > 2048) throw new PushSubscriptionError('This browser returned an invalid notification address.');
  if (!/^[A-Za-z0-9_-]{40,200}$/u.test(p256dh) || !/^[A-Za-z0-9_-]{16,64}$/u.test(auth)) {
    throw new PushSubscriptionError('This browser returned invalid notification keys.');
  }
  return { endpoint, p256dh, auth, showNames: candidate.showNames === true };
}

export interface PushSubscriptionRepository {
  listMine(scope: WorkspaceScope): Promise<readonly StoredPushDevice[]>;
  save(scope: WorkspaceScope, input: PushSubscriptionInput): Promise<void>;
  remove(scope: WorkspaceScope, endpoint: string): Promise<void>;
}

/** RLS-scoped: members only ever read or write their own devices. */
export function supabasePushSubscriptionRepository(client: SupabaseClient): PushSubscriptionRepository {
  return {
    async listMine(scope) {
      const { data, error } = await client.from('push_subscriptions')
        .select('endpoint, show_names, created_at')
        .eq('workspace_id', scope.workspaceId)
        .eq('membership_id', scope.membershipId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Failed to load notification devices: ${error.message}`);
      return (data ?? []).map((row) => ({ endpoint: String(row.endpoint), showNames: Boolean(row.show_names), createdAt: String(row.created_at) }));
    },
    async save(scope, input) {
      await client.from('push_subscriptions').delete().eq('endpoint', input.endpoint);
      const { error } = await client.from('push_subscriptions').insert({
        workspace_id: scope.workspaceId,
        membership_id: scope.membershipId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth_secret: input.auth,
        show_names: input.showNames,
      });
      if (error) throw new Error(`Failed to save notification device: ${error.message}`);
    },
    async remove(scope, endpoint) {
      const { error } = await client.from('push_subscriptions').delete()
        .eq('workspace_id', scope.workspaceId)
        .eq('membership_id', scope.membershipId)
        .eq('endpoint', endpoint);
      if (error) throw new Error(`Failed to remove notification device: ${error.message}`);
    },
  };
}

/** Demo workspace: devices live only for this server process. */
export function memoryPushSubscriptionRepository(): PushSubscriptionRepository {
  const devices = new Map<string, StoredPushDevice & { membershipId: string }>();
  return {
    async listMine(scope) {
      return [...devices.values()].filter((device) => device.membershipId === scope.membershipId)
        .map(({ endpoint, showNames, createdAt }) => ({ endpoint, showNames, createdAt }));
    },
    async save(scope, input) {
      devices.set(input.endpoint, { endpoint: input.endpoint, showNames: input.showNames, createdAt: new Date().toISOString(), membershipId: scope.membershipId });
    },
    async remove(scope, endpoint) {
      const device = devices.get(endpoint);
      if (device?.membershipId === scope.membershipId) devices.delete(endpoint);
    },
  };
}
