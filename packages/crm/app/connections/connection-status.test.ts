import { describe, expect, it } from 'vitest';
import { deriveConnectionCardStatus } from './connection-status';

describe('connection card status', () => {
  it('presents enabled Mailchimp OAuth as ready instead of still being built', () => {
    expect(deriveConnectionCardStatus('mailchimp', {
      providerEnabled: true, connected: false, productionApproved: false,
    })).toEqual({ status: 'ready', label: 'Ready to connect' });
  });

  it('shows a connected Mailchimp account with reconciliation work as review-required', () => {
    expect(deriveConnectionCardStatus('mailchimp', {
      providerEnabled: true, connected: true, productionApproved: false, reviewItems: 244,
    })).toEqual({ status: 'review', label: 'Connected · review required' });
  });

  it('distinguishes a bound Google account from an authorized feature bundle', () => {
    expect(deriveConnectionCardStatus('google', {
      providerEnabled: true, connected: true, productionApproved: false, requiredCapabilityActive: false,
    })).toEqual({ status: 'connected', label: 'Connected · permission pending' });
    expect(deriveConnectionCardStatus('google', {
      providerEnabled: true, connected: true, productionApproved: false, requiredCapabilityActive: true,
    })).toEqual({ status: 'connected', label: 'Connected · UAT pending' });
  });

  it('does not present an unconfigured Meta provider as operational', () => {
    expect(deriveConnectionCardStatus('meta', {
      providerEnabled: false, connected: false, productionApproved: false,
    })).toEqual({ status: 'gated', label: 'External setup required' });
  });
});
