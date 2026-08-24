export interface ConnectionNotice {
  readonly tone: 'success' | 'warning';
  readonly title: string;
  readonly message: string;
}

const SUCCESS_NOTICES: Readonly<Record<string, Omit<ConnectionNotice, 'tone'>>> = {
  'google-workspace-core-connected': {
    title: 'Google is connected',
    message: 'Gmail and Google Calendar permissions were saved. Omnix can now finish the guided setup.',
  },
  'google-workspace-core-partial': {
    title: 'Google saved the permissions you approved',
    message: 'Available Gmail or Calendar features are ready. Use Finish Google connection once more to approve the remaining permission without losing what is already connected.',
  },
  'google-gmail-send-connected': {
    title: 'Gmail sending is connected',
    message: 'You can now send governed emails from Omnix.',
  },
  'google-gmail-metadata-connected': {
    title: 'Gmail activity is connected',
    message: 'Omnix can now match email activity to the right contact without storing message bodies.',
  },
  'google-calendar-app-created-connected': {
    title: 'Google Calendar is connected',
    message: 'Omnix can now prepare your dedicated follow-up calendar.',
  },
  'mailchimp-connected-select-audience': {
    title: 'Mailchimp is connected',
    message: 'Your account is authorized. Select the audience you want Omnix to keep synchronized.',
  },
  'mailchimp-setup-complete': {
    title: 'Mailchimp is ready',
    message: 'Your newsletter audience, initial contact sync, and subscribe/unsubscribe updates are active.',
  },
  'mailchimp-setup-syncing': {
    title: 'Mailchimp is connected and syncing',
    message: 'Omnix saved the setup and is finishing the initial contact sync safely in the background.',
  },
};

const ERROR_NOTICES: Readonly<Record<string, Omit<ConnectionNotice, 'tone'>>> = {
  'sign-in-required': {
    title: 'Please sign in again',
    message: 'Your session ended before the connection could be saved. Sign in and try once more.',
  },
  'google-configuration-required': {
    title: 'Google connection needs developer attention',
    message: 'Judith does not need to configure anything. The registered Google app is not ready on this deployment.',
  },
  'google-oauth-invalid': {
    title: 'Google authorization expired',
    message: 'Nothing was changed. Click Connect Google and complete the Google window again.',
  },
  'google-oauth-denied': {
    title: 'Google permission was not approved',
    message: 'Nothing was changed. Click Finish Google connection when you are ready and approve the Gmail and Calendar permissions you want Omnix to use.',
  },
  'google-oauth-failed': {
    title: 'Google was not connected',
    message: 'The authorization was cancelled or could not be verified. Your existing data is safe; try again.',
  },
  'mailchimp-configuration-required': {
    title: 'Mailchimp connection needs developer attention',
    message: 'Judith does not need to configure anything. The registered Mailchimp app is not ready on this deployment.',
  },
  'mailchimp-oauth-invalid': {
    title: 'Mailchimp authorization expired',
    message: 'Nothing was changed. Click Connect Mailchimp and complete the Mailchimp window again.',
  },
  'mailchimp-oauth-denied': {
    title: 'Mailchimp permission was not approved',
    message: 'The previous connection remains unchanged. Click Connect Mailchimp when you are ready to approve access.',
  },
  'mailchimp-oauth-failed': {
    title: 'Mailchimp was not connected',
    message: 'The authorization was cancelled or could not be verified. The previous connection remains unchanged.',
  },
  'mailchimp-setup-reconnect': {
    title: 'Reconnect Mailchimp to finish setup',
    message: 'The saved Mailchimp permission is no longer accepted. Reconnect the same account, then Omnix will resume the audience setup without replacing CRM data.',
  },
  'mailchimp-setup-temporary': {
    title: 'Mailchimp is temporarily unavailable',
    message: 'No setup step was lost. Wait a moment and click Finish Mailchimp setup again.',
  },
  'mailchimp-setup-developer': {
    title: 'Mailchimp setup needs developer attention',
    message: 'Judith does not need to configure anything. The deployment is missing a registered webhook or connector setting.',
  },
  'mailchimp-audience-required': {
    title: 'Choose the newsletter audience first',
    message: 'Select the Mailchimp audience Omnix should synchronize, then finish setup.',
  },
  'mailchimp-setup-failed': {
    title: 'Mailchimp setup could not finish',
    message: 'Your contacts and existing Mailchimp connection are safe. Try once more; if it repeats, the developer can use the connector receipt to diagnose it.',
  },
  'mailchimp-setup-review': {
    title: 'Mailchimp is connected, but some contacts need review',
    message: 'Subscribe and unsubscribe updates are active. Open the latest contact-sync review before retrying the remaining contacts.',
  },
};

export function connectionNotice(input: { readonly success?: string; readonly error?: string }): ConnectionNotice | undefined {
  if (input.error) {
    const content = ERROR_NOTICES[input.error] ?? {
      title: 'Connection needs attention',
      message: 'Nothing was changed. Try again or ask the developer to review the connection health.',
    };
    return { tone: 'warning', ...content };
  }
  if (input.success) {
    const content = SUCCESS_NOTICES[input.success] ?? {
      title: 'Connection updated',
      message: 'The authorization was saved successfully.',
    };
    return { tone: 'success', ...content };
  }
  return undefined;
}

export function googleWorkspaceConnectHref(connectionId?: string): string {
  const params = new URLSearchParams({ bundle: 'workspace-core' });
  if (connectionId) params.set('connectionId', connectionId);
  return `/api/connectors/google/connect?${params.toString()}`;
}

export function mailchimpConnectHref(connectionId?: string): string {
  if (!connectionId) return '/api/connectors/mailchimp/connect';
  return `/api/connectors/mailchimp/connect?connectionId=${encodeURIComponent(connectionId)}`;
}
