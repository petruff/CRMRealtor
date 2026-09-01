import { describe, expect, it } from 'vitest';
import { createDisabledListingAdapter, validateListingProviderAuthority, validateListingSyncPage, validateListingSyncRequest } from './licensed-listing-provider';

const authority = { providerKey:'reso-provider',displayName:'Licensed MLS feed',state:'active' as const,rightsReference:'agreement:MLS-2026-001',credentialBindingReference:'server-secret:reso-provider',effectiveAt:'2026-08-31T12:00:00Z',expiresAt:'2027-08-31T12:00:00Z',policy:{attributionLabel:'Data supplied by licensed MLS',attributionUrl:'https://provider.example/attribution',freshnessMinutes:15,displayHours:24,retentionHours:48,deletionDeadlineHours:12,mediaPermitted:false} };

describe('licensed listing provider contract', () => {
  it('requires active authority to include a server credential binding', () => {
    expect(() => validateListingProviderAuthority({ ...authority, credentialBindingReference: undefined })).toThrow('server credential binding');
    expect(validateListingProviderAuthority(authority).providerKey).toBe('reso-provider');
  });
  it('bounds cursors and requires continuing pages to return a next cursor', () => {
    expect(validateListingSyncRequest({ cursor:'cursor-1',pageSize:100,requestedAt:'2026-08-31T12:00:00Z' }).pageSize).toBe(100);
    expect(() => validateListingSyncRequest({ cursor:'x'.repeat(513),pageSize:100,requestedAt:'2026-08-31T12:00:00Z' })).toThrow('Provider cursor');
    expect(() => validateListingSyncPage({ changes:[],hasMore:true,providerAsOf:'2026-08-31T12:00:00Z' })).toThrow('requires a cursor');
  });
  it('rejects deletion notices carrying retained listing facts', () => {
    expect(() => validateListingSyncPage({ changes:[{kind:'delete',remoteRecordId:'remote-1',modifiedAt:'2026-08-31T12:00:00Z',payloadHash:'a'.repeat(64),mappedFacts:{bedrooms:3}}],hasMore:false,providerAsOf:'2026-08-31T12:00:00Z' })).toThrow('cannot include listing facts');
  });
  it('performs no provider work in the default disabled state', async () => {
    const adapter = createDisabledListingAdapter();
    expect(adapter.enabled).toBe(false);
    await expect(adapter.listChanges({ pageSize:100,requestedAt:new Date().toISOString() })).rejects.toThrow('disabled');
  });
});
