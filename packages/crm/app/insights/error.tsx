'use client';

import Link from 'next/link';
import { RotateCcw, ShieldCheck } from 'lucide-react';

export default function InsightsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section role="alert" className="insights-error">
      <span className="insights-error-icon"><ShieldCheck className="size-6" aria-hidden /></span>
      <div>
        <p className="eyebrow">Protected read</p>
        <h1>Insights could not be refreshed.</h1>
        <p>No CRM data was changed. Try the authorized read again, or continue working from Today.</p>
        <div className="insights-error-actions">
          <button type="button" onClick={reset} className="sk-primary-button"><RotateCcw className="size-4" aria-hidden /> Try again</button>
          <Link href="/" className="sk-secondary-button">Open Today</Link>
        </div>
      </div>
    </section>
  );
}
