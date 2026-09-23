import type { SupabaseClient } from '@supabase/supabase-js';

export type WebsiteIntakeClaim =
  | { readonly outcome: 'accepted'; readonly submissionId: string; readonly supportReference: string; readonly responseSlaMinutes: number; readonly responsibleMembershipId: string; readonly receivedAt: string }
  | { readonly outcome: 'replay'; readonly supportReference: string; readonly status: 'completed' | 'review' }
  | { readonly outcome: 'processing' | 'conflict' | 'origin-denied' | 'rate-limited'; readonly supportReference: string }
  | { readonly outcome: 'disabled' };

export interface WebsiteIntakeRepository {
  claim(input: { readonly workspaceId: string; readonly endpointKey: string; readonly idempotencyKey: string; readonly requestHash: string; readonly origin: string; readonly ipHash: string; readonly userAgentHash: string; readonly receivedAt: string }): Promise<WebsiteIntakeClaim>;
  finalize(input: { readonly workspaceId: string; readonly submissionId: string; readonly contactId: string; readonly taskId: string; readonly identityOutcome: 'created'|'updated'|'unchanged'; readonly attribution: Readonly<Record<string, unknown>>; readonly consent: Readonly<Record<string, unknown>>; readonly classification: Readonly<Record<string, unknown>>; readonly completedAt: string }): Promise<{ readonly status: 'completed'; readonly supportReference: string; readonly noOp: boolean }>;
  review(input: { readonly workspaceId: string; readonly submissionId: string; readonly attribution: Readonly<Record<string, unknown>>; readonly consent: Readonly<Record<string, unknown>>; readonly classification: Readonly<Record<string, unknown>>; readonly reviewCategory: string; readonly completedAt: string }): Promise<{ readonly status: 'review'; readonly supportReference: string; readonly noOp: boolean }>;
  fail(input: { readonly workspaceId: string; readonly submissionId: string; readonly failureCategory: string; readonly failedAt: string }): Promise<void>;
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

export function supabaseWebsiteIntakeRepository(client: SupabaseClient): WebsiteIntakeRepository {
  return {
    async claim(input) {
      const { data, error } = await client.rpc('claim_website_intake_submission', { target_workspace_id:input.workspaceId,target_endpoint_key:input.endpointKey,target_idempotency_key:input.idempotencyKey,target_request_hash:input.requestHash,target_origin:input.origin,target_ip_hash:input.ipHash,target_user_agent_hash:input.userAgentHash,target_received_at:input.receivedAt });
      if (error) throw new Error(`Website intake claim failed: ${error.message}`);
      const receipt=object(data,'Website intake claim returned an invalid receipt.');const outcome=String(receipt.outcome);
      if(outcome==='disabled')return{outcome};
      const supportReference=String(receipt.supportReference??'');if(!/^[A-F0-9]{8}$/.test(supportReference))throw new Error('Website intake claim returned an invalid support reference.');
      if(outcome==='accepted'){const responseSlaMinutes=Number(receipt.responseSlaMinutes);if(typeof receipt.submissionId!=='string'||typeof receipt.responsibleMembershipId!=='string'||typeof receipt.receivedAt!=='string'||!Number.isSafeInteger(responseSlaMinutes))throw new Error('Website intake claim returned incomplete authority.');return{outcome,submissionId:receipt.submissionId,supportReference,responseSlaMinutes,responsibleMembershipId:receipt.responsibleMembershipId,receivedAt:receipt.receivedAt};}
      if(outcome==='replay'&&(receipt.status==='completed'||receipt.status==='review'))return{outcome,supportReference,status:receipt.status};
      if(['processing','conflict','origin-denied','rate-limited'].includes(outcome))return{outcome:outcome as 'processing'|'conflict'|'origin-denied'|'rate-limited',supportReference};
      throw new Error('Website intake claim returned an unknown outcome.');
    },
    async finalize(input){const{data,error}=await client.rpc('finalize_website_intake_submission',{target_workspace_id:input.workspaceId,target_submission_id:input.submissionId,target_contact_id:input.contactId,target_task_id:input.taskId,target_identity_outcome:input.identityOutcome,target_attribution:input.attribution,target_consent:input.consent,target_classification:input.classification,target_completed_at:input.completedAt});if(error)throw new Error(`Website intake finalization failed: ${error.message}`);const receipt=object(data,'Website intake finalization returned an invalid receipt.');if(receipt.status!=='completed'||typeof receipt.supportReference!=='string'||typeof receipt.noOp!=='boolean')throw new Error('Website intake finalization returned incomplete evidence.');return{status:'completed',supportReference:receipt.supportReference,noOp:receipt.noOp};},
    async review(input){const{data,error}=await client.rpc('review_website_intake_submission',{target_workspace_id:input.workspaceId,target_submission_id:input.submissionId,target_attribution:input.attribution,target_consent:input.consent,target_classification:input.classification,target_review_category:input.reviewCategory,target_completed_at:input.completedAt});if(error)throw new Error(`Website intake review failed: ${error.message}`);const receipt=object(data,'Website intake review returned an invalid receipt.');if(receipt.status!=='review'||typeof receipt.supportReference!=='string'||typeof receipt.noOp!=='boolean')throw new Error('Website intake review returned incomplete evidence.');return{status:'review',supportReference:receipt.supportReference,noOp:receipt.noOp};},
    async fail(input){const{error}=await client.rpc('fail_website_intake_submission',{target_workspace_id:input.workspaceId,target_submission_id:input.submissionId,target_failure_category:input.failureCategory,target_failed_at:input.failedAt});if(error)throw new Error(`Website intake failure receipt could not be recorded: ${error.message}`);},
  };
}
