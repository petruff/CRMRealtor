export default function TodayLoading() {
  return (
    <div role="status" aria-live="polite">
      <p className="eyebrow">Today</p>
      <h1 className="mt-2 font-display text-[2.5rem] text-ink">Preparing your command center…</h1>
      <div className="mt-8 min-h-64 animate-pulse rounded-[var(--sk-card-radius)] border border-line bg-surface-2" aria-hidden />
    </div>
  );
}
