'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HeartHandshake, Share2, Sparkles, X, Zap } from 'lucide-react';

export const WHATS_NEW_KEY = 'omnix-whats-new-2026-09';

const ITEMS = [
  { icon: Sparkles, title: 'A calmer layout', body: 'Today, People, Deals, Inbox and Omnix. Everything else is under More — your contacts and notes are exactly where you left them.', href: undefined },
  { icon: Zap, title: 'Power Hour', body: 'Work through who to reach, one person at a time.', href: '/power-hour' },
  { icon: HeartHandshake, title: 'Referral engine', body: 'Birthdays, home anniversaries and past clients, with notes ready to send.', href: '/sphere' },
  { icon: Share2, title: 'Client page', body: 'Share a private progress page from any deal.', href: '/transactions' },
] as const;

/**
 * One-time, dismissible note about the September update. Shown once per
 * browser and never again after "Got it"; nothing is stored on the server.
 */
export function WhatsNew() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { setOpen(window.localStorage.getItem(WHATS_NEW_KEY) !== 'seen'); } catch { setOpen(false); }
  }, []);

  if (!open) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(WHATS_NEW_KEY, 'seen'); } catch { /* storage unavailable */ }
    setOpen(false);
  };

  return (
    <section className="ox-card ox-whats-new" aria-labelledby="whats-new-title">
      <header className="ox-whats-new-header">
        <div>
          <p className="ox-eyebrow">What’s new</p>
          <h2 id="whats-new-title" className="ox-card-title">Omnix has a few new tools for you</h2>
        </div>
        <button type="button" className="ox-whats-new-close" onClick={dismiss} aria-label="Dismiss what’s new"><X className="size-4" aria-hidden /></button>
      </header>
      <ul className="ox-whats-new-list">
        {ITEMS.map(({ icon: Icon, title, body, href }) => (
          <li key={title}>
            <span className="ox-icon-chip ox-tone-reply"><Icon className="size-4" aria-hidden /></span>
            <div className="min-w-0">
              <p className="ox-row-title">{href ? <Link href={href} onClick={dismiss}>{title}</Link> : title}</p>
              <p className="ox-row-detail">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="ox-whats-new-footer"><button type="button" className="sk-secondary-button" onClick={dismiss}>Got it</button></div>
    </section>
  );
}
