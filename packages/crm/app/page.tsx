import { TodayCommandCenter } from '@/components/today-command-center';
import { loadOmnixAlerts } from '@/lib/application/omnix-alert-loader';
import { getRepository } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const alerts = await loadOmnixAlerts();
  const { repository, activityRepository, workspaceScope, userDisplayName } = await getRepository();
  const [contacts, importedEventsResult] = await Promise.all([
    repository.list(),
    activityRepository
      .listEvents(workspaceScope, { type: 'contact-imported', limit: 500 })
      .then((events) => ({ events }))
      .catch(() => ({ events: [] })),
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
  />;
}
