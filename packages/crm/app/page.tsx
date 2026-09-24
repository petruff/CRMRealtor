import { TodayCommandCenter } from '@/components/today-command-center';
import { loadOmnixAlerts } from '@/lib/application/omnix-alert-loader';
import { buildTodayOperatingProjection, type TodaySourceResult } from '@/lib/application/today-operating-projection';
import { getRepository } from '@/lib/data';
import { buildReadyToSend, mergeSellerUpdates, sellerUpdateCandidates, sellerUpdateItem, withNoteHints } from '@/lib/application/ready-to-send';
import { isSellerUpdateDay } from '@/lib/domain/seller-update';
import { markReadyTextSentAction } from './ready-to-send-actions';

export const dynamic = 'force-dynamic';

async function readSource<T>(promise: Promise<readonly T[]>): Promise<TodaySourceResult<T>> {
  return promise.then((value) => ({ state: 'available' as const, value }))
    .catch(() => ({ state: 'unavailable' as const, value: [] }));
}

export default async function TodayPage() {
  const alerts = await loadOmnixAlerts();
  const context = await getRepository();
  const { repository, activityRepository, workspaceScope, userDisplayName } = context;
  const now = new Date(alerts.asOf);
  const [contacts, importedEventsResult, attention, proposals, inbound, milestones, connections, nurture, transactions] = await Promise.all([
    repository.list(),
    activityRepository
      .listEvents(workspaceScope, { type: 'contact-imported', limit: 500 })
      .then((events) => ({ events }))
      .catch(() => ({ events: [] })),
    readSource(context.attentionRepository.list(workspaceScope, { state: 'active', limit: 500, now: now.toISOString() })),
    readSource(context.omnixProposalRepository.list(workspaceScope, { state: 'active', limit: 500 })),
    readSource(context.operationalSignalRepository.listInbound(workspaceScope, { unacknowledgedOnly: true, limit: 500 })),
    readSource(context.operationalSignalRepository.listMilestones(workspaceScope, { openOnly: true, limit: 1000 })),
    readSource(context.connectorRepository.listConnections(workspaceScope, { limit: 100 })),
    readSource(context.nurturePlanRepository.list(workspaceScope, { limit: 500 })),
    readSource(context.transactionRepository.list(workspaceScope)),
  ]);
  const historicalImportContactIds = new Set(
    importedEventsResult.events.flatMap((event) => event.contactId ? [event.contactId] : []),
  );
  const timeZone = process.env.OMNIX_TIME_ZONE ?? 'America/New_York';
  const ready = buildReadyToSend({ contacts, now, historicalImportContactIds, ...(userDisplayName ? { agentName: userDisplayName } : {}) });
  const readyNotes = new Map(await Promise.all(ready.map(async (item) => [item.contactId, await repository.notesFor(item.contactId).catch(() => [])] as const)));
  const sellerItems = isSellerUpdateDay(now, timeZone)
    ? (await Promise.all(sellerUpdateCandidates(contacts).map(async (contact) => sellerUpdateItem(contact, await repository.notesFor(contact.id).catch(() => []), now, userDisplayName))))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const readyItems = mergeSellerUpdates(withNoteHints(ready, readyNotes), sellerItems);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const operatingProjection = buildTodayOperatingProjection({
    attention, proposals, inbound, milestones, connections, nurture, transactions,
  }, now);
  return <TodayCommandCenter
    alerts={alerts}
    contacts={contacts}
    userDisplayName={userDisplayName}
    timeZone={timeZone}
    ready={{ items: readyItems, day, markSent: markReadyTextSentAction }}
    historicalImportContactIds={historicalImportContactIds}
    operatingProjection={operatingProjection}
  />;
}
