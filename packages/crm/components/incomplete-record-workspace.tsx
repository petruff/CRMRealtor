"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Archive, CheckCircle2, Mail, Phone, RefreshCcw, ShieldCheck, UserRound } from "lucide-react";
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

function inferredPhone(email?: string): string | undefined {
  const match = /^(\d{10})@kvleads\.com$/i.exec(email ?? "");
  if (!match?.[1]) return undefined;
  const digits = match[1];
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function contactLabel(record: IncompleteRecord): string {
  const candidate = record.candidate;
  const name = [candidate.preferredName ?? candidate.firstName, candidate.lastName]
    .filter(Boolean)
    .join(" ");
  if (name) return name;
  const phone = candidate.phone ?? inferredPhone(candidate.email);
  if (phone) return `New lead · ${phone}`;
  return candidate.email ?? "New contact needs a name";
}

function sourceLabel(source: string): string {
  if (source === "mailchimp-live") return "Mailchimp audience";
  if (source === "meta-live") return "Facebook or Instagram";
  return source.replaceAll("-", " ");
}

function friendlyReason(record: IncompleteRecord, message: string): string {
  if (record.source === "mailchimp-live" && /no canonical CRM contact/i.test(message)) {
    return "This person is in Mailchimp but is not yet matched to an Omnix contact.";
  }
  return message;
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
          New contacts that need information will appear here with the details
          available for review.
        </p>
      </div>
    );

  const previewReady = records.filter((record) => previews[record.id]).length;
  const needsName = records.filter((record) => (
    !record.candidate.preferredName
    && !record.candidate.firstName
    && !record.candidate.lastName
  )).length;

  return (
    <div className="space-y-5">
      <State {...convertState} />
      <State {...statusState} />
      <section className="overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-surface">
        <div className="grid gap-px bg-line sm:grid-cols-3">
          {[
            ["Needs review", records.length],
            ["Ready to add", previewReady],
            ["Missing a name", needsName],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-surface px-5 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</p>
              <p className="mt-1 font-display text-3xl text-ink">{value}</p>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">
          Omnix keeps unmatched provider records here so no lead is lost. Open only the contact you want to review; existing CRM contacts remain unchanged.
        </p>
      </section>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      {records.map((record) => {
        const preview = previews[record.id];
        const candidate = record.candidate;
        const detectedPhone = candidate.phone ?? inferredPhone(candidate.email);
        return (
          <article key={record.id} className="sk-group min-w-0 bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-display text-xl text-ink">
                  {contactLabel(record)}
                </h2>
                <p className="mt-1 text-xs font-medium text-muted">
                  {sourceLabel(record.source)} · {record.status === "pending" ? "Needs review" : record.status}
                </p>
              </div>
              <span className="rounded-full border border-warm-border bg-warm-soft px-2.5 py-1 text-xs font-medium text-warm">
                {preview ? "Ready to add" : "Information needed"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {candidate.email ? (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs text-muted">
                  <Mail className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{candidate.email}</span>
                </span>
              ) : null}
              {detectedPhone ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs text-muted">
                  <Phone className="size-3.5" aria-hidden />{detectedPhone}
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <UserRound className="size-4 text-warm" aria-hidden />What Omnix needs
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {record.reasons.map((reason) => (
                    <li key={`${reason.field}-${reason.code}`}>
                      {friendlyReason(record, reason.message)}
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
                    : "Add the missing name below to preview and create this contact safely."}
                </p>
                {preview?.changes.length ? (
                  <p className="mt-1 text-xs text-muted">
                    Fields: {preview.changes.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
            {record.status === "pending" || (metaEventId && record.status === "converted") ? (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
                  <span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4 text-nurture" aria-hidden />Review and add to CRM</span>
                </summary>
              <form
                action={convertAction}
                className="mt-4"
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
                      defaultValue={detectedPhone}
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
              </details>
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
    </div>
  );
}
