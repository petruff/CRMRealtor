import { BarChart3, LoaderCircle } from 'lucide-react';

export default function InsightsLoading() {
  return (
    <section className="insights-loading" role="status" aria-live="polite">
      <span className="insights-loading-icon"><BarChart3 className="size-5" aria-hidden /></span>
      <LoaderCircle className="size-5 animate-spin text-accent" aria-hidden />
      <div>
        <h1>Building your business view…</h1>
        <p>Reading stored relationships, follow-ups, tasks, and pipeline evidence.</p>
      </div>
    </section>
  );
}
