import { describe, expect, it, vi } from 'vitest';
import {
  buildOmnixCopilotTelemetryEvent,
  emitOmnixCopilotTelemetry,
} from './omnix-copilot-telemetry';

describe('Omnix copilot telemetry', () => {
  it('emits only the redacted allowlisted schema', () => {
    const event = buildOmnixCopilotTelemetryEvent({
      correlationId: 'correlation-1',
      workspaceId: 'workspace-1',
      membershipId: 'membership-1',
      resolvedIntent: 'find-contact',
      mode: 'live',
      asOf: '2026-08-11T14:00:00.000Z',
      outcome: 'success',
      resultCount: 2,
      citationCount: 2,
      durationMs: 4.8,
    });

    expect(event).toEqual({
      schema: 'omnix-copilot-telemetry.v1',
      correlationId: 'correlation-1',
      workspaceId: 'workspace-1',
      membershipId: 'membership-1',
      resolvedIntent: 'find-contact',
      mode: 'live',
      asOf: '2026-08-11T14:00:00.000Z',
      outcome: 'success',
      resultCount: 2,
      citationCount: 2,
      durationMs: 4,
    });
    expect(JSON.stringify(event)).not.toMatch(/question|email|phone|note|taskDescription|title/i);
  });

  it('normalizes invalid numeric measurements without adding raw payloads', () => {
    expect(buildOmnixCopilotTelemetryEvent({
      correlationId: 'correlation-2',
      workspaceId: 'workspace-1',
      membershipId: 'membership-1',
      resolvedIntent: 'unsupported',
      mode: 'sample',
      asOf: '2026-08-11T14:00:00.000Z',
      outcome: 'failure',
      errorCategory: 'unsupported-intent',
      resultCount: -1,
      citationCount: Number.NaN,
      durationMs: Number.POSITIVE_INFINITY,
    })).toMatchObject({
      resultCount: 0,
      citationCount: 0,
      durationMs: 0,
      errorCategory: 'unsupported-intent',
    });
  });

  it('normalizes authority aliases and unknown error text to fixed safe categories', () => {
    const base = {
      correlationId: 'correlation-safe-category',
      workspaceId: 'unresolved',
      membershipId: 'unresolved',
      resolvedIntent: 'pipeline',
      mode: 'sample' as const,
      asOf: '2026-08-11T14:00:00.000Z',
      outcome: 'failure' as const,
      resultCount: 0,
      citationCount: 0,
      durationMs: 1,
    };

    expect(buildOmnixCopilotTelemetryEvent({
      ...base,
      errorCategory: 'revoked-membership',
    }).errorCategory).toBe('forbidden');

    const unsafe = buildOmnixCopilotTelemetryEvent({
      ...base,
      errorCategory: 'private@example.com\nsecret-token',
    });
    expect(unsafe.errorCategory).toBe('internal-error');
    expect(JSON.stringify(unsafe)).not.toContain('private@example.com');
    expect(JSON.stringify(unsafe)).not.toContain('secret-token');
  });

  it('does not let a telemetry failure change the application result', async () => {
    const sink = vi.fn().mockRejectedValue(new Error('collector unavailable'));

    await expect(emitOmnixCopilotTelemetry(sink, {
      correlationId: 'correlation-3',
      workspaceId: 'workspace-1',
      membershipId: 'membership-1',
      resolvedIntent: 'brief',
      mode: 'sample',
      asOf: '2026-08-11T14:00:00.000Z',
      outcome: 'success',
      resultCount: 1,
      citationCount: 1,
      durationMs: 1,
    })).resolves.toBeUndefined();
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
