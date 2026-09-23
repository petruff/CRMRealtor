import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inQuietHours, newLeadsAlert, type PushPayload } from './push-alerts.ts';

export interface NewLead {
  readonly contactId: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly source?: string;
}

export interface LeadAlertTarget {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly authSecret: string;
  readonly showNames: boolean;
  readonly alertNewLeads: boolean;
  readonly quietStartHour: number;
  readonly quietEndHour: number;
}

export interface LeadAlertStore {
  listTargets(workspaceId: string): Promise<readonly LeadAlertTarget[]>;
  revoke(id: string, at: string): Promise<void>;
}

export type LeadAlertDelivery = (target: LeadAlertTarget, payload: PushPayload) => Promise<void>;

export interface LeadAlertResult {
  readonly sent: number;
  readonly quiet: number;
  readonly optedOut: number;
  readonly revoked: number;
  readonly failed: number;
}

function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number } | undefined)?.statusCode;
  return status === 404 || status === 410;
}

/** Real-time "new lead" push to every opted-in device of the workspace, outside quiet hours. */
export async function sendNewLeadAlerts(input: {
  readonly workspaceId: string;
  readonly leads: readonly NewLead[];
  readonly store: LeadAlertStore;
  readonly deliver: LeadAlertDelivery;
  readonly now: Date;
  readonly timeZone: string;
}): Promise<LeadAlertResult> {
  const counts = { sent: 0, quiet: 0, optedOut: 0, revoked: 0, failed: 0 };
  if (!input.leads.length) return counts;
  for (const target of await input.store.listTargets(input.workspaceId)) {
    if (!target.alertNewLeads) { counts.optedOut += 1; continue; }
    if (inQuietHours(input.now, input.timeZone, target.quietStartHour, target.quietEndHour)) { counts.quiet += 1; continue; }
    const payload = newLeadsAlert(input.leads, target.showNames);
    if (!payload) continue;
    try {
      await input.deliver(target, payload);
      counts.sent += 1;
    } catch (error) {
      if (isGone(error)) { await input.store.revoke(target.id, input.now.toISOString()); counts.revoked += 1; }
      else { counts.failed += 1; console.error(JSON.stringify({ schemaVersion: 'new-lead-alert-error.v1', category: 'push-failed' })); }
    }
  }
  return counts;
}

function supabaseLeadAlertStore(client: SupabaseClient): LeadAlertStore {
  return {
    async listTargets(workspaceId) {
      const { data, error } = await client.from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_secret, show_names, alert_new_leads, quiet_start_hour, quiet_end_hour')
        .eq('workspace_id', workspaceId).is('revoked_at', null).limit(100);
      if (error) throw new Error(`Failed to load notification devices: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: String(row.id), endpoint: String(row.endpoint), p256dh: String(row.p256dh), authSecret: String(row.auth_secret),
        showNames: Boolean(row.show_names), alertNewLeads: row.alert_new_leads !== false,
        quietStartHour: Number(row.quiet_start_hour ?? 21), quietEndHour: Number(row.quiet_end_hour ?? 7),
      }));
    },
    async revoke(id, at) {
      await client.from('push_subscriptions').update({ revoked_at: at, updated_at: at }).eq('id', id);
    },
  };
}

/**
 * Production entry point, called after a lead is saved. Never throws: a
 * notification problem must not affect the lead that was just captured.
 */
export async function notifyNewLeads(
  workspaceId: string,
  leads: readonly NewLead[],
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<LeadAlertResult | undefined> {
  try {
    const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const publicKey = environment.NEXT_PUBLIC_OMNIX_PUSH_PUBLIC_KEY?.trim();
    const privateKey = environment.OMNIX_PUSH_PRIVATE_KEY?.trim();
    const subject = environment.OMNIX_PUSH_SUBJECT?.trim();
    if (!url || !key || !publicKey || !privateKey || !subject?.startsWith('mailto:') || !leads.length) return undefined;
    const { default: webPush } = await import('web-push');
    webPush.setVapidDetails(subject, publicKey, privateKey);
    const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    return await sendNewLeadAlerts({
      workspaceId, leads, store: supabaseLeadAlertStore(client), now,
      timeZone: environment.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
      deliver: async (target, payload) => {
        await webPush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.authSecret } },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: 'high', topic: 'omnix-new-lead' },
        );
      },
    });
  } catch {
    console.error(JSON.stringify({ schemaVersion: 'new-lead-alert-error.v1', category: 'run-failed' }));
    return undefined;
  }
}
