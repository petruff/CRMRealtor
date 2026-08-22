import type { Metadata } from 'next';
import { StatTile, GroupedSurface } from '@/components/ui';
import { getRepository } from '@/lib/data';
import { buildWorkspaceSnapshot } from '@/lib/domain/workspace-intelligence';
import { PipelineBoard } from '@/components/pipeline-board';
import { loadPipelineEvidence } from '@/lib/application/pipeline-evidence';

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
    <div>
      <header className="mb-9 md:mb-12">
        <p className="eyebrow">Business pipeline</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Every relationship,<br /><span className="text-muted">in the right stage.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
          A truthful view of the stages already on each contact. Edit the source record to move someone — no hidden duplicate board state.
        </p>
      </header>

      <GroupedSurface className="mb-10 grid grid-cols-2 gap-px sm:grid-cols-4">
        <StatTile value={contacts.length} label="All contacts" />
        <StatTile value={active} label="Actively progressing" tone="accent" />
        <StatTile value={snapshot.pipeline.find((item) => item.id === 'under-contract')?.count ?? 0} label="Under contract" tone="warm" />
        <StatTile value={snapshot.pipeline.find((item) => item.id === 'closed')?.count ?? 0} label="Closed relationships" tone="nurture" />
      </GroupedSurface>

      <PipelineBoard initialContacts={contacts} evidence={evidence} />
    </div>
  );
}
