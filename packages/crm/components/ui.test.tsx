import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionLink, EmptyState, LeadBadge } from '@/components/ui';

describe('semantic action primitives', () => {
  it('keeps internal and protocol navigation as anchors with button affordance', () => {
    const internal = renderToStaticMarkup(<ActionLink href="/alerts" variant="primary">Review alerts</ActionLink>);
    const protocol = renderToStaticMarkup(<ActionLink href="mailto:agent@example.com">Email agent</ActionLink>);

    expect(internal).toContain('<a class="sk-primary-button');
    expect(internal).toContain('href="/alerts"');
    expect(protocol).toContain('<a href="mailto:agent@example.com"');
    expect(internal).not.toContain('<button');
  });

  it('adds an optional semantic CTA without changing passive empty states', () => {
    const actionable = renderToStaticMarkup(<EmptyState title="No contacts" message="Start here." action={{ href: '/contacts/new', label: 'Add contact' }} />);
    const passive = renderToStaticMarkup(<EmptyState message="No items." />);

    expect(actionable).toContain('href="/contacts/new"');
    expect(passive).not.toContain('<a');
  });

  it('shows client relationship status instead of a misleading lead temperature', () => {
    const pastClient = renderToStaticMarkup(
      <LeadBadge leadType="hot" relationship="past-client" />,
    );
    const lead = renderToStaticMarkup(<LeadBadge leadType="hot" relationship="lead" />);

    expect(pastClient).toContain('Past client');
    expect(pastClient).not.toContain('Hot');
    expect(lead).toContain('Hot');
  });
});
