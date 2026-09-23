import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contactAddressLines } from '@/lib/domain/contact';
import { ContactReachSummary } from './contact-reach-summary';

describe('contactAddressLines', () => {
  it('formats a complete postal address into street and locality lines', () => {
    expect(contactAddressLines({ mailingAddress: '12 Palm Ave, Apt 4', city: 'Tampa', state: 'FL', postalCode: '33602' }))
      .toEqual(['12 Palm Ave, Apt 4', 'Tampa, FL 33602']);
  });

  it('uses only the parts that exist, without stray separators or placeholders', () => {
    expect(contactAddressLines({ city: 'Tampa' })).toEqual(['Tampa']);
    expect(contactAddressLines({ state: 'FL', postalCode: '33602' })).toEqual(['FL 33602']);
    expect(contactAddressLines({ mailingAddress: '12 Palm Ave' })).toEqual(['12 Palm Ave']);
    expect(contactAddressLines({ city: 'Tampa', postalCode: '33602' })).toEqual(['Tampa, 33602']);
    expect(contactAddressLines({ mailingAddress: '   ', city: '', state: undefined })).toEqual([]);
    expect(contactAddressLines({}).join(' ')).not.toMatch(/undefined|null/);
  });
});

describe('ContactReachSummary', () => {
  it('shows phone (still callable) and address together', () => {
    const html = renderToStaticMarkup(<ContactReachSummary callable contact={{
      phone: '(813) 555-0100', mailingAddress: '12 Palm Ave', city: 'Tampa', state: 'FL', postalCode: '33602',
    }} />);
    expect(html).toContain('aria-label="Phone and address"');
    expect(html).toContain('href="tel:(813) 555-0100"');
    expect(html).toContain('<dt class="flex items-center gap-1.5 text-xs font-medium text-muted"><svg');
    expect(html).toMatch(/Phone<\/dt>[\s\S]*Address<\/dt>/);
    expect(html).toContain('12 Palm Ave');
    expect(html).toContain('Tampa, FL 33602');
  });

  it('keeps the address visible when there is no phone, and says when the address is missing', () => {
    const noPhone = renderToStaticMarkup(<ContactReachSummary callable contact={{ city: 'Tampa', state: 'FL' }} />);
    expect(noPhone).toContain('Tampa, FL');
    expect(noPhone).toContain('Not provided');
    expect(noPhone).not.toContain('tel:');

    const nothing = renderToStaticMarkup(<ContactReachSummary callable contact={{}} />);
    expect(nothing.match(/Not provided/g)).toHaveLength(2);
  });

  it('wraps long addresses instead of overflowing and never uses the listing address', () => {
    const long = `${'1234 Extraordinarily Long Boulevard Name '.repeat(4)}Suite 900`;
    const contact = { mailingAddress: long, seller: { propertyAddress: '99 Listing Rd' } };
    const html = renderToStaticMarkup(<ContactReachSummary callable contact={contact} />);
    expect(html).toContain('break-words');
    expect(html).toContain('Suite 900');
    expect(html).not.toContain('99 Listing Rd');

    const onlyListing = renderToStaticMarkup(<ContactReachSummary callable contact={{ seller: { propertyAddress: '99 Listing Rd' } } as never} />);
    expect(onlyListing).not.toContain('99 Listing Rd');
  });

  it('shows the phone as text on read-only archived records', () => {
    const html = renderToStaticMarkup(<ContactReachSummary callable={false} contact={{ phone: '555-0100' }} />);
    expect(html).toContain('555-0100');
    expect(html).not.toContain('tel:');
  });

  it('lays out side by side on tablets and as a right-hand column on desktop', () => {
    const html = renderToStaticMarkup(<ContactReachSummary callable contact={{}} />);
    expect(html).toContain('w-full');
    expect(html).toContain('sm:grid-cols-2');
    expect(html).toContain('lg:w-[22rem]');
    expect(html).toContain('lg:grid-cols-1');
  });
});
