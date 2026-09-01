import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { ContactForm } from '@/components/contact-form';
import { ContactRecordNavigator } from '@/components/contact-record-navigation';
import { updateContactAction } from '@/app/contact-actions';
import { getRepository } from '@/lib/data';
import { displayName } from '@/lib/domain/contact';
import {
  contactBrowseSequence,
  contactRecordHref,
  contactRecordNavigation,
  parseContactBrowseContext,
} from '@/lib/application/contact-navigation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Edit contact',
  description: 'Update a contact relationship, follow-up priority, details, and important dates in Omnix.',
};

export default async function EditContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    view?: string;
    scope?: string;
    q?: string;
    leadType?: string;
    source?: string;
    smartList?: string;
    page?: string;
  }>;
}) {
  const { id } = await params;
  const browseParams = await searchParams;
  const { repository, smartListRepository, workspaceScope } = await getRepository();
  const [contact, contacts] = await Promise.all([repository.get(id), repository.list()]);
  if (!contact) notFound();

  const browseContext = parseContactBrowseContext(browseParams, contact);
  const smartList = browseContext.smartList
    ? await smartListRepository.get(workspaceScope, browseContext.smartList)
    : undefined;
  const browseSequence = contactBrowseSequence(
    contacts,
    browseContext,
    smartList?.status === 'active' ? smartList.definition : undefined,
  );
  const navigation = contactRecordNavigation(browseSequence, contact, browseContext);
  const reviewNext = navigation.next
    ?? (browseContext.scope === 'needs-review'
      ? browseSequence.find((entry) => entry.id !== contact.id)
      : undefined);

  const referralOptions = contacts
    .filter((entry) => entry.id !== id)
    .map((entry) => ({ id: entry.id, name: displayName(entry) }));
  const action = updateContactAction.bind(null, id, {
    context: browseContext,
    ...(reviewNext ? { nextContactId: reviewNext.id } : {}),
  });
  const detailHref = contactRecordHref(id, browseContext);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={detailHref} className="sk-text-action self-start">
          <ArrowLeft className="size-4" /> Back to {displayName(contact)}
        </Link>
        <ContactRecordNavigator navigation={navigation} />
      </div>
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
        cancelHref={detailHref}
        submitLabel="Save changes"
        nextContactName={reviewNext ? displayName(reviewNext) : undefined}
      />
    </div>
  );
}
