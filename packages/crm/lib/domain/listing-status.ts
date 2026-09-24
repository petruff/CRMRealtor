import type { Contact, PipelineStage, SellerCriteria } from './contact.ts';

/**
 * A seller's listing status, set in one tap from the contact page. "Coming
 * soon", "Active" and "Pending" mean she represents the home now, which turns
 * on the weekly seller update. No other field or contact is touched.
 */
export const LISTING_STATUSES = ['Coming soon', 'Active', 'Pending', 'Sold', 'Withdrawn'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export class ListingStatusError extends Error {}

const EARLY_STAGES: readonly PipelineStage[] = ['new', 'contacted', 'appointment-set'];

export function parseListingStatusInput(input: { readonly status: unknown; readonly propertyAddress: unknown }): { readonly status: ListingStatus; readonly propertyAddress: string } {
  const status = LISTING_STATUSES.find((item) => item === input.status);
  if (!status) throw new ListingStatusError('Choose a listing status.');
  const propertyAddress = typeof input.propertyAddress === 'string' ? input.propertyAddress.normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
  if (propertyAddress.length < 5) throw new ListingStatusError('Add the address of the home being sold.');
  if (propertyAddress.length > 160 || /[\u0000-\u001f\u007f]/u.test(propertyAddress)) throw new ListingStatusError('Keep the address under 160 characters.');
  return { status, propertyAddress };
}

/** The stage a listing implies, only ever moving an early-stage lead forward. */
export function stageForListing(current: PipelineStage, status: ListingStatus): PipelineStage | undefined {
  if (!EARLY_STAGES.includes(current)) return undefined;
  if (status === 'Active' || status === 'Coming soon') return 'active';
  if (status === 'Pending') return 'under-contract';
  return undefined;
}

export function listingStatusPatch(contact: Contact, input: { readonly status: ListingStatus; readonly propertyAddress: string }): Partial<Contact> {
  const seller: SellerCriteria = { ...(contact.seller ?? {}), propertyAddress: input.propertyAddress, listingStatus: input.status };
  const stage = stageForListing(contact.pipelineStage, input.status);
  const intent = contact.intent === 'seller' || contact.intent === 'both' ? undefined : contact.intent === 'buyer' ? 'both' as const : 'seller' as const;
  return { seller, ...(stage ? { pipelineStage: stage } : {}), ...(intent ? { intent } : {}) };
}
