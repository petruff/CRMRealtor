"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Archive, CheckCircle2, RefreshCcw, ShieldCheck } from "lucide-react";
import type {
  IncompleteContactConversionPlan,
  IncompleteRecord,
} from "@/lib/domain/incomplete-record";
import { INITIAL_WORK_QUEUE_ACTION_STATE } from "@/app/contacts/action-state";
import {
  convertIncompleteAction,
  setIncompleteStatusAction,
} from "@/app/contacts/incomplete/actions";

function Submit({
  children,
  className = "sk-primary-button",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
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

export function IncompleteRecordWorkspace({
  records,
  previews,
  metaEventId,
}: {
  records: readonly IncompleteRecord[];
  previews: Readonly<
    Record<string, IncompleteContactConversionPlan | undefined>
  >;
  metaEventId?: string;
}) {
  const [convertState, convertAction] = useActionState(
    convertIncompleteAction,
    INITIAL_WORK_QUEUE_ACTION_STATE,
  );
  const [statusState, statusAction] = useActionState(
    setIncompleteStatusAction,
    INITIAL_WORK_QUEUE_ACTION_STATE,
  );
  if (!records.length)
    return (
      <div className="sk-group bg-surface px-6 py-14 text-center">
        <ShieldCheck className="mx-auto size-7 text-nurture" aria-hidden />
        <h2 className="mt-4 font-display text-2xl text-ink">
          Nothing needs review
        </h2>
        <p className="mt-2 text-sm text-muted">
          New incomplete intake records will appear here with only their safe,
          allowlisted details.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <State {...convertState} />
      <State {...statusState} />
      {records.map((record) => {
        const preview = previews[record.id];
        const candidate = record.candidate;
        return (
          <article key={record.id} className="sk-group bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-ink">
                  {[
                    candidate.preferredName ?? candidate.firstName,
                    candidate.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ") || "Unnamed intake"}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Source: {record.source} · {record.status}
                </p>
              </div>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                {record.reasons.length} validation note
                {record.reasons.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  Why it paused
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {record.reasons.map((reason) => (
                    <li key={`${reason.field}-${reason.code}`}>
                      {reason.message}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <h3 className="text-sm font-semibold text-ink">
                  Conversion preview
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {preview
                    ? `${preview.action === "create" ? "Create a new contact" : preview.action === "update" ? "Update the conservative match" : "No changes to the existing match"}${preview.matchedBy ? ` · matched by ${preview.matchedBy}` : ""}.`
                    : "Preview is unavailable until this record can be reviewed."}
                </p>
                {preview?.changes.length ? (
                  <p className="mt-1 text-xs text-muted">
                    Fields: {preview.changes.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
            {record.status === "pending" || (metaEventId && record.status === "converted") ? (
              <form
                action={convertAction}
                className="mt-5 border-t border-line pt-4"
              >
                <input type="hidden" name="id" value={record.id} />
                {metaEventId ? (
                  <input type="hidden" name="metaEventId" value={metaEventId} />
                ) : null}
                <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <legend className="mb-2 text-sm font-medium text-ink">
                    Correct safe fields before conversion
                  </legend>
                  <label className="sk-field">
                    <span className="sk-label">First name</span>
                    <input
                      name="firstName"
                      defaultValue={candidate.firstName}
                      className="sk-input"
                    />
                  </label>
                  <label className="sk-field">
                    <span className="sk-label">Last name</span>
                    <input
                      name="lastName"
                      defaultValue={candidate.lastName}
                      className="sk-input"
                    />
                  </label>
                  <label className="sk-field">
                    <span className="sk-label">Phone</span>
                    <input
                      name="phone"
                      inputMode="tel"
                      defaultValue={candidate.phone}
                      className="sk-input"
                    />
                  </label>
                  <label className="sk-field">
                    <span className="sk-label">Email</span>
                    <input
                      name="email"
                      type="email"
                      defaultValue={candidate.email}
                      className="sk-input"
                    />
                  </label>
                </fieldset>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Submit>
                    <CheckCircle2 className="size-4" aria-hidden />
                    {record.status === "converted"
                      ? "Complete Meta link"
                      : metaEventId
                        ? "Convert and link"
                        : "Convert once"}
                  </Submit>
                  <p className="text-xs text-muted">
                    {metaEventId
                      ? "Conversion and Meta source linking are workspace-scoped and replay-safe."
                      : "Conversion is workspace-scoped and replay-safe."}
                  </p>
                </div>
              </form>
            ) : (
              <form action={statusAction} className="mt-5 flex justify-end">
                <input type="hidden" name="id" value={record.id} />
                <input type="hidden" name="intent" value="restore" />
                <Submit className="sk-text-action">
                  <RefreshCcw className="size-4" aria-hidden /> Restore to
                  review
                </Submit>
              </form>
            )}
            {record.status === "pending" ? (
              <form action={statusAction} className="mt-3">
                <input type="hidden" name="id" value={record.id} />
                <input type="hidden" name="intent" value="archive" />
                <input
                  type="hidden"
                  name="reason"
                  value="Reviewed and deferred"
                />
                <Submit className="sk-text-action">
                  <Archive className="size-4" aria-hidden /> Archive instead
                </Submit>
              </form>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
