import { LoaderCircle } from "lucide-react";

export default function ActivitiesLoading() {
  return (
    <div className="sk-group bg-surface px-6 py-14 text-center" role="status">
      <LoaderCircle
        className="mx-auto size-6 animate-spin text-accent"
        aria-hidden
      />
      <p className="mt-3 text-sm text-muted">Loading the work queue…</p>
    </div>
  );
}
