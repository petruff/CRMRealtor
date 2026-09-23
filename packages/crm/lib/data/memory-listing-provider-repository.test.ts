import { describe, expect, it } from 'vitest';
import { SAMPLE_ASSISTANT_SCOPE, SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { createMemoryListingProviderRepository } from './memory-listing-provider-repository';

const authority={providerKey:'reso-provider',displayName:'Licensed feed',state:'pending' as const,rightsReference:'agreement:MLS-2026-001',effectiveAt:'2026-08-31T12:00:00Z',policy:{attributionLabel:'Licensed MLS',attributionUrl:'https://provider.example/',freshnessMinutes:15,displayHours:24,retentionHours:48,deletionDeadlineHours:12,mediaPermitted:false}};
describe('memory listing provider repository',()=>{
  it('keeps configuration and revocation owner-only',async()=>{const repository=createMemoryListingProviderRepository();await expect(repository.configureAuthority(SAMPLE_ASSISTANT_SCOPE,authority,'2026-08-31T12:00:00Z')).rejects.toThrow('owner');const saved=await repository.configureAuthority(SAMPLE_WORKSPACE_SCOPE,authority,'2026-08-31T12:00:00Z');expect((await repository.listAuthorities(SAMPLE_WORKSPACE_SCOPE))[0]?.state).toBe('pending');expect((await repository.revokeAuthority(SAMPLE_WORKSPACE_SCOPE,saved.id,'rights-revoked','2026-08-31T13:00:00Z')).state).toBe('revoked');});
});
