import { MapPin, Phone } from 'lucide-react';
import { contactAddressLines, type Contact } from '@/lib/domain/contact';

/**
 * Phone and postal address side by side, in the header's right-hand column on
 * desktop and stacked under the name on small screens. Reuses the contact's
 * canonical fields; a property being sold is shown separately under "Selling".
 */
export function ContactReachSummary({
  contact,
  callable,
  callContact,
}: {
  contact: Pick<Contact, 'phone' | 'mailingAddress' | 'city' | 'state' | 'postalCode'>;
  /** False for read-only (archived) records, where the phone is shown as text. */
  callable: boolean;
  /** Lets Omnix offer to log the call after the realtor comes back. */
  callContact?: { id: string; name: string };
}) {
  const phone = contact.phone?.trim();
  const address = contactAddressLines(contact);
  return (
    <dl
      aria-label="Phone and address"
      className="grid w-full min-w-0 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:w-[22rem] lg:shrink-0 lg:grid-cols-1"
    >
      <div className="min-w-0 bg-surface px-4 py-3">
        <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Phone className="size-3.5" aria-hidden /> Phone
        </dt>
        <dd className="mt-1 break-words text-[15px] text-ink">
          {phone ? (
            callable ? <a href={`tel:${phone}`} {...(callContact ? { 'data-call-contact': callContact.id, 'data-call-name': callContact.name } : {})} className="underline-offset-2 hover:underline">{phone}</a> : phone
          ) : <span className="text-subtle">Not provided</span>}
        </dd>
      </div>
      <div className="min-w-0 bg-surface px-4 py-3">
        <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <MapPin className="size-3.5" aria-hidden /> Address
        </dt>
        <dd className="mt-1 break-words text-[15px] leading-snug text-ink">
          {address.length ? address.map((line) => <span key={line} className="block">{line}</span>)
            : <span className="text-subtle">Not provided</span>}
        </dd>
      </div>
    </dl>
  );
}
