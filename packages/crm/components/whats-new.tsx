'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Heart, MessageSquareText, Mic, QrCode, Send, Sparkles, X } from 'lucide-react';

export const WHATS_NEW_KEY = 'omnix-whats-new-2026-09-daily-agent';

const ITEMS = [
  { icon: Send, title: 'Ready to send', body: 'Each morning Omnix prepares today’s texts — new leads, follow-ups, birthdays. Review, send from your phone, tap Mark sent.', href: undefined },
  { icon: Mic, title: 'Voice update', body: 'On a contact, tap Voice update and say what happened. Budget, beds, areas and the next follow-up update in one step.', href: undefined },
  { icon: Heart, title: 'What matters to them', body: 'Pets, work, moves and how they like to be reached — pulled from your notes onto each contact.', href: undefined },
  { icon: Sparkles, title: 'A smarter Omnix assistant', body: 'Ask in your own words — “hot buyers I haven’t called in a week”, “remind me to call Ana tomorrow”.', href: '/omnix' },
  { icon: QrCode, title: 'Your lead page', body: 'One link and QR code for your bio, signs and cards. Every inquiry becomes a lead with an instant alert.', href: '/lead-page' },
  { icon: MessageSquareText, title: 'Quick texts', body: 'Tap Text on a contact for ready-made messages in English or Spanish.', href: undefined },
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
