import Link from "next/link";
import type { Metadata } from "next";
import {
  Phone,
  MessageSquare,
  Mail,
  Plus,
  Search,
  Upload,
  X,
  Archive,
  RotateCcw,
  Cake,
} from "lucide-react";
import {
  INTENT_LABEL,
  LEAD_TYPE_LABEL,
  PIPELINE_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  displayName,
  initials,
  type Contact,
  type LeadType,
  type LeadSource,
} from "@/lib/domain/contact";
import { getRepository } from "@/lib/data";
import { Avatar, IconAction, SectionHeader } from "@/components/ui";
import { SmartListControls } from "@/components/smart-list-controls";
import { ContactScopeNavigation } from "@/components/contact-scope-navigation";
import { ContactPagination } from "@/components/contact-pagination";
import {
  CONTACT_QUERY_MAX,
  CONTACT_PAGE_SIZE,
  contactPageMetadata,
  paginateContacts,
  parseContactPage,
  CONTACT_LEAD_TYPES,
  CONTACT_SCOPES,
  parseContactScope,
  parseLeadType,
  parseLeadSource,
  queryArchivedContacts,
  queryContacts,
  type ContactScope,
} from "@/lib/application/contact-query";
import { contactViewHref, type ContactViewState } from "@/lib/application/contact-view-state";
import { contactRecordHref, type ContactBrowseContext } from "@/lib/application/contact-navigation";
import { formatHuman } from "@/lib/domain/dates";
import {
  applySmartListCommand,
  listSmartListsCommand,
} from "@/lib/application/smart-list-commands";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contacts" };

/**
 * Grouped Hot → Warm → Nurture, which is the organisation she explicitly asked
 * for and her previous CRM refused to give her.
 */
const ORDER: LeadType[] = ["hot", "warm", "nurture"];

const BLURB: Record<LeadType, string> = {
  hot: "Immediate attention. Weekly rhythm.",
  warm: "Real interest, longer horizon. Weekly rhythm.",
  nurture: "Long-term leads and relationships. Monthly rhythm.",
};

const SCOPE_COPY: Record<ContactScope, { title: string; eyebrow: string; empty: string }> = {
  leads: {
    title: "Working leads",
    eyebrow: "Leads",
    empty: "No leads match this view yet.",
  },
  clients: {
    title: "Client relationships",
    eyebrow: "All clients",
    empty: "No active or past clients match this view yet.",
  },
  "active-clients": {
    title: "Active clients",
    eyebrow: "Clients",
    empty: "No active clients match this view yet.",
  },
  "past-clients": {
    title: "Past clients",
    eyebrow: "Clients",
    empty: "No past clients match this view yet.",
  },
  "needs-review": {
    title: "Needs review",
    eyebrow: "Contacts to confirm",
    empty: "Every contact in this view has been reviewed.",
  },
  all: {
    title: "All contacts",
    eyebrow: "Complete active database",
    empty: "No active contacts match this view yet.",
  },
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    leadType?: string | string[];
    source?: string | string[];
    smartList?: string | string[];
    view?: string | string[];
    qualification?: string | string[];
    scope?: string | string[];
    page?: string | string[];
    saved?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const archiveNotice = params.saved === "archived-end"
    ? "Contact archived. There are no more contacts after it in this list."
    : params.saved === "archived"
      ? "Contact archived. It stays available under Archived."
      : undefined;
  const archivedView = params.view === "archived";
  const legacyNeedsReview = params.qualification === "needs-qualification";
  const rawScope = typeof params.scope === "string" ? params.scope : undefined;
  let scope: ContactScope = "leads";
  if (legacyNeedsReview) scope = "needs-review";
  else {
    try {
      scope = parseContactScope(rawScope);
    } catch {
      scope = "leads";
    }
  }
  const rawQuery = typeof params.q === "string" ? params.q : "";
  const query = rawQuery.slice(0, CONTACT_QUERY_MAX);
  const rawLeadType =
    typeof params.leadType === "string" ? params.leadType : undefined;
  let leadType: LeadType | undefined;
  try {
    leadType = parseLeadType(rawLeadType);
  } catch {
    leadType = undefined;
  }
  if (!archivedView && scope === "past-clients") leadType = undefined;
  const rawSource = typeof params.source === "string" ? params.source : undefined;
  let source: LeadSource | undefined;
  try {
    source = parseLeadSource(rawSource);
  } catch {
    source = undefined;
  }
  const rawSmartListId =
    typeof params.smartList === "string" ? params.smartList : undefined;
  const requestedPage = parseContactPage(typeof params.page === "string" ? params.page : undefined);
  const {
    repository, smartListRepository, activityRepository, richContactRepository, workspaceScope,
  } =
    await getRepository();
  const smartLists = await listSmartListsCommand(
    smartListRepository,
    workspaceScope,
    "all",
  );
  const selectedSmartList = !archivedView && rawSmartListId
    ? smartLists.find((list) => list.id === rawSmartListId && list.status === "active")
    : undefined;
  let smartListError = rawSmartListId && !archivedView && !selectedSmartList
    ? "That Smart List is no longer available."
    : undefined;
  const listPage = repository.listPage?.bind(repository);
  let allContacts: Awaited<ReturnType<typeof repository.list>> = [];
  let contacts: Awaited<ReturnType<typeof repository.list>> = [];
  let contactPage: ReturnType<typeof paginateContacts<Contact>>;
  let scopeCounts: Record<ContactScope, number>;
  let leadTypeCounts: Record<LeadType, number>;
  let activeTotal = 0;

  if (listPage) {
    const requestedOffset = (requestedPage - 1) * CONTACT_PAGE_SIZE;
    const request = {
      scope,
      query,
      ...(leadType ? { leadType } : {}),
      ...(source ? { source } : {}),
      ...(selectedSmartList ? {
        smartListId: selectedSmartList.id,
        smartListDefinition: selectedSmartList.definition,
      } : {}),
      archivedOnly: archivedView,
      offset: requestedOffset,
      limit: CONTACT_PAGE_SIZE,
    } as const;
    let pageResult = await listPage(request);
    const metadata = contactPageMetadata(pageResult.total, requestedPage);
    if (metadata.offset !== requestedOffset) {
      pageResult = await listPage({ ...request, offset: metadata.offset });
      if (pageResult.total !== metadata.total) {
        throw new Error("Contact counts changed while this page was loading. Please refresh.");
      }
    }
    contacts = [...pageResult.items];
    contactPage = { items: contacts, ...metadata };
    scopeCounts = { ...pageResult.scopeCounts };
    leadTypeCounts = { ...pageResult.leadTypeCounts };
    activeTotal = pageResult.activeTotal;
  } else {
    allContacts = await repository.list(archivedView ? { archivedOnly: true } : undefined);
    let scopedContacts = allContacts;
    if (rawSmartListId && !archivedView) {
      try {
        const applied = await applySmartListCommand(
          smartListRepository,
          { list: async () => allContacts },
          workspaceScope,
          rawSmartListId,
        );
        const ids = new Set(applied.contactIds);
        scopedContacts = allContacts.filter((contact) => ids.has(contact.id));
      } catch (error) {
        smartListError = error instanceof Error ? error.message : "That Smart List could not be applied.";
      }
    }
    contacts = archivedView
      ? queryArchivedContacts(scopedContacts, { query, leadType, source })
      : queryContacts(scopedContacts, { query, leadType, source, scope });
    contactPage = paginateContacts(contacts, requestedPage);
    activeTotal = archivedView ? (await repository.list()).length : allContacts.length;
    scopeCounts = Object.fromEntries(CONTACT_SCOPES.map((candidate) => [
      candidate,
      queryContacts(scopedContacts, { query, leadType, source, scope: candidate }).length,
    ])) as Record<ContactScope, number>;
    leadTypeCounts = Object.fromEntries(ORDER.map((candidate) => [
      candidate,
      contacts.filter((contact) => contact.leadType === candidate).length,
    ])) as Record<LeadType, number>;
  }
  const visibleContacts = contactPage.items;
  const pastClients = visibleContacts.filter((contact) => contact.relationship === "past-client");
  const contactGroups = [
    ...(pastClients.length > 0 ? [{
      key: "past-clients",
      title: "Past clients",
      blurb: "Relationships you have already served. Kept separate from lead priority.",
      count: scope === "past-clients" ? contactPage.total : pastClients.length,
      tone: "neutral" as const,
      contacts: pastClients,
    }] : []),
    ...ORDER.map((candidate) => ({
      key: candidate,
      title: LEAD_TYPE_LABEL[candidate],
      blurb: BLURB[candidate],
      count: !archivedView && (scope === "leads" || scope === "active-clients")
        ? leadTypeCounts[candidate]
        : visibleContacts.filter((contact) => contact.relationship !== "past-client" && contact.leadType === candidate).length,
      tone: candidate,
      contacts: visibleContacts.filter((contact) => contact.relationship !== "past-client" && contact.leadType === candidate),
    })).filter((group) => group.contacts.length > 0),
  ];
  const viewState: ContactViewState = {
    scope,
    ...(query ? { query } : {}),
    ...(leadType ? { leadType } : {}),
    ...(source ? { source } : {}),
    ...(rawSmartListId ? { smartList: rawSmartListId } : {}),
    ...(contactPage.page > 1 ? { page: contactPage.page } : {}),
  };
  const browseContext: ContactBrowseContext = archivedView
    ? {
      archived: true,
      scope: "all",
      ...(query ? { query } : {}),
      ...(leadType ? { leadType } : {}),
      ...(source ? { source } : {}),
      ...(contactPage.page > 1 ? { page: contactPage.page } : {}),
    }
    : { ...viewState, origin: "list" };
  const listContactAggregates = activityRepository.listContactAggregates?.bind(activityRepository);
  if (!listContactAggregates) {
    throw new Error("Exact contact activity counts are unavailable.");
  }
  const [contactAggregates, assignments] = await Promise.all([
    listContactAggregates(workspaceScope, visibleContacts.map((contact) => contact.id)),
    richContactRepository ? richContactRepository.listAssignments(workspaceScope) : Promise.resolve([]),
  ]);
  const assigneeByContact = new Map(assignments.filter((item) => !item.unassignedAt).map((item) => [item.contactId, item.assigneeMembershipId]));
  const searching = Boolean(query.trim() || leadType || source || (!archivedView && rawSmartListId));
  const clearSmartListHref = contactViewHref(viewState, { smartList: undefined });
  const clearQueryHref = archivedView
    ? `/contacts?${new URLSearchParams({ view: "archived", ...(leadType ? { leadType } : {}), ...(source ? { source } : {}) })}`
    : contactViewHref(viewState, { query: undefined });
  const clearLeadTypeHref = archivedView
    ? `/contacts?${new URLSearchParams({ view: "archived", ...(query ? { q: query } : {}), ...(source ? { source } : {}) })}`
    : contactViewHref(viewState, { leadType: undefined });
  const clearSourceHref = archivedView
    ? `/contacts?${new URLSearchParams({ view: "archived", ...(query ? { q: query } : {}), ...(leadType ? { leadType } : {}) })}`
    : contactViewHref(viewState, { source: undefined });
  const clearFiltersHref = archivedView
    ? "/contacts?view=archived"
    : contactViewHref(viewState, { query: undefined, leadType: undefined, source: undefined });
  const scopeCopy = SCOPE_COPY[scope];
  const archivedPageHref = (page: number) => `/contacts?${new URLSearchParams({
    view: "archived",
    ...(query ? { q: query } : {}),
    ...(leadType ? { leadType } : {}),
    ...(source ? { source } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  })}`;

  return (
    <div>
      <header className="mb-10 flex flex-col items-start gap-5 md:mb-12 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{archivedView ? "Archived contacts" : scopeCopy.eyebrow}</p>
          <h1 className="mt-2 max-w-3xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
            {archivedView
              ? `${contactPage.total} archived ${contactPage.total === 1 ? "record" : "records"}.`
              : scopeCopy.title}
          </h1>
          {!archivedView ? (
            <p className="mt-3 text-sm text-muted">
              {contactPage.total} {contactPage.total === 1 ? "person" : "people"} in this view
              {searching ? ` · ${activeTotal} active records total` : " · hottest first"}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={archivedView ? "/contacts" : "/contacts?view=archived"} className="sk-secondary-button px-3">
            {archivedView ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
            {archivedView ? "Active contacts" : "Archived"}
          </Link>
          <Link href="/contacts/incomplete" className="sk-secondary-button px-3">
            Incomplete records
          </Link>
          <Link href="/contacts/import" className="sk-secondary-button px-3">
            <Upload className="size-4" /> Import
          </Link>
          {!archivedView ? <Link href="/contacts/new" className="sk-primary-button shrink-0">
            <Plus className="size-4" /> Add contact
          </Link> : null}
        </div>
      </header>

      {!archivedView ? <ContactScopeNavigation scope={scope} counts={scopeCounts} viewState={viewState} /> : null}

      {!archivedView ? <SmartListControls
        lists={smartLists}
        activeId={selectedSmartList?.id}
        query={query || undefined}
        leadType={leadType}
        scope={scope}
      /> : null}

      {archiveNotice && !archivedView ? (
        <p
          role="status"
          className="mb-5 rounded-2xl border border-nurture-border bg-nurture-soft px-4 py-3 text-sm text-nurture"
        >
          {archiveNotice}
        </p>
      ) : null}

      {smartListError ? (
        <p role="alert" className="mb-5 text-sm text-hot">
          {smartListError}
        </p>
      ) : null}
      {selectedSmartList ? (
        <p
          role="status"
          className="mb-5 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-ink"
        >
          Viewing <strong>{selectedSmartList.name}</strong> ·{" "}
          {selectedSmartList.definition.criteria.length} saved criterion.
          <Link
            href={clearSmartListHref}
            className="ml-2 text-accent underline underline-offset-2"
          >
            Clear Smart List
          </Link>
        </p>
      ) : null}

      <form
        role="search"
        method="get"
        className="sk-group mb-5 grid gap-px bg-line sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
      >
        <label className="relative block bg-surface">
          <span className="sr-only">Search contacts</span>
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            maxLength={CONTACT_QUERY_MAX}
            defaultValue={query}
            placeholder="Name, phone, email, city, ZIP, or tag"
            className="sk-input min-h-14 rounded-none border-0 bg-surface pl-11"
          />
        </label>
        {rawSmartListId && !archivedView ? (
          <input type="hidden" name="smartList" value={rawSmartListId} />
        ) : null}
        {source ? <input type="hidden" name="source" value={source} /> : null}
        {!archivedView && scope !== "leads" ? <input type="hidden" name="scope" value={scope} /> : null}
        {archivedView ? <input type="hidden" name="view" value="archived" /> : null}
        {!archivedView && scope === "past-clients" ? (
          <div className="flex min-h-14 items-center bg-surface px-4 text-xs leading-relaxed text-muted">
            Past clients are organized by relationship, not lead priority.
          </div>
        ) : (
          <label className="bg-surface">
            <span className="sr-only">Filter by follow-up group</span>
            <select
              name="leadType"
              defaultValue={leadType ?? ""}
              className="sk-input min-h-14 rounded-none border-0 bg-surface"
            >
              <option value="">All follow-up groups</option>
              {CONTACT_LEAD_TYPES.map((value) => (
                <option key={value} value={value}>
                  {LEAD_TYPE_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex min-h-14 items-center gap-1 bg-surface px-2">
          <button
            type="submit"
            className="sk-primary-button min-h-11 flex-1 px-4 sm:flex-none"
          >
            <Search className="size-4" aria-hidden /> Search
          </button>
          {searching ? (
            <Link
              href={clearFiltersHref}
              className="sk-text-action min-h-11 px-3"
              aria-label="Clear search and follow-up filters"
            >
              <X className="size-4" aria-hidden /> Clear
            </Link>
          ) : null}
        </div>
      </form>

      {searching ? (
        <div role="status" className="mb-7 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{contactPage.total === 1 ? "1 contact matches" : `${contactPage.total} contacts match`} in {archivedView ? "Archived" : scopeCopy.title}.</span>
          {query.trim() ? (
            <Link href={clearQueryHref} className="sk-secondary-button min-h-9 px-3 text-xs">
              “{query.trim()}” <X className="size-3.5" aria-hidden />
            </Link>
          ) : null}
          {leadType ? (
            <Link href={clearLeadTypeHref} className="sk-secondary-button min-h-9 px-3 text-xs">
              {LEAD_TYPE_LABEL[leadType]} <X className="size-3.5" aria-hidden />
            </Link>
          ) : null}
          {source ? (
            <Link href={clearSourceHref} className="sk-secondary-button min-h-9 px-3 text-xs">
              {SOURCE_LABEL[source]} <X className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}

      {!archivedView && scope === "needs-review" ? (
        <div className="mb-7 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-sm leading-relaxed text-warm">
          These contacts were added successfully. “Needs review” means Omnix needs your judgment about their relationship or follow-up priority; it does not mean the import failed.
        </div>
      ) : null}

      {contactPage.total ? (
        <div className="space-y-12">
          {contactGroups.map((group) => (
              <section key={group.key}>
                <SectionHeader
                  title={group.title}
                  blurb={group.blurb}
                  count={group.count}
                  tone={group.tone}
                />

                <ul className="sk-group sk-list-grid grid gap-px lg:grid-cols-2">
                  {group.contacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 bg-surface p-4 sm:flex sm:p-5"
                    >
                      <Avatar
                        initials={initials(contact)}
                        leadType={contact.leadType}
                        relationship={contact.relationship}
                      />

                      <div className="min-w-0 flex-1">
                        <Link
                          href={contactRecordHref(contact.id, browseContext)}
                          className="flex min-h-11 items-center truncate font-medium text-ink underline-offset-2 hover:underline"
                        >
                          {displayName(contact)}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {[
                            RELATIONSHIP_LABEL[contact.relationship],
                            INTENT_LABEL[contact.intent],
                            PIPELINE_LABEL[contact.pipelineStage],
                          ].join(" · ")}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-subtle">
                          {contactAggregates.get(contact.id)?.activityCount ?? 0} activities · {contactAggregates.get(contact.id)?.openTaskCount ?? 0} open tasks · {contactAggregates.get(contact.id)?.completedTaskCount ?? 0} completed · {assigneeByContact.has(contact.id) ? `Assigned ${assigneeByContact.get(contact.id)}` : "Unassigned"}
                        </p>
                        {contact.birthdate ? (
                          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                            <Cake className="size-3.5 shrink-0 text-nurture" aria-hidden />
                            Birthday {formatHuman(contact.birthdate)}
                          </p>
                        ) : null}
                      </div>

                      {!archivedView ? <div className="col-start-2 flex shrink-0 gap-1.5 sm:ml-auto">
                        {contact.phone && (
                          <>
                            <IconAction
                              href={`tel:${contact.phone}`}
                              label={`Call ${displayName(contact)}`}
                            >
                              <Phone className="size-4" />
                            </IconAction>
                            <IconAction
                              href={`sms:${contact.phone}`}
                              label={`Text ${displayName(contact)}`}
                            >
                              <MessageSquare className="size-4" />
                            </IconAction>
                          </>
                        )}
                        {contact.email && (
                          <IconAction
                            href={`mailto:${contact.email}`}
                            label={`Email ${displayName(contact)}`}
                          >
                            <Mail className="size-4" />
                          </IconAction>
                        )}
                      </div> : <span className="col-start-2 rounded-full bg-surface-2 px-2 py-1 text-xs text-muted sm:ml-auto">Read only</span>}
                    </li>
                  ))}
                </ul>
              </section>
          ))}
          <ContactPagination
            page={contactPage}
            hrefForPage={(page) => archivedView ? archivedPageHref(page) : contactViewHref(viewState, { page })}
          />
        </div>
      ) : (
        <div className="sk-group bg-surface px-6 py-14 text-center">
          <Search className="mx-auto size-7 text-accent" aria-hidden />
          <h2 className="mt-4 font-display text-2xl text-ink">
            {archivedView ? "No archived contacts found" : scopeCopy.empty}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            {searching
              ? "Clear one filter above or broaden the search while keeping this contact view selected."
              : "This view is ready. Contacts will appear here as their explicit relationship or qualification changes."}
          </p>
          {searching ? <Link href={clearFiltersHref} className="sk-primary-button mt-5">Clear search filters</Link> : null}
        </div>
      )}
    </div>
  );
}
