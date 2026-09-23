import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface DeviceAlertPreferences {
  readonly alertNewLeads: boolean;
  readonly alertDeadlines: boolean;
  readonly quietStartHour: number;
  readonly quietEndHour: number;
}

export const DEFAULT_DEVICE_PREFERENCES: DeviceAlertPreferences = {
  alertNewLeads: true, alertDeadlines: true, quietStartHour: 21, quietEndHour: 7,
};

export interface PushSubscriptionInput extends DeviceAlertPreferences {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly showNames: boolean;
}

export interface StoredPushDevice extends DeviceAlertPreferences {
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

function hour(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) throw new PushSubscriptionError('Choose a valid hour for quiet hours.');
  return parsed;
}

/** Validates the per-device alert choices; missing values keep the defaults. */
export function validateAlertPreferences(input: unknown): DeviceAlertPreferences {
  const candidate = (input ?? {}) as Record<string, unknown>;
  return {
    alertNewLeads: candidate.alertNewLeads === undefined ? DEFAULT_DEVICE_PREFERENCES.alertNewLeads : candidate.alertNewLeads === true,
    alertDeadlines: candidate.alertDeadlines === undefined ? DEFAULT_DEVICE_PREFERENCES.alertDeadlines : candidate.alertDeadlines === true,
    quietStartHour: hour(candidate.quietStartHour, DEFAULT_DEVICE_PREFERENCES.quietStartHour),
    quietEndHour: hour(candidate.quietEndHour, DEFAULT_DEVICE_PREFERENCES.quietEndHour),
  };
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
  return { endpoint, p256dh, auth, showNames: candidate.showNames === true, ...validateAlertPreferences(candidate) };
}

export interface PushSubscriptionRepository {
  listMine(scope: WorkspaceScope): Promise<readonly StoredPushDevice[]>;
  save(scope: WorkspaceScope, input: PushSubscriptionInput): Promise<void>;
  updatePreferences(scope: WorkspaceScope, endpoint: string, preferences: DeviceAlertPreferences & { readonly showNames: boolean }): Promise<void>;
  remove(scope: WorkspaceScope, endpoint: string): Promise<void>;
}

/** RLS-scoped: members only ever read or write their own devices. */
export function supabasePushSubscriptionRepository(client: SupabaseClient): PushSubscriptionRepository {
  return {
    async listMine(scope) {
      const { data, error } = await client.from('push_subscriptions')
        .select('endpoint, show_names, created_at, alert_new_leads, alert_deadlines, quiet_start_hour, quiet_end_hour')
        .eq('workspace_id', scope.workspaceId)
        .eq('membership_id', scope.membershipId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Failed to load notification devices: ${error.message}`);
      return (data ?? []).map((row) => ({
        endpoint: String(row.endpoint), showNames: Boolean(row.show_names), createdAt: String(row.created_at),
        alertNewLeads: row.alert_new_leads !== false, alertDeadlines: row.alert_deadlines !== false,
        quietStartHour: Number(row.quiet_start_hour ?? 21), quietEndHour: Number(row.quiet_end_hour ?? 7),
      }));
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
        alert_new_leads: input.alertNewLeads,
        alert_deadlines: input.alertDeadlines,
        quiet_start_hour: input.quietStartHour,
        quiet_end_hour: input.quietEndHour,
      });
      if (error) throw new Error(`Failed to save notification device: ${error.message}`);
    },
    async updatePreferences(scope, endpoint, preferences) {
      const { error } = await client.from('push_subscriptions').update({
        show_names: preferences.showNames,
        alert_new_leads: preferences.alertNewLeads,
        alert_deadlines: preferences.alertDeadlines,
        quiet_start_hour: preferences.quietStartHour,
        quiet_end_hour: preferences.quietEndHour,
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', scope.workspaceId).eq('membership_id', scope.membershipId).eq('endpoint', endpoint);
      if (error) throw new Error(`Failed to update notification choices: ${error.message}`);
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
        .map(({ membershipId: _membershipId, ...device }) => { void _membershipId; return device; });
    },
    async save(scope, input) {
      const { p256dh: _p256dh, auth: _auth, ...stored } = input;
      void _p256dh; void _auth;
      devices.set(input.endpoint, { ...stored, createdAt: new Date().toISOString(), membershipId: scope.membershipId });
    },
    async updatePreferences(scope, endpoint, preferences) {
      const device = devices.get(endpoint);
      if (device?.membershipId === scope.membershipId) devices.set(endpoint, { ...device, ...preferences });
    },
    async remove(scope, endpoint) {
      const device = devices.get(endpoint);
      if (device?.membershipId === scope.membershipId) devices.delete(endpoint);
    },
  };
}
