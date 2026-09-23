'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BellRing, CalendarRange, PhoneCall, QrCode, Undo2, X } from 'lucide-react';

export const WHATS_NEW_KEY = 'omnix-whats-new-2026-09-lead-page';

const ITEMS = [
  { icon: QrCode, title: 'Your lead page', body: 'One link and QR code for your bio, signs and cards. Every inquiry becomes a lead with an instant alert.', href: '/lead-page' },
  { icon: PhoneCall, title: 'Log a call in one tap', body: 'After you call someone from Omnix, it offers to save how it went — with voice notes. You can turn this off.', href: undefined },
  { icon: Undo2, title: 'Undo after archiving', body: 'Archived someone by mistake? Tap Undo and you are right back where you were.', href: undefined },
  { icon: BellRing, title: 'Alerts you choose', body: 'New leads right away, deal dates 48 hours ahead, and quiet hours at night.', href: '/settings#morning-brief' },
  { icon: CalendarRange, title: 'Contract timeline', body: 'Enter the Effective Date once and every Florida contract deadline is added for you.', href: '/transactions' },
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
          <h2 id="whats-new-title" className="ox-card-title">A few time-savers were just added</h2>
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
