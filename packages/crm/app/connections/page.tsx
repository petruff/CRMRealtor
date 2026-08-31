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
import { readConnectorLifecycleSnapshot } from '@/lib/application/connector-lifecycle-orchestrator';
import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';
import { supabaseTwilioOperationRepository, type TwilioReadinessState } from '@/lib/data/twilio-operation-repository';
import {
  prepareGoogleCalendarCreationAction,
  prepareGoogleCalendarSyncAction,
  prepareGoogleGmailSyncAction,
  checkGoogleConnectionAction,
} from './google-actions';
import { supabaseMetaOperationRepository, type MetaConnectionState, type MetaReviewItem } from '@/lib/data/meta-operation-repository';
import { readMetaEnquiryReviewContext } from '@/lib/application/meta-review-service';
import { displayName, type Contact } from '@/lib/domain/contact';
import { createClient } from '@supabase/supabase-js';
import {
  canShowConnectorOwnerControls,
  canRecoverMailchimpLifecycle,
  canDisconnectLifecycle,
  canShowGoogleOperations,
  canShowMailchimpManagement,
  connectionCardStatus,
  connectionViewerMessage,
  SETUP_UNAVAILABLE_LABEL,
  otherConnectionCardStatus,
  type ConnectionCardStatus,
} from './connection-status';
import { connectionNotice, googleInsightsConnectHref, googleWorkspaceConnectHref, mailchimpConnectHref } from './oauth-presentation';
import {
  mailchimpConnectionNeedsAttention,
  mailchimpConnectionRequiresReauthorization,
  mailchimpConnectionSummaryLabel,
  recordMailchimpReadFailure,
  type MailchimpAudienceLoadIssue,
} from './mailchimp-presentation';
import { probeMailchimpConnectionAction } from './mailchimp-actions';
import {
  googleConnectionPresentation,
  googleSyncStateLabel,
  googleSyncStreamLabel,
} from './google-presentation';
import { ConnectorActivityLedger } from '@/components/connector-activity-ledger';

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google Workspace',
  mailchimp: 'Mailchimp',
  twilio: 'Texting',
  meta: 'Instagram & Facebook',
};

function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? 'Connected service';
}

function connectionStatus(status: string): string {
  if (status === 'active') return 'Connected';
  if (status === 'degraded') return 'Needs attention';
  if (status === 'reauthorization-required') return 'Reconnect required';
  return status.replaceAll('-', ' ');
}

function actionName(actionType: string): string {
  const labels: Record<string, string> = {
    'message.send': 'Send a text message',
    'audience.sync': 'Update newsletter contacts',
    'gmail.sync-metadata': 'Update contact email activity',
    'calendar.create-omnix-calendar': 'Create the Omnix calendar',
    'calendar.upsert-omnix-event': 'Update a calendar follow-up',
    'dm.ingest': 'Add a social media enquiry',
  };
  return labels[actionType] ?? 'Update a connected service';
}

function reviewReason(reason: string): string {
  const labels: Record<string, string> = {
    'identity-ambiguous': 'More than one contact may match',
    'identity-missing': 'No matching contact was found',
    'missing-contact-point': 'Contact information is incomplete',
  };
  return labels[reason] ?? 'A person needs to confirm this match';
}

function jobStatus(state: string, nextRetryAt: string | null | undefined, scheduledAt: string): string {
  if (state === 'queued') return `Waiting to run · ${new Date(scheduledAt).toLocaleString('en-US')}`;
  if (state === 'retry-scheduled') return `Will retry automatically · ${new Date(nextRetryAt ?? scheduledAt).toLocaleString('en-US')}`;
  if (state === 'reconciliation-required') return 'Please review before continuing';
  return 'Automatic action paused';
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
    label: 'Final setup required',
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
    detail: 'Connect Google once, then choose whether Omnix may send email and record contact email activity.',
    access: 'Authorized through Google',
  },
  {
    name: 'Google Calendar',
    icon: Calendar,
    what: 'Your follow-ups appear in the calendar you already look at.',
    status: 'uat',
    detail: 'Omnix uses a separate calendar for follow-ups, so your personal calendar stays organized.',
    access: 'Authorized through Google',
  },
  {
    name: 'Mailchimp',
    icon: Send,
    what: 'Keep one newsletter audience, lead tags, and subscription choices synchronized.',
    status: 'uat',
    detail: 'Choose the audience once. Omnix will keep contact changes and unsubscribes aligned in both places.',
    access: 'Authorized through Mailchimp',
  },
  {
    name: 'Texting',
    icon: MessageSquare,
    what: 'Text contacts from the CRM, with the conversation saved to their record.',
    status: 'gated',
    detail: 'Business texting becomes available after carrier registration and a final delivery test.',
    access: 'Business texting account required',
  },
  {
    name: 'Instagram & Facebook',
    icon: Instagram,
    what: 'Turn DM enquiries into contacts without retyping them.',
    status: 'gated',
    detail: 'Connect a verified business account to review new enquiries before they become contacts.',
    access: 'Meta business approval required',
  },
  {
    name: 'Website forms',
    icon: Globe,
    what: 'Authenticated website submissions can land here as new contacts, ready to screen.',
    status: 'ready',
    detail: 'When the website is ready, its contact form can add new leads automatically.',
    access: 'Developer setup required',
  },
];

function liveIntegrationStatus(
  integration: Integration,
  input: {
    readonly mailchimpLifecycle: ConnectorLifecycleProjection;
    readonly googleLifecycle: ConnectorLifecycleProjection;
    readonly twilioEnabled: boolean;
    readonly twilioConnected: boolean;
    readonly twilioLive: boolean;
    readonly twilioReady: boolean;
    readonly metaEnabled: boolean;
    readonly metaConnected: boolean;
    readonly metaLive: boolean;
  },
): Integration {
  if (integration.name === 'Mailchimp') {
    const presentation = connectionCardStatus(input.mailchimpLifecycle);
    return {
      ...integration,
      status: presentation.status,
      statusLabel: presentation.label,
      what: input.mailchimpLifecycle.connectionId
        ? 'Keep the selected audience, lead-temperature tags, and subscription choices synchronized.'
        : 'Connect one Mailchimp account, then choose the audience you want Omnix to keep updated.',
      detail: input.mailchimpLifecycle.safeSummary,
    };
  }
  if (integration.name === 'Gmail' || integration.name === 'Google Calendar') {
    const presentation = connectionCardStatus(input.googleLifecycle);
    return {
      ...integration,
      status: presentation.status,
      statusLabel: presentation.label,
      detail: input.googleLifecycle.safeSummary,
    };
  }
  if (integration.name === 'Texting') {
    if (!input.twilioEnabled) {
      return {
        ...integration,
        status: 'gated',
        statusLabel: SETUP_UNAVAILABLE_LABEL,
        detail: 'This service is not available for this workspace.',
      };
    }
    return {
      ...integration,
      status: input.twilioConnected && input.twilioLive && input.twilioReady ? 'ready' : 'uat',
      detail: input.twilioConnected
        ? `The workspace Messaging Service is bound. ${input.twilioLive
          ? 'Business texting is approved and ready.'
          : 'Texting remains paused until registration, contact preferences, and the final delivery test are complete.'}`
        : 'A business texting account and carrier approval are still required.',
    };
  }
  if (integration.name === 'Instagram & Facebook') {
    const presentation = otherConnectionCardStatus({
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
          ? 'Business messages are connected and ready to become reviewable enquiries.'
          : 'The account is connected for incoming business messages while Meta completes the remaining approval.'}`
        : 'Connect an eligible Facebook Page or Instagram Professional account after Meta business approval.',
      access: 'Incoming business messages only',
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
  const canonicalOwner = canShowConnectorOwnerControls(workspaceScope);
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
  const mailchimpDefinition = definitions.find((definition) => definition.provider === 'mailchimp');
  const mailchimpConnection = realConnections.find((connection) => connection.provider === 'mailchimp');
  const googleDefinition = definitions.find((definition) => definition.provider === 'google');
  const googleConnection = realConnections.find((connection) => connection.provider === 'google');
  const twilioDefinition = definitions.find((definition) => definition.provider === 'twilio');
  const twilioConnection = realConnections.find((connection) => connection.provider === 'twilio');
  const metaDefinition = definitions.find((definition) => definition.provider === 'meta');
  const metaConnection = realConnections.find((connection) => connection.provider === 'meta');
  const lifecycleSnapshot = await readConnectorLifecycleSnapshot({
    connectorRepository,
    workspaceScope,
    isLive,
    definitions,
    connections: realConnections,
    includeMailchimpAudiences: canonicalOwner,
  });
  let mailchimpAudienceLoadIssue: MailchimpAudienceLoadIssue | undefined;
  let twilioReadinessState: TwilioReadinessState | undefined;
  let metaConnectionState: MetaConnectionState | undefined;
  let metaReviewItems: readonly MetaReviewItem[] = [];
  let metaReviewContacts: readonly Contact[] = [];
  const mailchimpLifecycle = lifecycleSnapshot.mailchimp.lifecycle;
  const googleLifecycle = lifecycleSnapshot.google.lifecycle;
  const selectedMailchimpAudience = lifecycleSnapshot.mailchimp.binding;
  const mailchimpReconciliation = lifecycleSnapshot.mailchimp.reconciliation;
  const mailchimpOutboundBackfills = lifecycleSnapshot.mailchimp.backfills;
  const mailchimpAudiences = lifecycleSnapshot.mailchimp.audiences;
  const googleCapabilityState = lifecycleSnapshot.google.capabilityState;
  if (mailchimpConnection) {
    for (const failure of lifecycleSnapshot.mailchimp.failures) {
      if (failure.operation === 'capabilities') continue;
      const issue = recordMailchimpReadFailure({
        operation: failure.operation,
        connectionId: mailchimpConnection.id,
        error: failure.error,
      });
      if (failure.operation === 'binding' || failure.operation === 'audiences') {
        mailchimpAudienceLoadIssue = issue;
      }
    }
  }
  const googlePresentation = googleConnection
    ? googleConnectionPresentation(googleLifecycle)
    : undefined;
  const googleConsentPending = googlePresentation?.consentPending ?? false;
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
  const mailchimpNeedsAttention = mailchimpConnection
    ? mailchimpConnectionNeedsAttention(mailchimpLifecycle)
    : false;
  const mailchimpRequiresReauthorization = mailchimpConnection
    ? mailchimpConnectionRequiresReauthorization(mailchimpLifecycle)
    : false;
  const integrations = INTEGRATIONS.map((integration) => liveIntegrationStatus(integration, {
    mailchimpLifecycle,
    googleLifecycle,
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
  const googleWorkspaceAuthorized = googleLifecycle.state === 'ready';
  const googleCard = connectionCardStatus(googleLifecycle);
  const mailchimpCard = connectionCardStatus(mailchimpLifecycle);
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
          <p><span className="font-medium text-ink">Omnix never asks for your Google or Mailchimp password.</span> You sign in on each service’s official page and choose what Omnix may use.</p>
        </div>
      </header>

      {feedback && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${feedback.tone === 'warning'
          ? 'border-warm-border bg-warm-soft text-warm'
          : 'border-nurture-border bg-nurture-soft text-nurture'}`} role="status">
          <p className="font-medium">{feedback.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed opacity-90">{feedback.message}</p>
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
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${googleLifecycle.state === 'ready'
                ? 'border-nurture-border bg-nurture-soft text-nurture'
                : 'border-warm-border bg-warm-soft text-warm'}`}>
                {googleCard.label}
              </span>
            </div>
            <h3 className="mt-5 font-display text-2xl text-ink">Google Workspace</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">Use Gmail inside Omnix, keep contact email activity together, and place follow-ups on your Google Calendar.</p>
            {googleDefinition?.enabled !== true ? (
              <p className="mt-5 text-xs text-muted">{SETUP_UNAVAILABLE_LABEL}</p>
            ) : canonicalOwner ? (
              <a href={googleWorkspaceConnectHref(googleConnection?.id)} className={`${googleWorkspaceAuthorized ? 'sk-button-secondary' : 'sk-button-primary'} mt-5 inline-flex items-center gap-2`}>
                {googleWorkspaceAuthorized ? 'Reconnect Google' : googleConnection ? 'Finish Google connection' : 'Connect Google'}
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </a>
            ) : (
              <p className="mt-5 text-xs text-muted">{connectionViewerMessage(workspaceScope, 'Google Workspace')}</p>
            )}
          </article>

          <article className="group rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 shadow-sm transition duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink"><Send className="size-5" aria-hidden /></span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${mailchimpLifecycle.state === 'ready'
                ? 'border-nurture-border bg-nurture-soft text-nurture'
                : 'border-warm-border bg-warm-soft text-warm'}`}>
                {mailchimpCard.label}
              </span>
            </div>
            <h3 className="mt-5 font-display text-2xl text-ink">Mailchimp</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">Keep the newsletter audience, lead temperature tags, and unsubscribe status synchronized without copying contacts by hand.</p>
            {mailchimpDefinition?.enabled !== true ? (
              <p className="mt-5 text-xs text-muted">{SETUP_UNAVAILABLE_LABEL}</p>
            ) : canonicalOwner ? (
              <a
                href={mailchimpRequiresReauthorization || !mailchimpConnection
                  ? mailchimpConnectHref(mailchimpConnection?.id)
                  : '#mailchimp-connected'}
                className={`${mailchimpRequiresReauthorization || !mailchimpConnection ? 'sk-button-primary' : 'sk-button-secondary'} mt-5 inline-flex items-center gap-2`}
              >
                {mailchimpRequiresReauthorization
                  ? 'Reconnect Mailchimp'
                  : mailchimpConnection && mailchimpNeedsAttention
                    ? 'Review Mailchimp'
                    : mailchimpConnection
                      ? 'Manage Mailchimp'
                      : 'Connect Mailchimp'}
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </a>
            ) : (
              <p className="mt-5 text-xs text-muted">{connectionViewerMessage(workspaceScope, 'Mailchimp')}</p>
            )}
          </article>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-subtle"><ShieldCheck className="size-4 text-nurture" aria-hidden />Omnix never sees or stores your Google or Mailchimp password.</p>
      </section>

      {isLive && canonicalOwner && mailchimpDefinition?.enabled && !mailchimpConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="mailchimp-connect">
          <p className="eyebrow">Mailchimp</p>
          <h2 id="mailchimp-connect" className="mt-1 font-display text-2xl text-ink">Connect your audience securely.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Omnix sends you to Mailchimp to authorize the registered app. Your Mailchimp password never enters Omnix.
            After you return, choose the newsletter audience you want Omnix to keep updated.
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
            {mailchimpConnectionSummaryLabel(mailchimpLifecycle)} {selectedMailchimpAudience
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
                Latest contact check · {mailchimpReconciliation.state === 'review' ? 'review needed' : 'complete'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {mailchimpReconciliation.itemsSeen} contact{mailchimpReconciliation.itemsSeen === 1 ? '' : 's'} checked · {mailchimpReconciliation.itemsReviewed} need{mailchimpReconciliation.itemsReviewed === 1 ? 's' : ''} review.
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
          {!canonicalOwner ? (
            <p className="mt-4 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
              {connectionViewerMessage(workspaceScope, 'Mailchimp')}
            </p>
          ) : canShowMailchimpManagement(mailchimpLifecycle) ? (
            <MailchimpAudienceSelector
              connectionId={mailchimpConnection.id}
              audiences={mailchimpAudiences}
              binding={selectedMailchimpAudience}
              backfillRuns={mailchimpOutboundBackfills}
              loadIssue={mailchimpAudienceLoadIssue}
            />
          ) : (
            <div className="mt-4 rounded-2xl border border-line bg-surface-2 px-4 py-3">
              <p className="text-xs text-muted">Changes stay paused until Omnix can confirm this connection.</p>
              {canRecoverMailchimpLifecycle(mailchimpLifecycle) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={probeMailchimpConnectionAction}>
                    <input type="hidden" name="connectionId" value={mailchimpConnection.id} />
                    <button className="sk-button-secondary" type="submit">Try connection check again</button>
                  </form>
                  <a className="sk-button-primary" href={mailchimpConnectHref(mailchimpConnection.id)}>
                    Reconnect Mailchimp
                  </a>
                  {canDisconnectLifecycle(mailchimpLifecycle) && (
                    <form action={disconnectConnectionAction}>
                      <input type="hidden" name="connectionId" value={mailchimpConnection.id} />
                      <button className="sk-button-secondary" type="submit">Disconnect account</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {isLive && canonicalOwner && googleDefinition?.enabled && !googleConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="google-connect">
          <p className="eyebrow">Google Workspace</p>
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
          <p className="eyebrow">Google Workspace</p>
          <h2 id="google-connected" className="mt-1 font-display text-2xl text-ink">
            {googleConnection.remoteAccountLabel ?? 'Connected Google account'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {googlePresentation?.description}
          </p>
          {googleCapabilityState ? (
            <div className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
              <div className="bg-surface-2 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Account access</p>
                <p className="mt-1 text-xs text-ink">{googleCapabilityState.tokenState.refreshPresent ? 'Connected' : 'Reconnect required'}</p>
              </div>
              {googleCapabilityState.sync.map((sync) => (
                <div key={sync.stream} className="bg-surface-2 px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">{googleSyncStreamLabel(sync.stream)}</p>
                  <p className="mt-1 text-xs text-ink">{googleSyncStateLabel(sync.state)}</p>
                  {sync.lastSuccessAt ? <p className="mt-1 text-[11px] text-muted">Last updated {new Date(sync.lastSuccessAt).toLocaleString()}</p> : null}
                </div>
              ))}
            </div>
          ) : googleConsentPending ? (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs leading-relaxed text-warm">
              Authorization has started, but no Google permission has been saved yet. Click Finish Google connection and complete the Google consent window.
            </p>
          ) : googleWorkspaceAuthorized ? (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs leading-relaxed text-warm">
              Google permissions are connected. The workspace owner still needs to run a connection check so Omnix can verify the account and start Gmail and Calendar health tracking.
            </p>
          ) : (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs text-warm">
              Omnix could not confirm the connection status. Reconnect Google or try again in a few minutes.
            </p>
          )}
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([
              ['Gmail send', 'https://www.googleapis.com/auth/gmail.send'],
              ['Gmail activity', 'https://www.googleapis.com/auth/gmail.metadata'],
              ['Omnix Calendar', 'https://www.googleapis.com/auth/calendar.app.created'],
            ] as const).map(([label, scope]) => {
              const granted = googleLifecycle.grantedScopes.includes(scope);
              return (
                <div key={scope} className="rounded-xl border border-line bg-surface-2 px-3 py-3">
                  <p className="text-xs font-medium text-ink">{label}</p>
                  <p className={`mt-1 text-[11px] ${granted ? 'text-nurture' : 'text-warm'}`}>{granted ? 'Authorized' : 'Permission required'}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
            <div>
              <p className="text-sm font-medium text-ink">AI reply insights</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                Optional: Omnix can summarize intent, urgency, and sentiment for incoming replies linked to a contact.
                The message is minimized, treated as untrusted data, and not stored. Google classifies this as restricted access.
              </p>
              <p className={`mt-2 text-[11px] ${googleLifecycle.grantedScopes.includes('https://www.googleapis.com/auth/gmail.readonly') ? 'text-nurture' : 'text-subtle'}`}>
                {googleLifecycle.grantedScopes.includes('https://www.googleapis.com/auth/gmail.readonly')
                  ? 'Authorized by the workspace owner'
                  : 'Off until the workspace owner explicitly authorizes it'}
              </p>
            </div>
            {canonicalOwner && !googleLifecycle.grantedScopes.includes('https://www.googleapis.com/auth/gmail.readonly') ? (
              <a href={googleInsightsConnectHref(googleConnection.id)} className="sk-button-secondary mt-3 shrink-0 sm:mt-0">
                Enable reply insights
              </a>
            ) : null}
          </div>
          {canonicalOwner && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {!googleCapabilityState ? (
                <form action={checkGoogleConnectionAction}>
                  <input type="hidden" name="connectionId" value={googleConnection.id} />
                  <button type="submit" className="sk-button-primary">Check Google connection</button>
                </form>
              ) : null}
              <a href={googleWorkspaceConnectHref(googleConnection.id)} className={googleWorkspaceAuthorized ? 'sk-button-secondary' : 'sk-button-primary'}>
                {googleWorkspaceAuthorized ? 'Reconnect Google' : 'Finish Google connection'}
              </a>
            </div>
          )}
          {!canonicalOwner && (
            <p className="mt-4 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
              {connectionViewerMessage(workspaceScope, 'Google Workspace')}
            </p>
          )}
          {canonicalOwner && canShowGoogleOperations(googleLifecycle) && <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {googleLifecycle.grantedScopes.includes('https://www.googleapis.com/auth/gmail.metadata') ? (
              <form action={prepareGoogleGmailSyncAction}>
                <input type="hidden" name="connectionId" value={googleConnection.id} />
                <button type="submit" className="sk-button-secondary">Update Gmail activity</button>
              </form>
            ) : null}
            {googleLifecycle.grantedScopes.includes('https://www.googleapis.com/auth/calendar.app.created') && !googleCapabilityState?.calendar.created ? (
              <form action={prepareGoogleCalendarCreationAction}>
                <input type="hidden" name="connectionId" value={googleConnection.id} />
                <button type="submit" className="sk-button-secondary">Create Omnix Calendar</button>
              </form>
            ) : null}
            {googleCapabilityState?.calendar.created ? (
              <form action={prepareGoogleCalendarSyncAction}>
                <input type="hidden" name="connectionId" value={googleConnection.id} />
                <button type="submit" className="sk-button-secondary">Update Calendar</button>
              </form>
            ) : null}
          </div>}
        </section>
      )}

      {isLive && canonicalOwner && twilioDefinition?.enabled && !twilioConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="twilio-connect">
          <p className="eyebrow">Texting setup</p>
          <h2 id="twilio-connect" className="mt-1 font-display text-2xl text-ink">Connect the business texting account.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Omnix checks the business number, carrier registration, contact preferences, and quiet hours before texting is enabled.
          </p>
          <form action={configureTwilioAction} className="mt-4">
            <button type="submit" className="sk-button-primary">Verify Twilio configuration</button>
          </form>
          <p className="mt-3 text-[11px] leading-relaxed text-subtle">
            After setup, send one approved delivery test before texting contacts normally.
          </p>
        </section>
      )}

      {isLive && canonicalOwner && metaDefinition?.enabled && !metaConnection && (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="meta-connect">
          <p className="eyebrow">Instagram &amp; Facebook · inbound only</p>
          <h2 id="meta-connect" className="mt-1 font-display text-2xl text-ink">Choose the business login that owns the enquiries.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Sign in on Meta’s official page, then choose the Facebook Page or Instagram Professional account that receives enquiries.
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
          <p className="eyebrow">Texting</p>
          <h2 id="twilio-connected" className="mt-1 font-display text-2xl text-ink">Business texting</h2>
          {twilioReadinessState ? (
            <div className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
              <div className="bg-surface-2 px-3 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Readiness</p><p className="mt-1 text-xs text-ink">{twilioReadinessState.readiness.replaceAll('_', ' ')}</p></div>
              <div className="bg-surface-2 px-3 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Carrier registration</p><p className="mt-1 text-xs text-ink">{twilioReadinessState.registration.replaceAll('_', ' ')}</p></div>
              <div className="bg-surface-2 px-3 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-subtle">Quiet hours</p><p className="mt-1 text-xs text-ink">{twilioReadinessState.quietHoursStart && twilioReadinessState.quietHoursEnd ? `${twilioReadinessState.quietHoursStart}–${twilioReadinessState.quietHoursEnd} recipient local time` : 'Policy required'}</p></div>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-xs text-warm">Omnix could not confirm the texting account. No message will be sent until the connection is restored.</p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted">Every text requires a valid phone number, current permission from the contact, and owner approval.</p>
          {canonicalOwner ? (
            <form action={disableTextingAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="connectionId" value={twilioConnection.id} />
              <input type="hidden" name="destroySendCredentials" value="true" />
              <button type="submit" className="sk-button-secondary">Disconnect texting</button>
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
                <div className="bg-surface-2 px-3 py-3"><dt className="text-[11px] uppercase tracking-[0.12em] text-subtle">Connected through</dt><dd className="mt-1 text-xs text-ink">{metaConnectionState.loginMode === 'facebook-page' ? 'Facebook Page' : 'Instagram Professional'}</dd></div>
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
              Personal accounts, outbound replies, and Lead Ads are excluded. When Omnix cannot match a sender confidently, the enquiry waits here for review.
              </p>
              {canonicalOwner ? (
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
                      <p className="text-xs leading-relaxed text-muted">Only the accounts selected here can send enquiries into Omnix.</p>
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
                          <p className="mt-1 text-xs text-muted">{reviewReason(item.reason)} · {new Date(item.providerOccurredAt).toLocaleString()}</p>
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
              Omnix could not confirm the social account. New enquiries are paused until the connection is restored.
            </p>
          )}
        </section>
      )}

      {isLive && canonicalOwner && (realConnections.length > 0 || intents.length > 0 || jobs.length > 0) && (
        <section id="pending-approvals" className="mb-8 scroll-mt-6 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6" aria-labelledby="connector-operations">
          <h2 id="connector-operations" className="font-display text-2xl text-ink">Connection controls</h2>
          <p className="mt-1 text-sm text-muted">Review connected accounts, approve pending actions, and resolve anything that needs attention.</p>

          {realConnections.length > 0 && (
            <div className="mt-5 space-y-2">
              <h3 className="text-sm font-medium text-ink">Connections</h3>
              {realConnections.map((connection) => (
                <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                  <div><p className="text-sm font-medium text-ink">{connection.remoteAccountLabel ?? providerName(connection.provider)}</p><p className="text-xs text-muted">{providerName(connection.provider)} · {(connection.provider === 'google' ? googleLifecycle : connection.provider === 'mailchimp' ? mailchimpLifecycle : undefined)?.safeSummary ?? connectionStatus(connection.status)}</p></div>
                  {['active', 'degraded', 'reauthorization-required'].includes(connection.status)
                    && (connection.provider === 'google'
                      ? canDisconnectLifecycle(googleLifecycle)
                      : connection.provider === 'mailchimp'
                        ? canDisconnectLifecycle(mailchimpLifecycle)
                        : true) && (
                    <form action={disconnectConnectionAction}>
                      <input type="hidden" name="connectionId" value={connection.id} />
                      <button className="sk-button-secondary" type="submit">Disconnect account</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}

          {intents.filter((intent) => intent.status === 'pending').map((intent) => (
            <details key={intent.id} className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">Review {intent.summary}</summary>
              <p className="mt-2 text-xs text-muted">{providerName(intent.provider)} · {actionName(intent.actionType)}</p>
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
              <p className="mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted">
                Need to change this action? Reject it here, then make the change from the related contact or service.
              </p>
            </details>
          ))}

          {jobs.filter((job) => ['failed', 'dead-letter', 'reconciliation-required', 'queued', 'retry-scheduled'].includes(job.state)).map((job) => (
            <div key={job.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{actionName(job.actionType)}</p>
                <p className="text-xs text-muted">{jobStatus(job.state, job.nextRetryAt, job.scheduledAt)}</p>
              </div>
              <div className="flex gap-2">
                {['failed', 'dead-letter', 'reconciliation-required'].includes(job.state) && <form action={retryConnectorJobAction}><input type="hidden" name="jobId" value={job.id} /><button type="submit" className="sk-button-secondary">Retry</button></form>}
                {['queued', 'retry-scheduled', 'reconciliation-required'].includes(job.state) && <form action={cancelConnectorJobAction}><input type="hidden" name="jobId" value={job.id} /><button type="submit" className="sk-button-secondary">Cancel</button></form>}
              </div>
            </div>
          ))}

          <ConnectorActivityLedger receipts={receipts} />
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

    </div>
  );
}
