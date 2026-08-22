import type { WorkspaceScope } from '../domain/workspace.ts';
import type { MailchimpAccountIdentity } from '../domain/mailchimp.ts';
import type { ConnectorOAuthTransaction } from '../security/connector-oauth.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

export interface BeginMailchimpOAuthInput {
  readonly connectionId: string;
  readonly correlationId: string;
  readonly displayLabel: string;
  readonly sessionBindingHash: string;
  readonly safeReturnPath: string;
  readonly transaction: ConnectorOAuthTransaction;
  readonly verifierEnvelope: ConnectorSecretEnvelope;
}

export interface ConsumedMailchimpOAuthTransaction {
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly provider: 'mailchimp';
  readonly requestedScopeBundle: 'mailchimp.audience-sync.v1';
  readonly requestedScopes: readonly string[];
  readonly safeReturnPath: string;
  readonly verifierEnvelope: ConnectorSecretEnvelope;
  readonly expectedAccessSecretVersion?: number;
  readonly consumedAt: string;
}

export interface CompleteMailchimpOAuthInput {
  readonly transactionId: string;
  readonly connectionId: string;
  readonly correlationId: string;
  readonly identity: MailchimpAccountIdentity;
  readonly grantedScopes: readonly string[];
  readonly accessTokenEnvelope: ConnectorSecretEnvelope;
  readonly expectedAccessSecretVersion?: number;
  readonly completedAt: string;
}

export interface MailchimpOAuthRepository {
  begin(
    scope: WorkspaceScope,
    input: BeginMailchimpOAuthInput,
  ): Promise<{ readonly connectionId: string; readonly transactionId: string }>;
  consume(
    scope: WorkspaceScope,
    input: {
      readonly stateHash: string;
      readonly sessionBindingHash: string;
      readonly redirectUri: string;
      readonly consumedAt: string;
    },
  ): Promise<ConsumedMailchimpOAuthTransaction>;
  complete(
    scope: WorkspaceScope,
    input: CompleteMailchimpOAuthInput,
  ): Promise<{ readonly connectionId: string; readonly status: 'active' }>;
}
