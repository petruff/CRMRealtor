'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { MessageCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  askOmnixCopilotAction,
  confirmOmnixActionAction,
  getOmnixAssistantProfileAction,
  recordOmnixFeedbackAction,
  type OmnixAssistantProfile,
} from '@/app/omnix/actions';
import type { OmnixConfirmAction } from '@/components/omnix-action-preview';
import { OmnixCopilot } from '@/components/omnix-copilot';
import type { OmnixCopilotAction } from '@/components/omnix-copilot-view-model';

interface OmnixAssistantLauncherProps {
  readonly action?: OmnixCopilotAction;
  readonly confirm?: OmnixConfirmAction;
  readonly loadProfile?: (contactId?: string) => Promise<OmnixAssistantProfile>;
  readonly suppressed?: boolean;
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function OmnixAssistantLauncher({
  action = askOmnixCopilotAction,
  confirm = confirmOmnixActionAction,
  loadProfile = getOmnixAssistantProfileAction,
  suppressed = false,
}: OmnixAssistantLauncherProps) {
  const pathname = usePathname();
  const contactId = /^\/contacts\/([^/]+)$/u.exec(pathname)?.[1];
  const onContact = contactId && !['new', 'import', 'incomplete'].includes(contactId) ? decodeURIComponent(contactId) : undefined;
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<OmnixAssistantProfile | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestedFor = useRef<string | null>(null);

  const close = () => {
    setOpen(false);
    queueMicrotask(() => launcherRef.current?.focus());
  };

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let active = true;
    const key = onContact ?? '';
    if (!profile || requestedFor.current !== key) {
      requestedFor.current = key;
      void loadProfile(onContact).then((result) => {
        if (active) setProfile(result);
      });
    }
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>('#omnix-assistant-question')?.focus();
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [loadProfile, onContact, open, profile]);

  if (pathname.startsWith('/omnix') || suppressed) return null;

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="omnix-assistant-launcher"
        aria-label="Open Omnix assistant"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="omnix-assistant-pulse" aria-hidden />
        <Image
          src="/omnix-assistant-blue.png"
          alt=""
          width={84}
          height={84}
          priority
          className="omnix-assistant-avatar"
        />
        <span className="omnix-assistant-label">
          <MessageCircle className="size-4" aria-hidden /> Ask Omnix
        </span>
      </button>

      {open ? (
        <div className="omnix-assistant-layer">
          <button type="button" className="omnix-assistant-backdrop" aria-label="Close Omnix assistant" onClick={close} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="omnix-assistant-dialog-title"
            className="omnix-assistant-dialog"
            onKeyDown={onDialogKeyDown}
          >
            <div className="flex min-h-14 items-center justify-between gap-4 border-b border-line bg-surface px-4">
              <div className="flex min-w-0 items-center gap-3">
                <Image src="/omnix-assistant-blue.png" alt="" width={42} height={42} className="size-10 object-contain" />
                <div className="min-w-0">
                  <h2 id="omnix-assistant-dialog-title" className="font-display text-lg leading-tight text-ink">Omnix AI</h2>
                  <p className="truncate text-xs text-muted">CRM + public research · Nothing changes without you</p>
                </div>
              </div>
              <button type="button" className="sk-icon-button" onClick={close} aria-label="Close Omnix assistant">
                <X className="size-[18px]" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <OmnixCopilot
                action={action}
                confirm={confirm}
                feedback={recordOmnixFeedbackAction}
                mode="assistant"
                greetingName={profile?.firstName}
                {...(onContact && profile?.contact?.id === onContact ? { contextContact: profile.contact } : {})}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
