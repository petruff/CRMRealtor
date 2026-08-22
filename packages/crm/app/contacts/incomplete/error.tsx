"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function IncompleteContactsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[incomplete-contacts-page]", error);
  }, [error]);

  return (
    <div className="sk-group bg-surface px-6 py-14 text-center" role="alert">
      <AlertTriangle className="mx-auto size-7 text-hot" aria-hidden />
      <h1 className="mt-4 font-display text-2xl text-ink">
        The review inbox could not load.
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        No record was converted or archived. Retry, or return to the contact
        list.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" className="sk-primary-button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden /> Retry
        </button>
        <Link href="/contacts" className="sk-text-action">
          Return to Contacts
        </Link>
      </div>
    </div>
  );
}
