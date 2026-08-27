import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLockup } from '@/components/brand-lockup';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main className="pwa-offline-page">
      <section className="pwa-offline-card">
        <BrandLockup />
        <div className="pwa-offline-card__signal" aria-hidden><span /><span /><span /></div>
        <p className="eyebrow">Connection paused</p>
        <h1>Your client records remain private.</h1>
        <p>Omnix does not store CRM pages or client data in the offline cache. Reconnect to continue with the latest information.</p>
        <Link href="/" className="sk-primary-button">Try again</Link>
        <small>Open Omnix again when your connection returns.</small>
      </section>
    </main>
  );
}
