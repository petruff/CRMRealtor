import { TodayCommandCenter } from '@/components/today-command-center';
import { loadOmnixAlerts } from '@/lib/application/omnix-alert-loader';
import { getRepository } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const alerts = await loadOmnixAlerts();
  const context = await getRepository();
  const { repository, activityRepository, workspaceScope, userDisplayName } = context;
  const [contacts, importedEventsResult, operational] = await Promise.all([
    repository.list(),
    activityRepository
      .listEvents(workspaceScope, { type: 'contact-imported', limit: 500 })
      .then((events) => ({ events }))
      .catch(() => ({ events: [] })),
    Promise.all([
      context.omnixProposalRepository.list(workspaceScope, { state: 'active', limit: 500 }),
      context.operationalSignalRepository.listInbound(workspaceScope, { unacknowledgedOnly: true, limit: 500 }),
      context.operationalSignalRepository.listMilestones(workspaceScope, { openOnly: true, limit: 1000 }),
    ]).then(([proposals, inbound, milestones]) => ({ availability: 'available' as const, approvals: proposals.length, inbound: inbound.length, deadlines: milestones.length, overdueDeadlines: milestones.filter((item) => Date.parse(item.dueAt) < Date.now()).length })).catch(() => ({ availability: 'unavailable' as const, approvals: 0, inbound: 0, deadlines: 0, overdueDeadlines: 0 })),
  ]);
  const historicalImportContactIds = new Set(
    importedEventsResult.events.flatMap((event) => event.contactId ? [event.contactId] : []),
  );
  return <TodayCommandCenter
    alerts={alerts}
    contacts={contacts}
    userDisplayName={userDisplayName}
    timeZone={process.env.OMNIX_TIME_ZONE ?? 'America/New_York'}
    historicalImportContactIds={historicalImportContactIds}
    operational={operational}
  />;
}
