'use client';

import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import { DoorOpen, MessageSquarePlus, Upload, UserRoundPlus, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface CaptureOption {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const CAPTURE_OPTIONS: readonly CaptureOption[] = [
  { href: '/capture', label: 'Log a conversation', description: 'Call, showing or text — notes, next step and follow-up date', icon: MessageSquarePlus },
  { href: '/contacts/new', label: 'New contact', description: 'Add a lead, client or someone from your sphere', icon: UserRoundPlus },
  { href: '/open-house', label: 'Open house sign-in', description: 'Turn this device into a guest sign-in kiosk', icon: DoorOpen },
  { href: '/contacts/import', label: 'Import contacts', description: 'Phone, spreadsheet, Mailchimp or another CRM', icon: Upload },
];

/**
 * Quick capture: a bottom sheet on phones and a centered panel on larger
 * screens. Focus moves into the sheet, stays trapped, and returns to the
 * trigger on close.
 */
export function CaptureSheet({
  open,
  onClose,
  options = CAPTURE_OPTIONS,
}: {
  open: boolean;
  onClose: () => void;
  options?: readonly CaptureOption[];
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="ox-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="ox-sheet" onKeyDown={onKeyDown}>
        <span className="ox-sheet-grabber" aria-hidden />
        <div className="ox-sheet-header">
          <div>
            <p className="ox-eyebrow">Quick capture</p>
            <h2 id={titleId} className="ox-sheet-title">What just happened?</h2>
          </div>
          <button type="button" className="sk-icon-button" onClick={onClose} aria-label="Close quick capture">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <ul className="ox-sheet-options">
          {options.map(({ href, label, description, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="ox-sheet-option" onClick={onClose}>
                <span className="ox-sheet-option-icon"><Icon className="size-5" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="ox-sheet-option-label">{label}</span>
                  <span className="ox-sheet-option-description">{description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
