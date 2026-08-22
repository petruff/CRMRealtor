import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export type MetaLoginMode = 'facebook-page' | 'instagram-login';

export interface MetaOAuthRepository {
  begin(scope: WorkspaceScope, input: {
    connectionId: string; loginMode: MetaLoginMode; graphVersion: string;
    versionSourceUrl: string; versionSourceHash: string; versionReviewedAt: string;
    requestedScopes: readonly string[]; correlationId: string; stateHash: string;
    sessionBindingHash: string; redirectUri: string; safeReturnPath: string;
    stateEnvelope: ConnectorSecretEnvelope; expiresAt: string; occurredAt: string;
  }): Promise<void>;
  consume(scope: WorkspaceScope, input: {
    stateHash: string; sessionBindingHash: string; redirectUri: string; consumedAt: string;
  }): Promise<{
    transactionId: string; workspaceId: string; connectionId: string; loginMode: MetaLoginMode;
    graphVersion: string; requestedScopes: readonly string[]; safeReturnPath: string;
    stateEnvelope: ConnectorSecretEnvelope; expectedAccessSecretVersion?: number;
  }>;
  complete(scope: WorkspaceScope, input: {
    transactionId: string; connectionId: string; accountKeyHash: string;
    grantedScopes: readonly string[]; businessVerified: boolean; businessVerificationHash?: string;
    appReviewApproved: boolean; appReviewEvidenceHash?: string; expectedAccessSecretVersion?: number;
    accessTokenEnvelope: ConnectorSecretEnvelope; tokenExpiresAt: string;
    correlationId: string; occurredAt: string;
  }): Promise<void>;
}

