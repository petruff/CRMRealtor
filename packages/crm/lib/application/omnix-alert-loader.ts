import 'server-only';

import { cache } from 'react';
import { getRepository } from '@/lib/data';
import { createOmnixCopilotRequest, type OmnixCopilotAlert, type OmnixCopilotCitation } from '@/lib/domain/omnix-copilot';
import { executeOmnixCopilot } from '@/lib/application/omnix-copilot-service';

export interface OmnixAlertPageResult {
  readonly availability: 'available' | 'partial' | 'unavailable';
  readonly alerts: readonly OmnixCopilotAlert[];
  readonly citations: readonly OmnixCopilotCitation[];
  readonly warnings: readonly string[];
  readonly asOf: string;
  readonly dataMode: 'sample' | 'live';
  readonly timeZone: string;
}

/** One request-scoped, fail-closed server read for Today and /alerts. */
export const loadOmnixAlerts = cache(async (): Promise<OmnixAlertPageResult> => {
  const now = new Date();
  const timeZone = process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York';
  try {
    const context = await getRepository();
    const request = createOmnixCopilotRequest({
      command: 'alerts',
      live: context.isLive,
      now,
    });
    const response = await executeOmnixCopilot(request, {
      getRepository: async () => context,
    });
    const warnings = response.warnings.map((warning) => warning.message);
    return Object.freeze({
      availability: response.warnings.some((warning) => warning.code === 'capability-unavailable')
        ? 'partial'
        : 'available',
      alerts: response.alerts,
      citations: response.citations,
      warnings: Object.freeze(warnings),
      asOf: response.asOf,
      dataMode: response.dataMode,
      timeZone,
    });
  } catch {
    return Object.freeze({
      availability: 'unavailable',
      alerts: Object.freeze([]),
      citations: Object.freeze([]),
      warnings: Object.freeze(['Alerts could not load. Nothing was changed.']),
      asOf: now.toISOString(),
      dataMode: 'sample',
      timeZone,
    });
  }
});
