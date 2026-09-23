'use server';

import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { processWebsiteLeadSubmission } from '@/lib/application/website-intake-processor';
import { siteOrigin } from '@/lib/application/site-origin';
import { findPublicLeadPage, leadPageIntakeContext, serviceClient } from '@/lib/data/lead-page-repository';
import { LeadPageError, isLeadPageKey, leadPagePayload, leadPageSource } from '@/lib/domain/lead-page';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export interface LeadPageState {
  readonly status: 'idle' | 'sent' | 'error';
  readonly firstName?: string;
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly values?: Readonly<Record<string, string>>;
}

function kept(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, entry] of formData.entries()) if (typeof entry === 'string' && key !== 'company' && key !== 'src') values[key] = entry;
  return values;
}

/** Public submission from the hosted lead page. Every answer is re-validated on the server. */
export async function submitLeadPageAction(endpointKey: string, _state: LeadPageState, formData: FormData): Promise<LeadPageState> {
  // Honeypot: people never see this field; bots fill it.
  if (String(formData.get('company') ?? '')) return { status: 'sent', firstName: 'there' };
  if (!isLeadPageKey(endpointKey) && endpointKey !== 'preview') return { status: 'error', message: 'This page is no longer active.' };
  try {
    const origin = await siteOrigin();
    const submissionId = randomUUID();
    const payload = leadPagePayload(formData, {
      submissionId,
      landingPage: `${origin.replace(/^http:/u, 'https:')}/l/${endpointKey}`,
      source: leadPageSource(formData.get('src')),
    });
    if (!isSupabaseConfigured() || endpointKey === 'preview') return { status: 'sent', firstName: payload.firstName };
    const client = serviceClient();
    const page = client ? await findPublicLeadPage(client, endpointKey) : undefined;
    if (!client || !page) return { status: 'error', message: 'This page is no longer active.' };
    const list = await headers();
    const outcome = await processWebsiteLeadSubmission(await leadPageIntakeContext(client, page.workspaceId), {
      endpointKey, body: JSON.stringify(payload), idempotencyKey: submissionId, origin,
      forwardedFor: list.get('x-forwarded-for')?.split(',')[0]?.trim(), userAgent: list.get('user-agent'), receivedAt: new Date(),
    });
    if (outcome.status === 200 || outcome.status === 202) return { status: 'sent', firstName: payload.firstName };
    if (outcome.status === 429) return { status: 'error', message: 'Lots of people are reaching out right now — please try again in a minute.', values: kept(formData) };
    return { status: 'error', message: 'Sorry — that didn’t go through. Please try again, or call or text directly.', values: kept(formData) };
  } catch (error) {
    if (error instanceof LeadPageError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors, values: kept(formData) };
    console.error('[lead-page:submit]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'Sorry — that didn’t go through. Please try again.', values: kept(formData) };
  }
}
