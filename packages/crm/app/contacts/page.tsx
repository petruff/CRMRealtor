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
} from "lucide-react";
import {
  INTENT_LABEL,
  LEAD_TYPE_LABEL,
  PIPELINE_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  displayName,
  initials,
  type LeadType,
  type LeadSource,
} from "@/lib/domain/contact";
import { getRepository } from "@/lib/data";
import { Avatar, IconAction, SectionHeader } from "@/components/ui";
import { SmartListControls } from "@/components/smart-list-controls";
import { ContactScopeNavigation } from "@/components/contact-scope-navigation";
import {
  CONTACT_QUERY_MAX,
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
    eyebrow: "Qualification queue",
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
  }>;
}) {
  const params = await searchParams;
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
  const rawSource = typeof params.source === "string" ? params.source : undefined;
  let source: LeadSource | undefined;
  try {
    source = parseLeadSource(rawSource);
  } catch {
    source = undefined;
  }
  const rawSmartListId =
    typeof params.smartList === "string" ? params.smartList : undefined;
  const { repository, smartListRepository, activityRepository, richContactRepository, workspaceScope } =
    await getRepository();
  const allContacts = await repository.list(archivedView ? { archivedOnly: true } : undefined);
  const smartLists = await listSmartListsCommand(
    smartListRepository,
    workspaceScope,
    "all",
  );
  const selectedSmartList = !archivedView && rawSmartListId
    ? smartLists.find((list) => list.id === rawSmartListId)
    : undefined;
  let smartListError: string | undefined;
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
      smartListError =
        error instanceof Error
          ? error.message
          : "That Smart List could not be applied.";
    }
  }
  const contacts = archivedView
    ? queryArchivedContacts(scopedContacts, { query, leadType, source })
    : queryContacts(scopedContacts, { query, leadType, source, scope });
  const viewState: ContactViewState = {
    scope,
    ...(query ? { query } : {}),
    ...(leadType ? { leadType } : {}),
    ...(source ? { source } : {}),
    ...(rawSmartListId ? { smartList: rawSmartListId } : {}),
  };
  const scopeCounts = Object.fromEntries(CONTACT_SCOPES.map((candidate) => [
    candidate,
    queryContacts(scopedContacts, { query, leadType, source, scope: candidate }).length,
  ])) as Record<ContactScope, number>;
  const [tasks, activityEvents, assignments] = await Promise.all([
    activityRepository.listTasks(workspaceScope, { status: "all", limit: 500 }),
    activityRepository.listEvents(workspaceScope, { limit: 500 }),
    richContactRepository ? richContactRepository.listAssignments(workspaceScope) : Promise.resolve([]),
  ]);
  const taskCounts = new Map<string, { open: number; completed: number }>();
  for (const task of tasks) {
    if (!task.contactId) continue;
    const count = taskCounts.get(task.contactId) ?? { open: 0, completed: 0 };
    if (task.status === "open") count.open += 1;
    if (task.status === "completed") count.completed += 1;
    taskCounts.set(task.contactId, count);
  }
  const activityCounts = new Map<string, number>();
  for (const event of activityEvents) {
    if (!event.contactId) continue;
    activityCounts.set(event.contactId, (activityCounts.get(event.contactId) ?? 0) + 1);
  }
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

  return (
    <div>
      <header className="mb-10 flex flex-col items-start gap-5 md:mb-12 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{archivedView ? "Archived contacts" : scopeCopy.eyebrow}</p>
          <h1 className="mt-2 max-w-3xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
            {archivedView
              ? `${contacts.length} archived ${contacts.length === 1 ? "record" : "records"}.`
              : scopeCopy.title}
          </h1>
          {!archivedView ? (
            <p className="mt-3 text-sm text-muted">
              {contacts.length} {contacts.length === 1 ? "person" : "people"} in this view
              {searching ? ` · ${allContacts.length} active records total` : " · hottest first"}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={archivedView ? "/contacts" : "/contacts?view=archived"} className="sk-secondary-button px-3">
            {archivedView ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
            {archivedView ? "Active contacts" : "Archived"}
          </Link>
          <Link href="/contacts/incomplete" className="sk-secondary-button px-3">
            Review incomplete
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
          <span>{contacts.length === 1 ? "1 contact matches" : `${contacts.length} contacts match`} in {archivedView ? "Archived" : scopeCopy.title}.</span>
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

      {contacts.length ? (
        <div className="space-y-12">
          {ORDER.map((leadType) => {
            const group = contacts.filter((c) => c.leadType === leadType);
            if (group.length === 0) return null;
            return (
              <section key={leadType}>
                <SectionHeader
                  title={LEAD_TYPE_LABEL[leadType]}
                  blurb={BLURB[leadType]}
                  count={group.length}
                  tone={leadType}
                />

                <ul className="sk-group sk-list-grid grid gap-px lg:grid-cols-2">
                  {group.map((contact) => (
                    <li
                      key={contact.id}
                      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 bg-surface p-4 sm:flex sm:p-5"
                    >
                      <Avatar
                        initials={initials(contact)}
                        leadType={contact.leadType}
                      />

                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/contacts/${contact.id}${archivedView ? "?view=archived" : ""}`}
                          className="block truncate font-medium text-ink underline-offset-2 hover:underline"
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
                          {activityCounts.get(contact.id) ?? 0} activities · {taskCounts.get(contact.id)?.open ?? 0} open tasks · {taskCounts.get(contact.id)?.completed ?? 0} completed · {assigneeByContact.has(contact.id) ? `Assigned ${assigneeByContact.get(contact.id)}` : "Unassigned"}
                        </p>
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
            );
          })}
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
