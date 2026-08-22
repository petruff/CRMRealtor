import { describe, expect, it } from 'vitest';
import { createMailchimpOAuthServerRepository } from './mailchimp-oauth-server-context';

describe('Mailchimp OAuth server context', () => {
  it('fails closed before constructing privileged persistence without service authority', () => {
    expect(() => createMailchimpOAuthServerRepository({
      authenticated: {} as never, environment: {},
    })).toThrow(/server authority is not configured/i);
  });
});
