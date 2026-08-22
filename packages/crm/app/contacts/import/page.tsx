import Link from 'next/link';
import type { Metadata } from 'next';
import { ChevronLeft } from 'lucide-react';
import { ContactImportWorkspace } from '@/components/contact-import-workspace';

export const metadata: Metadata = { title: 'Import contacts' };
// A governed 144-row import performs bounded parsing plus idempotent, atomic
// persistence groups. Fifteen seconds proved too short in production and
// terminated otherwise valid commits after most rows had been saved.
export const maxDuration = 60;

export default function ImportContactsPage() {
  return (
    <div>
      <Link href="/contacts" className="sk-text-action"><ChevronLeft className="size-4" /> Contacts</Link>
      <header className="mb-8 mt-5 md:mb-10">
        <p className="eyebrow">Contact import</p>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl md:text-[3.5rem]">
          Bring your relationships with you.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
          Move people from another CRM, Mailchimp, Google, Apple, or a spreadsheet. Preview first; save only after every match makes sense.
        </p>
      </header>
      <ContactImportWorkspace />
    </div>
  );
}
