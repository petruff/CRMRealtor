import { describe, expect, it } from 'vitest';
import { contextualOmnixQuestion, validateOmnixAssistantRequest } from './omnix-assistant-request';

describe('assistant source and selected-client request boundary', () => {
  it('defaults legacy callers to CRM and accepts only bounded explicit context', () => {
    expect(validateOmnixAssistantRequest('Show transactions', undefined)).toEqual({ question: 'Show transactions', source: 'crm', contactId: undefined });
    expect(validateOmnixAssistantRequest('and her status?', { source: 'crm', contactId: 'c-alicia' }).contactId).toBe('c-alicia');
    for (const options of [null, [], { source: 'auto' }, { source: 'crm', transcript: 'trusted facts' }, { source: 'crm', contactId: '../other' }]) {
      expect(() => validateOmnixAssistantRequest('question', options)).toThrow();
    }
  });
  it('rejects private context in public mode before any model call', () => {
    for (const question of ['Research my client Alicia', 'Pesquisar meu cliente', 'Research x@example.com', 'Research +1 (555) 123-4567']) {
      expect(() => validateOmnixAssistantRequest(question, { source: 'public-web' })).toThrow(/client information/);
    }
    expect(() => validateOmnixAssistantRequest('Florida housing trends', { source: 'public-web', contactId: 'c-alicia' })).toThrow();
    expect(validateOmnixAssistantRequest('Florida housing trends', { source: 'public-web' }).source).toBe('public-web');
  });
  it('rejects oversized, non-string and control input', () => {
    for (const question of [null, 42, '', 'x'.repeat(201), 'client\nstatus']) {
      expect(() => validateOmnixAssistantRequest(question, undefined)).toThrow();
    }
  });
  it('resolves only simple follow-ups from a server-loaded ID and preserves complex requests', () => {
    expect(contextualOmnixQuestion('and her status?', 'c-alicia')).toBe('client status c-alicia');
    expect(contextualOmnixQuestion('Show this client status', 'c-alicia')).toBe('client status c-alicia');
    expect(contextualOmnixQuestion('and her status?')).toBe('and her status?');
    expect(contextualOmnixQuestion('her status and research mortgage trends', 'Alicia Morgan')).toBe('her status and research mortgage trends');
  });
});
