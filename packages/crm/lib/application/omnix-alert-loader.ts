import 'server-only';

import { createHash } from 'node:crypto';
import { cache } from 'react';
import { getRepository, sampleAttentionRepository } from '@/lib/data';
import { createOmnixCopilotRequest, type OmnixCopilotAlert, type OmnixCopilotCitation } from '@/lib/domain/omnix-copilot';
import { executeOmnixCopilot } from '@/lib/application/omnix-copilot-service';
import { reconcileAttentionCommand } from '@/lib/application/attention-commands';
import { createAttentionAutomationServerRepository } from '@/lib/data/attention-automation-server-context';
import type { AttentionItem } from '@/lib/domain/attention';

function reconciliationKey(alerts: readonly OmnixCopilotAlert[]): string {
  const fingerprint = createHash('sha256').update(JSON.stringify(alerts.map((alert) => ({
    occurrenceKey: alert.occurrenceKey ?? `${alert.rule}:${alert.recordId}`,
    sourceFingerprint: alert.sourceFingerprint ?? '',
  })).sort((left, right) => left.occurrenceKey.localeCompare(right.occurrenceKey)))).digest('hex');
  return `omnix-alerts:${fingerprint}`;
}

function orderByOperationalQueue(
  alerts: readonly OmnixCopilotAlert[],
  occurrences: readonly { occurrenceKey: string }[],
): readonly OmnixCopilotAlert[] {
  const byOccurrence = new Map(alerts.map((alert) => [
    alert.occurrenceKey ?? `${alert.rule}:${alert.recordId}`,
    alert,
  ]));
  return Object.freeze(occurrences.flatMap((item) => {
    const alert = byOccurrence.get(item.occurrenceKey);
    return alert ? [alert] : [];
  }));
}

export interface OmnixAlertPageResult {
  readonly availability: 'available' | 'partial' | 'unavailable';
  readonly alerts: readonly OmnixCopilotAlert[];
  readonly attentionItems: readonly AttentionItem[];
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
    let alerts = response.alerts;
    let attentionItems: readonly AttentionItem[] = Object.freeze([]);
    try {
      const attentionRepository = context.isLive
        ? createAttentionAutomationServerRepository(context.workspaceScope)
        : sampleAttentionRepository;
      const reconciliation = await reconcileAttentionCommand(
        attentionRepository,
        context.workspaceScope,
        response.alerts,
        now,
        reconciliationKey(response.alerts),
      );
      attentionItems = reconciliation.active;
      alerts = orderByOperationalQueue(response.alerts, reconciliation.active);
    } catch {
      warnings.push('Priority history is temporarily unavailable. Current alerts are shown without lifecycle actions.');
    }
    return Object.freeze({
      availability: response.warnings.some((warning) => warning.code === 'capability-unavailable') || warnings.length > response.warnings.length
        ? 'partial'
        : 'available',
      alerts,
      attentionItems,
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
      attentionItems: Object.freeze([]),
      citations: Object.freeze([]),
      warnings: Object.freeze(['Alerts could not load. Nothing was changed.']),
      asOf: now.toISOString(),
      dataMode: 'sample',
      timeZone,
    });
  }
});
