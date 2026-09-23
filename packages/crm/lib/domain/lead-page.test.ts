import { describe, expect, it } from 'vitest';
import { LeadPageError, agentFirstName, isLeadPageKey, leadPagePayload, leadPageSource } from './lead-page.ts';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const input = { submissionId: '00000000-0000-4000-8000-000000000001', landingPage: 'https://omnix.test/l/lead-page-abc123def456', source: 'instagram' };

describe('lead page', () => {
  it('accepts only generated keys and short source tags', () => {
    expect(isLeadPageKey('lead-page-abc123def456')).toBe(true);
    expect(isLeadPageKey('lead-page-ABC')).toBe(false);
    expect(isLeadPageKey('website-main')).toBe(false);
    expect(leadPageSource('Instagram')).toBe('instagram');
    expect(leadPageSource('<script>')).toBe('lead-page');
    expect(leadPageSource(null)).toBe('lead-page');
  });

  it('greets with the agent’s first name, never a generic word', () => {
    expect(agentFirstName('Judith Realty')).toBe('Judith');
    expect(agentFirstName('Judith’s Workspace')).toBe('Judith');
    expect(agentFirstName("Judith's Workspace")).toBe('Judith');
    expect(agentFirstName('Your Omnix agent')).toBe('your agent');
    expect(agentFirstName('Omnix workspace')).toBe('your agent');
    expect(agentFirstName('  ')).toBe('your agent');
  });

  it('builds a website-intake payload with explicit consent', () => {
    const payload = leadPagePayload(form({
      firstName: ' Ana ', lastName: 'Silva', phone: '(305) 555-0101', email: 'ANA@Example.com',
      intent: 'buyer', help: 'showing-request', timeframe: '3-months', message: 'Brickell condo', smsConsent: 'on',
    }), input);
    expect(payload).toMatchObject({
      firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', phone: '(305) 555-0101',
      intent: 'buyer', requestedAction: 'showing-request', timelineDays: 90, message: 'Brickell condo',
      attribution: { source: 'instagram', medium: 'lead-page' },
      consent: { sms: 'granted', email: 'declined', phone: 'unknown' },
    });
  });

  it('defaults unknown choices safely', () => {
    const payload = leadPagePayload(form({ firstName: 'Ana', lastName: 'Silva', email: 'a@b.co', intent: 'hacker', help: 'x', timeframe: 'just-looking' }), input);
    expect(payload.intent).toBe('unknown');
    expect(payload.requestedAction).toBe('general-inquiry');
    expect(payload).not.toHaveProperty('timelineDays');
    expect(payload.consent.email).toBe('declined');
  });

  it('explains missing contact details field by field', () => {
    try {
      leadPagePayload(form({ firstName: '', lastName: 'Silva', smsConsent: 'on', emailConsent: 'on' }), input);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(LeadPageError);
      expect((error as LeadPageError).fieldErrors).toMatchObject({
        firstName: expect.any(String), phone: expect.any(String), smsConsent: expect.any(String), emailConsent: expect.any(String),
      });
    }
    expect(() => leadPagePayload(form({ firstName: 'A', lastName: 'B', phone: '123' }), input)).toThrow(LeadPageError);
    expect(() => leadPagePayload(form({ firstName: 'A', lastName: 'B', email: 'nope' }), input)).toThrow(LeadPageError);
  });
});
