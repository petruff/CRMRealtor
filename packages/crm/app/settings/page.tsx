import type { Metadata } from 'next';
import { AiSettingsForm } from '@/components/ai-settings-form';
import { MorningBriefSettings } from '@/components/morning-brief-settings';
import { PageHeader } from '@/components/page-header';
import { ShieldCheck } from 'lucide-react';
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
  return <div className="ox-stack">
    <PageHeader eyebrow="Workspace" title="Settings" description="Omnix intelligence, notifications and account security for this workspace." />
    {!context.isLive ? <div role="status" className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">AI settings require a signed-in live Supabase workspace.</div>
      : context.workspaceScope.role !== 'owner' ? <div role="status" className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">Only the workspace owner can change AI credentials. Your access remains read-only.</div>
        : unavailable ? <div role="alert" className="rounded-2xl border border-hot bg-hot-soft p-5 text-sm text-hot">{unavailable}</div>
          : <AiSettingsForm status={status} usage={usage} />}
    <MorningBriefSettings publicKey={process.env.NEXT_PUBLIC_OMNIX_PUSH_PUBLIC_KEY?.trim() || undefined} isLive={context.isLive} />
    <section id="security" aria-labelledby="security-title" className="ox-card ox-settings-card scroll-mt-24">
      <div className="ox-settings-card-body">
        <span className="ox-icon-chip ox-tone-task"><ShieldCheck className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="ox-eyebrow">Account security</p>
          <h2 id="security-title" className="ox-card-title mt-1">Sessions and devices</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Lost a phone or used a shared computer? Signing out everywhere ends every open Omnix session for your account, including this one.
            For the strongest protection, keep 2-Step Verification turned on for the Google account you use to sign in.
          </p>
          <form action="/auth/signout" method="post" className="mt-4">
            <input type="hidden" name="scope" value="global" />
            <button type="submit" className="sk-secondary-button">Sign out of all devices</button>
          </form>
        </div>
      </div>
    </section>
  </div>;
}
