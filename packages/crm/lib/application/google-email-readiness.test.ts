import { describe, expect, it } from 'vitest';
import type { GoogleCapabilityState } from '../data/google-operation-repository.ts';
import { googleEmailReadiness } from './google-email-readiness.ts';

function state(overrides: Partial<GoogleCapabilityState> = {}): GoogleCapabilityState {
  return {
    connection: {
      id: 'connection-a', workspaceId: 'workspace-a', status: 'active',
      displayLabel: 'Owner account', accountKeyHash: 'a'.repeat(64),
      grantedScopes: ['https://www.googleapis.com/auth/gmail.send'],
    },
    capabilities: [{
      bundle: 'gmail-send', requiredScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'],
      grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'], state: 'active',
    }],
    sync: [], calendar: { created: false }, tokenState: { refreshPresent: true },
    ...overrides,
  };
}

describe('googleEmailReadiness', () => {
  it('allows drafting only when the Gmail capability and refresh authority are active', () => {
    expect(googleEmailReadiness(state())).toEqual({ ready: true });
  });

  it('blocks a connection whose aggregate scope exists but Gmail capability is missing', () => {
    expect(googleEmailReadiness(state({ capabilities: [] }))).toEqual({
      ready: false,
      message: 'Gmail permission is not ready yet. Open Connections and finish the Google setup.',
    });
  });

  it('requires durable refresh authority before exposing the composer', () => {
    expect(googleEmailReadiness(state({ tokenState: { refreshPresent: false } }))).toEqual({
      ready: false,
      message: 'Google needs to be reconnected before Omnix can prepare email drafts.',
    });
  });
});
