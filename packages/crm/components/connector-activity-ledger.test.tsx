// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConnectorReceipt } from '@/lib/domain/connector';
import { ConnectorActivityLedger } from './connector-activity-ledger';

function receipt(overrides: Partial<ConnectorReceipt> & Pick<ConnectorReceipt, 'id' | 'type' | 'occurredAt'>): ConnectorReceipt {
  return {
    workspaceId: 'workspace-a',
    provider: 'google',
    correlationId: `correlation-${overrides.id}`,
    errorCategory: 'none',
    ...overrides,
  };
}

describe('ConnectorActivityLedger', () => {
  it('groups repeated technical events into a people-first connection history', () => {
    render(<ConnectorActivityLedger receipts={[
      receipt({ id: 'a1', type: 'oauth.started', occurredAt: '2026-08-24T21:00:00.000Z' }),
      receipt({ id: 'a2', type: 'oauth.started', occurredAt: '2026-08-24T20:50:00.000Z' }),
      receipt({ id: 'a3', provider: 'mailchimp', type: 'audience.selected', occurredAt: '2026-08-21T21:25:03.000Z' }),
    ]} />);

    expect(screen.getByRole('heading', { name: 'Connection activity' })).toBeTruthy();
    expect(screen.getByText('Authorization started')).toBeTruthy();
    expect(screen.getByText('· 2 attempts')).toBeTruthy();
    expect(screen.getByText('Newsletter audience selected')).toBeTruthy();
    expect(screen.queryByText('oauth.started')).toBeNull();
    expect(screen.getAllByText('Technical details')).toHaveLength(2);
  });

  it('surfaces attention without exposing the raw diagnostic as the primary message', () => {
    render(<ConnectorActivityLedger receipts={[
      receipt({
        id: 'failed-1',
        provider: 'mailchimp',
        type: 'provider.failed',
        occurredAt: '2026-08-24T21:05:00.000Z',
        errorCategory: 'authorization_revoked',
      }),
    ]} />);

    expect(screen.getAllByText('Needs attention')).toHaveLength(3);
    expect(screen.getByText('Connected service action paused')).toBeTruthy();
    expect(screen.getByText('Authorization revoked')).toBeTruthy();
    expect(screen.queryByText('authorization_revoked')).toBeNull();
  });
});
