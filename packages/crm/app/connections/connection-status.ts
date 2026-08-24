export type ConnectionCardStatus = 'ready' | 'connected' | 'review' | 'uat' | 'building' | 'gated';

export interface ConnectionStatusFacts {
  readonly providerEnabled: boolean;
  readonly connected: boolean;
  readonly productionApproved: boolean;
  readonly reviewItems?: number;
  readonly requiredCapabilityActive?: boolean;
}

export function deriveConnectionCardStatus(
  provider: 'mailchimp' | 'google' | 'meta' | 'twilio',
  facts: ConnectionStatusFacts,
): { readonly status: ConnectionCardStatus; readonly label?: string } {
  if (!facts.providerEnabled) return { status: 'gated', label: 'External setup required' };
  if (!facts.connected) {
    return provider === 'mailchimp'
      ? { status: 'ready', label: 'Ready to connect' }
      : { status: 'uat' };
  }
  if (provider === 'mailchimp' && (facts.reviewItems ?? 0) > 0) {
    return { status: 'review', label: 'Connected · review required' };
  }
  if (provider === 'google' && facts.requiredCapabilityActive === false) {
    return { status: 'connected', label: 'Connected · permission pending' };
  }
  if (facts.productionApproved) return { status: 'ready', label: 'Connected · production approved' };
  return { status: 'connected', label: 'Connected · UAT pending' };
}
