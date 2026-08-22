import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Search } from "lucide-react";
import {
  listIncompleteRecordsCommand,
  previewIncompleteRecordInboxCommand,
} from "@/lib/application/incomplete-record-commands";
import { getRepository } from "@/lib/data";
import { IncompleteRecordWorkspace } from "@/components/incomplete-record-workspace";
import type { IncompleteRecordStatus } from "@/lib/domain/incomplete-record";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incomplete contacts" };

export default async function IncompleteContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; metaEventId?: string }>;
}) {
  const params = await searchParams;
  const status: IncompleteRecordStatus | "all" = [
    "pending",
    "converted",
    "archived",
    "all",
  ].includes(params.status ?? "")
    ? (params.status as IncompleteRecordStatus | "all")
    : params.metaEventId
      ? "all"
      : "pending";
  const { incompleteRecordRepository, workspaceScope } = await getRepository();
  const linkedRecord = params.metaEventId && params.q
    ? await incompleteRecordRepository.get(workspaceScope, params.q)
    : undefined;
  const records = params.metaEventId && params.q
    ? linkedRecord
      ? [linkedRecord]
      : []
    : await listIncompleteRecordsCommand(
        incompleteRecordRepository,
        workspaceScope,
        { status, query: params.q },
      );
  const previews = await previewIncompleteRecordInboxCommand(
    incompleteRecordRepository,
    workspaceScope,
    records,
  );
  return (
    <div>
      <Link href="/contacts" className="sk-text-action mb-6">
        <ArrowLeft className="size-4" aria-hidden /> Contacts
      </Link>
      <header className="mb-8">
        <p className="eyebrow">Intake safety net</p>
        <h1 className="mt-2 font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl">
          Review incomplete contacts.
        </h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-muted">
          Only safe, allowlisted identity details are shown here. Nothing is
          deleted; archival is reversible.
        </p>
      </header>
      <form
        method="get"
        role="search"
        className="sk-group mb-6 grid gap-px bg-line sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
      >
        {params.metaEventId ? (
          <input type="hidden" name="metaEventId" value={params.metaEventId} />
        ) : null}
        <label className="relative bg-surface">
          <span className="sr-only">Search incomplete contacts</span>
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            className="sk-input min-h-14 rounded-none border-0 pl-10"
            name="q"
            defaultValue={params.q}
            maxLength={200}
            placeholder="Name, source, or external ID"
          />
        </label>
        <select
          className="sk-input min-h-14 rounded-none border-0 bg-surface"
          name="status"
          defaultValue={status}
        >
          <option value="pending">Needs review</option>
          <option value="archived">Archived</option>
          <option value="converted">Converted</option>
          <option value="all">All records</option>
        </select>
        <button className="sk-primary-button m-2" type="submit">
          Refresh
        </button>
      </form>
      <IncompleteRecordWorkspace
        records={records}
        previews={previews}
        metaEventId={params.metaEventId}
      />
    </div>
  );
}
