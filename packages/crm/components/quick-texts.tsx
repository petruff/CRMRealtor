'use client';

import { useEffect, useId, useState } from 'react';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { QUICK_TEXT_KINDS, quickText, quickTextHref, type QuickTextLanguage } from '@/lib/domain/quick-texts';

export const QUICK_TEXT_LANGUAGE_KEY = 'omnix-quick-text-language';

/**
 * "Text" with ready-made messages. Each option opens the phone's own Messages
 * app pre-filled so the realtor can adjust and send it herself.
 */
export function QuickTexts({ phone, firstName, agentName, initiallyOpen = false }: { phone: string; firstName?: string; agentName?: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [language, setLanguage] = useState<QuickTextLanguage>('en');
  const panelId = useId();

  useEffect(() => {
    try { if (window.localStorage.getItem(QUICK_TEXT_LANGUAGE_KEY) === 'es') setLanguage('es'); } catch { /* storage unavailable */ }
  }, []);

  const choose = (value: QuickTextLanguage) => {
    setLanguage(value);
    try { window.localStorage.setItem(QUICK_TEXT_LANGUAGE_KEY, value); } catch { /* storage unavailable */ }
  };

  const blank = quickTextHref(phone);
  if (!blank) return null;

  return (
    <>
      <button type="button" className="sk-text-action" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <MessageSquare className="size-4" aria-hidden /> Text
      </button>
      {open ? (
        <section id={panelId} className="ox-quick-texts" aria-label="Quick texts">
          <header className="ox-quick-texts-header">
            <p className="ox-quick-texts-title">Quick texts</p>
            <div className="ox-segment" role="group" aria-label="Message language">
              {(['en', 'es'] as const).map((value) => (
                <button key={value} type="button" aria-pressed={language === value} onClick={() => choose(value)}>{value.toUpperCase()}</button>
              ))}
            </div>
          </header>
          <ul className="ox-quick-texts-list">
            {QUICK_TEXT_KINDS.map((item) => {
              const body = quickText(item.kind, language, { firstName, agentName });
              return (
                <li key={item.kind}>
                  <a className="ox-quick-text" href={quickTextHref(phone, body)} onClick={() => setOpen(false)}>
                    <span className="min-w-0 flex-1">
                      <span className="ox-quick-text-label">{item.label}</span>
                      <span className="ox-quick-text-body">{body}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0" aria-hidden />
                  </a>
                </li>
              );
            })}
            <li>
              <a className="ox-quick-text is-blank" href={blank} onClick={() => setOpen(false)}>
                <span className="ox-quick-text-label">Blank message</span>
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </a>
            </li>
          </ul>
          <p className="ox-quick-texts-note">Opens your Messages app — you can edit before sending.</p>
        </section>
      ) : null}
    </>
  );
}
