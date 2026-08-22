'use client';

import Link from 'next/link';

export default function TodayError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section role="alert" className="sk-group bg-surface p-6">
      <h1 className="font-display text-3xl text-ink">Today could not load</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">Nothing was changed. Retry the authorized read or continue to a safe workspace destination.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="sk-primary-button">Retry</button>
        <Link href="/activities" className="sk-secondary-button">Open activities</Link>
        <Link href="/contacts" className="sk-secondary-button">Open contacts</Link>
      </div>
    </section>
  );
}
