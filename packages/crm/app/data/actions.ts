'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { WebsiteIntakeActionState } from './website-intake-action-state';

function integer(value: FormDataEntryValue | null, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function origins(value: FormDataEntryValue | null): string[] {
  const unique = [...new Set(String(value ?? '').split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean).map((item) => {
    const parsed = new URL(item);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('Each website origin must be an HTTPS origin, such as https://example.com.');
    }
    return parsed.origin;
  }))];
  if (unique.length < 1 || unique.length > 20) throw new Error('Provide between 1 and 20 approved website origins.');
  return unique;
}

export async function configureWebsiteIntakeAction(
  _previous: WebsiteIntakeActionState,
  formData: FormData,
): Promise<WebsiteIntakeActionState> {
  try {
    const context = await getRepository();
    if (!context.isLive) throw new Error('A signed-in live workspace is required.');
    if (context.workspaceScope.role !== 'owner') throw new Error('Only the workspace owner can change website lead intake.');
    const endpointKey = process.env.OMNIX_WEBSITE_INTAKE_ENDPOINT_KEY?.trim() ?? '';
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(endpointKey)) {
      throw new Error('The developer must bind the website intake endpoint before setup can be saved.');
    }
    const displayName = String(formData.get('displayName') ?? '').trim();
    if (!displayName || displayName.length > 120) throw new Error('Connection name must be between 1 and 120 characters.');
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc('configure_website_intake_endpoint', {
      target_workspace_id: context.workspaceScope.workspaceId,
      target_membership_id: context.workspaceScope.membershipId,
      target_endpoint_key: endpointKey,
      target_display_name: displayName,
      target_allowed_origins: origins(formData.get('allowedOrigins')),
      target_rate_limit_per_minute: integer(formData.get('rateLimitPerMinute'), 1, 60, 'Requests per minute'),
      target_response_sla_minutes: integer(formData.get('responseSlaMinutes'), 1, 1440, 'Response target'),
      target_responsible_membership_id: context.workspaceScope.membershipId,
      target_occurred_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Website lead intake could not be saved: ${error.message}`);
    revalidatePath('/data');
    return { status: 'success', message: 'Website lead intake is active. New signed leads will be organized automatically.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Website lead intake could not be saved.' };
  }
}
