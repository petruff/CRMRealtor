import Link from 'next/link';
import type { Metadata } from 'next';
import { Mail, Calendar, Send, MessageSquare, Instagram, Globe, Lock, Clock, Check, Upload, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { getRepository } from '@/lib/data';
import {
  listConnectorConnectionsCommand,
  listConnectorDefinitionsCommand,
  listConnectorJobsCommand,
  listConnectorIntentsCommand,
  listConnectorReceiptsCommand,
} from '@/lib/application/connector-commands';
import {
  approveConnectorIntentAction,
  approveTextingIntentAction,
  cancelConnectorJobAction,
  disconnectConnectionAction,
  editConnectorIntentAction,
  rejectConnectorIntentAction,
  retryConnectorJobAction,
  disableTextingAction,
  configureTwilioAction,
  discoverMetaAssetsAction,
  selectMetaAssetsAction,
  resolveMetaReviewAction,
} from './actions';
import { MailchimpAudienceSelector } from '@/components/mailchimp-audience-selector';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createMailchimpServerRepository } from '@/lib/data/mailchimp-operation-server-context';
import { listLiveMailchimpAudiencesCommand } from '@/lib/application/mailchimp-commands';
import { MailchimpMarketingClient } from '@/lib/providers/mailchimp-client';
import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import type { MailchimpAudience, MailchimpAudienceBinding } from '@/lib/domain/mailchimp';
import type { MailchimpReconciliationRun } from '@/lib/data/supabase-mailchimp-reconciliation-repository';
import type { MailchimpOutboundBackfillRun } from '@/lib/data/mailchimp-outbound-backfill-repository';
import { supabaseGoogleOperationRepository } from '@/lib/data/supabase-google-operation-repository';
import type { GoogleCapabilityState } from '@/lib/data/google-operation-repository';
import { supabaseTwilioOperationRepository, type TwilioReadinessState } from '@/lib/data/twilio-operation-repository';
import {
  prepareGoogleCalendarCreationAction,
  prepareGoogleCalendarSyncAction,
  prepareGoogleGmailSyncAction,
} from './google-actions';
import { supabaseMetaOperationRepository, type MetaConnectionState, type MetaReviewItem } from '@/lib/data/meta-operation-repository';
import { readMetaEnquiryReviewContext } from '@/lib/application/meta-review-service';
import { displayName, type Contact } from '@/lib/domain/contact';
import { createClient } from '@supabase/supabase-js';
import { deriveConnectionCardStatus, type ConnectionCardStatus } from './connection-status';
import { connectionNotice, googleWorkspaceConnectHref, mailchimpConnectHref } from './oauth-presentation';
import {
  mailchimpConnectionStatusLabel,
  recordMailchimpReadFailure,
  type MailchimpAudienceLoadIssue,
} from './mailchimp-presentation';
import { googleConnectionPresentation } from './google-presentation';

const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/calendar.app.created',
] as const;

function supportReference(value: string): string {
  return value.replaceAll('-', '').slice(0, 8).toUpperCase();
}

function connectorServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('Connector service authority is unavailable.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Connections hub.
 *
 * Every platform she mentioned appears here. Statuses are honest: some are
 * blocked by external approval that no amount of code shortens (carrier 10DLC
 * registration, Meta business review), and showing those as a live "Connect"
 * button would be a lie the user only discovers after clicking.
 */

type Status = ConnectionCardStatus;

interface Integration {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  what: string;
  status: Status;
  statusLabel?: string;
  detail: string;
  access: string;
  href?: string;
}

const STATUS_META: Record<Status, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  ready: {
    label: 'Ready to connect',
    className: 'bg-nurture-soft text-nurture border-nurture-border',
    icon: Check,
  },
  building: {
    label: 'Being built',
    className: 'bg-warm-soft text-warm border-warm-border',
    icon: Clock,
  },
  connected: {
    label: 'Connected · setup pending',
    className: 'bg-nurture-soft text-nurture border-nurture-border',
    icon: Check,
  },
  review: {
    label: 'Connected · review required',
    className: 'bg-warm-soft text-warm border-warm-border',
    icon: ShieldCheck,
  },
  uat: {
    label: 'Implemented · UAT pending',
    className: 'bg-warm-soft text-warm border-warm-border',
    icon: ShieldCheck,
  },
  gated: {
    label: 'Waiting on approval',
    className: 'bg-surface-3 text-muted border-line-strong',
    icon: Lock,
  },
};

const INTEGRATIONS: Integration[] = [
  {
    name: 'Contact imports',
    icon: Upload,
    what: 'Bring contacts from another CRM, Mailchimp, Google, Apple, BoldTrail, or a spreadsheet.',
    status: 'ready',
    detail: 'Preview every match first. Existing information is preserved, duplicates are merged conservatively, and rejected rows stay visible.',
    access: 'File upload · no platform password',
    href: '/contacts/import',
  },
  {
    name: 'Gmail',
    icon: Mail,
    what: 'Send from inside the CRM, and log emails onto the contact automatically.',
    status: 'uat',
    detail:
      'Incremental OAuth, governed send, minimized metadata matching, verified push wake-ups, cursor recovery and no-blind-resend reconciliation are implemented. Production credentials, Google verification and real-account UAT are still required.',
    access: 'Google OAuth · incremental Gmail scopes',
  },
  {
    name: 'Google Calendar',
    icon: Calendar,
    what: 'Your follow-ups appear in the calendar you already look at.',
    status: 'uat',
    detail: 'The Omnix-created secondary calendar supports governed task create, update, completion, cancellation, deletion and bounded reconciliation. Production credentials, Google verification and real-account UAT remain required.',
    access: 'Google OAuth · separate Calendar scopes',
  },
  {
    name: 'Mailchimp',
    icon: Send,
    what: 'Connect one selected audience for governed tag sync and inbound subscription updates.',
    status: 'uat',
    detail:
      'OAuth, audience selection, encrypted per-connection webhook secrets, durable jobs, baseline matching and unsubscribe authority are implemented. Production remains gated by registered credentials and real-account UAT.',
    access: 'Mailchimp OAuth · selected audience + signed webhooks',
  },
  {
    name: 'Texting',
    icon: MessageSquare,
    what: 'Text contacts from the CRM, with the conversation saved to their record.',
    status: 'gated',
    detail:
      'The governed Twilio workflow, consent and quiet-hours authority, signed callbacks, STOP suppression and reconciliation are implemented. Provider messaging remains blocked until 10DLC approval and controlled real-number UAT pass.',
    access: 'Twilio service connection · consent and carrier registration',
  },
  {
    name: 'Instagram & Facebook',
    icon: Instagram,
    what: 'Turn DM enquiries into contacts without retyping them.',
    status: 'gated',
    detail:
      'Inbound-only Facebook Page and Instagram Professional intake, signed webhook handling, selected-asset authority, review/quarantine and disconnect recovery are implemented. Meta Business Verification, App Review, an approved Graph version and real-account UAT remain external gates.',
    access: 'Meta Business Login · approved assets and webhook permissions',
  },
  {
    name: 'Website forms',
    icon: Globe,
    what: 'Authenticated website submissions can land here as new contacts, ready to screen.',
    status: 'ready',
    detail: 'The authenticated CRM intake endpoint is ready. Connect the website when it exists by adding the live owner, service-role, token, and an idempotency key per submission.',
    access: 'Server token · owner-bound idempotent intake',
  },
];

function liveIntegrationStatus(
  integration: Integration,
  input: {
    readonly mailchimpEnabled: boolean;
    readonly mailchimpConnected: boolean;
    readonly mailchimpLive: boolean;
    readonly mailchimpReviewItems: number;
    readonly googleEnabled: boolean;
    readonly googleConnected: boolean;
    readonly googleLive: boolean;
    readonly googleGmailActive: boolean;
    readonly googleCalendarActive: boolean;
    readonly twilioEnabled: boolean;
    readonly twilioConnected: boolean;
    readonly twilioLive: boolean;
    readonly twilioReady: boolean;
    readonly metaEnabled: boolean;
    readonly metaConnected: boolean;
    readonly metaLive: boolean;
  },
): Integration {
  if (integration.name === 'Mailchimp' && input.mailchimpEnabled) {
    const presentation = deriveConnectionCardStatus('mailchimp', {
      providerEnabled: input.mailchimpEnabled,
      connected: input.mailchimpConnected,
      productionApproved: input.mailchimpLive,
      reviewItems: input.mailchimpReviewItems,
    });
    return {
      ...integration,
      status: presentation.status,
      statusLabel: presentation.label,
      what: input.mailchimpConnected
        ? 'Synchronize the selected audience with governed Omnix lead-temperature tags and inbound subscription authority.'
        : 'Authorize one Mailchimp account, then select exactly one audience for controlled synchronization.',
      detail: input.mailchimpConnected
        ? input.mailchimpReviewItems > 0
          ? `OAuth, the selected audience and the signed webhook are active. The latest reconciliation completed and ${input.mailchimpReviewItems} records need safe identity review before baseline activation.`
          : `The OAuth connection is persisted. ${input.mailchimpLive
            ? 'Production activation is approved for this deployment; the selected-audience evidence below remains authoritative.'
            : 'It remains in UAT until a real tag update, signed unsubscribe, reconciliation and disconnect are proven.'}`
        : 'The registered-app OAuth flow is available only to the workspace owner when server credentials are configured. No password or API key is requested.',
    };
  }
  if ((integration.name === 'Gmail' || integration.name === 'Google Calendar') && input.googleEnabled) {
    const requiredCapabilityActive = integration.name === 'Gmail'
      ? input.googleGmailActive
      : input.googleCalendarActive;
    const presentation = deriveConnectionCardStatus('google', {
      providerEnabled: input.googleEnabled,
      connected: input.googleConnected,
      productionApproved: input.googleLive,
      requiredCapabilityActive,
    });
    return {
      ...integration,
      status: presentation.status,
      statusLabel: presentation.label,
      detail: input.googleConnected
        ? `The Google account is bound to this workspace. ${input.googleLive
          ? 'Production scope review and real-account UAT are approved.'
          : 'It remains in UAT while each Gmail and Calendar feature bundle is consented and verified.'}`
        : 'The separate connector OAuth flow is available. The owner chooses Gmail send, Gmail metadata, or the Omnix-created Calendar permission individually.',
    };
  }
  if (integration.name === 'Texting' && input.twilioEnabled) {
    return {
      ...integration,
      status: input.twilioConnected && input.twilioLive && input.twilioReady ? 'ready' : 'uat',
      detail: input.twilioConnected
        ? `The workspace Messaging Service is bound. ${input.twilioLive
          ? 'Registration, compliance policy, signed callbacks and controlled real-number UAT are approved.'
          : 'Provider sends remain blocked while registration, consent/quiet-hours policy, callbacks or real-number UAT are pending.'}`
        : 'The server-side Twilio boundary is implemented. It never asks for a consumer password; owner configuration and external approval are still required.',
    };
  }
  if (integration.name === 'Instagram & Facebook') {
    const presentation = deriveConnectionCardStatus('meta', {
      providerEnabled: input.metaEnabled,
      connected: input.metaConnected,
      productionApproved: input.metaLive,
    });
    return {
      ...integration,
      status: presentation.status,
      statusLabel: presentation.label,
      what: 'Turn verified Facebook Page or Instagram Professional messages into reviewable CRM enquiries.',
      detail: input.metaConnected
        ? `Inbound-only business messaging is bound to selected assets. ${input.metaLive
          ? 'Business Verification, App Review, retention policy and real-account UAT are approved for this deployment.'
          : 'It remains in UAT; no outbound reply, Lead Ads, personal-account access or production claim is enabled.'}`
        : 'The inbound-only Meta boundary is implemented fail-closed. Business Login stays unavailable until the Graph version, exact permissions and eligible assets are verified.',
      access: 'Meta Business Login · inbound business messages only',
    };
  }
  return integration;
}

export const metadata: Metadata = { title: 'Connections' };

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ success?: string | string[]; error?: string | string[]; ref?: string | string[] }>;
}) {
  const { repository, connectorRepository, workspaceScope, isLive } = await getRepository();
  const notice = await searchParams;
  const feedback = connectionNotice(notice ?? {});
  const [definitions, persistedConnections, intents, jobs, receipts] = await Promise.all([
    listConnectorDefinitionsCommand(connectorRepository, workspaceScope),
    listConnectorConnectionsCommand(connectorRepository, workspaceScope, { limit: 50 }),
    listConnectorIntentsCommand(connectorRepository, workspaceScope, { limit: 20 }),
    listConnectorJobsCommand(connectorRepository, workspaceScope, { state: 'all', limit: 20 }),
    listConnectorReceiptsCommand(connectorRepository, workspaceScope, { limit: 20 }),
  ]);
  const realConnections = persistedConnections.filter((connection) => connection.provider !== 'contract-test');
  const enabledRealProviders = definitions.filter((definition) => (
    definition.provider !== 'contract-test' && definition.enabled
  ));
  const mailchimpDefinition = definitions.find((definition) => definition.provider === 'mailchimp');
  const mailchimpConnection = realConnections.find((connection) => connection.provider === 'mailchimp');
  const googleDefinition = definitions.find((definition) => definition.provider === 'google');
  const googleConnection = realConnections.find((connection) => connection.provider === 'google');
  const twilioDefinition = definitions.find((definition) => definition.provider === 'twilio');
  const twilioConnection = realConnections.find((connection) => connection.provider === 'twilio');
  const metaDefinition = definitions.find((definition) => definition.provider === 'meta');
  const metaConnection = realConnections.find((connection) => connection.provider === 'meta');
  let mailchimpAudiences: readonly MailchimpAudience[] = [];
  let mailchimpAudienceLoadIssue: MailchimpAudienceLoadIssue | undefined;
  let selectedMailchimpAudience: MailchimpAudienceBinding | undefined;
  let mailchimpReconciliation: MailchimpReconciliationRun | undefined;
  let mailchimpOutboundBackfills: readonly MailchimpOutboundBackfillRun[] = [];
  let googleCapabilityState: GoogleCapabilityState | undefined;
  let twilioReadinessState: TwilioReadinessState | undefined;
  let metaConnectionState: MetaConnectionState | undefined;
  let metaReviewItems: readonly MetaReviewItem[] = [];
  let metaReviewContacts: readonly Contact[] = [];
  if (isLive && mailchimpDefinition?.enabled && mailchimpConnection) {
    try {
      const authenticated = await createSupabaseServerClient();
      const server = createMailchimpServerRepository({ authenticated });
      const operations = server.operations;
      const configured = loadMailchimpConfiguredRuntimeConfiguration();
      const [bindingResult, reconciliationResult, backfillResult] = await Promise.allSettled([
        operations.getSelectedAudience(workspaceScope, mailchimpConnection.id),
        server.reconciliations.list(workspaceScope, mailchimpConnection.id, 1),
        server.outboundBackfills.list(workspaceScope, mailchimpConnection.id, 5),
      ]);
      if (bindingResult.status === 'fulfilled') selectedMailchimpAudience = bindingResult.value;
      else mailchimpAudienceLoadIssue = recordMailchimpReadFailure({
        operation: 'binding', connectionId: mailchimpConnection.id, error: bindingResult.reason,
      });
      if (reconciliationResult.status === 'fulfilled') mailchimpReconciliation = reconciliationResult.value[0];
      else recordMailchimpReadFailure({
        operation: 'reconciliation', connectionId: mailchimpConnection.id, error: reconciliationResult.reason,
      });
      if (backfillResult.status === 'fulfilled') mailchimpOutboundBackfills = backfillResult.value;
      else recordMailchimpReadFailure({
        operation: 'backfill', connectionId: mailchimpConnection.id, error: backfillResult.reason,
      });
      if (workspaceScope.role === 'owner' && !mailchimpAudienceLoadIssue) {
        try {
          mailchimpAudiences = await listLiveMailchimpAudiencesCommand(
            operations, configured, workspaceScope,
            { connectionId: mailchimpConnection.id, limit: 500 },
            { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
          );
        } catch (error) {
          mailchimpAudienceLoadIssue = recordMailchimpReadFailure({
            operation: 'audiences', connectionId: mailchimpConnection.id, error,
          });
        }
      }
    } catch (error) {
      mailchimpAudienceLoadIssue = recordMailchimpReadFailure({
        operation: 'binding', connectionId: mailchimpConnection.id, error,
      });
    }
  }
  const googlePresentation = googleConnection
    ? googleConnectionPresentation(googleConnection)
    : undefined;
  const googleConsentPending = googlePresentation?.consentPending ?? false;
  if (isLive && googleDefinition?.enabled && googleConnection
    && googlePresentation?.shouldReadCapabilityHealth) {
    try {
      const authenticated = await createSupabaseServerClient();
      googleCapabilityState = await supabaseGoogleOperationRepository({ authenticated })
        .readCapabilityState(workspaceScope, googleConnection.id);
    } catch {
      googleCapabilityState = undefined;
    }
  }
  if (isLive && twilioDefinition?.enabled && twilioConnection) {
    try {
      twilioReadinessState = await supabaseTwilioOperationRepository(await createSupabaseServerClient())
        .readReadiness(workspaceScope, twilioConnection.id);
    } catch {
      twilioReadinessState = undefined;
    }
  }
  if (isLive && metaDefinition?.enabled && metaConnection) {
    try {
      const metaRepository = supabaseMetaOperationRepository(await createSupabaseServerClient());
      [metaConnectionState, metaReviewItems] = await Promise.all([
        metaRepository.readConnectionState(workspaceScope, metaConnection.id),
        metaRepository.listReviewItems(workspaceScope, metaConnection.id, 20),
      ]);
      metaReviewItems = await Promise.all(metaReviewItems.map(async (item) => {
        try {
          const context = await readMetaEnquiryReviewContext({ service: connectorServiceClient(), scope: workspaceScope, eventId: item.eventId });
          return { ...item, textPreview: context.textPreview, sourceReference: context.sourceReference,
            attachmentTypes: context.attachmentTypes, incompleteRecordId: context.incompleteRecordId };
        } catch { return item; }
      }));
      if (metaReviewItems.length) metaReviewContacts = await repository.list();
    } catch {
      metaConnectionState = undefined;
      metaReviewItems = [];
    }
  }
  const integrations = INTEGRATIONS.map((integration) => liveIntegrationStatus(integration, {
    mailchimpEnabled: mailchimpDefinition?.enabled === true,
    mailchimpConnected: Boolean(mailchimpConnection),
    mailchimpLive: mailchimpDefinition?.mode === 'live',
    mailchimpReviewItems: mailchimpReconciliation?.itemsReviewed ?? 0,
    googleEnabled: googleDefinition?.enabled === true,
    googleConnected: Boolean(googleConnection),
    googleLive: googleDefinition?.mode === 'live',
    googleGmailActive: googleCapabilityState?.capabilities.some((capability) => (
      ['gmail-send', 'gmail-metadata'].includes(capability.bundle) && capability.state === 'active'
    )) === true,
    googleCalendarActive: googleCapabilityState?.capabilities.some((capability) => (
      capability.bundle === 'calendar-app-created' && capability.state === 'active'
    )) === true,
    twilioEnabled: twilioDefinition?.enabled === true,
    twilioConnected: Boolean(twilioConnection),
    twilioLive: twilioDefinition?.mode === 'live',
    twilioReady: twilioReadinessState?.enabled === true
      && twilioReadinessState.readiness === 'active'
      && twilioReadinessState.providerBacked,
    metaEnabled: metaDefinition?.enabled === true,
    metaConnected: Boolean(metaConnection),
    metaLive: metaDefinition?.mode === 'live',
  }));
  const googleWorkspaceAuthorized = GOOGLE_WORKSPACE_SCOPES.every((scope) => (
    googleConnection?.grantedScopes.includes(scope)
  ));
  const mailchimpNeedsReauthorization = Boolean(mailchimpConnection) && (
    mailchimpConnection?.status === 'reauthorization-required'
  );
  return (
    <div>
      <header className="mb-10 md:mb-12">
        <p className="eyebrow">Connections</p>
        <h1 className="mt-2 max-w-3xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Everything in one place.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
          You said you were tired of going back and forth between systems. This is the list of
          what plugs in — and, honestly, what is still waiting on someone else.
        </p>
        <div className="mt-5 flex max-w-2xl items-start gap-2.5 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-nurture" aria-hidden />
          <p><span className="font-medium text-ink">Omnix never asks for a platform password.</span> Connections use provider authorization, server-side tokens, scoped access, receipts, and revocation.</p>
        </div>
      </header>

      {feedback && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${feedback.tone === 'warning'
          ? 'border-warm-border bg-warm-soft text-warm'
          : 'border-nurture-border bg-nurture-soft text-nurture'}`} role="status">
          <p className="font-medium">{feedback.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed opacity-90">{feedback.message}</p>
          {feedback.supportReference ? (
            <p className="mt-1 text-[11px] font-medium opacity-80">Support reference: {feedback.supportReference}</p>
          ) : null}
        </div>
      )}

      <section className="mb-8" aria-labelledby="quick-connections">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Simple setup</p>
            <h2 id="quick-connections" className="mt-1 font-display text-3xl text-ink">Connect your everyday tools.</h2>
            <p className="mt-1 text-sm text-muted">Choose a service once. You will sign in on its official page, then return here automatically.</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="group rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 shadow-sm transition duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink"><Mail className="size-5" aria-hidden /></span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${googleWorkspaceAuthorized
                ? 'border-nurture-border bg-nurture-soft text-nurture'
                : 'border-warm-border bg-warm-soft text-warm'}`}>
                {googleWorkspaceAuthorized ? 'Connected' : googleConnection ? 'Finish setup' : 'Ready to connect'}
              </span>
            </div>
            <h3 className="mt-5 font-display text-2xl text-ink">Google Workspace</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">Use Gmail inside Omnix, keep contact email activity together, and place follow-ups on your Google Calendar.</p>
            {workspaceScope.role === 'owner' && googleDefinition?.enabled ? (
              <a href={googleWorkspaceConnectHref(googleConnection?.id)} className={`${googleWorkspaceAuthorized ? 'sk-button-secondary' : 'sk-button-primary'} mt-5 inline-flex items-center gap-2`}>
                {googleWorkspaceAuthorized ? 'Reconnect Google' : googleConnection ? 'Finish Google connection' : 'Connect Google'}
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </a>
            ) : (
              <p className="mt-5 text-xs text-muted">{workspaceScope.role !== 'owner' ? 'The workspace owner manages this connection.' : 'Developer setup is still required.'}</p>
            )}
          </article>

          <article className="group rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 shadow-sm transition duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink"><Send className="size-5" aria-hidden /></span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${mailchimpConnection && !mailchimpNeedsReauthorization
                ? 'border-nurture-border bg-nurture-soft text-nurture'
                : 'border-warm-border bg-warm-soft text-warm'}`}>
                {mailchimpConnection && !mailchimpNeedsReauthorization ? 'Connected' : mailchimpConnection ? 'Reconnect needed' : 'Ready to connect'}
              </span>
            </div>
            <h3 className="mt-5 font-display text-2xl text-ink">Mailchimp</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">Keep the newsletter audience, lead temperature tags, and unsubscribe status synchronized without copying contacts by hand.</p>
            {workspaceScope.role === 'owner' && mailchimpDefinition?.enabled ? (
              <a href={mailchimpConnectHref(mailchimpConnection?.id)} className={`${mailchimpConnection && !mailchimpNeedsReauthorization ? 'sk-button-secondary' : 'sk-button-primary'} mt-5 inline-flex items-center gap-2`}>
                {mailchimpConnection ? 'Reconnect Mailchimp' : 'Connect Mailchimp'}
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </a>
            ) : (
              <p className="mt-5 text-xs text-muted">{workspaceScope.role !== 'owner' ? 'The workspace owner manages this connection.' : 'Developer setup is still required.'}</p>
            )}
          </article>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-subtle"><ShieldCheck className="size-4 text-nurture" aria-hidden />Omnix never sees or stores your Google or Mailchimp password.</p>
      </section>

      <details className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6">
        <summary className="cursor-pointer list-none text-sm font-medium text-ink">
          <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-nurture" aria-hidden />Connection health and technical details</span>
        </summary>
        <div className="mt-5" aria-labelledby="connector-control-plane">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Secure connector control plane</p>
            <h2 id="connector-control-plane" className="mt-1 font-display text-2xl text-ink">
              The safety foundation is installed.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              OAuth transactions, encrypted secret envelopes, owner approvals, durable jobs,
              leases, reconciliation, signed-webhook replay protection and redacted receipts now
              share one workspace-scoped authority.
            </p>
          </div>
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${isLive
            ? 'border-nurture-border bg-nurture-soft text-nurture'
            : 'border-warm-border bg-warm-soft text-warm'}`}>
            {isLive ? 'Live workspace authority' : 'Sample · non-durable'}
          </span>
        </div>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-4">
          {[
            ['Provider definitions', definitions.length],
            ['Enabled real providers', enabledRealProviders.length],
            ['Real connections', realConnections.length],
            ['Receipts recorded', receipts.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-surface-2 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</dt>
              <dd className="mt-1 font-display text-2xl text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <h3 className="text-sm font-medium text-ink">Current execution evidence</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {jobs.length
                ? `${jobs.length} persisted job${jobs.length === 1 ? '' : 's'} visible. Latest state: ${jobs[0]?.state}.`
                : 'No provider job has been queued in this workspace.'}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <h3 className="text-sm font-medium text-ink">Activation boundary</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Real Connect buttons stay unavailable until that provider has credentials,
              required review or registration, webhook proof and real-account UAT.
            </p>
          </div>
        </div>
        </div>
      </details>

      {isLive && workspaceScope.role === 'owner' && mailchimpDefinition?.enabled && !mailchimpConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="mailchimp-connect">
          <p className="eyebrow">Mailchimp</p>
          <h2 id="mailchimp-connect" className="mt-1 font-display text-2xl text-ink">Connect your audience securely.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Omnix sends you to Mailchimp to authorize the registered app. Your Mailchimp password never enters Omnix.
            The connection remains in {mailchimpDefinition.mode === 'uat' ? ' UAT' : ' production'} mode until the selected-audience checks pass.
          </p>
          <a href={mailchimpConnectHref()} className="sk-button-primary mt-4 inline-flex">Connect Mailchimp</a>
        </section>
      )}

      {isLive && mailchimpDefinition?.enabled && mailchimpConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="mailchimp-connected">
          <p className="eyebrow">Mailchimp connection</p>
          <h2 id="mailchimp-connected" className="mt-1 font-display text-2xl text-ink">
            {mailchimpConnection.remoteAccountLabel ?? 'Connected Mailchimp account'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {mailchimpConnectionStatusLabel(mailchimpConnection.status)}. {selectedMailchimpAudience
              ? `Newsletter audience: ${selectedMailchimpAudience.audienceName}.`
              : 'Choose the newsletter audience you want to keep synchronized.'}
          </p>
          {selectedMailchimpAudience && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium">
              <span className={`rounded-full border px-2.5 py-1 ${selectedMailchimpAudience.baselineRequired
                ? 'border-warm-border bg-warm-soft text-warm'
                : 'border-nurture-border bg-nurture-soft text-nurture'}`}>
                Initial contact sync: {selectedMailchimpAudience.baselineRequired ? 'not started' : 'complete'}
              </span>
              <span className={`rounded-full border px-2.5 py-1 ${selectedMailchimpAudience.webhookRegistrationRequired
                ? 'border-warm-border bg-warm-soft text-warm'
                : 'border-nurture-border bg-nurture-soft text-nurture'}`}>
                Subscribe and unsubscribe updates: {selectedMailchimpAudience.webhookRegistrationRequired ? 'not active' : 'active'}
              </span>
            </div>
          )}
          {mailchimpReconciliation && (
            <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
              <p className="text-xs font-medium text-ink">
                Latest {mailchimpReconciliation.mode === 'baseline' ? 'baseline' : 'reconciliation'} · {mailchimpReconciliation.state.replace('_', ' ')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {mailchimpReconciliation.itemsSeen} member{mailchimpReconciliation.itemsSeen === 1 ? '' : 's'} checked · {mailchimpReconciliation.itemsReviewed} review item{mailchimpReconciliation.itemsReviewed === 1 ? '' : 's'} · {mailchimpReconciliation.pagesApplied} page{mailchimpReconciliation.pagesApplied === 1 ? '' : 's'} checkpointed.
              </p>
              {mailchimpReconciliation.state === 'review' && mailchimpReconciliation.itemsReviewed > 0 ? (
                <Link
                  href="/contacts/incomplete?q=mailchimp-live&status=pending"
                  className="sk-button-secondary mt-3 inline-flex"
                >
                  Review Mailchimp contacts
                </Link>
              ) : null}
            </div>
          )}
          {workspaceScope.role !== 'owner' ? (
            <p className="mt-4 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
              Read-only health is visible to workspace assistants. Audience selection, webhook setup,
              reconciliation requests and disconnect remain owner-only.
            </p>
          ) : (
            <MailchimpAudienceSelector
              connectionId={mailchimpConnection.id}
              audiences={mailchimpAudiences}
              binding={selectedMailchimpAudience}
              backfillRuns={mailchimpOutboundBackfills}
              loadIssue={mailchimpAudienceLoadIssue}
            />
          )}
        </section>
      )}

      {isLive && workspaceScope.role === 'owner' && googleDefinition?.enabled && !googleConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="google-connect">
          <p className="eyebrow">Google workspace · {googleDefinition.mode === 'uat' ? 'UAT' : 'live'}</p>
          <h2 id="google-connect" className="mt-1 font-display text-2xl text-ink">Connect Gmail and Calendar together.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            One guided authorization connects email sending, minimized Gmail activity, and the Omnix follow-up calendar. Google shows the exact permissions before anything is saved.
          </p>
          <a href={googleWorkspaceConnectHref()} className="sk-button-primary mt-4 inline-flex">Connect Google</a>
          <p className="mt-3 text-[11px] leading-relaxed text-subtle">
            Gmail metadata does not authorize message bodies or attachments. Calendar access is limited to the secondary calendar Omnix creates.
          </p>
        </section>
      )}

      {isLive && googleDefinition?.enabled && googleConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="google-connected">
          <p className="eyebrow">Google workspace · {googleDefinition.mode === 'uat' ? 'UAT' : 'live'}</p>
          <h2 id="google-connected" className="mt-1 font-display text-2xl text-ink">
            {googleConnection.remoteAccountLabel ?? 'Connected Google account'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {googlePresentation?.description}
          </p>
          {googleCapabilityState ? (
            <div className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
              <div className="bg-surface-2 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Token authority</p>
                <p className="mt-1 text-xs text-ink">{googleCapabilityState.tokenState.refreshPresent ? 'Refresh available' : 'Reauthorization required'}</p>
              </div>
              {googleCapabilityState.sync.map((sync) => (
                <div key={sync.stream} className="bg-surface-2 px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">{sync.stream.replace('-', ' ')}</p>
                  <p className="mt-1 text-xs text-ink">{sync.state.replaceAll('_', ' ')} · generation {sync.cursorGeneration}</p>
                  {sync.lastSuccessAt ? <p className="mt-1 text-[11px] text-muted">Last success {new Date(sync.lastSuccessAt).toLocaleString()}</p> : null}
                </div>
              ))}
            </div>
          ) : googleConsentPending ? (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs leading-relaxed text-warm">
              Authorization has started, but no Google permission has been saved yet. Click Finish Google connection and complete the Google consent window.
            </p>
          ) : (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs text-warm">
              Capability health is unavailable. No Google action will be presented as successful without a receipt.
            </p>
          )}
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([
              ['Gmail send', 'https://www.googleapis.com/auth/gmail.send'],
              ['Gmail activity', 'https://www.googleapis.com/auth/gmail.metadata'],
              ['Omnix Calendar', 'https://www.googleapis.com/auth/calendar.app.created'],
            ] as const).map(([label, scope]) => {
              const granted = googleConnection.grantedScopes.includes(scope);
              return (
                <div key={scope} className="rounded-xl border border-line bg-surface-2 px-3 py-3">
                  <p className="text-xs font-medium text-ink">{label}</p>
                  <p className={`mt-1 text-[11px] ${granted ? 'text-nurture' : 'text-warm'}`}>{granted ? 'Authorized' : 'Permission required'}</p>
                </div>
              );
            })}
          </div>
          {workspaceScope.role === 'owner' && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <a href={googleWorkspaceConnectHref(googleConnection.id)} className={googleWorkspaceAuthorized ? 'sk-button-secondary' : 'sk-button-primary'}>
                {googleWorkspaceAuthorized ? 'Reconnect Google' : 'Finish Google connection'}
              </a>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {googleConnection.grantedScopes.includes('https://www.googleapis.com/auth/gmail.metadata') ? (
              <form action={prepareGoogleGmailSyncAction}>
                <input type="hidden" name="connectionId" value={googleConnection.id} />
                <button type="submit" className="sk-button-secondary">Prepare Gmail metadata sync</button>
              </form>
            ) : null}
            {googleConnection.grantedScopes.includes('https://www.googleapis.com/auth/calendar.app.created') && !googleCapabilityState?.calendar.created ? (
              <form action={prepareGoogleCalendarCreationAction}>
                <input type="hidden" name="connectionId" value={googleConnection.id} />
                <button type="submit" className="sk-button-secondary">Prepare Omnix Calendar</button>
              </form>
            ) : null}
            {googleCapabilityState?.calendar.created ? (
              <form action={prepareGoogleCalendarSyncAction}>
                <input type="hidden" name="connectionId" value={googleConnection.id} />
                <button type="submit" className="sk-button-secondary">Prepare Calendar sync</button>
              </form>
            ) : null}
          </div>
        </section>
      )}

      {isLive && workspaceScope.role === 'owner' && twilioDefinition?.enabled && !twilioConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="twilio-connect">
          <p className="eyebrow">Texting · controlled UAT</p>
          <h2 id="twilio-connect" className="mt-1 font-display text-2xl text-ink">Verify the business Messaging Service.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Omnix verifies restricted server credentials, the Messaging Service, carrier-registration evidence,
            consent policy and two signed callback routes. It never asks for a Twilio consumer password.
          </p>
          <form action={configureTwilioAction} className="mt-4">
            <button type="submit" className="sk-button-primary">Verify Twilio configuration</button>
          </form>
          <p className="mt-3 text-[11px] leading-relaxed text-subtle">
            Successful configuration still does not enable ordinary sends. A consented, owner-approved real-number UAT must reach a final delivery receipt first.
          </p>
        </section>
      )}

      {isLive && workspaceScope.role === 'owner' && metaDefinition?.enabled && !metaConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="meta-connect">
          <p className="eyebrow">Instagram &amp; Facebook · inbound only</p>
          <h2 id="meta-connect" className="mt-1 font-display text-2xl text-ink">Choose the business login that owns the enquiries.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Authorization happens on Meta. Omnix stores scoped encrypted tokens and only accepts messages from explicitly selected business assets.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="sk-button-primary" href="/api/connectors/meta/connect?loginMode=facebook-page">Connect a Facebook Page</a>
            <a className="sk-button-secondary" href="/api/connectors/meta/connect?loginMode=instagram-login">Connect Instagram Professional</a>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-subtle">
            Buttons remain fail-closed unless the Graph version was verified from Meta’s official changelog and the exact App Review evidence is configured. No personal account, Lead Ads or outbound DMs.
          </p>
        </section>
      )}

      {isLive && twilioDefinition?.enabled && twilioConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="twilio-connected">
          <p className="eyebrow">Texting · {twilioDefinition.mode === 'live' ? 'live configuration' : 'UAT'}</p>
          <h2 id="twilio-connected" className="mt-1 font-display text-2xl text-ink">Governed provider texting</h2>
          {twilioReadinessState ? (
            <div className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
              <div className="bg-surface-2 px-3 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Readiness</p><p className="mt-1 text-xs text-ink">{twilioReadinessState.readiness.replaceAll('_', ' ')}</p></div>
              <div className="bg-surface-2 px-3 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Carrier registration</p><p className="mt-1 text-xs text-ink">{twilioReadinessState.registration.replaceAll('_', ' ')}</p></div>
              <div className="bg-surface-2 px-3 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Quiet hours</p><p className="mt-1 text-xs text-ink">{twilioReadinessState.quietHoursStart && twilioReadinessState.quietHoursEnd ? `${twilioReadinessState.quietHoursStart}–${twilioReadinessState.quietHoursEnd} recipient local time` : 'Policy required'}</p></div>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs text-warm">Texting authority is unavailable. Omnix will not send through Twilio.</p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted">Device Messages remains a separate fallback. Provider sends require an exact canonical phone, current opt-in, owner approval and a receipt.</p>
          {workspaceScope.role === 'owner' ? (
            <form action={disableTextingAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="connectionId" value={twilioConnection.id} />
              <input type="hidden" name="destroySendCredentials" value="true" />
              <button type="submit" className="sk-button-secondary">Disable provider texting safely</button>
            </form>
          ) : null}
        </section>
      )}

      {isLive && metaDefinition?.enabled && metaConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="meta-connected">
          <p className="eyebrow">Instagram &amp; Facebook · inbound only</p>
          <h2 id="meta-connected" className="mt-1 font-display text-2xl text-ink">Verified business-message intake</h2>
          {metaConnectionState ? (
            <>
              <dl className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-4">
                <div className="bg-surface-2 px-3 py-3"><dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">Readiness</dt><dd className="mt-1 text-xs text-ink">{metaConnectionState.readiness.replaceAll('_', ' ')}</dd></div>
                <div className="bg-surface-2 px-3 py-3"><dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">Login authority</dt><dd className="mt-1 text-xs text-ink">{metaConnectionState.loginMode.replaceAll('-', ' ')}</dd></div>
                <div className="bg-surface-2 px-3 py-3"><dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">Graph version</dt><dd className="mt-1 font-mono text-xs text-ink">{metaConnectionState.graphVersion}</dd></div>
                <div className="bg-surface-2 px-3 py-3"><dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">Retention</dt><dd className="mt-1 text-xs text-ink">{metaConnectionState.retentionDays} days</dd></div>
              </dl>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-line bg-surface-2 p-4">
                  <p className="text-sm font-medium text-ink">Selected assets</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {metaConnectionState.selectedAssets.length
                      ? metaConnectionState.selectedAssets.map((asset) => `${asset.label} · ${asset.channel}${asset.subscriptionStatus ? ` · ${asset.subscriptionStatus}` : ''}`).join(' · ')
                      : 'No eligible business asset has been selected.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-line bg-surface-2 p-4">
                  <p className="text-sm font-medium text-ink">Review queue</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {metaConnectionState.reviewBacklog} enquiries need human identity review · {metaConnectionState.normalizationBacklog} awaiting normalization.
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                Personal accounts, outbound replies, Lead Ads and guessed contact matches are excluded. New senders without an exact canonical identity remain quarantined for review.
              </p>
              {workspaceScope.role === 'owner' ? (
                <div className="mt-4 border-t border-line pt-4">
                  <form action={discoverMetaAssetsAction}>
                    <input type="hidden" name="connectionId" value={metaConnection.id} />
                    <button type="submit" className="sk-button-secondary">
                      {metaConnectionState.selectedAssets.length ? 'Refresh eligible assets' : 'Discover eligible business assets'}
                    </button>
                  </form>
                  {metaConnectionState.snapshotHash && metaConnectionState.assets.some((asset) => ['eligible', 'selected'].includes(asset.state)) ? (
                    <form action={selectMetaAssetsAction} className="mt-4 grid gap-3 rounded-2xl border border-line bg-surface-2 p-4">
                      <input type="hidden" name="connectionId" value={metaConnection.id} />
                      <input type="hidden" name="snapshotHash" value={metaConnectionState.snapshotHash} />
                      <fieldset className="grid gap-2">
                        <legend className="text-sm font-medium text-ink">Assets Omnix may receive from</legend>
                        {metaConnectionState.assets.filter((asset) => ['eligible', 'selected'].includes(asset.state)).map((asset) => (
                          <label key={asset.assetIdHash} className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                            <input type="checkbox" name="assetHash" value={asset.assetIdHash} defaultChecked={asset.state === 'selected'} />
                            <span>{asset.label} · {asset.channel}</span>
                          </label>
                        ))}
                      </fieldset>
                      <p className="text-xs leading-relaxed text-muted">Only selected assets are subscribed to the messages webhook. Page and account identifiers remain encrypted or hashed.</p>
                      <button type="submit" className="sk-button-primary">Select or retry subscriptions</button>
                    </form>
                  ) : null}
                </div>
              ) : null}
              {metaReviewItems.length ? (
                <div className="mt-5 border-t border-line pt-5">
                  <h3 className="font-display text-xl text-ink">Social enquiries awaiting identity review</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">Omnix will not guess a person from a name or handle. Inspect the minimized enquiry evidence, then link an existing contact or finish the quarantined record as a new contact.</p>
                  <div className="mt-3 grid gap-3">
                    {metaReviewItems.map((item) => (
                      <form key={item.eventId} action={resolveMetaReviewAction} className="grid gap-3 rounded-2xl border border-line bg-surface-2 p-4 sm:grid-cols-[1fr_minmax(14rem,22rem)_auto] sm:items-end">
                        <div>
                          <p className="text-sm font-medium text-ink">{item.assetLabel} · {item.channel}</p>
                          <p className="mt-1 text-xs text-muted">{item.reason.replaceAll('_', ' ')} · {new Date(item.providerOccurredAt).toLocaleString()}</p>
                          {item.textPreview ? <blockquote className="mt-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink">{item.textPreview}</blockquote> : null}
                          <p className="mt-2 text-xs text-muted">{item.attachmentTypes.length ? `Attachments: ${item.attachmentTypes.join(', ')}` : 'No attachment'}{item.sourceReference ? ` · source ${item.sourceReference}` : ''}</p>
                          <a href={`/contacts/incomplete?q=${encodeURIComponent(item.incompleteRecordId)}&status=all&metaEventId=${encodeURIComponent(item.eventId)}`} className="sk-text-action mt-2 inline-flex">Review or create contact safely</a>
                        </div>
                        <input type="hidden" name="eventId" value={item.eventId} />
                        <label className="sk-field"><span className="sk-label">Verified contact</span><select name="contactId" className="sk-input" required defaultValue=""><option value="" disabled>Select an existing contact</option>{metaReviewContacts.map((contact) => <option key={contact.id} value={contact.id}>{displayName(contact)}</option>)}</select></label>
                        <button type="submit" className="sk-button-secondary">Link enquiry</button>
                      </form>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs text-warm">
              Meta provider authority is unavailable. Omnix will not accept business-message webhooks.
            </p>
          )}
        </section>
      )}

      {isLive && workspaceScope.role === 'owner' && (realConnections.length > 0 || intents.length > 0 || jobs.length > 0) && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="connector-operations">
          <h2 id="connector-operations" className="font-display text-2xl text-ink">Owner operations</h2>
          <p className="mt-1 text-sm text-muted">Every change below uses the same versioned commands and receipts proven by the CLI.</p>

          {realConnections.length > 0 && (
            <div className="mt-5 space-y-2">
              <h3 className="text-sm font-medium text-ink">Connections</h3>
              {realConnections.map((connection) => (
                <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                  <div><p className="text-sm font-medium text-ink">{connection.remoteAccountLabel ?? connection.provider}</p><p className="text-xs text-muted">{connection.provider} · {connection.status}</p></div>
                  {['active', 'degraded', 'reauthorization-required'].includes(connection.status) && (
                    <form action={disconnectConnectionAction}>
                      <input type="hidden" name="connectionId" value={connection.id} />
                      <button className="sk-button-secondary" type="submit">Disconnect safely</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}

          {intents.filter((intent) => intent.status === 'pending').map((intent) => (
            <details key={intent.id} className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">Review {intent.summary}</summary>
              <p className="mt-2 text-xs text-muted">{intent.provider} · {intent.actionType} · version {intent.version}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={intent.provider === 'twilio' && intent.actionType === 'message.send'
                  ? approveTextingIntentAction : approveConnectorIntentAction}>
                  <input type="hidden" name="intentId" value={intent.id} /><input type="hidden" name="expectedVersion" value={intent.version} />
                  {intent.provider === 'twilio' ? <input type="hidden" name="payloadHash" value={intent.payloadHash} /> : null}
                  <button type="submit" className="sk-button-primary">Approve and queue</button>
                </form>
                <form action={rejectConnectorIntentAction}>
                  <input type="hidden" name="intentId" value={intent.id} /><input type="hidden" name="expectedVersion" value={intent.version} />
                  <button type="submit" className="sk-button-secondary">Reject</button>
                </form>
              </div>
              {intent.provider === 'twilio' && intent.actionType === 'message.send' ? (
                <p className="mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted">
                  Message content is encrypted and version-bound. Edit it from the contact record to create a new approval version.
                </p>
              ) : <form action={editConnectorIntentAction} className="mt-4 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="intentId" value={intent.id} /><input type="hidden" name="expectedVersion" value={intent.version} />
                <input className="sk-input" name="summary" defaultValue={intent.summary} aria-label="Revised summary" required />
                <input className="sk-input" name="payloadReference" defaultValue={intent.payloadReference} aria-label="Encrypted payload reference" required />
                <input className="sk-input" name="payloadHash" defaultValue={intent.payloadHash} aria-label="Payload SHA-256" required />
                <input className="sk-input" name="policyId" placeholder="Policy ID" aria-label="Policy ID" required />
                <input className="sk-input" name="policyVersion" defaultValue="1" inputMode="numeric" aria-label="Policy version" required />
                <button type="submit" className="sk-button-secondary">Save as new version</button>
              </form>}
            </details>
          ))}

          {jobs.filter((job) => ['failed', 'dead-letter', 'reconciliation-required', 'queued', 'retry-scheduled'].includes(job.state)).map((job) => (
            <div key={job.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{job.actionType}</p>
                <p className="text-xs text-muted">{job.state} · attempt {job.attemptCount}/{job.maxAttempts}</p>
                <p className="mt-1 text-[11px] text-subtle" title={`Full support reference: ${job.correlationId}`}>
                  Support ref {supportReference(job.correlationId)} · {job.nextRetryAt
                    ? `next retry ${new Date(job.nextRetryAt).toLocaleString()}`
                    : `scheduled ${new Date(job.scheduledAt).toLocaleString()}`}
                </p>
              </div>
              <div className="flex gap-2">
                {['failed', 'dead-letter', 'reconciliation-required'].includes(job.state) && <form action={retryConnectorJobAction}><input type="hidden" name="jobId" value={job.id} /><button type="submit" className="sk-button-secondary">Retry</button></form>}
                {['queued', 'retry-scheduled', 'reconciliation-required'].includes(job.state) && <form action={cancelConnectorJobAction}><input type="hidden" name="jobId" value={job.id} /><button type="submit" className="sk-button-secondary">Cancel</button></form>}
              </div>
            </div>
          ))}

          {receipts.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium text-ink">Redacted execution receipts</h3>
              <div className="mt-2 overflow-x-auto rounded-2xl border border-line">
                <table className="min-w-full divide-y divide-line text-left text-xs">
                  <thead className="bg-surface-3 text-subtle">
                    <tr><th className="px-3 py-2 font-medium">Event</th><th className="px-3 py-2 font-medium">Provider status</th><th className="px-3 py-2 font-medium">Error category</th><th className="px-3 py-2 font-medium">Support ref</th><th className="px-3 py-2 font-medium">Time</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-surface-2 text-muted">
                    {receipts.slice(0, 20).map((receipt) => (
                      <tr key={receipt.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-ink">{receipt.type}</td>
                        <td className="whitespace-nowrap px-3 py-2">{receipt.providerStatus ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{receipt.errorCategory}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium" title={`Full support reference: ${receipt.correlationId}`}>{supportReference(receipt.correlationId)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{new Date(receipt.occurredAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="sk-group grid gap-px lg:grid-cols-2">
        {integrations.map((item) => {
          const status = STATUS_META[item.status];
          const StatusIcon = status.icon;
          return (
            <article
              key={item.name}
              className="flex flex-col bg-surface p-5 sm:p-6"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-muted">
                  <item.icon className="size-[18px]" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl text-ink">{item.name}</h2>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                    >
                      <StatusIcon className="size-3" />
                      {item.statusLabel ?? status.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-snug text-ink/80">{item.what}</p>
                </div>
              </div>

              <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
                {item.detail}
              </p>
              <p className="mt-2 text-[11px] font-medium text-subtle">{item.access}</p>
              {item.href && <Link href={item.href} className="sk-text-action mt-2 self-start">Open importer</Link>}
            </article>
          );
        })}
      </div>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="connector-definitions">
        <h2 id="connector-definitions" className="font-display text-2xl text-ink">Deployment truth</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {definitions.filter((definition) => definition.provider !== 'contract-test').map((definition) => (
            <article key={definition.provider} className="rounded-2xl border border-line bg-surface px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-ink">{definition.label}</h3>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${definition.enabled
                  ? 'border-nurture-border bg-nurture-soft text-nurture'
                  : 'border-line-strong bg-surface-3 text-muted'}`}>
                  {definition.enabled ? 'Enabled' : 'External setup required'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {definition.capabilities.join(' · ')}
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-subtle">
                Next gate: {definition.productionRequirements[0] ?? 'Provider-specific acceptance'}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
