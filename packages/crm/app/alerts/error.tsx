"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BellRing, ContactRound, House, RotateCcw } from "lucide-react";

export default function AlertsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[alerts-page]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-[var(--sk-card-radius)] border border-hot-border bg-surface shadow-sm" role="alert">
      <div className="grid gap-5 bg-hot-soft px-6 py-8 sm:grid-cols-[auto_1fr] sm:px-8">
        <span className="grid size-12 place-items-center rounded-full bg-surface text-hot shadow-sm">
          <BellRing className="size-6" aria-hidden />
        </span>
        <div>
          <p className="eyebrow text-hot">Alert read unavailable</p>
          <h1 className="mt-2 font-display text-3xl text-ink">No alert facts were guessed.</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Omnix could not complete the authorized read, so counts and record details stay hidden. Nothing was changed. Retry or continue from a safe workspace view.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 px-6 py-5 sm:px-8">
        <button type="button" className="sk-primary-button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden /> Retry
        </button>
        <Link href="/" className="sk-secondary-button">
          <House className="size-4" aria-hidden /> Return to Today
        </Link>
        <Link href="/contacts" className="sk-secondary-button">
          <ContactRound className="size-4" aria-hidden /> Open contacts
        </Link>
      </div>
    </div>
  );
}
