import { OmnixCopilotError, OMNIX_COPILOT_QUESTION_MAX } from '../domain/omnix-copilot.ts';

/** No transcript or client-provided facts are accepted as current CRM evidence. */
export function validateOmnixAssistantRequest(question: unknown, options: unknown) {
  if (typeof question !== 'string' || !question.trim() || question.trim().length > OMNIX_COPILOT_QUESTION_MAX
    || /[\u0000-\u001f\u007f]/u.test(question)) {
    throw new OmnixCopilotError('invalid-input', `Enter a printable question of at most ${OMNIX_COPILOT_QUESTION_MAX} characters.`);
  }
  const value = options === undefined ? { source: 'crm' } : options;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['source', 'contactId'].includes(key))) {
    throw new OmnixCopilotError('invalid-input', 'Choose CRM or Public web as the source.');
  }
  const input = value as Record<string, unknown>;
  if (input.source !== 'crm' && input.source !== 'public-web') {
    throw new OmnixCopilotError('invalid-input', 'Choose CRM or Public web as the source.');
  }
  if (input.contactId !== undefined && (typeof input.contactId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.contactId))) {
    throw new OmnixCopilotError('invalid-input', 'Choose a contact from the CRM results.');
  }
  if (input.source === 'public-web' && (input.contactId !== undefined || containsPrivateResearchContext(question))) {
    throw new OmnixCopilotError('unsupported-intent', 'Keep client information in CRM mode. Public web research needs a separate public question.');
  }
  return { question: question.trim(), source: input.source, contactId: input.contactId as string | undefined };
}

/** Defense in depth; a valid explicit public-web model route is required as well. */
export function containsPrivateResearchContext(question: string): boolean {
  return /\b(?:crm|my client|our client|my customer|our customer|my contact|our contact|client records?|private|confidential|meu cliente|minha cliente|nosso cliente|mi cliente|nuestro cliente)\b/iu.test(question)
    || /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u.test(question)
    || /(?:\+\d[\d ()-]{8,}\d|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b)/u.test(question);
}

export function contextualOmnixQuestion(question: string, canonicalContactId?: string): string {
  if (!canonicalContactId || !/\b(?:her|his|their|this client|this contact|dela|dele|desse cliente|dessa cliente)\b/iu.test(question)) return question;
  const normalized = question.toLowerCase().replace(/[?!.,]/gu, '').trim();
  // These compact follow-ups request a fresh client overview. More complex wording stays with the router.
  if (!/^(?:(?:and |what(?:'s| is| are) |show |how is |e |qual (?:é|o) |como está )?)(?:her|his|their|this client|this contact|dela|dele) (?:status|tasks|deals|transactions|follow-ups|nurture|pipeline)$/iu.test(normalized)) return question;
  const query = `client status ${canonicalContactId}`;
  return query.length <= OMNIX_COPILOT_QUESTION_MAX ? query : question;
}
