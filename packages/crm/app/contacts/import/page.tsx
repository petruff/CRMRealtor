import Link from 'next/link';
import type { Metadata } from 'next';
import { ChevronLeft, FileCheck2 } from 'lucide-react';
import { ContactImportWorkspace } from '@/components/contact-import-workspace';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Import contacts' };
// A governed 144-row import performs bounded parsing plus idempotent, atomic
// persistence groups. Fifteen seconds proved too short in production and
// terminated otherwise valid commits after most rows had been saved.
export const maxDuration = 60;

type LatestImport = {
  source: string;
  format: string;
  total_rows: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  quarantined_count: number;
  failed_count: number;
  completed_at: string;
};

async function getLatestImport(): Promise<LatestImport | null> {
  try {
    const { workspaceScope, isLive } = await getRepository();
    if (!isLive) return null;
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from('data_import_runs')
      .select('source,format,total_rows,created_count,updated_count,unchanged_count,rejected_count,quarantined_count,failed_count,completed_at')
      .eq('workspace_id', workspaceScope.workspaceId)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data as LatestImport | null;
  } catch {
    return null;
  }
}

export default async function ImportContactsPage() {
  const latestImport = await getLatestImport();
  return (
    <div>
      <Link href="/contacts" className="sk-text-action"><ChevronLeft className="size-4" /> Contacts</Link>
      <header className="mb-8 mt-5 md:mb-10">
        <p className="eyebrow">Contact import</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Bring your relationships with you.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
          Move people from another CRM, Mailchimp, Google, Apple, or a spreadsheet. Preview first; save only after every match makes sense.
        </p>
      </header>
      {latestImport ? (
        <section
          className="sk-group mb-6 overflow-hidden bg-surface p-5 sm:p-7"
          aria-labelledby="latest-import-heading"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-nurture-soft text-nurture">
                <FileCheck2 className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="eyebrow">Latest import summary</p>
                <h2 id="latest-import-heading" className="mt-1 text-xl text-ink">
                  {latestImport.total_rows} rows processed on {new Date(latestImport.completed_at).toLocaleDateString('en-US')}.
                </h2>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span><strong className="text-ink">{latestImport.created_count}</strong> added</span>
                  <span><strong className="text-ink">{latestImport.updated_count}</strong> enriched</span>
                  <span><strong className="text-ink">{latestImport.unchanged_count}</strong> already current</span>
                  <span><strong className="text-ink">{latestImport.rejected_count}</strong> sent to review</span>
                  <span><strong className="text-ink">{latestImport.failed_count}</strong> failed</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {latestImport.rejected_count > 0 || latestImport.quarantined_count > 0 ? (
                <Link href="/contacts/incomplete" className="sk-secondary-button">Review imported records</Link>
              ) : null}
              <Link href="/data#import-history" className="sk-secondary-button">View import history</Link>
            </div>
          </div>
        </section>
      ) : (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          <span>Your import summaries stay available after every upload.</span>
          <Link href="/data#import-history" className="font-semibold text-accent hover:underline">View import history</Link>
        </div>
      )}
      <ContactImportWorkspace />
    </div>
  );
}
