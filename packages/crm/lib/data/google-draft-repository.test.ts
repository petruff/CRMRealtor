import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGoogleEmailDraft } from './google-draft-repository.ts';

const originalActiveKek = process.env.OMNIX_CONNECTOR_KEK_ACTIVE_VERSION;
const originalKek = process.env.OMNIX_CONNECTOR_KEK_test;

describe('Google draft repository', () => {
  beforeEach(() => {
    process.env.OMNIX_CONNECTOR_KEK_ACTIVE_VERSION = 'test';
    process.env.OMNIX_CONNECTOR_KEK_test = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (originalActiveKek === undefined) delete process.env.OMNIX_CONNECTOR_KEK_ACTIVE_VERSION;
    else process.env.OMNIX_CONNECTOR_KEK_ACTIVE_VERSION = originalActiveKek;
    if (originalKek === undefined) delete process.env.OMNIX_CONNECTOR_KEK_test;
    else process.env.OMNIX_CONNECTOR_KEK_test = originalKek;
  });

  it('keeps encrypted JSON envelope fields in Base64 for the database decoder', async () => {
    const rpc = vi.fn(async () => ({ data: { draft: { id: 'draft-a' } }, error: null }));

    await createGoogleEmailDraft({
      database: { rpc } as unknown as SupabaseClient,
      scope: {
        authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
        workspaceId: 'workspace-a', role: 'owner', mode: 'live',
      },
      connectionId: 'connection-a', contactId: 'contact-a', contactPointId: 'point-a',
      from: 'owner@example.com', to: 'contact@example.com', subject: 'Hello', body: 'Message body',
      correlationId: 'correlation-a', draftId: 'draft-a', occurredAt: '2026-08-27T13:00:00.000Z',
    });

    expect(rpc).toHaveBeenCalledOnce();
    const [name, parameters] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe('create_google_email_draft');
    const envelope = parameters.target_envelope as {
      ciphertext: string;
      nonce: string;
      authTag: string;
      wrappedDek: string;
      wrapNonce: string;
      wrapAuthTag: string;
      kekVersion: string;
    };
    expect(envelope).toMatchObject({ kekVersion: 'test' });
    for (const field of [
      envelope.ciphertext, envelope.nonce, envelope.authTag,
      envelope.wrappedDek, envelope.wrapNonce, envelope.wrapAuthTag,
    ]) {
      expect(field).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(field).not.toMatch(/^\\x/);
      expect(Buffer.from(field, 'base64').length).toBeGreaterThan(0);
    }
    expect(Buffer.from(envelope.nonce, 'base64')).toHaveLength(12);
    expect(Buffer.from(envelope.authTag, 'base64')).toHaveLength(16);
    expect(Buffer.from(envelope.wrapNonce, 'base64')).toHaveLength(12);
    expect(Buffer.from(envelope.wrapAuthTag, 'base64')).toHaveLength(16);
  });
});
