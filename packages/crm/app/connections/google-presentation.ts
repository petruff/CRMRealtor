export interface GoogleConnectionPresentationInput {
  readonly status: string;
  readonly grantedScopes: readonly string[];
}

export interface GoogleConnectionPresentation {
  readonly consentPending: boolean;
  readonly shouldReadCapabilityHealth: boolean;
  readonly description: string;
}

export function googleConnectionPresentation(
  connection: GoogleConnectionPresentationInput,
): GoogleConnectionPresentation {
  const consentPending = connection.status === 'authorizing'
    && connection.grantedScopes.length === 0;
  return {
    consentPending,
    shouldReadCapabilityHealth: !consentPending,
    description: consentPending
      ? 'Google is waiting for the account owner to approve Gmail and Calendar access.'
      : 'Each capability below is derived from the exact permissions approved in Google.',
  };
}
