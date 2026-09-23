'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { siteOrigin } from '@/lib/application/site-origin';
import { LEAD_PAGE_KEY_PREFIX } from '@/lib/domain/lead-page';

export interface LeadPageSetupState {
  readonly status: 'idle' | 'created' | 'error';
  readonly message?: string;
}

function newKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return LEAD_PAGE_KEY_PREFIX + Array.from(randomBytes(16), (byte) => alphabet[byte % alphabet.length]).join('');
}

/** Creates the workspace's hosted lead page (owner only). Existing leads and settings are untouched. */
export async function createLeadPageAction(_state: LeadPageSetupState, formData: FormData): Promise<LeadPageSetupState> {
  try {
    const context = await getRepository();
    if (!context.isLive) return { status: 'error', message: 'Your lead page goes live once Omnix is connected to your workspace. You can preview it below.' };
    if (context.workspaceScope.role !== 'owner') return { status: 'error', message: 'Only the workspace owner can create the lead page.' };
    const sla = Number(formData.get('responseSlaMinutes') ?? 15);
    if (![5, 10, 15, 30, 60].includes(sla)) return { status: 'error', message: 'Choose a response target.' };
    const origin = await siteOrigin();
    if (!origin.startsWith('https://')) return { status: 'error', message: 'The lead page needs a secure (https) address for this workspace.' };
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc('configure_website_intake_endpoint', {
      target_workspace_id: context.workspaceScope.workspaceId,
      target_membership_id: context.workspaceScope.membershipId,
      target_endpoint_key: newKey(),
      target_display_name: 'Omnix lead page',
      target_allowed_origins: [origin],
      target_rate_limit_per_minute: 20,
      target_response_sla_minutes: sla,
      target_responsible_membership_id: context.workspaceScope.membershipId,
      target_occurred_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    revalidatePath('/lead-page');
    return { status: 'created', message: 'Your lead page is live. Share the link or QR code below.' };
  } catch (error) {
    console.error('[lead-page:create]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'The lead page couldn’t be created. Nothing was changed.' };
  }
}
