export default function AlertsLoading() {
  return (
    <div role="status" aria-live="polite">
      <p className="eyebrow">Daily relationship work</p>
      <h1 className="mt-2 font-display text-[2.5rem] text-ink">Loading today’s alerts…</h1>
      <div className="mt-9 min-h-64 animate-pulse rounded-[var(--sk-card-radius)] border border-line bg-surface-2" aria-hidden />
    </div>
  );
}
