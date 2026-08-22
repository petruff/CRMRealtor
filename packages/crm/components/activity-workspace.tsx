"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Archive, CalendarPlus, Check, Circle, Plus, RotateCcw } from "lucide-react";
import type { Contact } from "@/lib/domain/contact";
import type { CrmTask } from "@/lib/domain/activity";
import { INITIAL_WORK_QUEUE_ACTION_STATE } from "@/app/contacts/action-state";
import {
  createTaskAction,
  transitionTasksAction,
} from "@/app/activities/actions";
import { prepareTaskForGoogleCalendarAction } from "@/app/activities/google-actions";

function googleTaskFormId(taskId: string) {
  return `google-task-${taskId}`;
}

function Submit({
  children,
  className = "sk-primary-button",
  confirmText,
}: {
  children: React.ReactNode;
  className?: string;
  confirmText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={
        confirmText
          ? (event) => {
              if (!window.confirm(confirmText)) event.preventDefault();
            }
          : undefined
      }
    >
      {pending ? "Working…" : children}
    </button>
  );
}

function State({ status, message }: { status: string; message?: string }) {
  return message ? (
    <p
      role={status === "error" ? "alert" : "status"}
      className={`mt-3 text-sm ${status === "error" ? "text-hot" : "text-nurture"}`}
    >
      {message}
    </p>
  ) : null;
}

function taskTone(task: CrmTask, renderedAt: string) {
  return task.status === "completed"
    ? "text-nurture"
    : task.status === "archived"
      ? "text-subtle"
      : new Date(task.dueAt) < new Date(renderedAt)
        ? "text-hot"
        : "text-accent";
}

export function ActivityWorkspace({
  tasks,
  contacts,
  googleCalendarConnectionId,
  renderedAt,
  timeZone,
}: {
  tasks: readonly CrmTask[];
  contacts: readonly Contact[];
  googleCalendarConnectionId?: string;
  renderedAt: string;
  timeZone: string;
}) {
  const [createState, createAction] = useActionState(
    createTaskAction,
    INITIAL_WORK_QUEUE_ACTION_STATE,
  );
  const [transitionState, transitionAction] = useActionState(
    transitionTasksAction,
    INITIAL_WORK_QUEUE_ACTION_STATE,
  );
  const taskKeySeed = useId().replace(/[^A-Za-z0-9_-]/g, "") || "task";
  const [taskKeySequence, setTaskKeySequence] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const selectedCount = selected.length;
  const selectedHasArchived = tasks.some(
    (task) => task.status === "archived" && selected.includes(task.id),
  );
  useEffect(() => {
    if (createState.status === "success" || createState.status === "noop") {
      setTaskKeySequence((value) => value + 1);
    }
  }, [createState.status, createState.message]);
  return (
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-ink">Tasks</h2>
          {selectedCount ? (
            <span className="rounded-full bg-accent-soft px-3 py-1 text-sm text-ink">
              {selectedCount} selected
            </span>
          ) : null}
        </div>
        <form action={transitionAction}>
          {googleCalendarConnectionId ? <input type="hidden" name="googleConnectionId" value={googleCalendarConnectionId} /> : null}
          <div className="sk-group overflow-hidden">
            <div className="activity-task-toolbar flex min-h-14 items-center justify-between gap-3 border-b border-line bg-surface-2 px-2 pr-4">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--sk-control-radius)] px-1 pr-3 text-sm font-medium text-ink">
                <span className="activity-checkbox-target">
                  <input
                    aria-label="Select all visible tasks"
                    type="checkbox"
                    checked={tasks.length > 0 && selectedCount === tasks.length}
                    onChange={(event) =>
                      setSelected(event.target.checked ? tasks.map((task) => task.id) : [])
                    }
                  />
                </span>
                Select all visible
              </label>
              <span className="text-xs text-muted">{tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
            </div>
            <table className="activity-task-table w-full border-collapse text-left">
              <caption className="sr-only">
                Tasks in the selected work queue
              </caption>
              <thead className="activity-task-head bg-surface-2 text-xs text-muted">
                <tr>
                  <th scope="col" className="w-12 p-2"><span className="sr-only">Selection</span></th>
                  <th scope="col" className="p-4">
                    Task
                  </th>
                  <th scope="col" className="p-4">
                    Due
                  </th>
                  <th scope="col" className="p-4">
                    State
                  </th>
                  <th scope="col" className="p-4">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="activity-task-row border-t border-line bg-surface">
                    <td className="activity-selection-cell p-2">
                      <label className="activity-checkbox-target">
                        <input
                          type="checkbox"
                          name="taskIds"
                          value={task.id}
                          checked={selected.includes(task.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, task.id]
                                : current.filter((id) => id !== task.id),
                            )
                          }
                          aria-label={`Select ${task.title}`}
                        />
                      </label>
                    </td>
                    <td className="activity-task-copy min-w-0 p-4">
                      <p className="break-words font-medium text-ink">{task.title}</p>
                      {task.description ? (
                        <p className="mt-1 max-w-xl break-words text-sm text-muted">
                          {task.description}
                        </p>
                      ) : null}
                    </td>
                    <td className={`activity-task-due p-4 text-sm ${taskTone(task, renderedAt)}`}>
                      <span className="activity-mobile-label" aria-hidden="true">Due</span>
                      <time dateTime={task.dueAt}>
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone,
                        }).format(new Date(task.dueAt))}
                      </time>
                    </td>
                    <td className="activity-task-state p-4 text-sm text-muted">
                      <span className="activity-mobile-label" aria-hidden="true">State</span>
                      {task.status}
                    </td>
                    <td className="activity-task-actions p-4">
                      {task.status === "archived" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-subtle">Read only</span>
                          {googleCalendarConnectionId ? (
                            <button
                              type="submit"
                              form={googleTaskFormId(task.id)}
                              className="sk-icon-button"
                              aria-label={`Prepare removal of ${task.title} from Google Calendar for approval`}
                            >
                              <CalendarPlus className="size-4" />
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="submit"
                            name="rowIntent"
                            value={`${task.status === "completed" ? "reopen" : "complete"}:${task.id}`}
                            className="sk-icon-button"
                            aria-label={
                              task.status === "completed"
                                ? `Reopen ${task.title}`
                                : `Complete ${task.title}`
                            }
                          >
                            {task.status === "completed" ? (
                              <RotateCcw className="size-4" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </button>
                          {googleCalendarConnectionId ? (
                            <button
                              type="submit"
                              form={googleTaskFormId(task.id)}
                              className="sk-icon-button"
                              aria-label={`Prepare ${task.status === "completed" ? "completion of" : ""} ${task.title} for Google Calendar approval`}
                            >
                              <CalendarPlus className="size-4" />
                            </button>
                          ) : null}
                          <button
                            type="submit"
                            name="rowIntent"
                            value={`archive:${task.id}`}
                            className="sk-icon-button"
                            aria-label={`Archive ${task.title}`}
                            onClick={(event) => {
                              if (
                                !window.confirm(
                                  `Archive ${task.title}? You can no longer complete archived tasks.`,
                                )
                              )
                                event.preventDefault();
                            }}
                          >
                            <Archive className="size-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tasks.length === 0 ? (
            <div className="sk-group bg-surface px-6 py-12 text-center">
              <Circle className="mx-auto size-6 text-accent" aria-hidden />
              <p className="mt-3 text-sm text-muted">
                No tasks match this queue. Add a follow-up when the next step is
                clear.
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              name="intent"
              value="complete"
              disabled={!selectedCount || selectedHasArchived}
              className="sk-primary-button"
              onClick={(event) => {
                if (
                  !window.confirm(
                    `Complete ${selectedCount} selected task${selectedCount === 1 ? "" : "s"}?`,
                  )
                )
                  event.preventDefault();
              }}
            >
              <Check className="size-4" /> Complete selected
            </button>
            <button
              type="submit"
              name="intent"
              value="archive"
              disabled={!selectedCount}
              className="sk-text-action"
              onClick={(event) => {
                if (
                  !window.confirm(
                    `Archive ${selectedCount} selected task${selectedCount === 1 ? "" : "s"}? You can no longer complete archived tasks.`,
                  )
                )
                  event.preventDefault();
              }}
            >
              <Archive className="size-4" /> Archive selected
            </button>
          </div>
        </form>
        {googleCalendarConnectionId
          ? tasks.map((task) => (
              <form
                key={task.id}
                id={googleTaskFormId(task.id)}
                action={prepareTaskForGoogleCalendarAction}
                className="hidden"
              >
                <input type="hidden" name="googleConnectionId" value={googleCalendarConnectionId} />
                <input type="hidden" name="googleTaskId" value={task.id} />
              </form>
            ))
          : null}
        <State {...transitionState} />
      </section>
      <aside className="sk-group h-fit bg-surface p-4 sm:p-5">
        <h2 className="font-display text-2xl text-ink">Add follow-up</h2>
        <form action={createAction} className="mt-4 grid gap-3">
          <input
            type="hidden"
            name="idempotencyKey"
            value={`task:${taskKeySeed}:${taskKeySequence}`}
          />
          <label className="sk-field">
            <span className="sk-label">Task</span>
            <input
              required
              name="title"
              maxLength={160}
              className="sk-input"
              placeholder="Send listing options"
            />
          </label>
          <label className="sk-field">
            <span className="sk-label">Due</span>
            <input
              required
              name="dueAt"
              type="datetime-local"
              className="sk-input"
            />
          </label>
          <label className="sk-field">
            <span className="sk-label">Contact (optional)</span>
            <select name="contactId" className="sk-input">
              <option value="">Not linked to a contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="sk-field">
            <span className="sk-label">Context (optional)</span>
            <textarea
              name="description"
              maxLength={2000}
              rows={3}
              className="sk-input resize-y"
            />
          </label>
          <Submit>
            <Plus className="size-4" /> Add task
          </Submit>
        </form>
        <State {...createState} />
      </aside>
    </div>
  );
}
