import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ContactForm } from '@/components/contact-form';
import { updateContactAction } from '@/app/contact-actions';
import { getRepository } from '@/lib/data';
import { displayName } from '@/lib/domain/contact';

export const dynamic = 'force-dynamic';

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repository } = await getRepository();
  const [contact, contacts] = await Promise.all([repository.get(id), repository.list()]);
  if (!contact) notFound();

  const referralOptions = contacts
    .filter((entry) => entry.id !== id)
    .map((entry) => ({ id: entry.id, name: displayName(entry) }));
  const action = updateContactAction.bind(null, id);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/contacts/${id}`} className="sk-text-action mb-5">
        <ArrowLeft className="size-4" /> Back to {displayName(contact)}
      </Link>
      <header className="mb-8 md:mb-10">
        <p className="eyebrow">Edit contact</p>
        <h1 className="mt-2 font-display text-[2.5rem] leading-[1.04] text-ink sm:text-5xl">
          Keep the record useful.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
          Update what changed. Identity and activity history stay intact.
        </p>
      </header>
      <ContactForm
        action={action}
        contact={contact}
        referralOptions={referralOptions}
        cancelHref={`/contacts/${id}`}
        submitLabel="Save changes"
      />
    </div>
  );
}
