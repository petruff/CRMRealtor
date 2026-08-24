import { describe, expect, it } from 'vitest';
import { googleConnectionPresentation } from './google-presentation';

describe('Google connection presentation', () => {
  it('treats a new authorizing connection as pending consent without probing capability health', () => {
    expect(googleConnectionPresentation({ status: 'authorizing', grantedScopes: [] })).toEqual({
      consentPending: true,
      shouldReadCapabilityHealth: false,
      description: 'Google is waiting for the account owner to approve Gmail and Calendar access.',
    });
  });

  it('loads persisted capability health after any permission has been recorded', () => {
    expect(googleConnectionPresentation({
      status: 'active',
      grantedScopes: ['https://www.googleapis.com/auth/gmail.send'],
    })).toMatchObject({ consentPending: false, shouldReadCapabilityHealth: true });
  });
});
