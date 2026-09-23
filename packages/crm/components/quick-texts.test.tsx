/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { QUICK_TEXT_LANGUAGE_KEY, QuickTexts } from './quick-texts';

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('QuickTexts', () => {
  it('opens ready-made messages that prefill the Messages app', async () => {
    render(<QuickTexts phone="(305) 555-0101" firstName="Ana" agentName="Judith" />);
    expect(screen.queryByRole('region', { name: 'Quick texts' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Text' }));
    const link = screen.getByRole('link', { name: /reply to a new lead/i });
    expect(link.getAttribute('href')).toMatch(/^sms:3055550101\?&body=Hi%20Ana%2C%20this%20is%20Judith/);
    expect(screen.getByRole('link', { name: /blank message/i })).toHaveAttribute('href', 'sms:3055550101');
  });

  it('switches to Spanish and remembers the choice', async () => {
    render(<QuickTexts phone="3055550101" firstName="Ana" />);
    await userEvent.click(screen.getByRole('button', { name: 'Text' }));
    await userEvent.click(screen.getByRole('button', { name: 'ES' }));
    expect(screen.getByRole('link', { name: /after a showing/i }).textContent).toContain('gracias');
    expect(window.localStorage.getItem(QUICK_TEXT_LANGUAGE_KEY)).toBe('es');
  });

  it('opens straight to the list from a new-lead alert', () => {
    render(<QuickTexts phone="3055550101" firstName="Ana" initiallyOpen />);
    expect(screen.getByRole('region', { name: 'Quick texts' })).toBeInTheDocument();
  });

  it('renders nothing without a usable phone number', () => {
    const { container } = render(<QuickTexts phone="n/a" />);
    expect(container).toBeEmptyDOMElement();
  });
});
