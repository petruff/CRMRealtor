'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createMailchimpServerRepository } from '@/lib/data/mailchimp-operation-server-context';
import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { MailchimpMarketingClient } from '@/lib/providers/mailchimp-client';
import { createMailchimpCampaignDraftCommand, executeMailchimpCampaignActionCommand,
  updateMailchimpCampaignDraftCommand } from '@/lib/application/mailchimp-campaign-service';
import { ConnectorError } from '@/lib/domain/connector';
import { blockingFairHousingFindings, fairHousingBlockMessage } from '@/lib/domain/fair-housing';

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function correlationId(formData: FormData): string {
  const value = field(formData, 'correlationId');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value : randomUUID();
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function draftInput(formData: FormData) {
  const segmentValue = field(formData, 'segment');
  const message = field(formData, 'message');
  const blocking = blockingFairHousingFindings(field(formData, 'subject'), field(formData, 'previewText'), message);
  if (blocking.length) throw new ConnectorError('invalid-input', fairHousingBlockMessage(blocking));
  return {
    segment: segmentValue === 'all-subscribers'
      ? { kind: 'all-subscribers' as const }
      : { kind: 'lead-type' as const, value: segmentValue as 'hot' | 'warm' | 'nurture' },
    content: {
      title: field(formData, 'title'), subject: field(formData, 'subject'),
      previewText: field(formData, 'previewText'), fromName: field(formData, 'fromName'),
      replyTo: field(formData, 'replyTo'), plainText: message,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#181d26">${escapeHtml(message).replaceAll('\n', '<br>')}</div>`,
    },
  };
}

function finish(kind: 'success' | 'error', message: string): never {
  revalidatePath('/campaigns');
  redirect(`/campaigns?${new URLSearchParams({ [kind]: message.slice(0, 220) })}`);
}

export async function createCampaignDraftAction(formData: FormData) {
  let successMessage = 'Campaign draft ready for review.';
  try {
    const context = await getRepository();
    if (!context.isLive) throw new ConnectorError('forbidden', 'Sign in to create a campaign.');
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    const draft = draftInput(formData);
    const campaign = await createMailchimpCampaignDraftCommand({
      repository: server.campaigns, scope: context.workspaceScope,
      connectionId: field(formData, 'connectionId'), ...draft, correlationId: correlationId(formData),
    });
    successMessage = `Draft ready for review · ${campaign.eligibleCount} subscribed contacts eligible.`;
  } catch (error) {
    finish('error', error instanceof ConnectorError ? error.message : 'The campaign draft could not be created safely.');
  }
  finish('success', successMessage);
}

export async function updateCampaignDraftAction(formData: FormData) {
  let successMessage = 'Campaign changes saved. Review the updated audience before approval.';
  try {
    const context = await getRepository();
    if (!context.isLive) throw new ConnectorError('forbidden', 'Sign in to edit a campaign.');
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    const draft = draftInput(formData);
    const campaign = await updateMailchimpCampaignDraftCommand({
      repository: server.campaigns,
      scope: context.workspaceScope,
      campaignId: field(formData, 'campaignId'),
      version: Number(field(formData, 'version')),
      ...draft,
      correlationId: correlationId(formData),
    });
    successMessage = `Campaign updated · ${campaign.eligibleCount} subscribed contacts eligible.`;
  } catch (error) {
    finish('error', error instanceof ConnectorError ? error.message : 'The campaign changes could not be saved safely.');
  }
  finish('success', successMessage);
}

async function executeCampaignAction(formData: FormData, action: 'create' | 'send') {
  let successMessage = 'Mailchimp campaign updated.';
  try {
    const context = await getRepository();
    if (!context.isLive) throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    if (action === 'send' && field(formData, 'confirmed') !== 'yes') {
      throw new ConnectorError('invalid-input', 'Confirm the final audience and message before sending.');
    }
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    const campaign = await executeMailchimpCampaignActionCommand({
      campaigns: server.campaigns, operations: server.operations,
      configuration: loadMailchimpConfiguredRuntimeConfiguration(), scope: context.workspaceScope,
      campaignId: field(formData, 'campaignId'), action, correlationId: randomUUID(),
      createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token),
    });
    successMessage = action === 'create'
      ? `Campaign is ready in Mailchimp for ${campaign.eligibleCount} subscribed contacts.`
      : `Campaign sent to ${campaign.eligibleCount} subscribed contacts.`;
  } catch (error) {
    finish('error', error instanceof ConnectorError ? error.message : 'Mailchimp could not complete this action safely.');
  }
  finish('success', successMessage);
}

export async function createInMailchimpAction(formData: FormData) { return executeCampaignAction(formData, 'create'); }
export async function sendMailchimpCampaignAction(formData: FormData) { return executeCampaignAction(formData, 'send'); }
