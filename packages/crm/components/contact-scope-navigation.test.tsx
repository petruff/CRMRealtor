import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContactScopeNavigation, emptyContactScopeCounts } from './contact-scope-navigation';

describe('ContactScopeNavigation', () => {
  it('uses semantic selected navigation and keeps Clients selected for a client subview', () => {
    const counts = { ...emptyContactScopeCounts(), clients: 8, 'active-clients': 5, 'past-clients': 3 };
    const html = renderToStaticMarkup(
      <ContactScopeNavigation scope="active-clients" counts={counts} viewState={{ scope: 'active-clients' }} />,
    );
    expect(html).toContain('aria-label="Contact views"');
    expect(html).toContain('aria-label="Client views"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('mb-3 sk-overflow-rail px-1 pb-2 pt-1');
    expect(html).toContain('sk-overflow-rail mb-7 px-1 pb-2 pt-1');
    expect(html).toContain('<ul class="flex min-w-max gap-2">');
    expect(html).not.toContain('inline-flex min-w-max');
    expect(html).not.toContain('rounded-2xl border border-line bg-surface-2 p-2');
    expect(html).not.toContain('sk-text-action');
    expect(html).toContain('sk-primary-button min-h-11 whitespace-nowrap px-4');
    expect(html).toContain('sk-secondary-button min-h-11 whitespace-nowrap px-4');
    expect(html.match(/rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-ink/g)).toHaveLength(7);
    expect(html).toContain('Active clients');
    expect(html).not.toContain('qualification=');
  });

  it('uses Needs review as the only user-facing qualification name', () => {
    const html = renderToStaticMarkup(
      <ContactScopeNavigation scope="needs-review" counts={emptyContactScopeCounts()} viewState={{ scope: 'needs-review' }} />,
    );
    expect(html).toContain('Needs review');
    expect(html).not.toContain('Figure out');
  });
});
