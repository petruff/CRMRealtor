import { describe, expect, it, vi } from 'vitest';
import { connectorTelemetryEvent, defaultConnectorTelemetrySink } from './connector-telemetry';

describe('connector telemetry', () => {
  it('hashes tenant/job identities and allowlists errors without accepting details', () => {
    const event = connectorTelemetryEvent({
      event: 'worker.job-finished', provider: 'mailchimp', workspaceId: 'workspace-private',
      jobId: 'job-private', correlationId: 'correlation-1', outcome: 'failed',
      errorCategory: 'secret@example.com Bearer secret-token',
    });
    expect(event).toMatchObject({
      schemaVersion: 'connector-telemetry.v1', provider: 'mailchimp', correlationId: 'correlation-1',
      errorCategory: 'internal_error',
    });
    expect(JSON.stringify(event)).not.toMatch(/workspace-private|job-private|secret@example|secret-token/);
  });

  it('emits exactly one structured JSON line through the default sink', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const event = connectorTelemetryEvent({
      event: 'worker.batch-finished', outcome: 'succeeded', errorCategory: 'none', count: 1,
    });
    defaultConnectorTelemetrySink(event);
    expect(info).toHaveBeenCalledOnce();
    expect(() => JSON.parse(String(info.mock.calls[0]?.[0]))).not.toThrow();
    info.mockRestore();
  });
});
