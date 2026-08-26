'use server';

import { revalidatePath } from 'next/cache';
import { parseContactImport, type ContactImportMappingTarget, type ImportSource } from '@/lib/application/contact-import';
import { parsePortableContactImport } from '@/lib/application/workbook-portability';
import { executeContactImport, previewContactImport } from '@/lib/application/contact-import-service';
import { organizeExistingImportedContacts } from '@/lib/application/imported-contact-organization';
import { receiptReplayState, requestHash } from '@/lib/application/intake-security';
import { getRepository } from '@/lib/data';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  importResultFromReceipt,
  importResultFromStoredPlan,
  parseImportReceiptPreflight,
} from '@/lib/application/import-receipt-recovery';
import {
  CONTACT_INTAKE_PENDING_STATUS,
  validateStoredContactImportPlanResult,
} from '@/lib/data/import-gateway';

export interface ImportActionInput {
  content?: string;
  contentBase64?: string;
  filename: string;
  source: ImportSource;
  mapping?: Record<string, ContactImportMappingTarget | 'ignore'>;
}

const MAX_CONCURRENT_IMPORT_PARSES_PER_WORKSPACE = 2;
const activeImportParses = new Map<string, number>();

type ImportCommitStage = 'authority-resolved' | 'parsed' | 'previewed' | 'preflight-ready'
  | 'receipt-recovered' | 'applied' | 'receipt-recorded' | 'failed';

function recordImportCommitStage(
  stage: ImportCommitStage,
  startedAtMs: number,
  details?: {
    readonly format?: string;
    readonly counts?: Record<string, number>;
    readonly supportReference?: string;
    readonly databaseCode?: string;
  },
) {
  console.info(JSON.stringify({
    event: 'contact_import_commit_stage',
    stage,
    elapsedMs: Date.now() - startedAtMs,
    ...details,
  }));
}

function safeDatabaseCode(error: { readonly code?: unknown } | null): string {
  return typeof error?.code === 'string' && /^[A-Z0-9]{2,12}$/.test(error.code)
    ? error.code
    : 'UNCLASSIFIED';
}

function supportReference(correlationId: string): string {
  return correlationId.replaceAll('-', '').slice(0, 8).toUpperCase();
}

async function parseInput(input: ImportActionInput) {
  if (input.contentBase64) {
    const bytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
    return parsePortableContactImport({ bytes, filename: input.filename, source: input.source, mapping: input.mapping });
  }
  if (typeof input.content !== 'string') throw new Error('Import content is required.');
  return parseContactImport({ content: input.content, filename: input.filename, source: input.source, mapping: input.mapping });
}

async function parseInputForWorkspace(input: ImportActionInput, workspaceId: string) {
  const active = activeImportParses.get(workspaceId) ?? 0;
  if (active >= MAX_CONCURRENT_IMPORT_PARSES_PER_WORKSPACE) {
    throw new Error('Two contact files are already being processed for this workspace. Wait for one to finish, then retry.');
  }
  activeImportParses.set(workspaceId, active + 1);
  try { return await parseInput(input); }
  finally {
    const remaining = (activeImportParses.get(workspaceId) ?? 1) - 1;
    if (remaining > 0) activeImportParses.set(workspaceId, remaining);
    else activeImportParses.delete(workspaceId);
  }
}

function inputDigest(input: ImportActionInput): string {
  if (input.contentBase64) return createHash('sha256').update(Buffer.from(input.contentBase64, 'base64')).digest('hex');
  return requestHash(input.content ?? '');
}

export async function previewImportAction(input: ImportActionInput) {
  try {
    const { repository, importGateway, activityRepository, workspaceScope, isLive } = await getRepository();
    if (!isLive && isSupabaseConfigured()) {
      return { ok: false as const, message: 'Sign in to an authorized Omnix workspace before previewing contact files.' };
    }
    // Resolve authenticated workspace authority before spending the bounded
    // worker budget on user-controlled workbook bytes.
    const parsed = await parseInputForWorkspace(input, workspaceScope.workspaceId);
    const preview = await previewContactImport(
      repository,
      importGateway,
      parsed,
      workspaceScope,
      activityRepository,
    );
    return { ok: true as const, preview, isLive };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : 'The file could not be previewed.' };
  }
}

export async function commitImportAction(input: ImportActionInput) {
  const startedAtMs = Date.now();
  const correlationId = randomUUID();
  const reference = supportReference(correlationId);
  try {
    const startedAt = new Date();
    const {
      repository,
      importGateway,
      incompleteRecordRepository,
      activityRepository,
      richContactRepository,
      workspaceScope,
      isLive,
    } = await getRepository();
    recordImportCommitStage('authority-resolved', startedAtMs);
    if (!isLive) {
      return {
        ok: false as const,
        message: 'Preview is available in demo mode, but saving requires a signed-in Supabase workspace.',
      };
    }
    const fileHash = inputDigest(input);
    const receiptIdempotencyKey = `ui:${fileHash}`;
    const aggregateReceipt = await importGateway.getReceipt(receiptIdempotencyKey);
    const aggregateReplay = receiptReplayState(aggregateReceipt, fileHash);
    if (aggregateReplay === 'conflict') {
      return { ok: false as const, message: 'This import key belongs to a different file. No contacts were changed.' };
    }
    if (aggregateReplay === 'replay' && aggregateReceipt) {
      if (aggregateReceipt.statusCode === CONTACT_INTAKE_PENDING_STATUS) {
        return { ok: false as const, message: 'This exact file is already being saved. Wait a moment, then try again.' };
      }
      const result = importResultFromStoredPlan(
        input.source,
        validateStoredContactImportPlanResult(aggregateReceipt.response),
      );
      recordImportCommitStage('receipt-recovered', startedAtMs, {
        counts: { rows: result.totalRows, created: result.created, updated: result.updated },
        supportReference: reference,
      });
      return { ok: true as const, result };
    }
    const parsed = await parseInputForWorkspace(input, workspaceScope.workspaceId);
    recordImportCommitStage('parsed', startedAtMs, {
      format: parsed.format,
      counts: { rows: parsed.totalRows },
      supportReference: reference,
    });
    const supabase = await import('@/lib/supabase/server')
      .then(({ createSupabaseServerClient }) => createSupabaseServerClient());
    const { data: preparedData, error: preflightError } = await supabase.rpc('prepare_data_import_run', {
      target_workspace_id: workspaceScope.workspaceId,
      target_actor_membership_id: workspaceScope.membershipId,
      target_source: parsed.provider,
      target_format: parsed.format,
      target_file_hash: fileHash,
      target_idempotency_key: receiptIdempotencyKey,
      target_expected_rows: parsed.totalRows,
      target_correlation_id: correlationId,
      target_occurred_at: new Date().toISOString(),
    });
    if (preflightError) {
      recordImportCommitStage('failed', startedAtMs, {
        format: parsed.format,
        supportReference: reference,
        databaseCode: safeDatabaseCode(preflightError),
      });
      return {
        ok: false as const,
        message: `Omnix needs a developer update before this file can be saved. No contacts were changed. Support reference ${reference}.`,
      };
    }
    const prepared = parseImportReceiptPreflight(preparedData);
    if (prepared.state !== 'ready') {
      const result = importResultFromReceipt(parsed.provider, prepared);
      recordImportCommitStage('receipt-recovered', startedAtMs, {
        format: parsed.format,
        counts: {
          rows: result.totalRows,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
        },
        supportReference: reference,
      });
      revalidatePath('/data');
      return { ok: true as const, result };
    }
    const preview = await previewContactImport(
      repository,
      importGateway,
      parsed,
      workspaceScope,
      activityRepository,
    );
    recordImportCommitStage('previewed', startedAtMs, {
      format: preview.format,
      counts: { rows: preview.totalRows },
      supportReference: reference,
    });
    recordImportCommitStage('preflight-ready', startedAtMs, {
      format: preview.format,
      counts: { rows: preview.totalRows },
      supportReference: reference,
    });
    const now = new Date();
    const result = await executeContactImport(repository, importGateway, preview, now, {
      workspaceScope,
      incompleteRecordRepository,
      activityRepository,
      richContactRepository,
      idempotencyKeyBase: receiptIdempotencyKey,
      atomic: {
        requestHash: fileHash,
        fileHash,
        correlationId,
        startedAt: startedAt.toISOString(),
      },
    });
    recordImportCommitStage('applied', startedAtMs, {
      format: preview.format,
      counts: {
        rows: result.totalRows,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        failed: result.failed,
      },
      supportReference: reference,
    });
    recordImportCommitStage('receipt-recorded', startedAtMs, {
      format: preview.format,
      counts: { rows: result.totalRows },
      supportReference: reference,
    });
    revalidatePath('/');
    revalidatePath('/contacts');
    revalidatePath('/contacts/incomplete');
    revalidatePath('/activities');
    return { ok: true as const, result };
  } catch (error) {
    recordImportCommitStage('failed', startedAtMs, { supportReference: reference });
    return { ok: false as const, message: error instanceof Error ? error.message : 'The import could not be saved.' };
  }
}

export async function saveImportMappingProfileAction(input:{name:string;mapping:ImportActionInput['mapping']}){
  try{const{workspaceScope,isLive}=await getRepository();if(!isLive)return{ok:false as const,message:'Saving profiles requires a live signed-in workspace.'};if(!input.name.trim())return{ok:false as const,message:'Profile name is required.'};const supabase=await import('@/lib/supabase/server').then(({createSupabaseServerClient})=>createSupabaseServerClient());const{data,error}=await supabase.rpc('save_data_mapping_profile',{target_workspace_id:workspaceScope.workspaceId,target_name:input.name,target_definition:{mapping:input.mapping??{},defaults:{}},target_actor_membership_id:workspaceScope.membershipId,target_created_at:new Date().toISOString()});if(error)throw error;return{ok:true as const,profile:{id:data.id,name:data.name,version:data.version}};}catch{return{ok:false as const,message:'The mapping profile could not be saved.'};}
}

export async function listImportMappingProfilesAction(){try{const{workspaceScope,isLive}=await getRepository();if(!isLive)return{ok:true as const,profiles:[]};const supabase=await import('@/lib/supabase/server').then(({createSupabaseServerClient})=>createSupabaseServerClient());const{data,error}=await supabase.from('data_mapping_profiles').select('id,name,version,definition').eq('workspace_id',workspaceScope.workspaceId).is('archived_at',null).order('name');if(error)throw error;return{ok:true as const,profiles:(data??[]).map((row)=>({id:String(row.id),name:String(row.name),version:Number(row.version),mapping:((row.definition as {mapping?:ImportActionInput['mapping']})?.mapping??{})}))};}catch{return{ok:false as const,profiles:[],message:'Saved mappings are unavailable.'};}}

export async function previewExistingImportOrganizationAction() {
  try {
    const context = await getRepository();
    if (!context.isLive || !context.richContactRepository) {
      return { ok: false as const, message: 'Automatic organization requires a signed-in live workspace.' };
    }
    const result = await organizeExistingImportedContacts({
      repository: context.repository,
      richContactRepository: context.richContactRepository,
      activityRepository: context.activityRepository,
      importGateway: context.importGateway,
      workspaceScope: context.workspaceScope,
    }, { dryRun: true });
    console.info(JSON.stringify({
      event: 'contact_import_organization_previewed',
      policyVersion: result.policyVersion,
      counts: {
        scanned: result.scanned,
        eligible: result.eligible,
        wouldUpdate: result.wouldUpdate,
        needsReview: result.needsReview,
      },
    }));
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Existing imports could not be reviewed.',
    };
  }
}

export async function applyExistingImportOrganizationAction() {
  try {
    const context = await getRepository();
    if (!context.isLive || !context.richContactRepository) {
      return { ok: false as const, message: 'Automatic organization requires a signed-in live workspace.' };
    }
    if (context.workspaceScope.role !== 'owner') {
      return { ok: false as const, message: 'Only the workspace owner can organize existing imports.' };
    }
    const result = await organizeExistingImportedContacts({
      repository: context.repository,
      richContactRepository: context.richContactRepository,
      activityRepository: context.activityRepository,
      importGateway: context.importGateway,
      workspaceScope: context.workspaceScope,
    }, { dryRun: false });
    console.info(JSON.stringify({
      event: 'contact_import_organization_applied',
      policyVersion: result.policyVersion,
      counts: {
        eligible: result.eligible,
        updated: result.updated,
        skippedProtected: result.skippedProtected,
        needsReview: result.needsReview,
        failed: result.failed,
      },
    }));
    revalidatePath('/');
    revalidatePath('/contacts');
    revalidatePath('/pipeline');
    revalidatePath('/activities');
    revalidatePath('/contacts/import');
    if (result.failed > 0) {
      return {
        ok: false as const,
        result,
        message: `${result.failed} contacts could not be organized. No other records were affected.`,
      };
    }
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Existing imports could not be organized.',
    };
  }
}

export async function rollbackExistingImportOrganizationAction(runId: string) {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      return { ok: false as const, message: 'The rollback receipt is invalid.' };
    }
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      return { ok: false as const, message: 'Only the workspace owner can restore a historical organization run.' };
    }
    if (!context.importGateway.rollbackImportedContactOrganization) {
      return { ok: false as const, message: 'Rollback is not available in this environment.' };
    }
    const occurredAt = new Date().toISOString();
    const rollbackHash = createHash('sha256').update(JSON.stringify({
      runId, workspaceId: context.workspaceScope.workspaceId, action: 'rollback',
    })).digest('hex');
    const receipt = await context.importGateway.rollbackImportedContactOrganization({
      scope: context.workspaceScope,
      runId,
      requestHash: rollbackHash,
      occurredAt,
    });
    revalidatePath('/');
    revalidatePath('/contacts');
    revalidatePath('/pipeline');
    revalidatePath('/activities');
    revalidatePath('/contacts/import');
    return { ok: true as const, receipt };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'The historical organization could not be restored.',
    };
  }
}
