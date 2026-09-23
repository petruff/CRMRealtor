import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ContactImportError, parseJsonContactImport } from '@/lib/application/contact-import';
import { executeContactImport, previewContactImport } from '@/lib/application/contact-import-service';
import { MAX_WEBSITE_INTAKE_BYTES, requestFingerprint, validWebsiteSignature, websiteIntakeConfiguration, websiteRequestHash } from '@/lib/application/website-intake-security';
import { classifyWebsiteLead, validateWebsiteLeadPayload, websiteImportContact } from '@/lib/domain/website-intake';
import { createAutomationContext } from '@/lib/data/automation-context';
import { CONTACT_INTAKE_PENDING_STATUS, validateStoredContactImportPlanResult } from '@/lib/data/import-gateway';
import { validIdempotencyKey } from '@/lib/application/intake-security';
import { afterResponse } from '@/lib/application/after-response';
import { notifyNewLeads } from '@/lib/application/new-lead-alert-sender';

export const runtime = 'nodejs';

function safe(status: number, message: string, supportReference?: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: status < 400, message, ...(supportReference ? { supportReference } : {}) }, { status, headers });
}

async function boundedBody(request: NextRequest): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBSITE_INTAKE_BYTES) return undefined;
  if (!request.body) return '';
  const reader=request.body.getReader();const decoder=new TextDecoder();let bytes=0;let body='';
  while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_WEBSITE_INTAKE_BYTES){await reader.cancel();return undefined;}body+=decoder.decode(value,{stream:true});}
  return body+decoder.decode();
}

export async function POST(request: NextRequest) {
  const receivedAt=new Date();const configuration=websiteIntakeConfiguration();
  if(!configuration)return safe(503,'Website lead intake is not configured.');
  const body=await boundedBody(request);if(body===undefined)return safe(413,'The form submission is too large.');
  const idempotencyKey=request.headers.get('idempotency-key');const origin=request.headers.get('origin')?.trim()??'';
  if(!validIdempotencyKey(idempotencyKey))return safe(400,'A valid submission key is required.');
  if(!validWebsiteSignature({signature:request.headers.get('x-omnix-signature'),timestamp:request.headers.get('x-omnix-timestamp'),idempotencyKey,origin,body,secret:configuration.signingSecret,now:receivedAt}))return safe(401,'The form signature is invalid or expired.');
  let context;
  try{context=await createAutomationContext(configuration);}catch(error){console.error('Website intake workspace binding failed.',error);return safe(503,'Website lead intake is temporarily unavailable.');}
  const requestHash=websiteRequestHash(body);const forwarded=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  let claim;
  try{claim=await context.websiteIntakeRepository.claim({workspaceId:context.workspaceScope.workspaceId,endpointKey:configuration.endpointKey,idempotencyKey,requestHash,origin,ipHash:requestFingerprint(forwarded),userAgentHash:requestFingerprint(request.headers.get('user-agent')),receivedAt:receivedAt.toISOString()});}catch(error){console.error('Website intake claim failed.',error);return safe(503,'Website lead intake is temporarily unavailable.');}
  if(claim.outcome==='disabled')return safe(503,'Website lead intake is not active.');
  if(claim.outcome==='conflict')return safe(409,'This submission key was already used for different information.',claim.supportReference);
  if(claim.outcome==='processing')return safe(202,'This form submission is already being processed.',claim.supportReference,{ 'Retry-After':'10' });
  if(claim.outcome==='origin-denied')return safe(403,'This website is not authorized to submit leads.',claim.supportReference);
  if(claim.outcome==='rate-limited')return safe(429,'Too many form submissions. Please retry shortly.',claim.supportReference,{ 'Retry-After':'60' });
  if(claim.outcome==='replay')return safe(claim.status==='review'?202:200,claim.status==='review'?'This lead is already waiting for a safe identity review.':'This lead was already received.',claim.supportReference,{ 'Idempotency-Replayed':'true' });
  if(claim.outcome!=='accepted')return safe(503,'Website lead intake is temporarily unavailable.');

  const submissionId=claim.submissionId;const supportReference=claim.supportReference;
  try{
    let raw:unknown;try{raw=JSON.parse(body);}catch{throw new ContactImportError('Form data must be valid JSON.');}
    const payload=validateWebsiteLeadPayload(raw);
    if(payload.submissionId!==idempotencyKey)throw new ContactImportError('Submission key does not match the signed form.');
    const classification=classifyWebsiteLead(payload);const classificationEvidence={...classification};const attribution={...payload.attribution};const consent={...payload.consent};
    const parsed=parseJsonContactImport({source:'website',contacts:[websiteImportContact(payload,classification)]});
    const preview=await previewContactImport(context.repository,context.importGateway,parsed,context.workspaceScope,context.activityRepository);
    await executeContactImport(context.repository,context.importGateway,preview,receivedAt,{workspaceScope:context.workspaceScope,incompleteRecordRepository:context.incompleteRecordRepository,activityRepository:context.activityRepository,idempotencyKeyBase:`website:${supportReference}`,atomic:{requestHash,fileHash:requestHash,correlationId:randomUUID(),startedAt:receivedAt.toISOString()}});
    const terminalReceipt=await context.importGateway.getReceipt(`website:${supportReference}`);
    if(!terminalReceipt||terminalReceipt.statusCode===CONTACT_INTAKE_PENDING_STATUS||terminalReceipt.requestHash!==requestHash)throw new Error('Canonical website import receipt is incomplete.');
    const terminal=validateStoredContactImportPlanResult(terminalReceipt.response);const row=terminal.rowOutcomes[0];
    if(!row||row.outcome==='rejected'||row.outcome==='quarantined'||!row.contactId){await context.websiteIntakeRepository.review({workspaceId:context.workspaceScope.workspaceId,submissionId,attribution,consent,classification:classificationEvidence,reviewCategory:row?.outcome==='quarantined'?'ambiguous-identity':'identity-review-required',completedAt:new Date().toISOString()});return safe(202,'Your information was received and is waiting for a safe identity review.',supportReference);}
    const dueAt=new Date(Date.parse(claim.receivedAt)+claim.responseSlaMinutes*60_000).toISOString();
    const taskResult=await context.activityRepository.createTask(context.workspaceScope,{contactId:row.contactId,title:`Respond to ${payload.firstName} ${payload.lastName} website lead`,description:`Website ${payload.requestedAction.replaceAll('-',' ')} from ${payload.attribution.formId}. Review consent before choosing a channel.`,dueAt,creatorMembershipId:context.workspaceScope.membershipId,assigneeMembershipId:claim.responsibleMembershipId,createdAt:new Date().toISOString(),idempotencyKey:`website-response:${supportReference}`});
    await context.websiteIntakeRepository.finalize({workspaceId:context.workspaceScope.workspaceId,submissionId,contactId:row.contactId,taskId:taskResult.task.id,identityOutcome:row.outcome,attribution,consent,classification:classificationEvidence,completedAt:new Date().toISOString()});
    const alertWorkspaceId=context.workspaceScope.workspaceId;const alertLead={contactId:row.contactId,firstName:payload.firstName,lastName:payload.lastName,source:'website'};
    afterResponse(()=>notifyNewLeads(alertWorkspaceId,[alertLead]));
    return safe(200,'Your information was received. The realtor has a follow-up ready.',supportReference);
  }catch(error){const category=error instanceof ContactImportError||error instanceof SyntaxError||error instanceof TypeError?'payload-invalid':'downstream-unavailable';try{await context.websiteIntakeRepository.fail({workspaceId:context.workspaceScope.workspaceId,submissionId,failureCategory:category,failedAt:new Date().toISOString()});}catch(receiptError){console.error('Website intake failure receipt could not be recorded.',{supportReference,error:receiptError});}console.error('Website intake failed safely.',{supportReference,category});return safe(category==='payload-invalid'?422:503,category==='payload-invalid'?'The form information is invalid. Please review it and try again.':'Your information could not be finalized. Retry the exact same submission.',supportReference,{ 'Retry-After':category==='payload-invalid'?'0':'30' });}
}
