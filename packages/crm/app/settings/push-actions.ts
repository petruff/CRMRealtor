'use server';

import { getRepository } from '@/lib/data';
import {
  PushSubscriptionError,
  memoryPushSubscriptionRepository,
  supabasePushSubscriptionRepository,
  validateAlertPreferences,
  validatePushSubscription,
  type DeviceAlertPreferences,
  type PushSubscriptionRepository,
} from '@/lib/data/push-subscription-repository';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface PushActionResult {
  readonly ok: boolean;
  readonly message: string;
}

const demoDevices = memoryPushSubscriptionRepository();

async function devices(): Promise<{ repository: PushSubscriptionRepository; scope: Awaited<ReturnType<typeof getRepository>>['workspaceScope'] }> {
  const context = await getRepository();
  return {
    repository: context.isLive ? supabasePushSubscriptionRepository(await createSupabaseServerClient()) : demoDevices,
    scope: context.workspaceScope,
  };
}

export async function savePushSubscriptionAction(input: unknown): Promise<PushActionResult> {
  try {
    const subscription = validatePushSubscription(input);
    const { repository, scope } = await devices();
    await repository.save(scope, subscription);
    return { ok: true, message: 'Morning brief is on for this device.' };
  } catch (error) {
    if (error instanceof PushSubscriptionError) return { ok: false, message: error.message };
    console.error('[push-subscription]', error instanceof Error ? error.message : 'unknown');
    return { ok: false, message: "We couldn't turn on notifications. Nothing was changed." };
  }
}

export async function removePushSubscriptionAction(endpoint: unknown): Promise<PushActionResult> {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 2048) {
    return { ok: false, message: 'That device could not be identified.' };
  }
  try {
    const { repository, scope } = await devices();
    await repository.remove(scope, endpoint);
    return { ok: true, message: 'Morning brief is off for this device.' };
  } catch {
    return { ok: false, message: "We couldn't turn notifications off. Try again." };
  }
}

function validEndpoint(endpoint: unknown): endpoint is string {
  return typeof endpoint === 'string' && endpoint.startsWith('https://') && endpoint.length <= 2048;
}

export interface DevicePreferencesResult {
  readonly found: boolean;
  readonly preferences?: DeviceAlertPreferences & { readonly showNames: boolean };
}

/** Reads this device's alert choices (only the member's own devices are visible). */
export async function loadPushPreferencesAction(endpoint: unknown): Promise<DevicePreferencesResult> {
  if (!validEndpoint(endpoint)) return { found: false };
  try {
    const { repository, scope } = await devices();
    const device = (await repository.listMine(scope)).find((item) => item.endpoint === endpoint);
    if (!device) return { found: false };
    const { endpoint: _endpoint, createdAt: _createdAt, ...preferences } = device;
    void _endpoint; void _createdAt;
    return { found: true, preferences };
  } catch {
    return { found: false };
  }
}

export async function updatePushPreferencesAction(endpoint: unknown, input: unknown): Promise<PushActionResult> {
  if (!validEndpoint(endpoint)) return { ok: false, message: 'That device could not be identified.' };
  try {
    const preferences = validateAlertPreferences(input);
    const showNames = (input as { showNames?: unknown } | null)?.showNames === true;
    const { repository, scope } = await devices();
    await repository.updatePreferences(scope, endpoint, { ...preferences, showNames });
    return { ok: true, message: 'Saved for this device.' };
  } catch (error) {
    if (error instanceof PushSubscriptionError) return { ok: false, message: error.message };
    return { ok: false, message: "We couldn't save that. Nothing was changed." };
  }
}
