import { CONNECTOR_ERROR_CATEGORIES, sha256Hex, type ConnectorErrorCategory, type ConnectorProvider } from '../domain/connector.ts';

export interface ConnectorTelemetryEvent {
  readonly schemaVersion: 'connector-telemetry.v1';
  readonly event: 'worker.job-finished' | 'worker.revocation-finished' | 'worker.batch-finished' | 'oauth.callback' | 'webhook.accepted';
  readonly provider?: ConnectorProvider;
  readonly workspaceRef?: string;
  readonly jobRef?: string;
  readonly correlationId?: string;
  readonly outcome: 'succeeded' | 'deferred' | 'failed' | 'accepted';
  readonly errorCategory: ConnectorErrorCategory;
  readonly count?: number;
}

export type ConnectorTelemetrySink = (event: ConnectorTelemetryEvent) => void;

function safeIdentifier(value: string | undefined): string | undefined {
  if (!value || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) return undefined;
  return value;
}

export function connectorTelemetryEvent(input: {
  readonly event: ConnectorTelemetryEvent['event'];
  readonly provider?: ConnectorProvider;
  readonly workspaceId?: string;
  readonly jobId?: string;
  readonly correlationId?: string;
  readonly outcome: ConnectorTelemetryEvent['outcome'];
  readonly errorCategory?: string;
  readonly count?: number;
}): ConnectorTelemetryEvent {
  const errorCategory = CONNECTOR_ERROR_CATEGORIES.includes(input.errorCategory as ConnectorErrorCategory)
    ? input.errorCategory as ConnectorErrorCategory
    : 'internal_error';
  return {
    schemaVersion: 'connector-telemetry.v1',
    event: input.event,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.workspaceId ? { workspaceRef: sha256Hex(input.workspaceId).slice(0, 16) } : {}),
    ...(input.jobId ? { jobRef: sha256Hex(input.jobId).slice(0, 16) } : {}),
    ...(safeIdentifier(input.correlationId) ? { correlationId: safeIdentifier(input.correlationId) } : {}),
    outcome: input.outcome,
    errorCategory,
    ...(Number.isInteger(input.count) && (input.count ?? -1) >= 0 ? { count: input.count } : {}),
  };
}

export const defaultConnectorTelemetrySink: ConnectorTelemetrySink = (event) => {
  console.info(JSON.stringify(event));
};
