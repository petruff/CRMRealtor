import type { Metadata } from "next";
import { Activity } from "lucide-react";
import {
  listTasksCommand,
  listActivityEventsCommand,
} from "@/lib/application/activity-commands";
import { getRepository } from "@/lib/data";
import { ActivityWorkspace } from "@/components/activity-workspace";
import { ActivityError, type TaskStatus } from "@/lib/domain/activity";
import { CadenceFollowUpQueue } from "@/components/cadence-follow-up-queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activities" };

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    contactId?: string;
    dueFrom?: string;
    dueTo?: string;
    calendarPrepared?: string;
    calendarError?: string;
  }>;
}) {
  const renderedAt = new Date();
  const timeZone = process.env.OMNIX_TIME_ZONE?.trim() || "America/New_York";
  const params = await searchParams;
  const status: TaskStatus | "all" = [
    "open",
    "completed",
    "archived",
    "all",
  ].includes(params.status ?? "")
    ? (params.status as TaskStatus | "all")
    : "open";
  const { activityRepository, workspaceScope, repository, connectorRepository, isLive } =
    await getRepository();
  const [tasks, contacts] = await Promise.all([
    listTasksCommand(activityRepository, workspaceScope, {
      query: params.q,
      contactId: params.contactId || undefined,
      status,
      dueFrom: params.dueFrom || undefined,
      dueTo: params.dueTo || undefined,
    }),
    repository.list(),
  ]);
  const [eventsResult, importedEventsResult, googleConnectionsResult] = await Promise.allSettled([
    listActivityEventsCommand(activityRepository, workspaceScope, {
      limit: 20,
    }),
    listActivityEventsCommand(activityRepository, workspaceScope, {
      type: "contact-imported",
      limit: 500,
    }),
    isLive ? connectorRepository.listConnections(workspaceScope, { provider: "google", limit: 10 }) : Promise.resolve([]),
  ]);
  const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
  const historicalImportContactIds = new Set(
    (importedEventsResult.status === "fulfilled" ? importedEventsResult.value : [])
      .flatMap((event) => event.contactId ? [event.contactId] : []),
  );
  const googleConnections = googleConnectionsResult.status === "fulfilled" ? googleConnectionsResult.value : [];
  const readWarnings = [
    ...(eventsResult.status === "rejected" ? ["Recent activity evidence is temporarily unavailable. Tasks remain safe to review and update."] : []),
    ...(importedEventsResult.status === "rejected" ? ["Imported-contact history is temporarily unavailable. Fresh-lead urgency may be incomplete."] : []),
    ...(googleConnectionsResult.status === "rejected" ? ["Google Calendar actions are temporarily hidden. The Omnix task queue remains available."] : []),
  ];
  if (eventsResult.status === "rejected") {
    console.warn("[activities-page:activity-read]", eventsResult.reason instanceof ActivityError ? eventsResult.reason.code : "internal-error");
  }
  if (googleConnectionsResult.status === "rejected") {
    console.warn("[activities-page:google-read]", "connector-unavailable");
  }
  const googleCalendarConnection = googleConnections.find((connection) =>
    ["active", "degraded"].includes(connection.status)
    && connection.grantedScopes.includes("https://www.googleapis.com/auth/calendar.app.created"));
  return (
    <div>
      <header className="mb-8">
        <p className="eyebrow">Work queue</p>
        <h1 className="mt-2 font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl">
          Make the next step obvious.
        </h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-muted">
          Open tasks sort overdue first. Activity is evidence, not a provider
          communication log.
        </p>
      </header>
      {params.calendarPrepared ? <p role="status" className="mb-5 rounded-2xl border border-nurture-border bg-nurture-soft px-4 py-3 text-sm text-nurture">Calendar operation prepared. The owner must approve the exact task version before Google is called.</p> : null}
      {params.calendarError ? <p role="alert" className="mb-5 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-sm text-warm">{params.calendarError}</p> : null}
      {readWarnings.length ? (
        <div role="status" className="mb-5 rounded-[var(--sk-card-radius)] border border-warm-border bg-warm-soft px-4 py-3 text-sm text-warm">
          <p className="font-semibold">Some supporting information is unavailable</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {readWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
      <form
        method="get"
        role="search"
        className="sk-group mb-6 grid gap-px bg-line md:grid-cols-2 xl:grid-cols-6"
      >
        <label className="bg-surface p-2">
          <span className="sr-only">Search tasks</span>
          <input
            name="q"
            defaultValue={params.q}
            maxLength={200}
            className="sk-input"
            placeholder="Search task text"
          />
        </label>
        <label className="bg-surface p-2">
          <span className="sr-only">Filter by task status</span>
          <select
            name="status"
            defaultValue={status}
            className="sk-input"
          >
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
            <option value="all">All tasks</option>
          </select>
        </label>
        <label className="bg-surface p-2">
          <span className="sr-only">Filter by contact</span>
          <select
            name="contactId"
            defaultValue={params.contactId}
            className="sk-input"
          >
            <option value="">All contacts</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="bg-surface p-2">
          <span className="sr-only">Due on or after</span>
          <input
            type="date"
            name="dueFrom"
            defaultValue={params.dueFrom}
            className="sk-input"
          />
        </label>
        <label className="bg-surface p-2">
          <span className="sr-only">Due on or before</span>
          <input
            type="date"
            name="dueTo"
            defaultValue={params.dueTo}
            className="sk-input"
          />
        </label>
        <button className="sk-primary-button m-2" type="submit">
          <Activity className="size-4" /> Refresh queue
        </button>
      </form>
      <CadenceFollowUpQueue
        contacts={contacts}
        historicalImportContactIds={historicalImportContactIds}
        renderedAt={renderedAt.toISOString()}
      />
      <ActivityWorkspace
        tasks={tasks}
        contacts={contacts}
        googleCalendarConnectionId={googleCalendarConnection?.id}
        renderedAt={renderedAt.toISOString()}
        timeZone={timeZone}
      />
      {events.length ? (
        <section className="mt-10">
          <h2 className="font-display text-2xl text-ink">Recent activity</h2>
          <ol className="mt-4 sk-group grid gap-px">
            {events.map((event) => (
              <li key={event.id} className="bg-surface p-4 text-sm text-muted">
                <span className="font-medium text-ink">
                  {event.type.replaceAll("-", " ")}
                </span>{" "}
                ·{" "}
                <time dateTime={event.occurredAt}>
                  {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(event.occurredAt))}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
