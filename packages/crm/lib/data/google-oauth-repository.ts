import type { WorkspaceScope } from '../domain/workspace.ts';
import type { GoogleAccountIdentity, GoogleFeatureBundle } from '../domain/google-connector.ts';
import type { ConnectorOAuthTransaction } from '../security/connector-oauth.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

export interface BeginGoogleOAuthInput {
  readonly connectionId: string;
  readonly correlationId: string;
  readonly displayLabel: string;
  readonly sessionBindingHash: string;
  readonly safeReturnPath: string;
  readonly bundle: GoogleFeatureBundle;
  readonly transaction: ConnectorOAuthTransaction;
  readonly verifierEnvelope: ConnectorSecretEnvelope;
}

export interface ConsumedGoogleOAuthTransaction {
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly provider: 'google';
  readonly requestedScopeBundle: string;
  readonly requestedScopes: readonly string[];
  readonly safeReturnPath: string;
  readonly verifierEnvelope: ConnectorSecretEnvelope;
  readonly expectedAccessSecretVersion?: number;
  readonly expectedRefreshSecretVersion?: number;
  readonly consumedAt: string;
}

export interface CompleteGoogleOAuthInput {
  readonly transactionId: string;
  readonly connectionId: string;
  readonly correlationId: string;
  readonly bundle: GoogleFeatureBundle;
  readonly identity: GoogleAccountIdentity;
  readonly grantedScopes: readonly string[];
  readonly accessTokenEnvelope: ConnectorSecretEnvelope;
  readonly refreshTokenEnvelope?: ConnectorSecretEnvelope;
  readonly expectedAccessSecretVersion?: number;
  readonly expectedRefreshSecretVersion?: number;
  readonly tokenExpiresAt: string;
  readonly completedAt: string;
}

export interface GoogleOAuthRepository {
  begin(scope: WorkspaceScope, input: BeginGoogleOAuthInput): Promise<{
    readonly connectionId: string;
    readonly transactionId: string;
  }>;
  consume(scope: WorkspaceScope, input: {
    readonly stateHash: string;
    readonly sessionBindingHash: string;
    readonly redirectUri: string;
    readonly consumedAt: string;
  }): Promise<ConsumedGoogleOAuthTransaction>;
  complete(scope: WorkspaceScope, input: CompleteGoogleOAuthInput): Promise<{
    readonly connectionId: string;
    readonly status: 'active';
    readonly grantedScopes: readonly string[];
  }>;
}
