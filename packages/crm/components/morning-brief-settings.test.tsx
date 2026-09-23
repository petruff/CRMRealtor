// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock('@/app/settings/push-actions', () => ({ savePushSubscriptionAction: actions.save, removePushSubscriptionAction: actions.remove }));

import { MorningBriefSettings } from '@/components/morning-brief-settings';

function installPush(permission: NotificationPermission) {
  const subscription = { endpoint: 'https://push.example/1', getKey: () => new Uint8Array([1, 2, 3]).buffer, unsubscribe: vi.fn() };
  const registration = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => subscription) }, showNotification: vi.fn() };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: vi.fn(async () => registration), register: vi.fn(async () => registration) } });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
  Object.defineProperty(window, 'Notification', { configurable: true, value: Object.assign(class {}, { permission, requestPermission: vi.fn(async () => 'granted') }) });
  return registration;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).PushManager;
  delete (window as unknown as Record<string, unknown>).Notification;
  actions.save.mockReset();
});

describe('MorningBriefSettings', () => {
  it('explains when the browser cannot receive notifications (e.g. iPhone outside the Home Screen app)', async () => {
    render(<MorningBriefSettings isLive publicKey="BKey" />);
    expect(await screen.findByText(/add Omnix to your Home Screen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Turn on for this device/ })).toBeDisabled();
  });

  it('keeps names off the lock screen by default and previews locally', async () => {
    const registration = installPush('default');
    const user = userEvent.setup();
    render(<MorningBriefSettings isLive={false} />);
    const names = screen.getByRole('checkbox', { name: /Show names on the lock screen/ });
    expect(names).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole('button', { name: /Preview/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => expect(registration.showNotification).toHaveBeenCalledWith('Good morning — 3 people to reach', expect.objectContaining({ body: 'Tap to start your Power Hour.' })));
  });

  it('does not subscribe before the workspace has notification keys', async () => {
    const registration = installPush('granted');
    const user = userEvent.setup();
    render(<MorningBriefSettings isLive />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Turn on for this device/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Turn on for this device/ }));
    expect(await screen.findByText(/still need to be set up/)).toBeInTheDocument();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('subscribes, stores the device and reports success', async () => {
    installPush('granted');
    actions.save.mockResolvedValue({ ok: true, message: 'Morning brief is on for this device.' });
    const user = userEvent.setup();
    render(<MorningBriefSettings isLive publicKey="BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Turn on for this device/ })).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: /Show names/ }));
    await user.click(screen.getByRole('button', { name: /Turn on for this device/ }));
    expect(await screen.findByText('Morning brief is on for this device.')).toBeInTheDocument();
    expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.example/1', showNames: true }));
    expect(screen.getByRole('button', { name: /Turn off on this device/ })).toBeInTheDocument();
  });
});
