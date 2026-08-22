'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/routing/route-policy';

/**
 * One tap, no password, no confirmation email.
 *
 * Traces to her grievance about the old CRM: "I hated how many prompts I had to
 * go through just to sign in."
 *
 * Deliberately requests NO extra scopes. Google's default here is email + profile.
 * Gmail and Calendar scopes are added incrementally in phase 2 — asking for inbox
 * access on the sign-in screen, for features that do not exist yet, is how you
 * frighten someone out of a consent flow.
 */
export function GoogleSignIn({ next = '/' }: { next?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const origin = window.location.origin;
      const destination = safeInternalPath(next);

      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(destination)}`,
          scopes: 'openid email profile',
        },
      });

      if (authError) throw authError;
      // On success the browser navigates to Google; nothing further runs here.
    } catch (cause) {
      setPending(false);
      void cause;
      setError('Google sign-in could not start. Please try again.');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="sk-primary-button w-full disabled:opacity-60"
      >
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-hot">
          {error}
        </p>
      )}
    </div>
  );
}
