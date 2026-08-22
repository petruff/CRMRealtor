/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    React.createElement('a', { href, ...props }, children)
  ),
}));

import ActivitiesLoading from '@/app/activities/loading';
import ActivitiesError from '@/app/activities/error';

describe('Activities route states', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('announces a truthful named loading state covered by reduced-motion policy', () => {
    render(React.createElement(ActivitiesLoading));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading the work queue…');
    expect(status.querySelector('.animate-spin')).toHaveAttribute('aria-hidden', 'true');

    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\*,[\s\S]*?animation-duration:\s*0\.01ms\s*!important;[\s\S]*?animation-iteration-count:\s*1\s*!important;/s);
  });

  it('states what failed and what stayed safe, then preserves recovery destinations', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const expectedError = new Error('authorized read unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(React.createElement(ActivitiesError, { error: expectedError, reset }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your tasks are still safe.');
    expect(alert).toHaveTextContent('Nothing was changed or removed.');
    expect(screen.getByRole('link', { name: 'Return to Today' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Open contacts' })).toHaveAttribute('href', '/contacts');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[activities-page]', expectedError);
  });
});
