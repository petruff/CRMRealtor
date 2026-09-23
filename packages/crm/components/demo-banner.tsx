import { FlaskConical } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * Says out loud when the contacts on screen are invented.
 *
 * A demo that looks identical to real data is how someone starts trusting seeded
 * contacts — or worse, calls one. Renders nothing once the database is connected.
 */
export function DemoBanner() {
  if (isSupabaseConfigured()) return null;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-[1.25rem] border border-warm-border bg-warm-soft px-4 py-2.5 sm:mb-8 sm:py-3.5">
      <FlaskConical className="size-[18px] shrink-0 text-warm" />
      <p className="text-sm leading-snug text-warm">
        <span className="font-medium">Sample data.</span>{' '}
        <span className="sm:hidden">Made-up contacts — changes aren’t saved.</span>
        <span className="hidden sm:inline">These contacts are made up — the database is not connected yet. Nothing here is real, and nothing you change is saved.</span>
      </p>
    </div>
  );
}
