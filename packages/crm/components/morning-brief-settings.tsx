'use client';

import { useEffect, useState, useTransition } from 'react';
import { BellRing, BellOff, Eye, Smartphone } from 'lucide-react';
import { removePushSubscriptionAction, savePushSubscriptionAction } from '@/app/settings/push-actions';

type DeviceState = 'checking' | 'unsupported' | 'denied' | 'off' | 'on';

function base64UrlToBytes(value: string): Uint8Array {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

/** The PWA provider registers the worker in production; register it here if it is missing. */
async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');
}

function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Opt-in daily brief for this device. Names stay off the lock screen unless
 * the realtor chooses otherwise. "Preview" shows a local notification and works
 * even before server delivery is configured.
 */
export function MorningBriefSettings({ publicKey, isLive }: { publicKey?: string; isLive: boolean }) {
  const [state, setState] = useState<DeviceState>('checking');
  const [showNames, setShowNames] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pushSupported()) { setState('unsupported'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    navigator.serviceWorker.getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, []);

  const turnOn = () => startTransition(async () => {
    setMessage(undefined);
    if (!publicKey) { setMessage({ tone: 'error', text: 'Notifications still need to be set up for this workspace. You can preview how they will look.' }); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }
    try {
      const registration = await ensureRegistration();
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) as BufferSource });
      const result = await savePushSubscriptionAction({
        endpoint: subscription.endpoint,
        p256dh: bytesToBase64Url(subscription.getKey('p256dh')),
        auth: bytesToBase64Url(subscription.getKey('auth')),
        showNames,
      });
      if (!result.ok) await subscription.unsubscribe();
      setState(result.ok ? 'on' : 'off');
      setMessage({ tone: result.ok ? 'ok' : 'error', text: result.message });
    } catch {
      setMessage({ tone: 'error', text: 'This browser could not turn on notifications. Nothing was changed.' });
    }
  });

  const turnOff = () => startTransition(async () => {
    setMessage(undefined);
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      const result = await removePushSubscriptionAction(subscription.endpoint);
      await subscription.unsubscribe();
      setMessage({ tone: result.ok ? 'ok' : 'error', text: result.message });
    }
    setState('off');
  });

  const preview = () => startTransition(async () => {
    setMessage(undefined);
    if (!pushSupported()) return;
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') { setState('denied'); return; }
    const registration = await ensureRegistration();
    await registration.showNotification('Good morning — 3 people to reach', {
      body: showNames ? 'Start with Daniel Okafor, Alicia Monroe and Marisol Reyes.' : 'Tap to start your Power Hour.',
      icon: '/pwa/icon-192.png',
      tag: 'omnix-morning-brief-preview',
      data: { url: '/power-hour' },
    });
  });

  return (
    <section id="morning-brief" aria-labelledby="morning-brief-title" className="ox-card ox-settings-card">
      <div className="ox-settings-card-body">
        <span className="ox-icon-chip ox-tone-reply"><BellRing className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="ox-eyebrow">Notifications</p>
          <h2 id="morning-brief-title" className="ox-card-title mt-1">Morning brief</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Around 7 AM, get one notification with how many people to reach and any deal dates this week. Nothing is sent on quiet days.
          </p>
          {state === 'unsupported' ? (
            <p className="ox-settings-hint"><Smartphone className="size-4" aria-hidden /> This browser can’t receive notifications. On iPhone, add Omnix to your Home Screen first, then open it from there.</p>
          ) : state === 'denied' ? (
            <p className="ox-settings-hint"><BellOff className="size-4" aria-hidden /> Notifications are blocked for Omnix in this browser’s settings.</p>
          ) : null}
          <label className="ox-toggle-row">
            <input type="checkbox" checked={showNames} onChange={(event) => setShowNames(event.target.checked)} disabled={state === 'on' || pending} />
            <span><strong>Show names on the lock screen</strong><small>Off by default — a lock screen is not a private place.</small></span>
          </label>
          {!isLive ? <p className="ox-settings-hint">Sample workspace: delivery needs a live workspace, but you can preview the notification.</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {state === 'on' ? (
              <button type="button" className="sk-secondary-button" onClick={turnOff} disabled={pending}><BellOff className="size-4" aria-hidden /> Turn off on this device</button>
            ) : (
              <button type="button" className="sk-primary-button" onClick={turnOn} disabled={pending || state === 'unsupported' || state === 'denied' || state === 'checking'}>
                <BellRing className="size-4" aria-hidden /> {pending ? 'Working…' : 'Turn on for this device'}
              </button>
            )}
            <button type="button" className="sk-secondary-button" onClick={preview} disabled={pending || state === 'unsupported' || state === 'denied'}>
              <Eye className="size-4" aria-hidden /> Preview
            </button>
          </div>
          <p className="mt-3 min-h-5 text-sm" role="status">
            {message ? <span className={message.tone === 'ok' ? 'text-nurture' : 'text-hot'}>{message.text}</span> : state === 'on' ? <span className="text-nurture">On for this device.</span> : null}
          </p>
        </div>
      </div>
    </section>
  );
}
