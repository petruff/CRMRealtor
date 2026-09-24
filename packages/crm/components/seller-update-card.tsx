'use client';

import { useState } from 'react';
import { Check, Home } from 'lucide-react';
import type { MarkSentResult } from '@/app/ready-to-send-actions';
import type { ReadyItem } from '@/lib/application/ready-to-send';
import { ReadyRow } from './ready-to-send';

/** A seller's weekly update, ready on their page any day of the week. */
export function SellerUpdateCard({ item, markSent, lastSentLabel }: {
  item: ReadyItem;
  markSent: (contactId: string, body: string) => Promise<MarkSentResult>;
  lastSentLabel?: string;
}) {
  const [state, setState] = useState<'open' | 'sent' | 'hidden'>('open');
  if (state === 'hidden') return null;
  return (
    <section className="ox-card ox-ready" aria-labelledby="seller-update-title">
      <header className="ox-card-header">
        <span className="ox-icon-chip ox-tone-reply"><Home className="size-4" aria-hidden /></span>
        <h2 id="seller-update-title" className="ox-card-title">Weekly seller update</h2>
      </header>
      {state === 'sent' ? (
        <p className="ox-card-empty" role="status"><Check className="size-4 text-accent" aria-hidden /> Logged. Next Friday’s update will be ready here and on Today.</p>
      ) : (
        <>
          <p className="px-5 pb-2 text-sm text-muted">Sellers want to hear from you every week, even when it’s quiet.{lastSentLabel ? ` Last update: ${lastSentLabel}.` : ''}</p>
          <ul className="ox-ready-list">
            <ReadyRow item={item} markSent={markSent} onDone={() => setState('sent')} onSkip={() => setState('hidden')} />
          </ul>
        </>
      )}
    </section>
  );
}
