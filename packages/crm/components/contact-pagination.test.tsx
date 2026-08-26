import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { paginateContacts } from '@/lib/application/contact-query';
import { ContactPagination } from './contact-pagination';

describe('ContactPagination', () => {
  it('renders a bounded exact-count window with semantic filter-preserving navigation', () => {
    const page = paginateContacts(Array.from({ length: 1001 }, (_, index) => index), 11);
    const html = renderToStaticMarkup(
      <ContactPagination page={page} hrefForPage={(target) => `/contacts?scope=clients&q=Judith&page=${target}`} />,
    );

    expect(page.items).toHaveLength(50);
    expect(html).toContain('aria-label="Contact result pages"');
    expect(html).toContain('Showing <strong class="text-ink">501–550</strong> of');
    expect(html).toContain('<strong class="text-ink">1001</strong> exact contacts');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('scope=clients');
    expect(html).toContain('q=Judith');
  });

  it('exposes disabled previous and next states at an empty boundary', () => {
    const html = renderToStaticMarkup(
      <ContactPagination page={paginateContacts([], 1)} hrefForPage={(target) => `/contacts?page=${target}`} />,
    );
    expect(html).toContain('Showing <strong class="text-ink">0–0</strong>');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });
});
