import {
  hasImportedContactSuppression,
  type ContactImportCandidate,
  type ContactImportSourceFact,
} from './contact-import.ts';

export const CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION = 'omnix.import-classification.v1';

export type ImportClassificationField =
  | 'leadType'
  | 'qualificationStatus'
  | 'relationship'
  | 'intent'
  | 'source'
  | 'pipelineStage';

export interface ImportClassificationDecision {
  readonly field: ImportClassificationField;
  readonly value: string;
  readonly reason: string;
}

export interface ContactImportClassification {
  readonly policyVersion: typeof CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION;
  readonly mode: 'explicit' | 'automatic' | 'safe-default';
  readonly confidence: 'high' | 'medium' | 'review';
  readonly needsReview: boolean;
  readonly summary: string;
  readonly decisions: readonly ImportClassificationDecision[];
}

export interface ClassifiedContactImportCandidate {
  readonly candidate: ContactImportCandidate;
  readonly classification: ContactImportClassification;
}

type Lifecycle =
  | 'under-contract'
  | 'appointment'
  | 'active-client'
  | 'active-lead'
  | 'past-client'
  | 'sphere'
  | 'lost'
  | 'new-lead';

function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function sourceFact(
  facts: readonly ContactImportSourceFact[],
  key: string,
): ContactImportSourceFact | undefined {
  return facts.find((fact) => fact.key.toLocaleLowerCase('en-US') === key);
}

function numericFact(facts: readonly ContactImportSourceFact[], key: string): number | undefined {
  const value = sourceFact(facts, key)?.value;
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function textFact(facts: readonly ContactImportSourceFact[], key: string): string {
  return normalized(sourceFact(facts, key)?.value);
}

function lifecycleFrom(signal: string, hasClosedDate: boolean): Lifecycle | undefined {
  if (/\b(under contract|pending|escrow|in contract)\b/.test(signal)) return 'under-contract';
  if (/\b(appointment|consultation|meeting set)\b/.test(signal)) return 'appointment';
  if (/\b(sphere|soi|center of influence|personal contact|vendor|agent)\b/.test(signal)) return 'sphere';
  if (/\b(lost|inactive|archived?|dead|trash|do not contact|dnc)\b/.test(signal)) return 'lost';
  if (hasClosedDate || /\b(past client|former client|closed|sold)\b/.test(signal)) return 'past-client';
  if (/\b(active client|current client|buyer client|seller client)\b/.test(signal) || signal === 'client') return 'active-client';
  if (/\b(active lead|qualified lead|working lead)\b/.test(signal)) return 'active-lead';
  if (/\b(new lead|prospect|lead)\b/.test(signal)) return 'new-lead';
  return undefined;
}

function lifecycleFromCanonical(input: ContactImportCandidate): Lifecycle | undefined {
  if (input.pipelineStage === 'under-contract') return 'under-contract';
  if (input.pipelineStage === 'appointment-set') return 'appointment';
  if (input.pipelineStage === 'closed' || input.relationship === 'past-client') return 'past-client';
  if (input.pipelineStage === 'lost') return 'lost';
  if (input.relationship === 'sphere') return 'sphere';
  if (input.relationship === 'active-client') return 'active-client';
  if (input.pipelineStage === 'active') return 'active-lead';
  if (input.pipelineStage === 'contacted') return 'new-lead';
  if (input.pipelineStage === 'new') return 'new-lead';
  return undefined;
}

function intentFrom(facts: readonly ContactImportSourceFact[]): ContactImportCandidate['intent'] {
  const dealType = textFact(facts, 'deal-type');
  if (/\bbuyer\b/.test(dealType) && /\bseller\b/.test(dealType)) return 'both';
  if (/\binvest/.test(dealType)) return 'investor';
  if (/\brent/.test(dealType)) return 'renter';
  if (/\bbuyer\b/.test(dealType)) return 'buyer';
  if (/\bseller\b/.test(dealType)) return 'seller';
  return undefined;
}

function relationshipFor(lifecycle: Lifecycle | undefined): ContactImportCandidate['relationship'] {
  if (lifecycle === 'under-contract' || lifecycle === 'active-client') return 'active-client';
  if (lifecycle === 'past-client') return 'past-client';
  if (lifecycle === 'sphere') return 'sphere';
  return 'lead';
}

function pipelineFor(lifecycle: Lifecycle | undefined): ContactImportCandidate['pipelineStage'] {
  if (lifecycle === 'under-contract') return 'under-contract';
  if (lifecycle === 'appointment') return 'appointment-set';
  if (lifecycle === 'active-client' || lifecycle === 'active-lead') return 'active';
  if (lifecycle === 'past-client') return 'closed';
  if (lifecycle === 'sphere') return 'contacted';
  if (lifecycle === 'lost') return 'lost';
  return 'new';
}

function temperatureFor(
  rating: number | undefined,
  lifecycle: Lifecycle | undefined,
): ContactImportCandidate['leadType'] {
  if (rating !== undefined) {
    if (rating >= 4) return 'hot';
    if (rating >= 2) return 'warm';
    return 'nurture';
  }
  if (lifecycle === 'under-contract' || lifecycle === 'appointment') return 'hot';
  if (lifecycle === 'active-client' || lifecycle === 'active-lead') return 'warm';
  return 'nurture';
}

function reasonForLifecycle(lifecycle: Lifecycle): string {
  const labels: Record<Lifecycle, string> = {
    'under-contract': 'The imported lifecycle shows an active contract.',
    appointment: 'The imported lifecycle shows a scheduled appointment.',
    'active-client': 'The imported lifecycle identifies an active client.',
    'active-lead': 'The imported lifecycle identifies an active lead.',
    'past-client': 'The imported history identifies a past or closed client.',
    sphere: 'The imported lifecycle identifies a sphere relationship.',
    lost: 'The imported lifecycle identifies an inactive or lost lead.',
    'new-lead': 'The imported lifecycle identifies a new lead.',
  };
  return labels[lifecycle];
}

export function classifyContactImportCandidate(
  input: ContactImportCandidate,
): ClassifiedContactImportCandidate {
  const facts = input.sourceFacts ?? [];
  const status = textFact(facts, 'status');
  const tagSignal = normalized(input.tags.join(' '));
  const noteSignal = normalized(input.note);
  const signal = [status, tagSignal, noteSignal].filter(Boolean).join(' ');
  const hasClosedDate = Boolean(sourceFact(facts, 'last-closed-date')?.value || input.homePurchaseDate);
  const lifecycle = lifecycleFromCanonical(input) ?? lifecycleFrom(signal, hasClosedDate);
  const rating = numericFact(facts, 'rating');
  const hasBusinessEvidence = lifecycle !== undefined || rating !== undefined;
  const confidence: ContactImportClassification['confidence'] = lifecycle || rating !== undefined
    ? 'high'
    : signal || hasClosedDate ? 'medium' : 'review';
  const needsReview = !hasBusinessEvidence;
  const candidate: ContactImportCandidate = { ...input, tags: [...input.tags] };
  if (hasImportedContactSuppression(candidate)) candidate.emailSubscribed = false;
  const decisions: ImportClassificationDecision[] = [];

  function fill(
    field: ImportClassificationField,
    value: string,
    reason: string,
  ): void {
    if (candidate[field] !== undefined) return;
    (candidate as unknown as Record<string, unknown>)[field] = value;
    decisions.push({ field, value, reason });
  }

  const lifecycleReason = lifecycle
    ? reasonForLifecycle(lifecycle)
    : 'No reliable lifecycle signal was found, so Omnix used a safe starting point.';
  const temperature = temperatureFor(rating, lifecycle);
  const temperatureReason = rating !== undefined
    ? `The imported rating is ${rating}; ratings 4–5 are Hot, 2–3 are Warm, and 0–1 are Nurture.`
    : lifecycleReason;

  fill('leadType', temperature ?? 'nurture', temperatureReason);
  fill('relationship', relationshipFor(lifecycle) ?? 'lead', lifecycleReason);
  fill('pipelineStage', pipelineFor(lifecycle) ?? 'new', lifecycleReason);
  fill('qualificationStatus', needsReview ? 'needs-qualification' : 'qualified', needsReview
    ? 'The file did not include a reliable lifecycle or rating, so this contact is safely queued for review.'
    : 'The imported lifecycle or rating provides a usable classification signal.');
  fill('intent', intentFrom(facts) ?? 'unknown', intentFrom(facts)
    ? 'Buyer or seller intent came from the imported deal type.'
    : 'The file did not include a recognized buyer or seller intent.');
  fill('source', 'other', 'The original source is preserved in Imported profile when it does not match an Omnix source.');

  const mode: ContactImportClassification['mode'] = needsReview
    ? 'safe-default'
    : decisions.length ? 'automatic' : 'explicit';
  const summary = mode === 'explicit'
    ? 'The file already provided the CRM classification.'
    : needsReview
      ? 'Organized safely as Nurture and queued for review because the file lacked a reliable lifecycle or rating.'
      : lifecycle
        ? reasonForLifecycle(lifecycle)
        : `The imported rating organized this contact as ${temperature === 'hot' ? 'Hot' : temperature === 'warm' ? 'Warm' : 'Nurture'}.`;

  return {
    candidate,
    classification: {
      policyVersion: CONTACT_IMPORT_CLASSIFICATION_POLICY_VERSION,
      mode,
      confidence,
      needsReview,
      summary,
      decisions,
    },
  };
}
