import { describe, expect, it, vi } from 'vitest';
import type { MailchimpAudienceBinding } from '../domain/mailchimp';
import { resumeMailchimpGuidedSetup } from './mailchimp-guided-setup-service';

const binding = (overrides: Partial<MailchimpAudienceBinding> = {}): MailchimpAudienceBinding => ({
  id: 'binding-a',
  connectionId: 'connection-a',
  accountIdHash: 'a'.repeat(64),
  dataCenter: 'us21',
  audienceId: 'audience-a',
  audienceName: 'Judith Serna Realtor',
  mappingVersion: 1,
  selectedAt: '2026-08-24T12:00:00.000Z',
  baselineRequired: true,
  webhookRegistrationRequired: true,
  ...overrides,
});

describe('Mailchimp guided setup', () => {
  it('resumes the saved audience, webhook and baseline after reauthorization', async () => {
    const setupWebhook = vi.fn(async () => undefined);
    const reconcileBaseline = vi.fn(async () => ({ completed: true, review: false }));
    const result = await resumeMailchimpGuidedSetup({
      getSelectedAudience: vi.fn(async () => binding()),
      listAudiences: vi.fn(),
      selectAudience: vi.fn(),
      setupWebhook,
      reconcileBaseline,
    });

    expect(result).toEqual({ state: 'complete', automaticallySelected: false });
    expect(setupWebhook).toHaveBeenCalledOnce();
    expect(reconcileBaseline).toHaveBeenCalledOnce();
  });

  it('selects the only audience automatically and completes setup', async () => {
    const audience = { id: 'audience-a', name: 'Judith Serna Realtor', memberCount: 191 };
    const selectAudience = vi.fn(async () => binding());
    const result = await resumeMailchimpGuidedSetup({
      getSelectedAudience: vi.fn(async () => undefined),
      listAudiences: vi.fn(async () => [audience]),
      selectAudience,
      setupWebhook: vi.fn(async () => undefined),
      reconcileBaseline: vi.fn(async () => ({ completed: false, review: false })),
    });

    expect(result).toEqual({ state: 'syncing', automaticallySelected: true });
    expect(selectAudience).toHaveBeenCalledWith(audience);
  });

  it('requires an owner choice when more than one audience is available', async () => {
    const setupWebhook = vi.fn();
    const result = await resumeMailchimpGuidedSetup({
      getSelectedAudience: vi.fn(async () => undefined),
      listAudiences: vi.fn(async () => [
        { id: 'audience-a', name: 'Leads' },
        { id: 'audience-b', name: 'Past clients' },
      ]),
      selectAudience: vi.fn(),
      setupWebhook,
      reconcileBaseline: vi.fn(),
    });

    expect(result).toEqual({ state: 'selection-required', automaticallySelected: false });
    expect(setupWebhook).not.toHaveBeenCalled();
  });

  it('surfaces a reconciliation review instead of reporting a false success', async () => {
    const result = await resumeMailchimpGuidedSetup({
      getSelectedAudience: vi.fn(async () => binding({ webhookRegistrationRequired: false })),
      listAudiences: vi.fn(),
      selectAudience: vi.fn(),
      setupWebhook: vi.fn(),
      reconcileBaseline: vi.fn(async () => ({ completed: false, review: true })),
    });

    expect(result).toEqual({ state: 'review', automaticallySelected: false });
  });
});
