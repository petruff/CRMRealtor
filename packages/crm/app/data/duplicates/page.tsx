import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, Fingerprint, ShieldCheck } from 'lucide-react';
import { loadContactDuplicateAudit } from '@/lib/application/contact-duplicate-audit';
import { getRepository } from '@/lib/data';
import { displayName } from '@/lib/domain/contact';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Duplicate contact audit' };

export default async function ContactDuplicateAuditPage() {
  const context = await getRepository();
  const { audit, contacts } = await loadContactDuplicateAudit(context);
  const names = new Map(contacts.map((contact) => [contact.id, displayName(contact)]));

  return (
    <div className="space-y-8">
      <header>
        <Link href="/data" className="sk-secondary-button"><ArrowLeft className="size-4" aria-hidden /> Data tools</Link>
        <p className="mt-8 text-sm font-medium text-accent">Contact hygiene</p>
        <h1 className="mt-2 max-w-4xl font-display text-4xl text-ink sm:text-5xl">Review duplicate contacts</h1>
        <p className="mt-3 max-w-3xl text-muted">Omnix checks exact email and phone matches. Similar names, locations, and relationships never trigger an automatic merge.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Audit summary">
        {[
          ['Active contacts', audit.activeContacts],
          ['Emails and phones checked', audit.canonicalPoints],
          ['Exact duplicate groups', audit.duplicateGroups.length],
          ['Candidate contacts', audit.candidateContacts],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-2 font-display text-4xl text-ink">{value}</p>
          </article>
        ))}
      </section>

      {audit.partial ? (
        <div role="alert" className="rounded-2xl border border-warm-border bg-warm-soft p-5 text-sm text-warm">This account has more than 500 contacts. Omnix checked the first 500 and will not merge anything from a partial review.</div>
      ) : null}

      {audit.duplicateGroups.length ? (
        <section aria-labelledby="candidates-title">
          <div className="flex items-center gap-3">
            <CircleAlert className="size-5 text-warm" aria-hidden />
            <div>
              <h2 id="candidates-title" className="font-display text-2xl text-ink">Review required</h2>
              <p className="text-sm text-muted">Nothing has been merged or archived. Review each group before choosing what to keep.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {audit.duplicateGroups.map((group) => (
              <article key={group.id} className="rounded-2xl border border-warm-border bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><Fingerprint className="size-4 text-warm" aria-hidden /> Exact {group.kind}</span>
                  <span className="rounded-full bg-warm-soft px-2.5 py-1 text-xs font-semibold text-warm">{group.contactIds.length} contacts</span>
                </div>
                <ul className="mt-4 grid gap-2">
                  {group.contactIds.map((contactId) => (
                    <li key={contactId} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
                      <span className="truncate text-sm font-medium text-ink">{names.get(contactId) ?? 'Authorized contact'}</span>
                      <Link href={`/contacts/${encodeURIComponent(contactId)}`} className="sk-secondary-button shrink-0 text-xs">Review</Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-nurture-border bg-nurture-soft p-6" aria-labelledby="clean-title">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-6 shrink-0 text-nurture" aria-hidden />
            <div>
              <h2 id="clean-title" className="font-display text-2xl text-ink">No exact duplicates found</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">No active contacts share the same email or phone number.</p>
            </div>
          </div>
        </section>
      )}

      <p className="text-xs text-subtle">Checked {new Date(audit.asOf).toLocaleString('en-US')} · {audit.archivedContacts} archived contacts excluded · no records changed</p>
    </div>
  );
}
