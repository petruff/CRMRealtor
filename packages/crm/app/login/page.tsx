import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { BrandLockup, CyryxFooterLogo } from '@/components/brand-lockup';
import { GoogleSignIn } from '@/components/google-sign-in';
import { ThemeToggle } from '@/components/theme-toggle';
import { safeInternalPath } from '@/lib/routing/route-policy';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getCurrentUser } from '@/lib/supabase/server';
import styles from './login.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const destination = safeInternalPath(next);
  const configured = isSupabaseConfigured();

  if (configured) {
    const user = await getCurrentUser();
    if (user) redirect(destination);
  }

  return (
    <main id="main-content" className={styles.page}>
      <header className={styles.header}>
        <Link href="/welcome" aria-label="Back to Omnix welcome page">
          <BrandLockup compact />
        </Link>
        <ThemeToggle />
      </header>

      <div className={styles.shell}>
        <section className={styles.visualPanel} aria-labelledby="login-story-title">
          <Image
            src="/realtor-open-house-prep.webp"
            fill
            priority
            sizes="(max-width: 900px) 100vw, 52vw"
            alt="Illustrative scene of a realtor organizing property materials and keys before an open house."
            className={styles.visualImage}
          />
          <div className={styles.visualScrim} />
          <div className={styles.visualCopy}>
            <p>Omnix for realtors</p>
            <h1 id="login-story-title">Return to the details that keep every relationship moving.</h1>
            <Link href="/welcome">
              <ArrowLeft aria-hidden /> Back to the story
            </Link>
          </div>
        </section>

        <section className={styles.authPanel} aria-labelledby="sign-in-title">
          <div className={styles.authCard}>
            <p className={styles.eyebrow}>{configured ? 'Secure Google entry' : 'Local preview'}</p>
            <h2 id="sign-in-title">{configured ? 'Welcome back.' : 'Google sign-in needs its secure connection.'}</h2>
            <p className={styles.lead}>
              {configured
                ? 'Use the Google account you already use for Gmail. There is no Omnix password to remember.'
                : 'This local build has no Supabase project connected, so Omnix will not pretend to authenticate you. You can still explore the complete sample workspace.'}
            </p>

            <div className={styles.actionArea}>
              {configured ? (
                <GoogleSignIn next={destination} />
              ) : (
                <>
                  <button type="button" className="sk-primary-button w-full" disabled aria-describedby="auth-configuration-note">
                    Continue with Google
                  </button>
                  <p id="auth-configuration-note" className={styles.configurationNote}>
                    Provider configuration is absent in this environment. No password, token or Google permission is requested.
                  </p>
                  <Link href={destination} className={styles.demoAction}>
                    Explore the sample workspace <ArrowRight aria-hidden />
                  </Link>
                </>
              )}
            </div>

            {error && (
              <p role="alert" className={styles.errorText}>
                Google sign-in did not finish. No account change was made; you can try again.
              </p>
            )}

            <div className={styles.trustList}>
              <div><KeyRound aria-hidden /><span>Google keeps your password.</span></div>
              <div><ShieldCheck aria-hidden /><span>Sign-in requests identity only. Gmail and Calendar are separate permissions.</span></div>
            </div>
          </div>

          <CyryxFooterLogo className={styles.partnerLogo} />
        </section>
      </div>
    </main>
  );
}
