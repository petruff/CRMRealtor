import { ConnectorError, sha256Hex } from '@/lib/domain/connector';

export type MailchimpAudienceLoadIssueKind = 'reconnect' | 'temporary' | 'developer';

export interface MailchimpAudienceLoadIssue {
  readonly kind: MailchimpAudienceLoadIssueKind;
  readonly title: string;
  readonly message: string;
}

export function classifyMailchimpAudienceLoadIssue(error: unknown): MailchimpAudienceLoadIssue {
  if (error instanceof ConnectorError && error.code === 'forbidden') {
    return {
      kind: 'reconnect',
      title: 'Mailchimp needs to be reconnected',
      message: 'Your CRM data and selected audience are safe. Sign in to Mailchimp again to restore syncing.',
    };
  }
  if (error instanceof ConnectorError && error.code === 'provider-retryable') {
    return {
      kind: 'temporary',
      title: 'Mailchimp is taking longer than expected',
      message: 'Your saved setup is still available. Try refreshing again in a moment.',
    };
  }
  return {
    kind: 'developer',
    title: 'Mailchimp needs developer attention',
    message: 'Your account remains saved. Judith does not need to change any settings while the secure connection is reviewed.',
  };
}

export function mailchimpConnectionStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Connected';
    case 'authorizing': return 'Waiting for Mailchimp authorization';
    case 'degraded': return 'Connected, but syncing needs attention';
    case 'reauthorization-required': return 'Reconnect required';
    case 'revoking': return 'Disconnecting';
    case 'disconnected': return 'Disconnected';
    case 'disconnected-unconfirmed': return 'Disconnect needs confirmation';
    default: return 'Connection status unavailable';
  }
}

export function recordMailchimpReadFailure(input: {
  readonly operation: 'binding' | 'reconciliation' | 'backfill' | 'audiences';
  readonly connectionId: string;
  readonly error: unknown;
}): MailchimpAudienceLoadIssue {
  const issue = classifyMailchimpAudienceLoadIssue(input.error);
  console.error(JSON.stringify({
    event: 'mailchimp.connection_read_failed',
    operation: input.operation,
    category: issue.kind,
    connectorErrorCode: input.error instanceof ConnectorError ? input.error.code : 'internal-error',
    connectionIdHash: sha256Hex(input.connectionId),
  }));
  return issue;
}
