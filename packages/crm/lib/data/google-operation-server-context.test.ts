import { describe, expect, it } from 'vitest';
import { createGoogleOperationServerRepository } from './google-operation-server-context';

describe('Google operation server context', () => {
  it('fails closed without service authority and accepts only a server secret key', () => {
    const authenticated = {} as never;
    expect(() => createGoogleOperationServerRepository({ authenticated, environment: {} }))
      .toThrow(/server authority/i);
    const repository = createGoogleOperationServerRepository({
      authenticated,
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_service-key',
      },
    });
    expect(repository).toBeDefined();
  });
});
