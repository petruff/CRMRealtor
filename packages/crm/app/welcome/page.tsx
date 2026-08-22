import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BrainCircuit,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock3,
  KeyRound,
  MailCheck,
  ShieldCheck,
  Sparkles,
  Upload,
  UsersRound,
} from 'lucide-react';
import { BrandLockup, BrandMark, CyryxFooterLogo } from '@/components/brand-lockup';
import { GoogleSignIn } from '@/components/google-sign-in';
import { ThemeToggle } from '@/components/theme-toggle';
import { WelcomeMotion } from '@/components/welcome-motion';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/brand';
import { safeInternalPath } from '@/lib/routing/route-policy';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getCurrentUser } from '@/lib/supabase/server';
import styles from './welcome.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Omnix — Relationship intelligence for realtors' },
  description: PRODUCT_DESCRIPTION,
  alternates: { canonical: '/welcome' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    title: 'Omnix — Relationship intelligence for realtors',
    description: PRODUCT_DESCRIPTION,
    url: '/welcome',
    siteName: PRODUCT_NAME,
  },
};

const CAPABILITIES = [
  {
    title: 'Know what needs attention',
    detail: 'A daily view of overdue follow-ups, first conversations, tasks and relationship moments grounded in stored CRM facts.',
    icon: CalendarCheck2,
  },
  {
    title: 'Keep the full relationship',
    detail: 'Contacts, notes, next touches, real-estate intent, dates and activity stay connected to one coherent record.',
    icon: UsersRound,
  },
  {
    title: 'Ask Omnix what comes next',
    detail: 'The assistant can summarize the workspace, surface deadlines and point back to the records behind every answer.',
    icon: BrainCircuit,
  },
  {
    title: 'Bring existing contacts with you',
    detail: 'Preview CSV and vCard imports, merge conservatively and keep incomplete rows available for review.',
    icon: Upload,
  },
  {
    title: 'Remember the physical details',
    detail: 'Mailing readiness and physical-mail history stay visible without pretending an unconfigured provider is connected.',
    icon: MailCheck,
  },
  {
    title: 'Work from dates, not memory',
    detail: 'Tasks, due dates and next-touch commitments become an organized queue instead of another mental checklist.',
    icon: Clock3,
  },
] as const;

const TRUST_POINTS = [
  ['Identity first', 'Google sign-in asks for basic identity only.'],
  ['Permission stays explicit', 'Gmail and Calendar access require separate consent.'],
  ['The record stays visible', 'Recommendations point back to the CRM facts behind them.'],
] as const;

const PRODUCT_RHYTHM = [
  {
    label: 'Start informed',
    title: 'See what deserves attention before the day starts.',
    detail: 'Overdue follow-ups, first conversations, open tasks and important dates arrive in one prioritized view grounded in stored CRM facts.',
    icon: CalendarCheck2,
  },
  {
    label: 'Work in context',
    title: 'Carry the relationship into every conversation.',
    detail: 'Contact details, households, notes, intent, relationship history and the next promised touch stay connected instead of scattered across tools.',
    icon: UsersRound,
  },
  {
    label: 'Close the loop',
    title: 'Turn decisions into visible next steps.',
    detail: 'Tasks, activities, imports and incomplete records remain reviewable, so the next action is organized without hiding the evidence behind it.',
    icon: CheckCircle2,
  },
] as const;

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const destination = safeInternalPath(next);
  const configured = isSupabaseConfigured();
  const user = configured ? await getCurrentUser() : null;

  return (
    <WelcomeMotion className={styles.landing}>
      <a href="#welcome-main" className={styles.skipLink}>
        Skip to main content
      </a>

      <header className={styles.topNav}>
        <div className={styles.navInner}>
          <Link href="/welcome" aria-label="Omnix home" className={styles.brandLink}>
            <BrandLockup compact />
          </Link>
          <nav aria-label="Public" className={styles.navLinks}>
            <a href="#realtor-life">For realtors</a>
            <a href="#product">Product</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#trust">Trust</a>
          </nav>
          <div className={styles.navActions}>
            <ThemeToggle />
            <Link href={`/login?next=${encodeURIComponent(destination)}`} className={styles.navSignIn}>
              Sign in <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main id="welcome-main" tabIndex={-1}>
        <section className={styles.imageHero} aria-label="Judith Serna Realtor">
          <figure className={styles.heroMedia} data-hero-media>
            <div className={styles.heroImageFrame}>
              <Image
                src="/judith-serna-realtor-hero.webp"
                width={1376}
                height={768}
                quality={92}
                priority
                sizes="100vw"
                alt="Judith Serna, Realtor, standing in a warm contemporary kitchen beside her house-and-heart brand mark."
                className={styles.heroImage}
              />
            </div>
            <figcaption className="sr-only">Realtor brand image supplied for this experience.</figcaption>
          </figure>
        </section>

        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroIntro}>
            <div className={styles.heroCopy} data-hero-copy>
              <p className={styles.eyebrow}>A relationship-first CRM for realtors</p>
              <h1 id="hero-title" className={styles.heroTitle}>
                The details stay together.
                <span>You stay ahead.</span>
              </h1>
              <p className={styles.heroLead}>
                Omnix turns client history, follow-ups, dates and daily priorities into one calm operating view—so the relationship never gets lost in the administration.
              </p>
              <div className={styles.proofRow} aria-label="Current product principles">
                <span><Check aria-hidden /> Explainable</span>
                <span><Check aria-hidden /> Realtor-led</span>
                <span><Check aria-hidden /> Built around real records</span>
              </div>
            </div>

            <aside className={styles.signInCard} aria-labelledby="hero-sign-in-title" data-depth-card>
              <p className={styles.cardLabel}>{configured ? 'Secure entry' : 'Preview environment'}</p>
              <h2 id="hero-sign-in-title">Start with the account you already know.</h2>
              <p>Use the Google account you already use for Gmail. Omnix asks only for your identity at sign-in.</p>

              <div className={styles.signInAction}>
                {user ? (
                  <div>
                    <Link href={destination} className="sk-primary-button w-full">
                      Open your workspace <ArrowRight className="size-4" aria-hidden />
                    </Link>
                    <p className={styles.inlineStatus}>
                      <CheckCircle2 aria-hidden /> Google identity verified
                    </p>
                  </div>
                ) : configured ? (
                  <GoogleSignIn next={destination} />
                ) : (
                  <div className={styles.unavailableGroup}>
                    <button type="button" className="sk-primary-button w-full" disabled aria-describedby="google-unavailable">
                      Continue with Google
                    </button>
                    <p id="google-unavailable">
                      Google sign-in becomes active when the secure cloud project is connected. It is not simulated in this local preview.
                    </p>
                    <Link href={destination} className={styles.secondaryAction}>
                      Explore the sample workspace <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </div>
                )}
              </div>

              <div className={styles.identityNote}>
                <KeyRound aria-hidden />
                <span>No Google password is collected. Gmail and Calendar permissions are separate.</span>
              </div>
              {error && (
                <p role="alert" className={styles.errorText}>
                  Google sign-in did not finish. No account change was made; you can try again when ready.
                </p>
              )}
            </aside>
          </div>
        </section>

        <section id="realtor-life" className={styles.lifeSection} aria-labelledby="life-title">
          <div className={styles.sectionShell}>
            <div className={styles.sectionHeader} data-reveal>
              <p className={styles.eyebrow}>The work beyond the dashboard</p>
              <h2 id="life-title">Real estate moves through rooms, conversations and promises.</h2>
              <p>
                The CRM should support that human work without becoming the work. Omnix keeps the context ready before a showing, after a call and when the next date matters.
              </p>
            </div>

            <div className={styles.lifeGrid}>
              <figure className={styles.landscapeScene} data-depth-card>
                <div className={styles.sceneImageFrame} data-parallax-image>
                  <Image
                    src="/realtor-client-walkthrough.webp"
                    width={1448}
                    height={1086}
                    quality={90}
                    sizes="(max-width: 900px) 94vw, 62vw"
                    alt="Illustrative scene of a realtor guiding two clients through a warm contemporary home."
                    className={styles.sceneImage}
                  />
                </div>
                <figcaption>Illustrative scene · client walkthrough</figcaption>
              </figure>

              <div className={styles.lifeAside}>
                <figure className={styles.portraitScene} data-depth-card>
                  <div className={styles.sceneImageFrame} data-parallax-image>
                    <Image
                      src="/realtor-open-house-prep.webp"
                      width={1086}
                      height={1448}
                      quality={90}
                      sizes="(max-width: 900px) 94vw, 34vw"
                      alt="Illustrative scene of a realtor organizing property materials and keys before an open house."
                      className={styles.sceneImage}
                    />
                  </div>
                  <figcaption>Illustrative scene · open-house preparation</figcaption>
                </figure>

                <div className={styles.editorialNote} data-reveal>
                  <span>01</span>
                  <h3>Context before contact.</h3>
                  <p>Walk into the next conversation knowing the history, the last promise and the date that cannot slip.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className={styles.darkSection} aria-labelledby="product-title">
          <div className={styles.sectionShell}>
            <div className={styles.darkIntro} data-reveal>
              <div>
                <p className={styles.eyebrow}>The product, not a promise</p>
                <h2 id="product-title">A clear view of what deserves attention now.</h2>
              </div>
              <p>
                The current Omnix runtime uses clearly labeled sample data. It organizes real CRM facts and makes the evidence behind its guidance visible.
              </p>
            </div>

            <div className={styles.productStory} data-product-frame aria-label="How Omnix supports a realtor's day">
              {PRODUCT_RHYTHM.map(({ label, title, detail, icon: Icon }, index) => (
                <article key={label}>
                  <div className={styles.productStoryTopline}>
                    <span>0{index + 1}</span>
                    <Icon aria-hidden />
                  </div>
                  <p className={styles.productStoryLabel}>{label}</p>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>

            <div id="trust" className={styles.trustGrid} aria-label="Omnix trust principles">
              {TRUST_POINTS.map(([title, detail], index) => (
                <article key={title} data-reveal>
                  <span>0{index + 1}</span>
                  <ShieldCheck aria-hidden />
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="capabilities" className={styles.capabilitiesSection} aria-labelledby="capabilities-title">
          <div className={styles.sectionShell}>
            <div className={styles.sectionHeader} data-reveal>
              <p className={styles.eyebrow}>One relationship system</p>
              <h2 id="capabilities-title">Organized enough to feel lighter. Specific enough to be useful.</h2>
              <p>Each part of Omnix answers a concrete question in the realtor’s day, using the same underlying workspace.</p>
            </div>

            <div className={styles.capabilityGrid}>
              {CAPABILITIES.map(({ title, detail, icon: Icon }, index) => (
                <article key={title} className={index === 2 ? styles.capabilityAccent : undefined} data-depth-card>
                  <div className={styles.capabilityIcon}><Icon aria-hidden /></div>
                  <p className={styles.capabilityNumber}>0{index + 1}</p>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.ctaSection} aria-labelledby="ready-title">
          <div className={styles.ctaBand} data-depth-card>
            <div>
              <Sparkles aria-hidden />
              <p className={styles.cardLabel}>Ready when the relationship is</p>
              <h2 id="ready-title">Less CRM administration. More continuity.</h2>
            </div>
            <div className={styles.ctaAction}>
              {configured && !user ? (
                <GoogleSignIn next={destination} />
              ) : (
                <Link href={user ? destination : '/omnix'} className={styles.ctaButton}>
                  {user ? 'Open your workspace' : 'See Omnix intelligence'} <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
              <p>{configured ? 'Google identity only at sign-in.' : 'Sample mode is active in this local preview.'}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <BrandMark size={36} />
            <div>
              <p>{PRODUCT_NAME}</p>
              <p>Relationship intelligence</p>
            </div>
          </div>
          <p className={styles.footerStatement}>Relationship intelligence for the work behind every move.</p>
          <div className={styles.footerLinks}>
            <Link href="/connections">Connection status</Link>
            <Link href="/login">Sign in</Link>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <CyryxFooterLogo className={styles.cyryxFooterLogo} />
          <p>Current local experience · provider availability is shown honestly</p>
        </div>
      </footer>
    </WelcomeMotion>
  );
}
