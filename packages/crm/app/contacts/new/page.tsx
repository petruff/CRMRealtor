import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ContactForm } from '@/components/contact-form';
import { createContactAction } from '@/app/contact-actions';
import { getRepository } from '@/lib/data';
import { displayName } from '@/lib/domain/contact';

export const dynamic = 'force-dynamic';

export default async function NewContactPage() {
  const { repository } = await getRepository();
  const contacts = await repository.list();
  const referralOptions = contacts.map((contact) => ({
    id: contact.id,
    name: displayName(contact),
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/contacts" className="sk-text-action mb-5">
        <ArrowLeft className="size-4" /> Back to contacts
      </Link>
      <header className="mb-8 md:mb-10">
        <p className="eyebrow">New contact</p>
        <h1 className="mt-2 font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl">
          Add someone worth remembering.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
          Start with the essentials. The CRM will schedule the first follow-up automatically.
        </p>
      </header>
      <ContactForm
        action={createContactAction}
        referralOptions={referralOptions}
        cancelHref="/contacts"
        submitLabel="Create contact"
      />
    </div>
  );
}
