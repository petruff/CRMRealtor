'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MonitorSmartphone } from 'lucide-react';
import { KIOSK_PIN_KEY } from '@/components/open-house-kiosk';

export function OpenHouseSetup({ suggestions }: { suggestions: readonly string[] }) {
  const router = useRouter();
  const [property, setProperty] = useState(suggestions[0] ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const propertyId = useId();
  const pinId = useId();
  const listId = useId();

  const start = (event: React.FormEvent) => {
    event.preventDefault();
    const address = property.trim().replace(/\s+/g, ' ');
    if (address.length < 3 || address.length > 160) { setError('Enter the property address (3–160 characters).'); return; }
    if (pin && !/^\d{4,8}$/u.test(pin)) { setError('Use a 4–8 digit PIN, or leave it empty.'); return; }
    try { if (pin) sessionStorage.setItem(KIOSK_PIN_KEY, pin); else sessionStorage.removeItem(KIOSK_PIN_KEY); } catch { /* storage unavailable */ }
    router.push(`/open-house/kiosk?${new URLSearchParams({ property: address })}`);
  };

  return (
    <form onSubmit={start} className="ox-card ox-settings-card">
      <div className="ox-settings-card-body">
        <span className="ox-icon-chip ox-tone-reply"><MonitorSmartphone className="size-4" aria-hidden /></span>
        <div className="grid min-w-0 flex-1 gap-4">
          <div>
            <h2 className="ox-card-title">Start the sign-in kiosk</h2>
            <p className="mt-1 text-sm text-muted">Hand this device to guests. Each sign-in becomes a lead at the top of Today with their answers and consent saved as a note.</p>
          </div>
          <div className="sk-field">
            <label htmlFor={propertyId} className="sk-label">Property address</label>
            <input id={propertyId} list={listId} value={property} onChange={(event) => { setProperty(event.target.value); setError(undefined); }} className="sk-input" placeholder="1408 Bayshore Dr, Tampa, FL" autoComplete="off" required />
            <datalist id={listId}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
          </div>
          <div className="sk-field max-w-xs">
            <label htmlFor={pinId} className="sk-label">Staff PIN to exit <span className="font-normal text-subtle">(recommended)</span></label>
            <input id={pinId} value={pin} onChange={(event) => { setPin(event.target.value); setError(undefined); }} className="sk-input" inputMode="numeric" type="password" autoComplete="off" placeholder="4–8 digits" />
            <span className="sk-help">Kept only on this device for this session. On iPad, also turn on Guided Access.</span>
          </div>
          {error ? <p role="alert" className="text-sm text-hot">{error}</p> : null}
          <div><button type="submit" className="sk-primary-button"><MonitorSmartphone className="size-4" aria-hidden /> Start kiosk</button></div>
        </div>
      </div>
    </form>
  );
}
