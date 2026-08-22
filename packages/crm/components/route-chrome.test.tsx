// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/omnix' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="authenticated-shell" data-pathname={navigation.pathname}>{children}</div>
  ),
}));

vi.mock('@/components/demo-banner', () => ({ DemoBanner: () => <div>Workspace status</div> }));

import { RouteChrome } from '@/components/route-chrome';

afterEach(cleanup);

describe('RouteChrome', () => {
  it.each([
    ['/omnix', 'Omnix AI workspace'],
    ['/alerts', 'What needs attention'],
    ['/activities', 'Work queue'],
    ['/pipeline', 'Pipeline workspace'],
  ])('replaces %s content when pathname and RSC children advance to Today', (pathname, priorHeading) => {
    navigation.pathname = pathname;
    const view = render(<RouteChrome><h1>{priorHeading}</h1></RouteChrome>);
    expect(screen.getByTestId('authenticated-shell')).toHaveAttribute('data-pathname', pathname);
    expect(screen.getByRole('heading', { name: priorHeading })).toBeInTheDocument();

    navigation.pathname = '/';
    view.rerender(<RouteChrome><h1>Good morning, Judith.</h1></RouteChrome>);

    expect(screen.getByTestId('authenticated-shell')).toHaveAttribute('data-pathname', '/');
    expect(screen.getByRole('heading', { name: 'Good morning, Judith.' })).toBeInTheDocument();
    expect(screen.queryByText(priorHeading)).not.toBeInTheDocument();
  });
});
