import Link from "next/link";
import { Activity, CheckCircle2 } from "lucide-react";
import type { ActivityEvent, CrmTask } from "@/lib/domain/activity";
import { GroupedSurface } from "@/components/ui";

const EVENT_LABEL: Record<ActivityEvent["type"], string> = {
  "contact-created": "Contact created",
  "contact-updated": "Contact updated",
  "contact-imported": "Contact imported",
  "note-added": "Note added",
  "touch-recorded": "Touch recorded",
  "contact-archived": "Contact archived",
  "contact-restored": "Contact restored",
  "contact-point-added": "Contact point added",
  "contact-point-updated": "Contact point updated",
  "contact-point-archived": "Contact point archived",
  "contact-point-restored": "Contact point restored",
  "household-updated": "Household updated",
  "relationship-updated": "Relationship updated",
  "assignment-updated": "Assignment updated",
  "custom-field-updated": "Custom field updated",
  "pipeline-stage-changed": "Pipeline stage changed",
  "incomplete-record-received": "Incomplete record received",
  "incomplete-record-converted": "Incomplete record converted",
  "email-metadata-linked": "Email activity linked",
  "email-sent": "Email sent",
  "task-created": "Task created",
  "task-completed": "Task completed",
  "task-archived": "Task archived",
};

export function ContactActivityHistory({
  events,
  tasks,
}: {
  events: readonly ActivityEvent[];
  tasks: readonly CrmTask[];
}) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">
            Activity & follow-ups
          </h2>
          <p className="mt-1 text-sm text-muted">
            A read-only record of CRM activity and linked tasks.
          </p>
        </div>
        <Link href="/activities" className="sk-text-action">
          Open work queue
        </Link>
      </div>
      {tasks.length ? (
        <GroupedSurface className="mt-4">
          <ul className="grid gap-px">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start gap-3 bg-surface p-4"
              >
                <CheckCircle2
                  className={`mt-0.5 size-4 shrink-0 ${task.status === "completed" ? "text-nurture" : "text-accent"}`}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-medium text-ink">{task.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {task.status} · due{" "}
                    <time dateTime={task.dueAt}>
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(task.dueAt))}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </GroupedSurface>
      ) : null}
      {events.length ? (
        <GroupedSurface className="mt-4">
          <ol className="grid gap-px">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-3 bg-surface p-4"
              >
                <Activity
                  className="mt-0.5 size-4 shrink-0 text-accent"
                  aria-hidden
                />
                <div>
                  <p className="text-sm text-ink">{EVENT_LABEL[event.type]}</p>
                  <time
                    className="mt-1 block text-xs text-muted"
                    dateTime={event.occurredAt}
                  >
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(event.occurredAt))}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </GroupedSurface>
      ) : null}
      {!events.length && !tasks.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-5 text-center text-sm text-subtle">
          No linked activities or tasks yet. Notes remain in their own history
          below.
        </p>
      ) : null}
    </section>
  );
}
