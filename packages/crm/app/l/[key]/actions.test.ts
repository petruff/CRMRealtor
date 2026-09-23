import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: true,
  findPublicLeadPage: vi.fn(),
  processWebsiteLeadSubmission: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'test' }) }));
vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: () => mocks.configured }));
vi.mock('@/lib/application/site-origin', () => ({ siteOrigin: async () => 'https://omnix.test' }));
vi.mock('@/lib/data/lead-page-repository', () => ({
  serviceClient: () => ({}),
  findPublicLeadPage: mocks.findPublicLeadPage,
  leadPageIntakeContext: async () => ({ context: true }),
}));
vi.mock('@/lib/application/website-intake-processor', () => ({ processWebsiteLeadSubmission: mocks.processWebsiteLeadSubmission }));

import { submitLeadPageAction } from './actions';

const KEY = 'lead-page-abc123def456';
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const valid = { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', src: 'instagram' };

describe('submitLeadPageAction', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.findPublicLeadPage.mockReset().mockResolvedValue({ workspaceId: 'w', agentName: 'Judith' });
    mocks.processWebsiteLeadSubmission.mockReset().mockResolvedValue({ status: 202, message: 'ok' });
  });

  it('routes a valid inquiry through website intake with the site origin', async () => {
    const state = await submitLeadPageAction(KEY, { status: 'idle' }, form(valid));
    expect(state).toEqual({ status: 'sent', firstName: 'Ana' });
    const [, request] = mocks.processWebsiteLeadSubmission.mock.calls[0]!;
    expect(request).toMatchObject({ endpointKey: KEY, origin: 'https://omnix.test', forwardedFor: '203.0.113.9' });
    expect(JSON.parse(request.body)).toMatchObject({ attribution: { source: 'instagram', medium: 'lead-page' } });
  });

  it('silently drops honeypot submissions', async () => {
    const state = await submitLeadPageAction(KEY, { status: 'idle' }, form({ ...valid, company: 'Spam Inc' }));
    expect(state.status).toBe('sent');
    expect(mocks.processWebsiteLeadSubmission).not.toHaveBeenCalled();
  });

  it('never persists previews or unknown pages', async () => {
    expect((await submitLeadPageAction('preview', { status: 'idle' }, form(valid))).status).toBe('sent');
    expect((await submitLeadPageAction('../etc', { status: 'idle' }, form(valid))).status).toBe('error');
    mocks.findPublicLeadPage.mockResolvedValue(undefined);
    expect((await submitLeadPageAction(KEY, { status: 'idle' }, form(valid))).message).toMatch(/no longer active/);
    expect(mocks.processWebsiteLeadSubmission).not.toHaveBeenCalled();
  });

  it('keeps values on validation, rate-limit and failure errors', async () => {
    const invalid = await submitLeadPageAction(KEY, { status: 'idle' }, form({ firstName: 'Ana', lastName: 'Silva' }));
    expect(invalid).toMatchObject({ status: 'error', fieldErrors: { phone: expect.any(String) }, values: { firstName: 'Ana' } });
    mocks.processWebsiteLeadSubmission.mockResolvedValueOnce({ status: 429, message: 'slow' });
    expect((await submitLeadPageAction(KEY, { status: 'idle' }, form(valid))).message).toMatch(/try again in a minute/);
    mocks.processWebsiteLeadSubmission.mockResolvedValueOnce({ status: 500, message: 'no' });
    expect(await submitLeadPageAction(KEY, { status: 'idle' }, form(valid))).toMatchObject({ status: 'error', values: { email: 'ana@example.com' } });
  });
});
