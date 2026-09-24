import type { Metadata } from 'next';
import { ListingWriter, type ListingPrefill } from '@/components/listing-writer';
import { PageHeader } from '@/components/page-header';
import { getRepository } from '@/lib/data';
import { propertyFactCanDisplay } from '@/lib/domain/property';
import { writeListingCopyAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Listing writer', description: 'MLS remarks, social posts, an email blast and an open-house text from your listing facts.' };

const KIND_TO_TYPE: Record<string, ListingPrefill['homeType']> = {
  'single-family': 'single-family home', condo: 'condo', townhouse: 'townhouse', multifamily: 'multifamily', land: 'land',
};

export default async function ListingWriterPage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  const { propertyId } = await searchParams;
  const context = await getRepository();
  let prefill: ListingPrefill | undefined;
  if (propertyId && /^[A-Za-z0-9-]{1,64}$/u.test(propertyId)) {
    const properties = await context.propertyRepository.list(context.workspaceScope, { limit: 200 }).catch(() => []);
    const property = properties.find((item) => item.id === propertyId);
    if (property) {
      const facts = (await context.propertyRepository.listFacts(context.workspaceScope, [property.id]).catch(() => []))
        .filter((fact) => propertyFactCanDisplay(fact));
      const fact = (field: string) => facts.find((item) => item.field === field)?.value;
      const num = (value: unknown) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined);
      const cents = num(fact('list-price-cents'));
      prefill = {
        address: property.addressLine1,
        city: property.city,
        homeType: KIND_TO_TYPE[property.kind] ?? 'single-family home',
        ...(num(fact('bedrooms')) !== undefined ? { beds: num(fact('bedrooms')) } : {}),
        ...(num(fact('bathrooms')) !== undefined ? { baths: num(fact('bathrooms')) } : {}),
        ...(num(fact('square-feet')) !== undefined ? { squareFeet: num(fact('square-feet')) } : {}),
        ...(num(fact('year-built')) !== undefined ? { yearBuilt: num(fact('year-built')) } : {}),
        ...(cents ? { price: Math.round(cents / 100) } : {}),
      };
    }
  }
  return (
    <div className="ox-stack ox-narrow">
      <PageHeader eyebrow="Listing writer" title="Write the listing in a minute"
        description="MLS remarks, Instagram and Facebook posts, an email blast and an open-house text — in English or Spanish, from your facts, checked for Fair Housing." />
      <ListingWriter action={writeListingCopyAction} {...(prefill ? { prefill } : {})} {...(context.userDisplayName ? { agentName: context.userDisplayName } : {})} />
    </div>
  );
}
