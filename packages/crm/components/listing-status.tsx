'use client';

import { useState, useTransition } from 'react';
import { Check, Home, Pencil } from 'lucide-react';
import type { ListingStatusResult } from '@/app/contacts/listing-status-actions';
import { LISTING_STATUSES, stageForListing, type ListingStatus } from '@/lib/domain/listing-status';
import type { PipelineStage } from '@/lib/domain/contact';

type Save = (contactId: string, status: string, propertyAddress: string) => Promise<ListingStatusResult>;

const STAGE_LABEL: Partial<Record<PipelineStage, string>> = { active: 'Active', 'under-contract': 'Under contract' };

/** One-tap listing status for a seller; listed homes get a weekly update every Friday. */
export function ListingStatusControl({ contactId, stage, currentStatus, currentAddress, save }: {
  contactId: string; stage: PipelineStage; currentStatus?: string; currentAddress?: string; save: Save;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ListingStatus>((LISTING_STATUSES as readonly string[]).includes(currentStatus ?? '') ? currentStatus as ListingStatus : 'Active');
  const [address, setAddress] = useState(currentAddress ?? '');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const nextStage = stageForListing(stage, status);

  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="omnix-chip-action" onClick={() => { setOpen(true); setMessage(null); }}>
          {currentStatus ? <Pencil className="size-3.5" aria-hidden /> : <Home className="size-3.5" aria-hidden />}
          {currentStatus ? 'Change listing status' : 'Mark as listing'}
        </button>
        {message?.tone === 'ok' ? <p role="status" className="flex items-center gap-1 text-xs text-muted"><Check className="size-3.5 text-accent" aria-hidden /> {message.text}</p> : null}
      </div>
    );
  }

  return (
    <form className="mt-4 grid gap-3 rounded-2xl border border-line bg-surface-2 p-4 sm:grid-cols-[minmax(0,1fr)_12rem]" onSubmit={(event) => {
      event.preventDefault();
      setMessage(null);
      startTransition(async () => {
        const result = await save(contactId, status, address);
        if (result.status === 'saved') { setOpen(false); setMessage({ tone: 'ok', text: result.message }); }
        else setMessage({ tone: 'error', text: result.message });
      });
    }}>
      <label className="sk-field"><span className="sk-label">Home being sold</span>
        <input className="sk-input" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={160} required placeholder="123 Palm Ave, Doral" /></label>
      <label className="sk-field"><span className="sk-label">Listing status</span>
        <select className="sk-input" value={status} onChange={(event) => setStatus(event.target.value as ListingStatus)}>
          {LISTING_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
      <p className="text-xs text-muted sm:col-span-2">
        {status === 'Sold' || status === 'Withdrawn' ? 'Weekly seller updates stop for this home.' : 'A weekly update for this seller will be ready every Friday.'}
        {nextStage ? ` The deal stage also moves to ${STAGE_LABEL[nextStage]}.` : ''}
      </p>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className={`sk-primary-button${pending ? ' ox-busy' : ''}`} disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="sk-secondary-button" onClick={() => { setOpen(false); setMessage(null); }}>Cancel</button>
      </div>
      {message?.tone === 'error' ? <p role="alert" className="text-sm text-hot sm:col-span-2">{message.text}</p> : null}
    </form>
  );
}
