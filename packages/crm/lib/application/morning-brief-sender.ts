import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildMorningBrief, type MorningBrief } from './morning-brief.ts';
import { resolveServerWorkspaceScope } from '../data/automation-context.ts';
import { supabaseRepository } from '../data/supabase-repository.ts';
import { supabaseOperationalSignalRepository } from '../data/supabase-operational-signal-repository.ts';
import type { Contact } from '../domain/contact.ts';

export interface PushTarget {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly authSecret: string;
  readonly showNames: boolean;
  readonly lastSentOn?: string;
}

export interface PushDelivery {
  (target: PushTarget, payload: MorningBrief): Promise<void>;
}

export interface MorningBriefStore {
  listTargets(): Promise<readonly PushTarget[]>;
  markSent(id: string, day: string): Promise<void>;
  revoke(id: string, at: string): Promise<void>;
}

export interface MorningBriefRunResult {
  readonly day: string;
  readonly sent: number;
  readonly alreadySent: number;
  readonly nothingToSend: number;
  readonly revoked: number;
  readonly failed: number;
}

export function localCalendarDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Push services answer 404/410 for endpoints that will never work again. */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number } | undefined)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Sends at most one brief per device per local day. Idempotent: a retried
 * cron run skips devices already marked for today; dead endpoints are revoked.
 */
export async function runMorningBrief(input: {
  readonly contacts: readonly Contact[];
  readonly openDeadlines: number;
  readonly store: MorningBriefStore;
  readonly deliver: PushDelivery;
  readonly now: Date;
  readonly timeZone: string;
}): Promise<MorningBriefRunResult> {
  const day = localCalendarDay(input.now, input.timeZone);
  const counts = { sent: 0, alreadySent: 0, nothingToSend: 0, revoked: 0, failed: 0 };
  for (const target of await input.store.listTargets()) {
    if (target.lastSentOn === day) { counts.alreadySent += 1; continue; }
    const brief = buildMorningBrief(input.contacts, input.now, { showNames: target.showNames, openDeadlines: input.openDeadlines });
    if (!brief) { counts.nothingToSend += 1; continue; }
    try {
      await input.deliver(target, brief);
      await input.store.markSent(target.id, day);
      counts.sent += 1;
    } catch (error) {
      if (isGone(error)) {
        await input.store.revoke(target.id, input.now.toISOString());
        counts.revoked += 1;
      } else {
        counts.failed += 1;
        console.error(JSON.stringify({ schemaVersion: 'morning-brief-delivery-error.v1', category: 'push-failed' }));
      }
    }
  }
  return { day, ...counts };
}

function supabaseMorningBriefStore(client: SupabaseClient, workspaceId: string): MorningBriefStore {
  return {
    async listTargets() {
      const { data, error } = await client.from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_secret, show_names, last_sent_on')
        .eq('workspace_id', workspaceId).is('revoked_at', null).limit(100);
      if (error) throw new Error(`Failed to load notification devices: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: String(row.id), endpoint: String(row.endpoint), p256dh: String(row.p256dh), authSecret: String(row.auth_secret),
        showNames: Boolean(row.show_names), ...(row.last_sent_on ? { lastSentOn: String(row.last_sent_on) } : {}),
      }));
    },
    async markSent(id, day) {
      const { error } = await client.from('push_subscriptions').update({ last_sent_on: day, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(`Failed to record notification delivery: ${error.message}`);
    },
    async revoke(id, at) {
      await client.from('push_subscriptions').update({ revoked_at: at, updated_at: at }).eq('id', id);
    },
  };
}

/** Production entry point for the daily cron. Fails closed when not configured. */
export async function sendConfiguredMorningBriefs(
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<MorningBriefRunResult> {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const workspaceId = (environment.OMNIX_INTAKE_WORKSPACE_ID ?? environment.CRM_INTAKE_WORKSPACE_ID)?.trim();
  const ownerId = (environment.OMNIX_INTAKE_OWNER_ID ?? environment.CRM_INTAKE_OWNER_ID)?.trim();
  const publicKey = environment.NEXT_PUBLIC_OMNIX_PUSH_PUBLIC_KEY?.trim();
  const privateKey = environment.OMNIX_PUSH_PRIVATE_KEY?.trim();
  const subject = environment.OMNIX_PUSH_SUBJECT?.trim();
  if (!url || !key || (!workspaceId && !ownerId) || !publicKey || !privateKey || !subject?.startsWith('mailto:')) {
    throw new Error('Morning brief notifications are not configured.');
  }
  const { default: webPush } = await import('web-push');
  webPush.setVapidDetails(subject, publicKey, privateKey);
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const scope = await resolveServerWorkspaceScope(client, { workspaceId, ownerId });
  const [contacts, milestones] = await Promise.all([
    supabaseRepository(client, scope).list(),
    supabaseOperationalSignalRepository(client).listMilestones(scope, { openOnly: true, limit: 500 }).catch(() => []),
  ]);
  const horizon = now.getTime() + 7 * 86_400_000;
  return runMorningBrief({
    contacts,
    openDeadlines: milestones.filter((milestone) => Date.parse(milestone.dueAt) <= horizon).length,
    store: supabaseMorningBriefStore(client, scope.workspaceId),
    deliver: async (target, payload) => {
      await webPush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.authSecret } },
        JSON.stringify(payload),
        { TTL: 6 * 60 * 60, urgency: 'normal', topic: 'omnix-morning-brief' },
      );
    },
    now,
    timeZone: environment.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
  });
}
