import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import { createAttentionAutomationServerRepository } from './attention-automation-server-context.ts';

describe('attention automation server authority', () => {
  it('fails closed for sample scope', () => {
    expect(() => createAttentionAutomationServerRepository(SAMPLE_WORKSPACE_SCOPE, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
    })).toThrow('live workspace');
  });

  it('fails closed without a service credential', () => {
    expect(() => createAttentionAutomationServerRepository({
      ...SAMPLE_WORKSPACE_SCOPE,
      mode: 'live',
    }, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    })).toThrow('server authority');
  });
});
