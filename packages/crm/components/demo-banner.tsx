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
    <div className="mb-8 flex items-start gap-3 rounded-[1.25rem] border border-warm-border bg-warm-soft px-4 py-3.5 sm:items-center">
      <FlaskConical className="mt-0.5 size-[18px] shrink-0 text-warm sm:mt-0" />
      <p className="text-sm leading-snug text-warm">
        <span className="font-medium">Sample data.</span> These contacts are made up — the
        database is not connected yet. Nothing here is real, and nothing you change is saved.
      </p>
    </div>
  );
}
