import { randomUUID } from 'node:crypto';
import { ContactImportError, parseJsonContactImport } from './contact-import.ts';
import { executeContactImport, previewContactImport } from './contact-import-service.ts';
import { requestFingerprint, websiteRequestHash } from './website-intake-security.ts';
import { classifyWebsiteLead, validateWebsiteLeadPayload } from '../domain/website-intake.ts';
import { websiteImportContact } from '../domain/website-intake.ts';
import type { createAutomationRepositories } from '../data/automation-context.ts';
import { CONTACT_INTAKE_PENDING_STATUS, validateStoredContactImportPlanResult } from '../data/import-gateway.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { afterResponse } from './after-response.ts';
import { notifyNewLeads } from './new-lead-alert-sender.ts';

export type WebsiteIntakeContext = ReturnType<typeof createAutomationRepositories> & { readonly workspaceScope: WorkspaceScope };

export interface WebsiteIntakeOutcome {
  readonly status: number;
  readonly message: string;
  readonly supportReference?: string;
  readonly headers?: Record<string, string>;
  /** Set when a contact was created or matched and a response task exists. */
  readonly contactId?: string;
}

/**
 * The shared, already-authenticated part of website lead intake: claim the
 * submission (idempotency, origin allow-list, rate limit), import the contact,
 * create the response task, record the receipt and alert the realtor. Callers
 * are responsible for authenticating the request (HMAC signature for external
 * websites; the server itself for the hosted Omnix lead page).
 */
export async function processWebsiteLeadSubmission(context: WebsiteIntakeContext, input: {
  readonly endpointKey: string;
  readonly body: string;
  readonly idempotencyKey: string;
  readonly origin: string;
  readonly forwardedFor?: string | null;
  readonly userAgent?: string | null;
  readonly receivedAt: Date;
}): Promise<WebsiteIntakeOutcome> {
  const { receivedAt, idempotencyKey, origin, body } = input;
  const requestHash = websiteRequestHash(body);
  let claim;
  try {
    claim = await context.websiteIntakeRepository.claim({
      workspaceId: context.workspaceScope.workspaceId, endpointKey: input.endpointKey, idempotencyKey, requestHash, origin,
      ipHash: requestFingerprint(input.forwardedFor ?? undefined), userAgentHash: requestFingerprint(input.userAgent ?? undefined), receivedAt: receivedAt.toISOString(),
    });
  } catch (error) {
    console.error('Website intake claim failed.', error);
    return { status: 503, message: 'Website lead intake is temporarily unavailable.' };
  }
  if (claim.outcome === 'disabled') return { status: 503, message: 'Website lead intake is not active.' };
  if (claim.outcome === 'conflict') return { status: 409, message: 'This submission key was already used for different information.', supportReference: claim.supportReference };
  if (claim.outcome === 'processing') return { status: 202, message: 'This form submission is already being processed.', supportReference: claim.supportReference, headers: { 'Retry-After': '10' } };
  if (claim.outcome === 'origin-denied') return { status: 403, message: 'This website is not authorized to submit leads.', supportReference: claim.supportReference };
  if (claim.outcome === 'rate-limited') return { status: 429, message: 'Too many form submissions. Please retry shortly.', supportReference: claim.supportReference, headers: { 'Retry-After': '60' } };
  if (claim.outcome === 'replay') {
    return {
      status: claim.status === 'review' ? 202 : 200,
      message: claim.status === 'review' ? 'This lead is already waiting for a safe identity review.' : 'This lead was already received.',
      supportReference: claim.supportReference, headers: { 'Idempotency-Replayed': 'true' },
    };
  }
  if (claim.outcome !== 'accepted') return { status: 503, message: 'Website lead intake is temporarily unavailable.' };

  const submissionId = claim.submissionId;
  const supportReference = claim.supportReference;
  try {
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new ContactImportError('Form data must be valid JSON.'); }
    const payload = validateWebsiteLeadPayload(raw);
    if (payload.submissionId !== idempotencyKey) throw new ContactImportError('Submission key does not match the signed form.');
    const classification = classifyWebsiteLead(payload);
    const classificationEvidence = { ...classification };
    const attribution = { ...payload.attribution };
    const consent = { ...payload.consent };
    const parsed = parseJsonContactImport({ source: 'website', contacts: [websiteImportContact(payload, classification)] });
    const preview = await previewContactImport(context.repository, context.importGateway, parsed, context.workspaceScope, context.activityRepository);
    await executeContactImport(context.repository, context.importGateway, preview, receivedAt, {
      workspaceScope: context.workspaceScope, incompleteRecordRepository: context.incompleteRecordRepository, activityRepository: context.activityRepository,
      idempotencyKeyBase: `website:${supportReference}`, atomic: { requestHash, fileHash: requestHash, correlationId: randomUUID(), startedAt: receivedAt.toISOString() },
    });
    const terminalReceipt = await context.importGateway.getReceipt(`website:${supportReference}`);
    if (!terminalReceipt || terminalReceipt.statusCode === CONTACT_INTAKE_PENDING_STATUS || terminalReceipt.requestHash !== requestHash) throw new Error('Canonical website import receipt is incomplete.');
    const terminal = validateStoredContactImportPlanResult(terminalReceipt.response);
    const row = terminal.rowOutcomes[0];
    if (!row || row.outcome === 'rejected' || row.outcome === 'quarantined' || !row.contactId) {
      await context.websiteIntakeRepository.review({
        workspaceId: context.workspaceScope.workspaceId, submissionId, attribution, consent, classification: classificationEvidence,
        reviewCategory: row?.outcome === 'quarantined' ? 'ambiguous-identity' : 'identity-review-required', completedAt: new Date().toISOString(),
      });
      return { status: 202, message: 'Your information was received and is waiting for a safe identity review.', supportReference };
    }
    const dueAt = new Date(Date.parse(claim.receivedAt) + claim.responseSlaMinutes * 60_000).toISOString();
    const taskResult = await context.activityRepository.createTask(context.workspaceScope, {
      contactId: row.contactId, title: `Respond to ${payload.firstName} ${payload.lastName} website lead`,
      description: `Website ${payload.requestedAction.replaceAll('-', ' ')} from ${payload.attribution.formId}. Review consent before choosing a channel.`,
      dueAt, creatorMembershipId: context.workspaceScope.membershipId, assigneeMembershipId: claim.responsibleMembershipId,
      createdAt: new Date().toISOString(), idempotencyKey: `website-response:${supportReference}`,
    });
    await context.websiteIntakeRepository.finalize({
      workspaceId: context.workspaceScope.workspaceId, submissionId, contactId: row.contactId, taskId: taskResult.task.id, identityOutcome: row.outcome,
      attribution, consent, classification: classificationEvidence, completedAt: new Date().toISOString(),
    });
    const alertWorkspaceId = context.workspaceScope.workspaceId;
    const alertLead = { contactId: row.contactId, firstName: payload.firstName, lastName: payload.lastName, source: 'website' };
    afterResponse(() => notifyNewLeads(alertWorkspaceId, [alertLead]));
    return { status: 200, message: 'Your information was received. The realtor has a follow-up ready.', supportReference, contactId: row.contactId };
  } catch (error) {
    const category = error instanceof ContactImportError || error instanceof SyntaxError || error instanceof TypeError ? 'payload-invalid' : 'downstream-unavailable';
    try {
      await context.websiteIntakeRepository.fail({ workspaceId: context.workspaceScope.workspaceId, submissionId, failureCategory: category, failedAt: new Date().toISOString() });
    } catch (receiptError) {
      console.error('Website intake failure receipt could not be recorded.', { supportReference, error: receiptError });
    }
    console.error('Website intake failed safely.', { supportReference, category });
    return {
      status: category === 'payload-invalid' ? 422 : 503,
      message: category === 'payload-invalid' ? 'The form information is invalid. Please review it and try again.' : 'Your information could not be finalized. Retry the exact same submission.',
      supportReference, headers: { 'Retry-After': category === 'payload-invalid' ? '0' : '30' },
    };
  }
}
