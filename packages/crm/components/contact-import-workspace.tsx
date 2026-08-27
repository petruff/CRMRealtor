"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import {
  commitImportAction,
  applyExistingImportOrganizationAction,
  rollbackExistingImportOrganizationAction,
  previewExistingImportOrganizationAction,
  previewImportAction,
  saveImportMappingProfileAction,
  listImportMappingProfilesAction,
  type ImportActionInput,
} from "@/app/import-actions";
import type {
  ContactImportPreview,
  ContactImportResult,
  ImportRowAction,
} from "@/lib/application/contact-import-service";
import type { ImportedContactOrganizationResult } from "@/lib/application/imported-contact-organization";
import { CONTACT_IMPORT_MAPPING_TARGETS, type ContactImportMappingTarget, type ImportSource } from "@/lib/application/contact-import";

const SOURCES: Array<{ value: ImportSource; label: string }> = [
  { value: "auto", label: "Detect automatically" },
  { value: "spreadsheet", label: "Spreadsheet / CSV" },
  { value: "mailchimp", label: "Mailchimp export" },
  { value: "google", label: "Google Contacts" },
  { value: "apple", label: "Apple Contacts (vCard)" },
  { value: "boldtrail", label: "BoldTrail / kvCORE export" },
];

const CSV_VCARD_MAX_BYTES = 2_000_000;
const WORKBOOK_MAX_BYTES = 10_485_760;

const ACTION_LABEL: Record<ImportRowAction, string> = {
  create: "New",
  update: "Fill gaps",
  unchanged: "Already current",
  merge: "Duplicate row",
  "archived-match": "Archived match",
  "ambiguous-identity": "Needs identity review",
};

const LEAD_TYPE_SUMMARY = [
  { value: 'hot', label: 'Hot', className: 'border-hot-border bg-hot-soft text-hot' },
  { value: 'warm', label: 'Warm', className: 'border-warm-border bg-warm-soft text-warm' },
  { value: 'nurture', label: 'Nurture', className: 'border-line bg-surface-2 text-muted' },
] as const;

const PIPELINE_SUMMARY = [
  { value: 'new', label: 'New / Prospect' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'appointment-set', label: 'Appointment set' },
  { value: 'active', label: 'Active' },
  { value: 'under-contract', label: 'Under contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'lost', label: 'Archived / Lost' },
] as const;

function actionLabel(row: ContactImportPreview["rows"][number]) {
  if (row.action === "unchanged" && row.matchBy) return "Client already exists";
  if (row.action === "merge") return "Duplicate row — not imported";
  return ACTION_LABEL[row.action];
}

function personName(firstName: string, lastName: string) {
  return [firstName, lastName].filter(Boolean).join(" ") || "Unnamed";
}

function titleCase(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The workbook could not be read.'));
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.readAsDataURL(file);
  });
}

export function ContactImportWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>("auto");
  const [input, setInput] = useState<ImportActionInput>();
  const [preview, setPreview] = useState<ContactImportPreview>();
  const [isLive, setIsLive] = useState(false);
  const [result, setResult] = useState<ContactImportResult>();
  const [message, setMessage] = useState("");
  const [mapping, setMapping] = useState<Record<string, ContactImportMappingTarget | "ignore">>({});
  const [profileName,setProfileName]=useState("");
  const [profiles,setProfiles]=useState<Array<{id:string;name:string;version:number;mapping:Record<string,ContactImportMappingTarget|"ignore">}>>([]);
  const [dragActive, setDragActive] = useState(false);
  const [organizationAudit, setOrganizationAudit] = useState<ImportedContactOrganizationResult>();
  const [organizationResult, setOrganizationResult] = useState<ImportedContactOrganizationResult>();
  const [organizationMessage, setOrganizationMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void Promise.all([
      listImportMappingProfilesAction(),
      previewExistingImportOrganizationAction(),
    ]).then(([profileResponse, organizationResponse]) => {
      if (!active) return;
      if (profileResponse.ok) setProfiles(profileResponse.profiles);
      if (organizationResponse.ok) setOrganizationAudit(organizationResponse.result);
    });
    return () => { active = false; };
  }, []);

  async function chooseFile(file?: File) {
    if (!file) return;
    setMessage("");
    setResult(undefined);
    setPreview(undefined);
    const binary = /\.(?:xlsx?|numbers)$/i.test(file.name);
    const byteLimit = binary ? WORKBOOK_MAX_BYTES : CSV_VCARD_MAX_BYTES;
    if (file.size > byteLimit) {
      setMessage(binary
        ? 'This workbook is larger than the 10 MB safe upload limit. Split it into smaller files and import each one.'
        : 'This CSV or vCard is larger than the 2 MB safe upload limit. Split it into smaller files and import each one.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    let nextInput: ImportActionInput;
    try {
      nextInput = {
        filename: file.name,
        source,
        mapping,
        ...(binary ? { contentBase64: await fileBase64(file) } : { content: await file.text() }),
      };
    } catch {
      setMessage('The selected file could not be read. Choose the original export again or save it as CSV, XLSX, or Numbers.');
      return;
    }
    setInput(nextInput);
    startTransition(async () => {
      const response = await previewImportAction(nextInput);
      if (!response.ok) return setMessage(response.message);
      setPreview(response.preview);
      setIsLive(response.isLive);
    });
  }

  function dropFile(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragActive(false);
    void chooseFile(event.dataTransfer.files[0]);
  }

  function refreshSource(nextSource: ImportSource) {
    setSource(nextSource);
    if (!input) return;
    const nextInput = { ...input, source: nextSource };
    setInput(nextInput);
    setPreview(undefined);
    setMessage("");
    startTransition(async () => {
      const response = await previewImportAction(nextInput);
      if (!response.ok) return setMessage(response.message);
      setPreview(response.preview);
      setIsLive(response.isLive);
    });
  }

  function remap(header: string, target: ContactImportMappingTarget | "ignore") {
    if (!input) return;
    const nextMapping={...mapping,[header]:target}; setMapping(nextMapping);
    const nextInput={...input,mapping:nextMapping};setInput(nextInput);setPreview(undefined);setMessage("");
    startTransition(async()=>{const response=await previewImportAction(nextInput);if(!response.ok)return setMessage(response.message);setPreview(response.preview);setIsLive(response.isLive);});
  }

  function save() {
    if (!input) return;
    setMessage("");
    startTransition(async () => {
      const response = await commitImportAction(input);
      if (!response.ok) return setMessage(response.message);
      setResult(response.result);
    });
  }

  function organizeExistingImports() {
    setOrganizationMessage("");
    startTransition(async () => {
      const response = await applyExistingImportOrganizationAction();
      if (!("result" in response)) {
        setOrganizationMessage(response.message ?? "Existing imports could not be organized.");
        return;
      }
      setOrganizationResult(response.result);
      const refreshed = await previewExistingImportOrganizationAction();
      if (refreshed.ok) setOrganizationAudit(refreshed.result);
      if (!response.ok) setOrganizationMessage(response.message ?? "Some contacts could not be organized.");
    });
  }

  function rollbackExistingImports() {
    if (!organizationResult?.runId) return;
    setOrganizationMessage('');
    startTransition(async () => {
      const response = await rollbackExistingImportOrganizationAction(organizationResult.runId!);
      if (!response.ok) return setOrganizationMessage(response.message);
      setOrganizationResult(undefined);
      setOrganizationMessage(`${response.receipt.contactCount} contacts were restored to their previous values.`);
      const refreshed = await previewExistingImportOrganizationAction();
      if (refreshed.ok) setOrganizationAudit(refreshed.result);
    });
  }

  function clearPreview() {
    setInput(undefined);
    setPreview(undefined);
    setResult(undefined);
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }

  if (result) {
    const complete = result.ok && result.incomplete === 0 && result.failed === 0;
    return (
      <section className="sk-group bg-surface p-6 sm:p-8" aria-live="polite">
        <span
          className={`grid size-12 place-items-center rounded-full ${complete ? "bg-nurture-soft text-nurture" : "bg-warm-soft text-warm"}`}
        >
          {complete ? (
            <Check className="size-6" />
          ) : (
            <AlertTriangle className="size-6" />
          )}
        </span>
        <h2 className="mt-5 text-2xl">
          {result.receiptState === 'recovered'
            ? 'Import record recovered.'
            : complete ? "Import complete." : "Import finished with issues."}
        </h2>
        {result.receiptState === 'recovered' ? (
          <p className="mt-2 max-w-2xl rounded-2xl border border-nurture-border bg-nurture-soft px-4 py-3 text-sm leading-relaxed text-nurture">
            Omnix recognized the exact file, kept every existing contact unchanged, and rebuilt the missing audit record from the original row receipts.
          </p>
        ) : result.receiptState === 'recorded' ? (
          <p className="mt-2 max-w-2xl rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
            This exact file was already imported. No contacts, notes, or activities were added again.
          </p>
        ) : null}
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {result.created} created · {result.updated} enriched · {result.merged}{" "}
          duplicate rows merged · {result.notesAdded} notes added ·{" "}
          {result.unchanged} already current.
        </p>
        {result.qualificationReview > 0 && (
          <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-ink">
            <p className="font-medium">
              {result.qualificationReview} imported contacts need qualification review.
            </p>
            <Link
              href="/contacts?scope=needs-review"
              className="mt-2 inline-flex font-semibold text-accent underline underline-offset-4"
            >
              Review qualification
            </Link>
          </div>
        )}
        {(result.incomplete > 0 || result.failed > 0) && (
          <div className="mt-4 rounded-2xl border border-warm-border bg-warm-soft p-4 text-sm text-warm">
            <p className="font-medium">
              {result.incomplete} incomplete ({result.quarantined} safely quarantined) · {result.failed} failed.
              {' '}All other contacts have terminal import receipts.
            </p>
            {result.quarantined > 0 && (
              <Link
                href="/contacts/incomplete"
                className="mt-2 inline-flex font-semibold underline underline-offset-4"
              >
                Review quarantined records
              </Link>
            )}
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs leading-relaxed">
                {result.errors.slice(0, 50).map((error) => (
                  <li key={`${error.rowNumber}-${error.message}`}>
                    Row {error.rowNumber}: {error.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/contacts?scope=all" className="sk-primary-button">View all contacts</Link>
          {result.qualificationReview > 0 ? (
            <Link href="/contacts?scope=needs-review" className="sk-secondary-button">Review qualification</Link>
          ) : null}
          {result.quarantined > 0 ? (
            <Link href="/contacts/incomplete" className="sk-secondary-button">Review quarantined records</Link>
          ) : null}
          {result.rejected > 0 ? (
            <button type="button" className="sk-secondary-button" onClick={clearPreview}>Fix and re-import</button>
          ) : null}
          {result.failed > 0 ? (
            <button type="button" className="sk-secondary-button" disabled={pending} onClick={save}>Retry failed rows</button>
          ) : null}
          <Link href="/pipeline" className="sk-secondary-button">Open pipeline</Link>
          <Link href="/data#import-history" className="sk-secondary-button">View import history</Link>
          <button
            type="button"
            className="sk-text-action min-h-11 px-3"
            onClick={() => {
              setInput(undefined);
              setPreview(undefined);
              setResult(undefined);
            }}
          >
            Import another file
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {organizationAudit && organizationAudit.withImportProfile > 0 && (
        <section className="sk-group relative overflow-hidden bg-surface p-5 sm:p-7" aria-labelledby="automatic-organization-heading">
          <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-accent-soft blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-3xl items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="eyebrow">Automatic organization</p>
                <h2 id="automatic-organization-heading" className="mt-1 text-xl">
                  {organizationAudit.wouldUpdate > 0
                    ? `${organizationAudit.wouldUpdate} imported contacts are ready to organize.`
                    : "Your existing imports are organized."}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Omnix uses the original status, rating, deal history, and tags to set the relationship,
                  pipeline, Hot/Warm/Nurture priority, and next follow-up. Contacts already edited by a person stay untouched.
                </p>
                {organizationAudit.wouldUpdate > 0 && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-ink">
                    <span>{organizationAudit.leadTypes.hot} Hot</span>
                    <span>{organizationAudit.leadTypes.warm} Warm</span>
                    <span>{organizationAudit.leadTypes.nurture} Nurture</span>
                    <span>{organizationAudit.needsReview} safely queued for review</span>
                    <span>{organizationAudit.skippedProtected} protected</span>
                  </div>
                )}
                {organizationResult && (
                  <div className="mt-3 flex flex-wrap items-center gap-3" role="status">
                    <p className="text-sm font-medium text-nurture">
                      {organizationResult.updated} contacts organized automatically. {organizationResult.skippedProtected} protected records were left unchanged.
                    </p>
                    {organizationResult.rollbackAvailable && organizationResult.runId ? (
                      <button type="button" className="sk-secondary-button text-xs" disabled={pending} onClick={rollbackExistingImports}>
                        Restore previous values
                      </button>
                    ) : null}
                  </div>
                )}
                {organizationMessage && (
                  <p className="mt-3 text-sm text-hot" role="alert">{organizationMessage}</p>
                )}
              </div>
            </div>
            {organizationAudit.wouldUpdate > 0 && (
              <button
                type="button"
                className="sk-primary-button relative shrink-0"
                disabled={pending}
                onClick={organizeExistingImports}
              >
                {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Organize existing imports
              </button>
            )}
          </div>
        </section>
      )}

      <section className="sk-group bg-surface p-5 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <label className="sk-field self-start">
            <span className="sk-label">Where is this file from?</span>
            <select
              className="sk-input"
              value={source}
              onChange={(event) =>
                refreshSource(event.target.value as ImportSource)
              }
            >
              {SOURCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="sk-help">
              Auto-detect works for most exports. Choosing a source makes
              matching more explicit.
            </span>
          </label>

          <button
            type="button"
            className={`group min-h-44 rounded-[1.25rem] border border-dashed p-6 text-center transition-colors hover:border-accent hover:bg-accent-soft ${dragActive ? "border-accent bg-accent-soft" : "border-line bg-surface-2"}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={dropFile}
          >
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface text-accent">
              {pending ? (
                <LoaderCircle className="size-5 animate-spin" />
              ) : (
                <Upload className="size-5" />
              )}
            </span>
            <span className="mt-4 block font-medium text-ink">
              {input?.filename ??
                (dragActive ? "Drop it here" : "Drop or choose CSV, vCard, XLS, XLSX, or Numbers")}
            </span>
            <span className="mt-1 block text-xs text-muted">
              CSV/vCard up to 2 MB; XLS, XLSX, and Numbers workbooks up to 10 MB. Row count is not capped; safe cell, column, and processing limits still apply. Nothing is saved before review.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            aria-label="Choose a contact import file"
            accept=".csv,.vcf,.xls,.xlsx,.numbers,text/csv,text/vcard,text/x-vcard,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers"
            className="sr-only"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
        </div>
      </section>

      {!input && <div className="flex flex-wrap gap-3 text-sm">
        <a className="sk-secondary-button" href="/api/data/templates/contacts?format=csv">Download CSV template</a>
        <a className="sk-secondary-button" href="/api/data/templates/contacts?format=xlsx">Download XLSX template</a>
      </div>}

      {message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-hot-border bg-hot-soft p-4 text-sm text-hot"
        >
          <XCircle className="mt-0.5 size-4 shrink-0" /> {message}
        </div>
      )}

      {preview && (
        <section aria-labelledby="preview-heading" className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Preview · {preview.provider}</p>
              <h2 id="preview-heading" className="mt-1 text-2xl">
                Review every change before saving.
              </h2>
              <p className="mt-2 text-sm text-muted">
                {preview.counts.create} new · {preview.counts.update} enriched ·{" "}
                {preview.counts.merge} duplicate rows ·{" "}
                {preview.counts.unchanged} Already current · {preview.counts.rejected}{" "}
                rejected · {preview.counts["archived-match"]} archived matches ·{" "}
                {preview.counts["ambiguous-identity"]} identity conflicts ·{" "}
                {preview.counts.protected} manual stages protected
              </p>
              <p className="mt-2 text-sm font-medium text-ink">
                {preview.classificationCounts.automatic} organized automatically ·{" "}
                {preview.classificationCounts.explicit} already classified ·{" "}
                {preview.classificationCounts.needsReview} safely queued for review
              </p>
              <div className="mt-4 flex flex-wrap gap-2" aria-label="Final contact organization">
                {LEAD_TYPE_SUMMARY.map((item) => (
                  <span key={item.value} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${item.className}`}>
                    {preview.rows.filter((row) => row.candidate.leadType === item.value).length} {item.label}
                  </span>
                ))}
                {PIPELINE_SUMMARY.map((item) => {
                  const count = preview.rows.filter((row) => row.candidate.pipelineStage === item.value).length;
                  return count > 0 ? (
                    <span key={item.value} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted">
                      {count} {item.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="sk-text-action px-3"
                disabled={pending}
                onClick={clearPreview}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sk-primary-button shrink-0"
                disabled={pending || !isLive || preview.rows.length === 0}
                onClick={save}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Confirm import
              </button>
            </div>
          </div>

          {!isLive && (
            <p className="rounded-2xl bg-warm-soft px-4 py-3 text-sm text-warm">
              Demo mode: the complete preview works, but saving is locked until
              Supabase is connected and you are signed in.
            </p>
          )}

          {preview.unknownFields.length > 0 && (
            <p className="text-xs leading-relaxed text-muted">
              Ignored columns: {preview.unknownFields.join(", ")}.
            </p>
          )}
          {preview.preservedFields.length > 0 && (
            <p className="mt-3 rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm text-ink">
              All {preview.preservedFields.length} source columns are accounted for. Core fields populate Omnix and original values remain in the contact&apos;s Imported profile.
            </p>
          )}

          <details className="sk-group bg-surface p-5">
            <summary className="cursor-pointer font-medium text-ink">Edit column mapping</summary>
            <p className="mt-2 text-xs text-muted">Choose the matching Omnix field or ignore a source column. The preview updates immediately and nothing is saved until you confirm.</p>
            {preview.headers.some((header) => /^(status|rating)$/i.test(header.trim())) ? (
              <p className="mt-3 rounded-xl border border-warm-border bg-warm-soft p-3 text-xs leading-relaxed text-warm">
                KvCore Status and Rating remain in the imported profile. Omnix uses them to classify each contact automatically, as shown in the preview below.
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{preview.headers.map((header)=><label key={header} className="sk-field"><span className="sk-label">{header}</span><select className="sk-input" value={mapping[header]??""} onChange={(event)=>remap(header,event.target.value as ContactImportMappingTarget|"ignore")}><option value="">Auto-map</option><option value="ignore">Ignore</option>{CONTACT_IMPORT_MAPPING_TARGETS.map((target)=><option key={target} value={target}>{target}</option>)}</select></label>)}</div>
            {profiles.length?<label className="sk-field mt-4"><span className="sk-label">Reuse a saved mapping</span><select className="sk-input" defaultValue="" onChange={(event)=>{const profile=profiles.find((item)=>item.id===event.target.value);if(!profile||!input)return;setMapping(profile.mapping);const nextInput={...input,mapping:profile.mapping};setInput(nextInput);startTransition(async()=>{const response=await previewImportAction(nextInput);if(response.ok)setPreview(response.preview);else setMessage(response.message);});}}><option value="">Choose a profile</option>{profiles.map((profile)=><option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>)}</select></label>:null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input className="sk-input" value={profileName} onChange={(event)=>setProfileName(event.target.value)} placeholder="Profile name" maxLength={120}/><button type="button" className="sk-secondary-button" disabled={!isLive||pending||!profileName.trim()} onClick={()=>startTransition(async()=>{const response=await saveImportMappingProfileAction({name:profileName,mapping});setMessage(response.ok?`Saved ${response.profile.name} v${response.profile.version}.`:response.message);if(response.ok){const listed=await listImportMappingProfilesAction();if(listed.ok)setProfiles(listed.profiles);}})}>Save mapping profile</button></div>
          </details>

          <div className="sk-group overflow-x-auto bg-surface">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Row</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Identity</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Fields</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row) => (
                  <tr
                    key={row.rowNumber}
                    className="border-t border-line align-top"
                  >
                    <td className="tabular px-4 py-3 text-muted">
                      {row.rowNumber}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {personName(
                        row.candidate.firstName,
                        row.candidate.lastName,
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.matchBy ?? "No match"}
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {actionLabel(row)}
                      {row.protectedFields?.includes("pipelineStage") ? (
                        <span className="mt-1 block text-xs font-medium text-warm">
                          Manual pipeline stage kept
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-72 px-4 py-3 text-muted">
                      <span className="font-medium text-ink">
                        {titleCase(row.candidate.leadType ?? "nurture")} · {titleCase(row.candidate.pipelineStage ?? "new")}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed">
                        {row.classification.summary}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.changes.join(", ") || (row.protectedFields?.length ? "No automatic overwrite" : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 100 && (
            <p className="text-xs text-muted">
              Showing the first 100 of {preview.rows.length} valid rows.
            </p>
          )}
          {preview.rejected.length > 0 && (
            <details className="sk-form-section">
              <summary>{preview.rejected.length} rejected rows</summary>
              <ul className="space-y-2 border-t border-line p-4 text-sm text-hot">
                {preview.rejected.slice(0, 50).map((row) => (
                  <li key={row.rowNumber}>
                    Row {row.rowNumber}: {row.errors.join(" ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {!preview && !pending && !message && (
        <div className="grid gap-px overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-line md:grid-cols-3">
          {[
            ["1", "Choose", "Export contacts from your current platform."],
            ["2", "Review", "See new, matched, duplicate, and rejected rows."],
            [
              "3",
              "Confirm",
              "Save safely and start the right follow-up cadence.",
            ],
          ].map(([number, title, copy]) => (
            <div key={number} className="bg-surface p-5">
              <span className="text-xs font-semibold text-accent">
                {number}
              </span>
              <h2 className="mt-2 text-lg">{title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">{copy}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
