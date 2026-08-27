import type { GoogleCapabilityState } from '../data/google-operation-repository.ts';

export interface GoogleEmailReadiness {
  readonly ready: boolean;
  readonly message?: string;
}

export function googleEmailReadiness(state: GoogleCapabilityState): GoogleEmailReadiness {
  const gmail = state.capabilities.find((capability) => capability.bundle === 'gmail-send');
  if (!gmail || gmail.state !== 'active') {
    return {
      ready: false,
      message: 'Gmail permission is not ready yet. Open Connections and finish the Google setup.',
    };
  }
  if (!state.tokenState.refreshPresent) {
    return {
      ready: false,
      message: 'Google needs to be reconnected before Omnix can prepare email drafts.',
    };
  }
  return { ready: true };
}
