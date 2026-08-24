import type { Metadata } from 'next';
import { AlertCenter } from '@/components/alert-center';
import { loadOmnixAlerts } from '@/lib/application/omnix-alert-loader';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Alerts' };

export default async function AlertsPage() {
  const result = await loadOmnixAlerts();
  return (
    <div>
      <header className="mb-7 sm:mb-9 md:mb-12">
        <p className="eyebrow">Daily relationship work</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.15rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          What needs attention,<br className="hidden sm:block" /> <span className="text-muted">with the evidence attached.</span>
        </h1>
        <p className="mt-3 hidden max-w-2xl text-[15px] leading-relaxed text-muted sm:mt-4 sm:block sm:text-[17px]">
          One prioritized queue for follow-ups, tasks, relationship moments, and data readiness. Omnix keeps its position until you act or the source record is resolved.
        </p>
      </header>
      <AlertCenter {...result} />
    </div>
  );
}
