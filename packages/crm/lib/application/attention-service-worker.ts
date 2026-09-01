import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { attentionMaterializationsFromAlerts, attentionMaterializationsFromMilestones } from './attention-commands.ts';
import { buildOmnixAlertResult } from './omnix-copilot-service.ts';
import { resolveServerWorkspaceScope } from '../data/automation-context.ts';
import { supabaseActivityRepository } from '../data/supabase-activity-repository.ts';
import { supabaseAttentionRepository } from '../data/supabase-attention-repository.ts';
import { supabaseRepository } from '../data/supabase-repository.ts';
import { supabaseOmnixProposalAutomationRepository } from '../data/supabase-omnix-proposal-repository.ts';
import { materializeOmnixOperationalBrain } from './omnix-operational-materializer.ts';
import { supabaseNurturePlanAutomationRepository } from '../data/supabase-nurture-plan-repository.ts';
import { supabaseNurturePlanRepository } from '../data/supabase-nurture-plan-repository.ts';
import { materializeDueNurturePlans } from './nurture-materializer.ts';
import { supabaseOperationalSignalRepository } from '../data/supabase-operational-signal-repository.ts';

function calendarDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function reconcileConfiguredAttention(
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const workspaceId = (environment.OMNIX_INTAKE_WORKSPACE_ID ?? environment.CRM_INTAKE_WORKSPACE_ID)?.trim();
  const ownerId = (environment.OMNIX_INTAKE_OWNER_ID ?? environment.CRM_INTAKE_OWNER_ID)?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_')) || (!workspaceId && !ownerId)) {
    throw new Error('Attention worker authority is not configured.');
  }
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const scope = await resolveServerWorkspaceScope(client, { workspaceId, ownerId });
  const contacts = await supabaseRepository(client, scope).list();
  const activities = supabaseActivityRepository(client);
  const [tasks, importedEvents] = await Promise.all([
    activities.listTasks(scope, { status: 'open', limit: 500 }),
    activities.listEvents(scope, { type: 'contact-imported', limit: 500 }),
  ]);
  const timeZone = environment.OMNIX_TIME_ZONE?.trim() || 'America/New_York';
  const result = buildOmnixAlertResult({
    contacts,
    tasks,
    today: calendarDate(now, timeZone),
    asOf: now.toISOString(),
    timeZone,
    historicalImportContactIds: new Set(importedEvents.flatMap((event) => event.contactId ? [event.contactId] : [])),
  });
  const operationalSignals = supabaseOperationalSignalRepository(client);
  let milestoneSignals = [] as Awaited<ReturnType<typeof operationalSignals.listMilestones>>;
  try {
    milestoneSignals = await operationalSignals.listMilestones(scope, { openOnly: true, limit: 1000 });
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: 'omnix-milestone-attention-error.v1', workspaceId: scope.workspaceId,
      category: 'milestone-attention-unavailable',
      message: error instanceof Error ? error.message : 'Milestone attention materialization failed.',
    }));
  }
  const materializations = [
    ...attentionMaterializationsFromAlerts(result.alerts),
    ...attentionMaterializationsFromMilestones(milestoneSignals, now),
  ];
  const fingerprint = createHash('sha256').update(JSON.stringify(materializations.map((item) => [
    item.occurrenceKey, item.sourceFingerprint,
  ]).sort(([left], [right]) => String(left).localeCompare(String(right))))).digest('hex');
  const receipt = await supabaseAttentionRepository(client).reconcile(
    scope,
    materializations,
    now.toISOString(),
    `scheduled-attention:${fingerprint}`,
  );
  let operationalBrain: { availability: 'available'; proposals: number; proposalNoOps: number; memories: number;
    nurture: { availability: 'available'; claimed: number; materialized: number; noOps: number }
      | { availability: 'unavailable'; errorCategory: 'nurture-automation-unavailable' } }
    | { availability: 'unavailable'; errorCategory: 'operational-brain-unavailable' };
  try {
    const proposalAutomation = supabaseOmnixProposalAutomationRepository(client);
    const [inboundResponses, milestones, nurturePlans] = await Promise.all([
      operationalSignals.listInbound(scope, { unacknowledgedOnly: true, limit: 500 }),
      Promise.resolve(milestoneSignals),
      supabaseNurturePlanRepository(client).list(scope, { limit: 500 }),
    ]);
    const core = await materializeOmnixOperationalBrain(
      proposalAutomation, scope, contacts, result.alerts, inboundResponses, milestones, tasks, nurturePlans, now,
    );
    let nurture: { availability: 'available'; claimed: number; materialized: number; noOps: number }
      | { availability: 'unavailable'; errorCategory: 'nurture-automation-unavailable' };
    try {
      nurture = { availability: 'available', ...await materializeDueNurturePlans(
        proposalAutomation, supabaseNurturePlanAutomationRepository(client), scope, contacts, now,
      ) };
    } catch (error) {
      console.error(JSON.stringify({
        schemaVersion: 'omnix-nurture-automation-error.v1', workspaceId: scope.workspaceId,
        category: 'nurture-automation-unavailable',
        message: error instanceof Error ? error.message : 'Nurture materialization failed.',
      }));
      nurture = { availability: 'unavailable', errorCategory: 'nurture-automation-unavailable' };
    }
    operationalBrain = { availability: 'available', ...core, nurture };
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: 'omnix-operational-brain-error.v1',
      workspaceId: scope.workspaceId,
      category: 'operational-brain-unavailable',
      message: error instanceof Error ? error.message : 'Operational brain materialization failed.',
    }));
    operationalBrain = { availability: 'unavailable', errorCategory: 'operational-brain-unavailable' };
  }
  return {
    workspaceId: scope.workspaceId,
    sourceCount: result.alerts.length,
    availability: result.availability,
    runId: receipt.runId,
    noOp: receipt.noOp,
    materialized: receipt.materialized,
    refreshed: receipt.refreshed,
    reopened: receipt.reopened,
    resolved: receipt.resolved,
    operationalBrain,
  };
}
