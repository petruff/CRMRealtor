import type { Metadata } from 'next';
import { StatTile, GroupedSurface } from '@/components/ui';
import { getRepository } from '@/lib/data';
import { buildWorkspaceSnapshot } from '@/lib/domain/workspace-intelligence';
import { PipelineBoard } from '@/components/pipeline-board';
import { loadPipelineEvidence } from '@/lib/application/pipeline-evidence';
import { ArrowDownRight, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  const context = await getRepository();
  const { repository } = context;
  const contacts = await repository.list();
  const evidence = await loadPipelineEvidence(context.activityRepository, context.workspaceScope, contacts);
  const snapshot = buildWorkspaceSnapshot(contacts);
  const active = snapshot.pipeline
    .filter((item) => ['appointment-set', 'active', 'under-contract'].includes(item.id))
    .reduce((total, item) => total + item.count, 0);

  return (
    <div className="min-w-0">
      <header className="mb-6 grid gap-5 border-b border-line pb-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
        <div>
          <p className="eyebrow">Pipeline command desk</p>
          <h1 className="mt-3 max-w-4xl font-display text-[2.25rem] leading-[1.02] text-ink sm:text-[2.7rem] md:text-5xl">
            Move every relationship <span className="text-muted">forward.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">
            Drag on desktop or use “Move to” anywhere. Every change is saved to the contact record and activity history.
          </p>
        </div>
        <div className="flex max-w-sm items-start gap-3 rounded-xl border border-line bg-surface-3 p-4 text-sm text-muted">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-nurture-soft text-nurture"><ShieldCheck className="size-4" aria-hidden /></span>
          <div><p className="font-semibold text-ink">One source of truth</p><p className="mt-1 text-xs leading-relaxed">No duplicate board records. Contact stages and history stay together.</p></div>
        </div>
      </header>

      <GroupedSurface className="mb-6 grid grid-cols-2 gap-px [&>div]:min-h-20 [&>div]:p-3 sm:grid-cols-4 sm:[&>div]:p-4">
        <StatTile value={contacts.length} label="All contacts" />
        <StatTile value={active} label="In active progress" tone="accent" />
        <StatTile value={snapshot.pipeline.find((item) => item.id === 'under-contract')?.count ?? 0} label="Under contract" tone="warm" />
        <StatTile value={snapshot.pipeline.find((item) => item.id === 'closed')?.count ?? 0} label="Closed relationships" tone="nurture" />
      </GroupedSurface>

      <p className="mb-3 flex items-center gap-2 text-xs font-medium text-muted"><ArrowDownRight className="size-4 text-accent" aria-hidden />Follow the board from left to right</p>
      <PipelineBoard initialContacts={contacts} evidence={evidence} />
    </div>
  );
}
