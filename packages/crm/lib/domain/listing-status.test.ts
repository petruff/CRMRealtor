import { describe, expect, it } from 'vitest';
import type { Contact } from './contact.ts';
import { listingStatusPatch, ListingStatusError, parseListingStatusInput, stageForListing } from './listing-status.ts';
import { isActiveSeller } from './seller-update.ts';

function lead(extra: Partial<Contact> = {}): Contact {
  return { id: 'c1', firstName: 'Ana', lastName: 'Silva', leadType: 'warm', relationship: 'lead', intent: 'seller', source: 'referral', pipelineStage: 'new', tags: [], createdAt: '2026-06-01T00:00:00.000Z', seller: { targetPrice: 500000, timeline: '3 months' }, ...extra };
}

describe('listing status', () => {
  it('validates the status and address', () => {
    expect(parseListingStatusInput({ status: 'Active', propertyAddress: '  123   Palm Ave ' })).toEqual({ status: 'Active', propertyAddress: '123 Palm Ave' });
    expect(() => parseListingStatusInput({ status: 'Hot', propertyAddress: '123 Palm Ave' })).toThrow(ListingStatusError);
    expect(() => parseListingStatusInput({ status: 'Active', propertyAddress: '' })).toThrow(/address/u);
  });

  it('only moves early-stage leads forward', () => {
    expect(stageForListing('new', 'Active')).toBe('active');
    expect(stageForListing('contacted', 'Pending')).toBe('under-contract');
    expect(stageForListing('under-contract', 'Active')).toBeUndefined();
    expect(stageForListing('closed', 'Active')).toBeUndefined();
    expect(stageForListing('new', 'Sold')).toBeUndefined();
  });

  it('keeps the other seller details and turns on the weekly update', () => {
    const contact = lead();
    expect(isActiveSeller(contact)).toBe(false);
    const patch = listingStatusPatch(contact, { status: 'Active', propertyAddress: '123 Palm Ave' });
    expect(patch).toEqual({ seller: { targetPrice: 500000, timeline: '3 months', propertyAddress: '123 Palm Ave', listingStatus: 'Active' }, pipelineStage: 'active' });
    expect(isActiveSeller({ ...contact, ...patch })).toBe(true);
    const sold = listingStatusPatch({ ...contact, ...patch }, { status: 'Sold', propertyAddress: '123 Palm Ave' });
    expect(isActiveSeller({ ...contact, ...patch, ...sold })).toBe(false);
  });

  it('marks a buyer as buyer and seller when they list a home', () => {
    expect(listingStatusPatch(lead({ intent: 'buyer', seller: undefined }), { status: 'Coming soon', propertyAddress: '9 Bay Rd' }).intent).toBe('both');
  });
});
