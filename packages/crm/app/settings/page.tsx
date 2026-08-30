import type { Metadata } from 'next';
import { AiSettingsForm } from '@/components/ai-settings-form';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  readWorkspaceAiStatus,
  readWorkspaceAiUsageStatus,
  type WorkspaceAiStatus,
  type WorkspaceAiUsageStatus,
} from '@/lib/application/workspace-ai-settings';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const context = await getRepository();
  let status: WorkspaceAiStatus = { configured: false, enabled: false, provider: 'google-gemini', model: 'gemini-3.5-flash-lite', secretVersion: 0 };
  let usage: WorkspaceAiUsageStatus | undefined;
  let unavailable: string | undefined;
  if (context.isLive) {
    try {
      const client = await createSupabaseServerClient();
      [status, usage] = await Promise.all([
        readWorkspaceAiStatus(client, context.workspaceScope),
        readWorkspaceAiUsageStatus(client, context.workspaceScope),
      ]);
    }
    catch (error) { unavailable = error instanceof Error ? error.message : 'Workspace AI settings are unavailable.'; }
  }
  return <div className="space-y-8">
    <header><p className="eyebrow">Workspace control</p><h1 className="mt-2 font-display text-4xl text-ink sm:text-5xl">Settings</h1><p className="mt-3 max-w-3xl text-muted">Configure Omnix intelligence without exposing provider credentials or weakening workspace authority.</p></header>
    {!context.isLive ? <div role="status" className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">AI settings require a signed-in live Supabase workspace.</div>
      : context.workspaceScope.role !== 'owner' ? <div role="status" className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">Only the workspace owner can change AI credentials. Your access remains read-only.</div>
        : unavailable ? <div role="alert" className="rounded-2xl border border-hot bg-hot-soft p-5 text-sm text-hot">{unavailable}</div>
          : <AiSettingsForm status={status} usage={usage} />}
  </div>;
}
