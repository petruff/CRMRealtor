'use server';

import { getRepository } from '@/lib/data';
import { getMeetingBrief } from '@/lib/application/meeting-brief-service';
import { narrateMeetingBrief, type MeetingBriefNarrationEnvelope } from '@/lib/application/meeting-brief-narration';
import { loadWorkspaceAiRuntimeCredential } from '@/lib/application/workspace-ai-settings';
import { createSupabaseOmnixAiBudgetAuthority } from '@/lib/application/omnix-ai-budget';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function narrateMeetingBriefAction(contactId: string, snapshotId: string): Promise<{ narration?: MeetingBriefNarrationEnvelope; error?: string }> {
  try {
    const context = await getRepository();
    if (!context.meetingBriefRepository) return { error: 'Brief storage is unavailable. Your saved contact is still accessible.' };
    const contact = await context.repository.get(contactId);
    const dependencies = { ...context, meetingBriefRepository: context.meetingBriefRepository };
    const brief = await getMeetingBrief(dependencies, snapshotId);
    if (!contact || contact.archivedAt || brief.snapshot.subjectContactId !== contact.id) return { error: 'Reopen this contact’s meeting brief and try again.' };
    const credential = context.isLive ? await loadWorkspaceAiRuntimeCredential(context.workspaceScope).catch(() => undefined) : undefined;
    const client = context.isLive ? await createSupabaseServerClient() : undefined;
    return { narration: await narrateMeetingBrief(dependencies, snapshotId, {
      ...(credential?.provider === 'google-gemini' ? { credential } : {}),
      ...(client ? { budget: createSupabaseOmnixAiBudgetAuthority(client, context.workspaceScope) } : {}),
    }) };
  } catch { return { error: 'AI highlights are unavailable. You can keep using the cited brief below.' }; }
}
