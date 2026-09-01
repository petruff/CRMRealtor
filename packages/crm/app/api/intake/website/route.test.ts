import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { websiteSignature } from '@/lib/application/website-intake-security';

const { createAutomationContext, previewContactImport, executeContactImport } = vi.hoisted(() => ({
  createAutomationContext: vi.fn(),
  previewContactImport: vi.fn(),
  executeContactImport: vi.fn(),
}));

vi.mock('@/lib/data/automation-context', () => ({ createAutomationContext }));
vi.mock('@/lib/application/contact-import-service', () => ({ previewContactImport, executeContactImport }));

import { POST } from './route';

const secret='s'.repeat(32);const timestamp=String(Math.floor(Date.now()/1000));
const payload={submissionId:'lead-12345678',firstName:'Avery',lastName:'Buyer',email:'avery@example.com',intent:'buyer',requestedAction:'showing-request',timelineDays:14,attribution:{source:'instagram',medium:'social',campaign:'waterfront',formId:'property-interest',landingPage:'https://judith.example/listing'},consent:{email:'granted',sms:'unknown',phone:'granted',policyVersion:'privacy-v1'}};
const terminal=(outcome:'created'|'quarantined')=>({idempotencyKey:'website:A1B2C3D4',requestHash:'unused',statusCode:200,response:{state:'recorded',runId:'run-1',planHash:'a'.repeat(64),counts:{total:1,created:outcome==='created'?1:0,updated:0,unchanged:0,rejected:0,quarantined:outcome==='quarantined'?1:0,failed:0,notesAdded:0},rowOutcomes:[outcome==='created'?{rowNumber:1,outcome:'created',contactId:'contact-1'}:{rowNumber:1,outcome:'quarantined',incompleteRecordId:'review-1'}],noOp:false},createdAt:new Date().toISOString()});

function request(body:string,signature?:string){return new NextRequest('http://localhost/api/intake/website',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'lead-12345678','origin':'https://judith.example','x-omnix-timestamp':timestamp,'x-omnix-signature':signature??websiteSignature(secret,Number(timestamp),'lead-12345678','https://judith.example',body),'x-forwarded-for':'203.0.113.5','user-agent':'route-test'},body});}

function context(outcome:'created'|'quarantined'='created'){
  const receipt=terminal(outcome);return{workspaceScope:{workspaceId:'workspace-1',membershipId:'owner-member',authenticatedUserId:'owner-user',ownerUserId:'owner-user',role:'owner',mode:'live'},repository:{},incompleteRecordRepository:{},importGateway:{getReceipt:vi.fn().mockResolvedValue({...receipt,requestHash:'b'.repeat(64)})},activityRepository:{createTask:vi.fn().mockResolvedValue({task:{id:'task-1'},event:{},noOp:false})},websiteIntakeRepository:{claim:vi.fn().mockResolvedValue({outcome:'accepted',submissionId:'submission-1',supportReference:'A1B2C3D4',responseSlaMinutes:5,responsibleMembershipId:'owner-member',receivedAt:new Date().toISOString()}),finalize:vi.fn().mockResolvedValue({status:'completed',supportReference:'A1B2C3D4',noOp:false}),review:vi.fn().mockResolvedValue({status:'review',supportReference:'A1B2C3D4',noOp:false}),fail:vi.fn().mockResolvedValue(undefined)}};
}

describe('POST signed website intake',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','service-role');vi.stubEnv('OMNIX_INTAKE_WORKSPACE_ID','223e4567-e89b-42d3-a456-426614174000');vi.stubEnv('OMNIX_INTAKE_TOKEN','intake-token-with-at-least-24');vi.stubEnv('OMNIX_WEBSITE_INTAKE_ENDPOINT_KEY','judith-web');vi.stubEnv('OMNIX_WEBSITE_INTAKE_SECRET',secret);previewContactImport.mockResolvedValue({groups:[]});executeContactImport.mockResolvedValue({});});
  afterEach(()=>vi.unstubAllEnvs());

  it('rejects invalid signatures before loading workspace authority',async()=>{const response=await POST(request(JSON.stringify(payload),'v1='+'0'.repeat(64)));expect(response.status).toBe(401);expect(createAutomationContext).not.toHaveBeenCalled();});
  it('imports one canonical contact, creates one SLA task, and finalizes evidence',async()=>{const body=JSON.stringify(payload);const value=context();const requestHash=(await import('@/lib/application/website-intake-security')).websiteRequestHash(body);value.importGateway.getReceipt.mockResolvedValue({...terminal('created'),requestHash});createAutomationContext.mockResolvedValue(value);const response=await POST(request(body));expect(response.status).toBe(200);expect(value.activityRepository.createTask).toHaveBeenCalledWith(value.workspaceScope,expect.objectContaining({contactId:'contact-1',assigneeMembershipId:'owner-member',idempotencyKey:'website-response:A1B2C3D4'}));expect(value.websiteIntakeRepository.finalize).toHaveBeenCalledWith(expect.objectContaining({contactId:'contact-1',identityOutcome:'created'}));});
  it('routes ambiguous canonical identity to review without creating a task',async()=>{const body=JSON.stringify(payload);const value=context('quarantined');const requestHash=(await import('@/lib/application/website-intake-security')).websiteRequestHash(body);value.importGateway.getReceipt.mockResolvedValue({...terminal('quarantined'),requestHash});createAutomationContext.mockResolvedValue(value);const response=await POST(request(body));expect(response.status).toBe(202);expect(value.websiteIntakeRepository.review).toHaveBeenCalledWith(expect.objectContaining({reviewCategory:'ambiguous-identity'}));expect(value.activityRepository.createTask).not.toHaveBeenCalled();});
  it('returns terminal replay without parsing or duplicating contact work',async()=>{const body=JSON.stringify(payload);const value=context();value.websiteIntakeRepository.claim.mockResolvedValue({outcome:'replay',supportReference:'A1B2C3D4',status:'completed'});createAutomationContext.mockResolvedValue(value);const response=await POST(request(body));expect(response.status).toBe(200);expect(response.headers.get('idempotency-replayed')).toBe('true');expect(previewContactImport).not.toHaveBeenCalled();});
});
