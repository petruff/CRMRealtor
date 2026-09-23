'use client';

import { useEffect, useState, useTransition } from 'react';
import { BellRing, BellOff, Eye, Smartphone } from 'lucide-react';
import { loadPushPreferencesAction, removePushSubscriptionAction, savePushSubscriptionAction, updatePushPreferencesAction } from '@/app/settings/push-actions';

type DeviceState = 'checking' | 'unsupported' | 'denied' | 'off' | 'on';

const HOURS = Array.from({ length: 24 }, (_, index) => index);
function hourLabel(value: number): string {
  if (value === 0) return '12 AM';
  if (value === 12) return '12 PM';
  return value < 12 ? `${value} AM` : `${value - 12} PM`;
}

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
  const [endpoint, setEndpoint] = useState<string>();
  const [choices, setChoices] = useState({ alertNewLeads: true, alertDeadlines: true, quietStartHour: 21, quietEndHour: 7 });

  useEffect(() => {
    if (!pushSupported()) { setState('unsupported'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    navigator.serviceWorker.getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then(async (subscription) => {
        setState(subscription ? 'on' : 'off');
        if (!subscription) return;
        setEndpoint(subscription.endpoint);
        const saved = await loadPushPreferencesAction(subscription.endpoint);
        if (saved.found && saved.preferences) {
          const { showNames: names, ...rest } = saved.preferences;
          setShowNames(names);
          setChoices(rest);
        }
      })
      .catch(() => setState('off'));
  }, []);

  /** On a registered device every change saves immediately; before that it just shapes the sign-up. */
  const change = (next: Partial<typeof choices> & { showNames?: boolean }) => {
    const { showNames: names, ...rest } = next;
    const merged = { ...choices, ...rest };
    const nextNames = names ?? showNames;
    setChoices(merged);
    if (names !== undefined) setShowNames(names);
    if (state !== 'on' || !endpoint) return;
    startTransition(async () => {
      const result = await updatePushPreferencesAction(endpoint, { ...merged, showNames: nextNames });
      setMessage({ tone: result.ok ? 'ok' : 'error', text: result.message });
    });
  };

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
        ...choices,
      });
      if (result.ok) setEndpoint(subscription.endpoint);
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
          <h2 id="morning-brief-title" className="ox-card-title mt-1">Morning brief &amp; alerts</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Around 7 AM, one notification with who to reach and any deal dates. Nothing is sent on quiet days. Choose below what else may reach this device.
          </p>
          {state === 'unsupported' ? (
            <p className="ox-settings-hint"><Smartphone className="size-4" aria-hidden /> This browser can’t receive notifications. On iPhone, add Omnix to your Home Screen first, then open it from there.</p>
          ) : state === 'denied' ? (
            <p className="ox-settings-hint"><BellOff className="size-4" aria-hidden /> Notifications are blocked for Omnix in this browser’s settings.</p>
          ) : null}
          <fieldset className="ox-alert-choices" disabled={pending}>
            <legend className="sr-only">What this device receives</legend>
            <label className="ox-toggle-row">
              <input type="checkbox" checked={choices.alertNewLeads} onChange={(event) => change({ alertNewLeads: event.target.checked })} />
              <span><strong>New leads, right away</strong><small>When a lead arrives from your website or a lead source — the first agent to call usually wins.</small></span>
            </label>
            <label className="ox-toggle-row">
              <input type="checkbox" checked={choices.alertDeadlines} onChange={(event) => change({ alertDeadlines: event.target.checked })} />
              <span><strong>Deal dates due in 48 hours</strong><small>Inspection, financing, appraisal and closing dates, in your morning brief.</small></span>
            </label>
            <label className="ox-toggle-row">
              <input type="checkbox" checked={showNames} onChange={(event) => change({ showNames: event.target.checked })} />
              <span><strong>Show names on the lock screen</strong><small>Off by default — a lock screen is not a private place.</small></span>
            </label>
            <div className="ox-quiet-hours">
              <span className="sk-label">Quiet hours</span>
              <label className="sr-only" htmlFor="quiet-start">Quiet hours start</label>
              <select id="quiet-start" className="sk-input" value={choices.quietStartHour} onChange={(event) => change({ quietStartHour: Number(event.target.value) })}>
                {HOURS.map((value) => <option key={value} value={value}>{hourLabel(value)}</option>)}
              </select>
              <span aria-hidden>to</span>
              <label className="sr-only" htmlFor="quiet-end">Quiet hours end</label>
              <select id="quiet-end" className="sk-input" value={choices.quietEndHour} onChange={(event) => change({ quietEndHour: Number(event.target.value) })}>
                {HOURS.map((value) => <option key={value} value={value}>{hourLabel(value)}</option>)}
              </select>
            </div>
            <p className="ox-settings-hint">During quiet hours new leads don’t ping you; they wait for your morning brief and are always first in line on Today.</p>
          </fieldset>
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
