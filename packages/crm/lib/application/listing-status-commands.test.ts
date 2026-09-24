import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '../domain/contact.ts';
import { setListingStatus } from './listing-status-commands.ts';
import { ListingStatusError } from '../domain/listing-status.ts';

const ana: Contact = { id: 'c1', firstName: 'Ana', lastName: 'Silva', leadType: 'warm', relationship: 'lead', intent: 'seller', source: 'referral', pipelineStage: 'contacted', tags: [], createdAt: '2026-06-01T00:00:00.000Z' };

function repo(contact: Contact | undefined) {
  return { get: vi.fn(async () => contact), update: vi.fn(async (_id: string, patch: Partial<Contact>) => ({ ...contact!, ...patch })) };
}

describe('setListingStatus', () => {
  it('updates only the seller fields and stage', async () => {
    const repository = repo(ana);
    const result = await setListingStatus({ repository: repository as never, contactId: 'c1', status: 'Active', propertyAddress: '123 Palm Ave' });
    expect(repository.update).toHaveBeenCalledWith('c1', { seller: { propertyAddress: '123 Palm Ave', listingStatus: 'Active' }, pipelineStage: 'active' });
    expect(result.message).toBe('Ana Silva’s listing is active.');
  });

  it('refuses archived or missing contacts and bad input without writing', async () => {
    const archived = repo({ ...ana, archivedAt: '2026-09-01T00:00:00.000Z' });
    await expect(setListingStatus({ repository: archived as never, contactId: 'c1', status: 'Active', propertyAddress: '123 Palm Ave' })).rejects.toBeInstanceOf(ListingStatusError);
    const bad = repo(ana);
    await expect(setListingStatus({ repository: bad as never, contactId: 'c1', status: 'Active', propertyAddress: '' })).rejects.toThrow(/address/u);
    await expect(setListingStatus({ repository: bad as never, contactId: '../x y', status: 'Active', propertyAddress: '123 Palm Ave' })).rejects.toThrow(/contact/u);
    expect(archived.update).not.toHaveBeenCalled();
    expect(bad.update).not.toHaveBeenCalled();
  });
});
