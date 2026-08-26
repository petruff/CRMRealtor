import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';

export interface GoogleConnectionPresentation {
  readonly consentPending: boolean;
  readonly description: string;
}

export function googleConnectionPresentation(
  lifecycle: ConnectorLifecycleProjection,
): GoogleConnectionPresentation {
  return {
    consentPending: lifecycle.state === 'owner-consent-pending',
    description: lifecycle.safeSummary,
  };
}

export function googleSyncStreamLabel(stream: 'gmail-history' | 'calendar-events'): string {
  return stream === 'gmail-history' ? 'Gmail activity' : 'Calendar updates';
}

export function googleSyncStateLabel(
  state: 'idle' | 'syncing' | 'healthy' | 'full_resync_required' | 'degraded',
): string {
  if (state === 'healthy') return 'Up to date';
  if (state === 'syncing') return 'Updating';
  if (state === 'idle') return 'Waiting for the next update';
  return 'Needs attention';
}
