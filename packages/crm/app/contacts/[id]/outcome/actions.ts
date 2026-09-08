'use server';

import { revalidatePath } from 'next/cache';
import type { CaptureUiCommand, CaptureUiResult } from '@/components/capture-outcome';
import { getRepository } from '@/lib/data';
import { createCaptureOutcomeService } from '@/lib/application/capture-outcome-service';
import { extractAndRecordCaptureOutcome } from '@/lib/application/capture-outcome-observed-extraction';
import { recordCaptureRunTelemetry } from '@/lib/data/capture-run-telemetry';
import { loadWorkspaceAiRuntimeCredential } from '@/lib/application/workspace-ai-settings';
import { createSupabaseOmnixAiBudgetAuthority } from '@/lib/application/omnix-ai-budget';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CaptureOutcomeError } from '@/lib/domain/capture-outcome';
import { createOmnixProviderServerGateway } from '@/lib/application/omnix-provider-server-gateway';
import { supabaseContactOutboundGuard } from '@/lib/data/supabase-contact-outbound-guard';

export async function captureOutcomeAction(input: CaptureUiCommand): Promise<CaptureUiResult> {
  try {
    const context = await getRepository();
    const scope = context.workspaceScope;
    const captures = context.captureOutcomeRepository;
    const contact = await context.repository.get(input.contactId);
    if (!contact || contact.archivedAt || !captures) return { error: 'This contact or its outcome reviews are unavailable. Reopen the contact and try again.' };
    const authenticated = context.isLive ? await createSupabaseServerClient() : undefined;
    const service = createCaptureOutcomeService({
      captures, contacts: context.repository, proposals: context.omnixProposalRepository,
      activities: context.activityRepository, pipeline: context.pipelineRepository, nurture: context.nurturePlanRepository,
      richContacts: context.richContactRepository, connectors: context.connectorRepository,
      ...(authenticated ? { outboundGuard: supabaseContactOutboundGuard(authenticated), providerGateway: createOmnixProviderServerGateway(context, authenticated) } : {}),
      extract: async (source) => {
        if (!context.isLive) return { state: 'unconfigured' };
        const credential = await loadWorkspaceAiRuntimeCredential(scope).catch(() => undefined);
        const client = await createSupabaseServerClient();
        if (!client) return { state: 'limited' };
        return extractAndRecordCaptureOutcome(source, {
          ...(credential?.provider === 'google-gemini' ? { credential } : {}), budget: createSupabaseOmnixAiBudgetAuthority(client, scope),
        }, (data) => recordCaptureRunTelemetry(client, scope, contact.id, data));
      },
    });
    if (input.command === 'options') return { options: await service.options(scope, contact.id) };
    if (input.command === 'analyze') return { proposal: await service.analyze(scope, {
      contactId: contact.id, sourceText: input.sourceText ?? '', idempotencyKey: input.idempotencyKey ?? '',
      manualOnly: input.manualOnly, tasks: input.tasks,
    }) };
    if (!input.proposalId || !Number.isInteger(input.version)) return { error: 'Reopen the current review before making changes.' };
    const existing = await service.get(scope, input.proposalId);
    if (existing.contactId !== contact.id) return { error: 'This review is unavailable for the selected contact.' };
    const version = input.version!;
    let proposal;
    switch (input.command) {
      case 'add':
        if (!input.operationType) return { error: 'Choose the type of change to add.' };
        proposal = await service.addOperation(scope, existing.id, version, { type: input.operationType, after: input.patch ?? {} }); break;
      case 'edit': proposal = await service.edit(scope, existing.id, version, input.operationId ?? '', input.patch ?? {}); break;
      case 'select': proposal = await service.select(scope, existing.id, version, input.operationIds ?? []); break;
      case 'confirm': proposal = await service.confirm(scope, existing.id, version, input.contentHash ?? ''); break;
      case 'reject': proposal = await service.reject(scope, existing.id, version); break;
      case 'defer': proposal = await service.defer(scope, existing.id, version, input.until ?? ''); break;
      default: return { error: 'This review action is not supported.' };
    }
    if (input.command === 'confirm') {
      revalidatePath(`/contacts/${contact.id}`); revalidatePath('/activities'); revalidatePath('/');
      revalidatePath('/pipeline'); revalidatePath('/nurture'); revalidatePath('/omnix');
    }
    return { proposal };
  } catch (error) {
    if (error instanceof CaptureOutcomeError) return { error: error.message };
    return { error: 'The review could not be saved. Your existing records are preserved. Retry or reopen the saved review.' };
  }
}
