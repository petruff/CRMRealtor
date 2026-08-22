"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ContactsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[contacts-page]", error);
  }, [error]);

  return (
    <div className="sk-group bg-surface px-6 py-14 text-center" role="alert">
      <AlertTriangle className="mx-auto size-7 text-hot" aria-hidden />
      <h1 className="mt-4 font-display text-2xl text-ink">
        Contacts could not load.
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        Your filters and saved lists were not changed. Retry the data connection
        or return to Today.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" className="sk-primary-button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden /> Retry
        </button>
        <Link href="/" className="sk-text-action">
          Return to Today
        </Link>
      </div>
    </div>
  );
}
