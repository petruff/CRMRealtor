'use server';

import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseOmnixAiBudgetAuthority } from '@/lib/application/omnix-ai-budget';
import { loadWorkspaceAiRuntimeCredential } from '@/lib/application/workspace-ai-settings';
import { writeListingCopy, type ListingCopyResult } from '@/lib/application/listing-writer-service';
import { ListingWriterError, parseListingFacts, parseListingFormat, parseListingLanguage } from '@/lib/domain/listing-writer';
import type { FairHousingFinding } from '@/lib/domain/fair-housing';

export type ListingWriterState =
  | { readonly status: 'idle' }
  | ({ readonly status: 'written'; readonly format: string; readonly language: string } & ListingCopyResult)
  | { readonly status: 'error'; readonly message: string; readonly findings?: readonly FairHousingFinding[] };

/** Writes one piece of listing copy. Nothing is posted or sent anywhere. */
export async function writeListingCopyAction(_state: ListingWriterState, formData: FormData): Promise<ListingWriterState> {
  try {
    const values = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === 'string')) as Record<string, string>;
    const facts = parseListingFacts(values);
    const format = parseListingFormat(values.format);
    const language = parseListingLanguage(values.language);
    const context = await getRepository();
    const credential = context.isLive ? await loadWorkspaceAiRuntimeCredential(context.workspaceScope).catch(() => undefined) : undefined;
    const budget = credential ? createSupabaseOmnixAiBudgetAuthority(await createSupabaseServerClient(), context.workspaceScope) : undefined;
    const result = await writeListingCopy(facts, format, language, { ...(credential ? { credential } : {}), ...(budget ? { budget } : {}) });
    return { status: 'written', format, language, ...result };
  } catch (error) {
    if (error instanceof ListingWriterError) return { status: 'error', message: error.message, ...(error.findings.length ? { findings: error.findings } : {}) };
    console.error('[listing-writer]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'The copy couldn’t be written. Nothing was changed.' };
  }
}
