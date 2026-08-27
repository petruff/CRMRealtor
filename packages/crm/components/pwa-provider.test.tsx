/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaInstallAction, PwaProvider } from './pwa-provider';

function matchMedia(matches = false): MediaQueryList {
  return {
    matches,
    media: '(display-mode: standalone)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe('PwaProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => matchMedia(false)));
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => matchMedia(false)) });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers clear manual installation guidance when a native prompt is unavailable', async () => {
    const user = userEvent.setup();
    render(<PwaProvider><PwaInstallAction /></PwaProvider>);

    const install = screen.getByRole('button', { name: 'Install Omnix' });
    await user.click(install);
    expect(screen.getByRole('dialog', { name: 'Install Omnix on this device' })).toHaveFocus();
    expect(screen.getByText('Open the browser menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(install).toHaveFocus());
  });

  it('uses the native install prompt when the browser makes it available', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
    render(<PwaProvider><PwaInstallAction /></PwaProvider>);

    window.dispatchEvent(event);
    await user.click(screen.getByRole('button', { name: 'Install Omnix' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('announces connection loss without replacing the current screen', async () => {
    render(<PwaProvider><p>Current CRM work</p></PwaProvider>);
    window.dispatchEvent(new Event('offline'));

    expect(await screen.findByRole('status')).toHaveTextContent('Client records stay protected');
    expect(screen.getByText('Current CRM work')).toBeInTheDocument();
  });
});
