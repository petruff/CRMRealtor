'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Check,
  ChevronRight,
  CirclePlus,
  MailCheck,
  MapPin,
  Search,
  Send,
} from 'lucide-react';
import { createMailerAction, toggleMailerSendAction } from '@/app/mailer-actions';
import {
  INITIAL_MAILER_ACTION_STATE,
  type MailerActionState,
} from '@/lib/application/mailer-action-state';
import type { Contact } from '@/lib/domain/contact';
import { displayName } from '@/lib/domain/contact';
import type { MailerCampaign } from '@/lib/domain/mailer';
import {
  MAILING_ADDRESS_LABELS,
  isMailingReady,
  missingMailingAddressFields,
  summarizeMailer,
} from '@/lib/domain/mailer';
import { GroupedSurface, StatTile } from '@/components/ui';

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="sk-primary-button">
      <CirclePlus className="size-4" /> {pending ? 'Creating…' : 'Create campaign'}
    </button>
  );
}

function CreateCampaignForm() {
  const [state, action] = useActionState(createMailerAction, INITIAL_MAILER_ACTION_STATE);
  const nameError = state.fieldErrors?.name;
  const notesError = state.fieldErrors?.notes;
  return (
    <details className="sk-form-section mt-5" open={state.status === 'error' || undefined}>
      <summary>Create a physical-mail campaign</summary>
      <form key={state.values ? JSON.stringify(state.values) : 'new'} action={action} className="grid gap-4 border-t border-line p-4 sm:p-5">
        <label className="sk-field">
          <span className="sk-label">Campaign name</span>
          <input
            name="name"
            maxLength={120}
            defaultValue={state.values?.name}
            placeholder="e.g. September market update"
            className="sk-input"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'mailer-name-error' : undefined}
          />
          {nameError ? <span id="mailer-name-error" className="sk-error">{nameError}</span> : null}
        </label>
        <label className="sk-field">
          <span className="sk-label">Internal notes <span className="font-normal text-muted">(optional)</span></span>
          <textarea
            name="notes"
            maxLength={1_000}
            rows={3}
            defaultValue={state.values?.notes}
            placeholder="Audience, postcard version, or what this mailing is for"
            className="sk-input resize-y"
            aria-invalid={notesError ? true : undefined}
            aria-describedby={notesError ? 'mailer-notes-error' : 'mailer-notes-help'}
          />
          {notesError ? (
            <span id="mailer-notes-error" className="sk-error">{notesError}</span>
          ) : (
            <span id="mailer-notes-help" className="sk-help">For printed postcards and letters — email campaigns stay in Mailchimp.</span>
          )}
        </label>
        {state.status === 'error' && state.message && !nameError && !notesError ? (
          <p role="alert" className="text-sm text-hot">{state.message}</p>
        ) : null}
        <div className="flex justify-end"><CreateButton /></div>
      </form>
    </details>
  );
}

function ToggleButton({ checked, name }: { checked: boolean; name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${checked ? 'Clear sent status' : 'Mark as sent'} for ${name}`}
      disabled={pending}
      className={`grid size-11 shrink-0 place-items-center rounded-full border transition-colors ${
        checked
          ? 'border-nurture-border bg-nurture-soft text-nurture'
          : 'border-line bg-surface-2 text-transparent hover:border-accent hover:text-accent'
      }`}
    >
      {pending ? (
        <span className="size-4 animate-pulse rounded-full bg-current" aria-hidden />
      ) : (
        <Check className="size-[18px]" strokeWidth={2.4} aria-hidden />
      )}
    </button>
  );
}

function MailerSendToggle({
  campaignId,
  contact,
  sentOn,
}: {
  campaignId: string;
  contact: Contact;
  sentOn?: string;
}) {
  const [state, action] = useActionState<MailerActionState, FormData>(
    toggleMailerSendAction,
    INITIAL_MAILER_ACTION_STATE,
  );
  const name = displayName(contact);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="mailerId" value={campaignId} />
      <input type="hidden" name="contactId" value={contact.id} />
      <input type="hidden" name="nextChecked" value={sentOn ? 'false' : 'true'} />
      <div className="min-w-0 text-right">
        <p className={`text-xs font-medium ${sentOn ? 'text-nurture' : 'text-muted'}`}>
          {sentOn ? `Sent ${formatDate(sentOn)}` : 'Not sent'}
        </p>
        {state.status === 'error' ? (
          <p role="alert" className="mt-0.5 max-w-48 text-[11px] leading-tight text-hot">{state.message}</p>
        ) : state.status === 'success' ? (
          <p role="status" className="sr-only">{state.message}</p>
        ) : null}
      </div>
      <ToggleButton checked={Boolean(sentOn)} name={name} />
    </form>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

export function MailerWorkspace({
  campaigns,
  contacts,
  selectedCampaignId,
  isLive,
  saved,
}: {
  campaigns: MailerCampaign[];
  contacts: Contact[];
  selectedCampaignId?: string;
  isLive: boolean;
  saved?: string;
}) {
  const [query, setQuery] = useState('');
  const selected = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0];
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () => contacts.filter((contact) => [
      displayName(contact), contact.email, contact.mailingAddress, contact.city,
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized)),
    [contacts, normalized],
  );
  const selectedSummary = selected ? summarizeMailer(contacts, selected.sends) : undefined;
  const sentByContact = new Map(selected?.sends.map((send) => [send.contactId, send.sentOn]));

  return (
    <div>
      <header className="mb-8 md:mb-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Physical mail</p>
            <h1 className="mt-2 max-w-3xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
              Every postcard, accounted for.
            </h1>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
              Create a mailing, work through your contacts, and keep the exact date each piece went out.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
            isLive ? 'border-nurture-border bg-nurture-soft text-nurture' : 'border-warm-border bg-warm-soft text-warm'
          }`}>
            {isLive ? 'Saved to CRM' : 'Sample workspace'}
          </span>
        </div>
      </header>

      {saved === 'created' ? (
        <p role="status" className="mb-5 rounded-2xl border border-nurture-border bg-nurture-soft px-4 py-3 text-sm text-nurture">
          Campaign created. Its contact checklist is ready.
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="font-display text-xl text-ink">Campaigns</h2>
            <span className="tabular rounded-full bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">{campaigns.length}</span>
          </div>
          {campaigns.length ? (
            <GroupedSurface className="mt-3">
              <nav aria-label="Mailer campaigns" className="grid gap-px">
                {campaigns.map((campaign) => {
                  const summary = summarizeMailer(contacts, campaign.sends);
                  const active = campaign.id === selected?.id;
                  return (
                    <Link
                      key={campaign.id}
                      href={`/mailers?campaign=${encodeURIComponent(campaign.id)}`}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-h-16 items-center gap-3 bg-surface px-4 py-3 transition-colors ${active ? 'text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
                    >
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${active ? 'bg-accent text-white' : 'bg-surface-2 text-muted'}`}>
                        <Send className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{campaign.name}</span>
                        <span className="mt-0.5 block text-xs text-subtle">{summary.sent} of {summary.total} mail-ready sent</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-subtle" />
                    </Link>
                  );
                })}
              </nav>
            </GroupedSurface>
          ) : (
            <p className="mt-3 rounded-[1.25rem] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              No campaigns yet.
            </p>
          )}
          <CreateCampaignForm />
        </aside>

        <section className="min-w-0">
          {selected && selectedSummary ? (
            <>
              <div className="rounded-[var(--sk-card-radius)] bg-surface-2 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-white"><MailCheck className="size-5" /></span>
                  <div className="min-w-0">
                    <h2 className="font-display text-2xl leading-tight text-ink sm:text-3xl">{selected.name}</h2>
                    {selected.notes ? <p className="mt-1 text-sm leading-relaxed text-muted">{selected.notes}</p> : null}
                  </div>
                </div>
                <GroupedSurface className="mt-5 grid grid-cols-2 gap-px sm:grid-cols-4">
                  <StatTile value={selectedSummary.sent} label="Sent" tone="nurture" />
                  <StatTile value={selectedSummary.remaining} label="Remaining" tone="warm" />
                  <StatTile value={selectedSummary.total} label="Mail-ready" />
                  <StatTile value={selectedSummary.needsAddress} label="Need address" tone={selectedSummary.needsAddress ? 'hot' : undefined} />
                </GroupedSurface>
              </div>

              <label className="relative mt-5 block">
                <span className="sr-only">Search contacts in this campaign</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-subtle" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search contacts"
                  className="sk-input pl-11"
                />
              </label>

              <GroupedSurface className="mt-4">
                {filtered.length ? (
                  <ul className="grid gap-px">
                    {filtered.map((contact) => {
                      const name = displayName(contact);
                      const address = [contact.mailingAddress, contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ');
                      const sentOn = sentByContact.get(contact.id);
                      const mailReady = isMailingReady(contact);
                      const missing = missingMailingAddressFields(contact)
                        .map((field) => MAILING_ADDRESS_LABELS[field]);
                      return (
                        <li key={contact.id} className="flex min-h-[5.25rem] flex-wrap items-center gap-4 bg-surface px-4 py-3 sm:flex-nowrap sm:px-5">
                          <div className="min-w-0 flex-1">
                            <Link href={`/contacts/${encodeURIComponent(contact.id)}`} className="font-medium text-ink hover:text-accent hover:underline">
                              {name}
                            </Link>
                            <p className={`mt-1 flex min-w-0 items-center gap-1.5 text-xs ${mailReady ? 'text-muted' : 'font-medium text-hot'}`}>
                              <MapPin className="size-3.5 shrink-0" />
                              <span className="truncate">
                                {mailReady ? address : `Needs ${missing.join(', ')}`}
                              </span>
                            </p>
                          </div>
                          {mailReady || sentOn ? (
                            <div className="ml-auto flex items-center gap-3">
                              {!mailReady ? (
                                <Link
                                  href={`/contacts/${encodeURIComponent(contact.id)}/edit`}
                                  className="sk-text-action min-h-11 px-2 text-xs"
                                >
                                  Fix address
                                </Link>
                              ) : null}
                              <MailerSendToggle key={`${contact.id}:${sentOn ?? 'open'}`} campaignId={selected.id} contact={contact} sentOn={sentOn} />
                            </div>
                          ) : (
                            <div className="ml-auto text-right">
                              <p className="text-xs font-medium text-hot">Cannot mark sent</p>
                              <Link
                                href={`/contacts/${encodeURIComponent(contact.id)}/edit`}
                                className="sk-text-action mt-1 min-h-11 px-2 text-xs"
                              >
                                Add address
                              </Link>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="bg-surface px-5 py-10 text-center text-sm text-muted">No contacts match “{query}”.</p>
                )}
              </GroupedSurface>
            </>
          ) : (
            <div className="grid min-h-72 place-items-center rounded-[var(--sk-card-radius)] bg-surface-2 px-6 text-center">
              <div>
                <MailCheck className="mx-auto size-8 text-accent" />
                <h2 className="mt-4 font-display text-2xl text-ink">Create the first campaign</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">Give the physical mailing a name; the CRM will build its contact checklist automatically.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
