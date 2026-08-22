import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, KanbanSquare, Plug, Send, Sparkles } from 'lucide-react';
import { getRepository } from '@/lib/data';
import type { RichContactRepository } from '@/lib/data/rich-contact-repository';
import { listAssignmentsCommand } from '@/lib/application/rich-contact-commands';
import { WorkspaceAssignmentPanel } from '@/components/workspace-assignment-panel';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { selectWorkspaceAction } from './actions';

export const metadata: Metadata = { title: 'Workspaces' };

const WORKSPACES = [
  { href: '/pipeline', name: 'Pipeline', detail: 'See every relationship by real stage.', icon: KanbanSquare },
  { href: '/insights', name: 'Insights', detail: 'Measure contact, source and data readiness.', icon: BarChart3 },
  { href: '/omnix', name: 'Omnix AI', detail: 'Review explainable next-best actions.', icon: Sparkles },
  { href: '/mailers', name: 'Mailers', detail: 'Run physical-mail checklists safely.', icon: Send },
  { href: '/connections', name: 'Connections', detail: 'See what is ready, building or gated.', icon: Plug },
] as const;

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const repositoryContext = await getRepository();
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: availableMemberships } = auth.user ? await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(name)')
    .eq('user_id', auth.user.id)
    .eq('status', 'active') : { data: [] };
  const richContactRepository = 'richContactRepository' in repositoryContext
    ? repositoryContext.richContactRepository as RichContactRepository | undefined
    : undefined;
  const [contacts, members, assignments] = await Promise.all([
    repositoryContext.repository.list(),
    repositoryContext.workspaceRepository.listMemberships(repositoryContext.workspaceScope),
    richContactRepository
      ? listAssignmentsCommand(richContactRepository, repositoryContext.workspaceScope, undefined, true)
      : Promise.resolve([]),
  ]);
  return (
    <div>
      <header className="mb-9 md:mb-12">
        <p className="eyebrow">Omnix workspaces</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Choose the job.<br /><span className="text-muted">Keep the day simple.</span>
        </h1>
      </header>
      {(availableMemberships?.length ?? 0) > 1 ? (
        <section className="mb-8 rounded-[var(--sk-card-radius)] border border-line bg-surface p-5" aria-labelledby="workspace-switch-title">
          <p className="eyebrow">Account scope</p>
          <h2 id="workspace-switch-title" className="mt-1 font-display text-2xl text-ink">Choose which CRM you are viewing</h2>
          <p className="mt-2 text-sm text-muted">Each workspace remains isolated. Switching never copies or moves contacts.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {availableMemberships?.map((membership) => {
              const related = Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces;
              const name = related && typeof related === 'object' && 'name' in related ? String(related.name) : 'Omnix workspace';
              const active = membership.workspace_id === repositoryContext.workspaceScope.workspaceId;
              return <form key={membership.workspace_id} action={selectWorkspaceAction}>
                <input type="hidden" name="workspaceId" value={membership.workspace_id} />
                <button type="submit" className={active ? 'sk-primary-button' : 'sk-secondary-button'} aria-current={active ? 'true' : undefined}>
                  {name} · {membership.role === 'owner' ? 'Owner' : 'Administrator'}
                </button>
              </form>;
            })}
          </div>
        </section>
      ) : null}
      <div className="sk-group grid gap-px sm:grid-cols-2">
        {WORKSPACES.map(({ href, name, detail, icon: Icon }) => (
          <Link key={href} href={href} className="group flex min-h-32 items-start gap-4 bg-surface p-5 transition-colors hover:bg-surface-2 sm:p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-accent group-hover:bg-surface"><Icon className="size-5" aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="font-display text-xl text-ink">{name}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">{detail}</span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-subtle" aria-hidden />
          </Link>
        ))}
      </div>
      {richContactRepository ? <WorkspaceAssignmentPanel contacts={contacts} assignments={assignments} members={members} /> : null}
    </div>
  );
}
