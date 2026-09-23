import type { Intent, LeadType, QualificationStatus } from './contact';

export const WEBSITE_INTAKE_ACTIONS = ['general-inquiry', 'saved-property', 'favorite-property', 'showing-request', 'seller-consultation'] as const;
export type WebsiteIntakeAction = (typeof WEBSITE_INTAKE_ACTIONS)[number];
export const WEBSITE_CONSENT_STATES = ['granted', 'declined', 'unknown'] as const;
export type WebsiteConsentState = (typeof WEBSITE_CONSENT_STATES)[number];
export const WEBSITE_INTAKE_POLICY_VERSION = 'omnix.website-intake.v1';

export interface WebsiteLeadPayload {
  readonly submissionId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly intent: Intent;
  readonly requestedAction: WebsiteIntakeAction;
  readonly timelineDays?: number;
  readonly preApproved?: boolean;
  readonly message?: string;
  readonly attribution: {
    readonly source: string;
    readonly medium?: string;
    readonly campaign?: string;
    readonly formId: string;
    readonly landingPage: string;
    readonly referrer?: string;
  };
  readonly consent: {
    readonly email: WebsiteConsentState;
    readonly sms: WebsiteConsentState;
    readonly phone: WebsiteConsentState;
    readonly policyVersion: string;
  };
}

export interface WebsiteLeadClassification {
  readonly policyVersion: typeof WEBSITE_INTAKE_POLICY_VERSION;
  readonly leadType: LeadType;
  readonly qualificationStatus: QualificationStatus;
  readonly reasons: readonly string[];
}

const CONTROL = /[\u0000-\u001f\u007f]/u;
const SAFE_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const INTENTS: readonly Intent[] = ['buyer', 'seller', 'both', 'investor', 'renter', 'unknown'];

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${name} is required.`);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > max || CONTROL.test(normalized)) throw new Error(`${name} is invalid.`);
  return normalized;
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, name, max);
}

function webUrl(value: unknown, name: string, required: boolean): string | undefined {
  const normalized = optionalText(value, name, 500);
  if (!normalized) {
    if (required) throw new Error(`${name} is required.`);
    return undefined;
  }
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${name} must be a valid HTTPS URL.`);
  parsed.hash = '';
  return parsed.toString();
}

export function validateWebsiteLeadPayload(value: unknown): WebsiteLeadPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Website lead payload must be an object.');
  const input = value as Record<string, unknown>;
  const submissionId = text(input.submissionId, 'Submission ID', 128);
  if (!SAFE_KEY.test(submissionId)) throw new Error('Submission ID is invalid.');
  const firstName = text(input.firstName, 'First name', 100);
  const lastName = text(input.lastName, 'Last name', 100);
  const email = optionalText(input.email, 'Email', 254)?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email is invalid.');
  const phone = optionalText(input.phone, 'Phone', 40);
  const phoneDigits = phone?.replace(/\D/g, '') ?? '';
  if (phone && (phoneDigits.length < 10 || phoneDigits.length > 15)) throw new Error('Phone is invalid.');
  if (!email && !phone) throw new Error('Email or phone is required.');
  const intent = input.intent as Intent;
  const requestedAction = input.requestedAction as WebsiteIntakeAction;
  if (!INTENTS.includes(intent)) throw new Error('Intent is invalid.');
  if (!WEBSITE_INTAKE_ACTIONS.includes(requestedAction)) throw new Error('Requested action is invalid.');
  const timelineDays = input.timelineDays === undefined ? undefined : Number(input.timelineDays);
  if (timelineDays !== undefined && (!Number.isSafeInteger(timelineDays) || timelineDays < 0 || timelineDays > 3650)) throw new Error('Timeline is invalid.');
  if (input.preApproved !== undefined && typeof input.preApproved !== 'boolean') throw new Error('Pre-approval state is invalid.');
  const attributionValue = input.attribution;
  if (!attributionValue || typeof attributionValue !== 'object' || Array.isArray(attributionValue)) throw new Error('Attribution is required.');
  const attributionInput = attributionValue as Record<string, unknown>;
  const source = text(attributionInput.source, 'Lead source', 80).toLowerCase();
  const formId = text(attributionInput.formId, 'Form ID', 120);
  const landingPage = webUrl(attributionInput.landingPage, 'Landing page', true) as string;
  const consentValue = input.consent;
  if (!consentValue || typeof consentValue !== 'object' || Array.isArray(consentValue)) throw new Error('Consent evidence is required.');
  const consentInput = consentValue as Record<string, unknown>;
  const emailConsent = consentInput.email as WebsiteConsentState;
  const smsConsent = consentInput.sms as WebsiteConsentState;
  const phoneConsent = consentInput.phone as WebsiteConsentState;
  if (![emailConsent, smsConsent, phoneConsent].every((state) => WEBSITE_CONSENT_STATES.includes(state))) throw new Error('Consent state is invalid.');
  const policyVersion = text(consentInput.policyVersion, 'Consent policy version', 80);
  return Object.freeze({
    submissionId, firstName, lastName, ...(email ? { email } : {}), ...(phone ? { phone } : {}), intent, requestedAction,
    ...(timelineDays !== undefined ? { timelineDays } : {}), ...(input.preApproved !== undefined ? { preApproved: input.preApproved as boolean } : {}),
    ...(optionalText(input.message, 'Message', 2_000) ? { message: optionalText(input.message, 'Message', 2_000) } : {}),
    attribution: Object.freeze({ source, ...(optionalText(attributionInput.medium, 'Medium', 80) ? { medium: optionalText(attributionInput.medium, 'Medium', 80) } : {}), ...(optionalText(attributionInput.campaign, 'Campaign', 160) ? { campaign: optionalText(attributionInput.campaign, 'Campaign', 160) } : {}), formId, landingPage, ...(webUrl(attributionInput.referrer, 'Referrer', false) ? { referrer: webUrl(attributionInput.referrer, 'Referrer', false) } : {}) }),
    consent: Object.freeze({ email: emailConsent, sms: smsConsent, phone: phoneConsent, policyVersion }),
  });
}

export function classifyWebsiteLead(payload: WebsiteLeadPayload): WebsiteLeadClassification {
  const reasons: string[] = [];
  let leadType: LeadType = 'nurture';
  if (payload.requestedAction === 'showing-request' || payload.requestedAction === 'seller-consultation' || (payload.timelineDays !== undefined && payload.timelineDays <= 30)) {
    leadType = 'hot'; reasons.push(payload.requestedAction === 'showing-request' ? 'showing-requested' : payload.requestedAction === 'seller-consultation' ? 'seller-consultation-requested' : 'timeline-within-30-days');
  } else if (payload.requestedAction === 'saved-property' || payload.requestedAction === 'favorite-property' || payload.preApproved === true || (payload.timelineDays !== undefined && payload.timelineDays <= 90)) {
    leadType = 'warm';
    if (payload.requestedAction === 'saved-property' || payload.requestedAction === 'favorite-property') reasons.push('property-interest-recorded');
    else if (payload.preApproved) reasons.push('preapproval-reported');
    else reasons.push('timeline-within-90-days');
  } else reasons.push('no-immediate-timing-signal');
  return Object.freeze({ policyVersion: WEBSITE_INTAKE_POLICY_VERSION, leadType, qualificationStatus: payload.intent === 'unknown' ? 'needs-qualification' : 'qualified', reasons: Object.freeze(reasons) });
}

export function websiteImportContact(payload: WebsiteLeadPayload, classification: WebsiteLeadClassification): Record<string, string | boolean> {
  const note = [payload.message, `Website request: ${payload.requestedAction}.`, `Classification: ${classification.leadType} (${classification.reasons.join(', ')}).`].filter(Boolean).join(' ');
  return {
    externalId: `website:${payload.attribution.formId}:${payload.submissionId}`,
    firstName: payload.firstName, lastName: payload.lastName, ...(payload.email ? { email: payload.email } : {}), ...(payload.phone ? { phone: payload.phone } : {}),
    intent: payload.intent, source: 'website', leadType: classification.leadType, qualificationStatus: classification.qualificationStatus,
    relationship: 'lead', pipelineStage: 'new', emailSubscribed: payload.consent.email === 'granted', note,
  };
}
