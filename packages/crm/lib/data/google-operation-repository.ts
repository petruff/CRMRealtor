import type { WorkspaceScope } from '../domain/workspace.ts';
import type { GoogleFeatureBundle } from '../domain/google-connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

export interface GoogleCapabilityState {
  readonly connection: {
    readonly id: string;
    readonly workspaceId: string;
    readonly status: string;
    readonly displayLabel: string;
    readonly accountKeyHash: string;
    readonly grantedScopes: readonly string[];
    readonly lastProbeAt?: string;
    readonly lastErrorCategory?: string;
  };
  readonly capabilities: readonly {
    readonly bundle: GoogleFeatureBundle;
    readonly requiredScopes: readonly string[];
    readonly grantedScopes: readonly string[];
    readonly state: 'active' | 'missing' | 'revoked';
    readonly authorizedAt?: string;
    readonly lastErrorCategory?: string;
  }[];
  readonly sync: readonly {
    readonly stream: 'gmail-history' | 'calendar-events';
    readonly state: 'idle' | 'syncing' | 'healthy' | 'full_resync_required' | 'degraded';
    readonly cursorGeneration: number;
    readonly lastSuccessAt?: string;
    readonly lastCallbackAt?: string;
    readonly lagSeconds?: number;
    readonly lastErrorCategory?: string;
  }[];
  readonly calendar: { readonly created: boolean };
  readonly tokenState: { readonly accessExpiresAt?: string; readonly refreshPresent: boolean };
}

export interface GoogleOperationRepository {
  readCapabilityState(scope: WorkspaceScope, connectionId: string): Promise<GoogleCapabilityState>;
  storeEncryptedPayload(scope: WorkspaceScope, input: {
    readonly connectionId: string;
    readonly payloadKind: 'gmail.send' | 'gmail.sync-metadata' | 'calendar.create-omnix-calendar'
      | 'calendar.upsert-omnix-event' | 'calendar.complete-omnix-event'
      | 'calendar.cancel-omnix-event' | 'calendar.delete-omnix-event' | 'calendar.sync';
    readonly schemaVersion: string;
    readonly canonicalHash: string;
    readonly envelope: ConnectorSecretEnvelope;
  }): Promise<{ readonly payloadReference: string; readonly payloadHash: string; readonly envelopeVersion: number }>;
  ensurePolicy(scope: WorkspaceScope, input: {
    readonly actionType: 'gmail.send' | 'gmail.sync-metadata' | 'calendar.create-omnix-calendar'
      | 'calendar.upsert-omnix-event' | 'calendar.complete-omnix-event'
      | 'calendar.cancel-omnix-event' | 'calendar.delete-omnix-event' | 'calendar.sync';
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<{ readonly id: string; readonly version: number; readonly noOp: boolean }>;
}
