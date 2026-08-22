'use client';

import Link from 'next/link';
import { useActionState, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';
import {
  INTENT_LABEL,
  LEAD_TYPE_LABEL,
  PIPELINE_LABEL,
  QUALIFICATION_STATUS_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  type Contact,
} from '@/lib/domain/contact';
import {
  INITIAL_CONTACT_ACTION_STATE,
  type ContactActionState,
} from '@/lib/application/contact-action-state';

type ContactFormAction = (
  state: ContactActionState,
  formData: FormData,
) => Promise<ContactActionState>;

interface ReferralOption {
  id: string;
  name: string;
}

interface ContactFormProps {
  action: ContactFormAction;
  contact?: Contact;
  referralOptions: ReferralOption[];
  cancelHref: string;
  submitLabel: string;
}

function errorId(name: string) {
  return `${name}-error`;
}

function TextField({
  label,
  name,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}) {
  const describedBy = error ? errorId(name) : hint ? `${name}-hint` : undefined;
  return (
    <label className="sk-field">
      <span className="sk-label">{label}</span>
      <input
        {...props}
        name={name}
        className="sk-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && !error ? <span id={`${name}-hint`} className="sk-help">{hint}</span> : null}
      {error ? <span id={errorId(name)} className="sk-error">{error}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  name,
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  error?: string;
}) {
  return (
    <label className="sk-field">
      <span className="sk-label">{label}</span>
      <select
        {...props}
        name={name}
        className="sk-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId(name) : undefined}
      >
        {children}
      </select>
      {error ? <span id={errorId(name)} className="sk-error">{error}</span> : null}
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="sk-primary-button min-w-32">
      {pending ? 'Saving…' : label}
    </button>
  );
}

const LEAD_TYPES = ['hot', 'warm', 'nurture'] as const;
const RELATIONSHIPS = ['lead', 'active-client', 'past-client', 'sphere'] as const;
const INTENTS = ['buyer', 'seller', 'both', 'investor', 'renter', 'unknown'] as const;
const SOURCES = ['cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other'] as const;
const PIPELINE_STAGES = ['new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost'] as const;
const QUALIFICATION_STATUSES = ['qualified', 'needs-qualification'] as const;
const MORTGAGE_TYPES = ['conventional', 'fha', 'va', 'cash', 'unknown'] as const;
const TENURE_TYPES = ['owns', 'rents', 'unknown'] as const;
const PROPERTY_TO_SELL = ['yes', 'no', 'maybe', 'unknown'] as const;

export function ContactForm({
  action,
  contact,
  referralOptions,
  cancelHref,
  submitLabel,
}: ContactFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_CONTACT_ACTION_STATE);
  const fieldError = (name: string) => state.fieldErrors?.[name];
  const valueFor = (name: string, initial?: string | number) =>
    state.values ? (state.values[name] ?? '') : initial;
  const formKey = state.values ? JSON.stringify(state.values) : 'initial';

  return (
    <form key={formKey} action={formAction} className="space-y-4">
      {state.status === 'error' && state.message ? (
        <div role="alert" className="rounded-2xl border border-hot-border bg-hot-soft px-4 py-3 text-sm text-hot">
          {state.message}
        </div>
      ) : null}

      <section className="sk-group bg-surface p-5 sm:p-6" aria-labelledby="contact-essentials">
        <div className="mb-5">
          <h2 id="contact-essentials" className="font-display text-2xl text-ink">Essentials</h2>
          <p className="mt-1 text-sm text-muted">Fast enough for an open house. Add more detail when it helps.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" name="firstName" autoComplete="given-name" defaultValue={valueFor('firstName', contact?.firstName)} error={fieldError('firstName')} />
          <TextField label="Last name" name="lastName" autoComplete="family-name" defaultValue={valueFor('lastName', contact?.lastName)} error={fieldError('lastName')} />
          <TextField label="Phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={valueFor('phone', contact?.phone)} error={fieldError('phone')} />
          <TextField label="Email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={valueFor('email', contact?.email)} error={fieldError('email')} />
          <SelectField label="Lead type" name="leadType" defaultValue={valueFor('leadType', contact?.leadType ?? 'warm')} error={fieldError('leadType')}>
            {LEAD_TYPES.map((entry) => <option key={entry} value={entry}>{LEAD_TYPE_LABEL[entry]}</option>)}
          </SelectField>
          <SelectField label="Qualification" name="qualificationStatus" defaultValue={valueFor('qualificationStatus', contact?.qualificationStatus ?? 'qualified')} error={fieldError('qualificationStatus')}>
            {QUALIFICATION_STATUSES.map((entry) => <option key={entry} value={entry}>{QUALIFICATION_STATUS_LABEL[entry]}</option>)}
          </SelectField>
        </div>
      </section>

      <details className="sk-form-section" open>
        <summary>CRM details</summary>
        <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-2 sm:p-6">
          <TextField label="Preferred name" name="preferredName" autoComplete="nickname" defaultValue={valueFor('preferredName', contact?.preferredName)} error={fieldError('preferredName')} />
          <TextField label="Secondary phone" name="secondaryPhone" type="tel" inputMode="tel" defaultValue={valueFor('secondaryPhone', contact?.secondaryPhone)} error={fieldError('secondaryPhone')} />
          <SelectField label="Relationship" name="relationship" defaultValue={valueFor('relationship', contact?.relationship ?? 'lead')} error={fieldError('relationship')}>
            {RELATIONSHIPS.map((entry) => <option key={entry} value={entry}>{RELATIONSHIP_LABEL[entry]}</option>)}
          </SelectField>
          <SelectField label="Intent" name="intent" defaultValue={valueFor('intent', contact?.intent ?? 'unknown')} error={fieldError('intent')}>
            {INTENTS.map((entry) => <option key={entry} value={entry}>{INTENT_LABEL[entry]}</option>)}
          </SelectField>
          <SelectField label="Source" name="source" defaultValue={valueFor('source', contact?.source ?? 'other')} error={fieldError('source')}>
            {SOURCES.map((entry) => <option key={entry} value={entry}>{SOURCE_LABEL[entry]}</option>)}
          </SelectField>
          <SelectField label="Pipeline stage" name="pipelineStage" defaultValue={valueFor('pipelineStage', contact?.pipelineStage ?? 'new')} error={fieldError('pipelineStage')}>
            {PIPELINE_STAGES.map((entry) => <option key={entry} value={entry}>{PIPELINE_LABEL[entry]}</option>)}
          </SelectField>
          <SelectField label="Referred by" name="referredById" defaultValue={valueFor('referredById', contact?.referredById ?? '')} error={fieldError('referredById')}>
            <option value="">No referrer recorded</option>
            {referralOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </SelectField>
          <TextField label="Tags" name="tags" defaultValue={valueFor('tags', contact?.tags.join(', '))} placeholder="VIP, first-time buyer" hint="Separate tags with commas." error={fieldError('tags')} />
          <label className="flex min-h-11 items-center gap-3 sm:col-span-2">
            <input name="emailSubscribed" type="checkbox" defaultChecked={state.values ? state.values.emailSubscribed === 'on' : (contact?.emailSubscribed ?? true)} className="size-5 accent-accent" />
            <span>
              <span className="block text-sm font-medium text-ink">Subscribed to email</span>
              <span className="block text-xs text-muted">Keep this off for anyone who has opted out.</span>
            </span>
          </label>
        </div>
      </details>

      <details className="sk-form-section">
        <summary>Follow-up and important dates</summary>
        <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-3 sm:p-6">
          <TextField label="Next touch" name="nextTouchAt" type="date" defaultValue={valueFor('nextTouchAt', contact?.nextTouchAt)} hint="Leave blank to use the automatic cadence." error={fieldError('nextTouchAt')} />
          <TextField label="Birthday" name="birthdate" type="date" defaultValue={valueFor('birthdate', contact?.birthdate)} error={fieldError('birthdate')} />
          <TextField label="Home purchase date" name="homePurchaseDate" type="date" defaultValue={valueFor('homePurchaseDate', contact?.homePurchaseDate)} error={fieldError('homePurchaseDate')} />
        </div>
      </details>

      <details className="sk-form-section">
        <summary>Address</summary>
        <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-2 sm:p-6">
          <TextField label="Mailing address" name="mailingAddress" autoComplete="street-address" defaultValue={valueFor('mailingAddress', contact?.mailingAddress)} error={fieldError('mailingAddress')} />
          <TextField label="City" name="city" autoComplete="address-level2" defaultValue={valueFor('city', contact?.city)} error={fieldError('city')} />
          <TextField label="State" name="state" autoComplete="address-level1" defaultValue={valueFor('state', contact?.state)} error={fieldError('state')} />
          <TextField label="Postal code" name="postalCode" autoComplete="postal-code" inputMode="numeric" defaultValue={valueFor('postalCode', contact?.postalCode)} error={fieldError('postalCode')} />
        </div>
      </details>

      <details className="sk-form-section">
        <summary>Buyer criteria</summary>
        <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6">
          <TextField label="Minimum price" name="buyerPriceMin" type="number" min="0" inputMode="decimal" defaultValue={valueFor('buyerPriceMin', contact?.buyer?.priceMin)} error={fieldError('buyerPriceMin')} />
          <TextField label="Maximum price" name="buyerPriceMax" type="number" min="0" inputMode="decimal" defaultValue={valueFor('buyerPriceMax', contact?.buyer?.priceMax)} error={fieldError('buyerPriceMax')} />
          <TextField label="Areas" name="buyerAreas" defaultValue={valueFor('buyerAreas', contact?.buyer?.areas?.join(', '))} hint="Separate areas with commas." error={fieldError('buyerAreas')} />
          <TextField label="Beds" name="buyerBeds" type="number" min="0" step="1" inputMode="numeric" defaultValue={valueFor('buyerBeds', contact?.buyer?.beds)} error={fieldError('buyerBeds')} />
          <TextField label="Baths" name="buyerBaths" type="number" min="0" step="0.5" inputMode="decimal" defaultValue={valueFor('buyerBaths', contact?.buyer?.baths)} error={fieldError('buyerBaths')} />
          <TextField label="Timeline" name="buyerTimeline" defaultValue={valueFor('buyerTimeline', contact?.buyer?.timeline)} error={fieldError('buyerTimeline')} />
          <SelectField label="Pre-approved" name="buyerPreApproved" defaultValue={valueFor('buyerPreApproved', contact?.buyer?.preApproved === undefined ? '' : contact.buyer.preApproved ? 'yes' : 'no')} error={fieldError('buyerPreApproved')}>
            <option value="">Not recorded</option><option value="yes">Yes</option><option value="no">Not yet</option>
          </SelectField>
          <TextField label="Lender" name="buyerLender" defaultValue={valueFor('buyerLender', contact?.buyer?.lender)} error={fieldError('buyerLender')} />
          <SelectField label="Mortgage type" name="buyerMortgageType" defaultValue={valueFor('buyerMortgageType', contact?.buyer?.mortgageType ?? 'unknown')} error={fieldError('buyerMortgageType')}>
            {MORTGAGE_TYPES.map((entry) => <option key={entry} value={entry}>{entry === 'fha' || entry === 'va' ? entry.toUpperCase() : `${entry.charAt(0).toUpperCase()}${entry.slice(1)}`}</option>)}
          </SelectField>
          <TextField label="Desired property type" name="buyerDesiredPropertyType" maxLength={80} defaultValue={valueFor('buyerDesiredPropertyType', contact?.buyer?.desiredPropertyType)} error={fieldError('buyerDesiredPropertyType')} />
          <SelectField label="Current housing" name="buyerCurrentTenure" defaultValue={valueFor('buyerCurrentTenure', contact?.buyer?.currentTenure ?? 'unknown')} error={fieldError('buyerCurrentTenure')}>
            {TENURE_TYPES.map((entry) => <option key={entry} value={entry}>{entry === 'owns' ? 'Owns' : entry === 'rents' ? 'Rents' : 'Not recorded'}</option>)}
          </SelectField>
        </div>
      </details>

      <details className="sk-form-section">
        <summary>Seller criteria</summary>
        <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-2 sm:p-6">
          <TextField label="Property address" name="sellerPropertyAddress" defaultValue={valueFor('sellerPropertyAddress', contact?.seller?.propertyAddress)} error={fieldError('sellerPropertyAddress')} />
          <TextField label="Target price" name="sellerTargetPrice" type="number" min="0" inputMode="decimal" defaultValue={valueFor('sellerTargetPrice', contact?.seller?.targetPrice)} error={fieldError('sellerTargetPrice')} />
          <TextField label="Timeline" name="sellerTimeline" defaultValue={valueFor('sellerTimeline', contact?.seller?.timeline)} error={fieldError('sellerTimeline')} />
          <TextField label="Motivation" name="sellerMotivation" defaultValue={valueFor('sellerMotivation', contact?.seller?.motivation)} error={fieldError('sellerMotivation')} />
          <SelectField label="Property to sell" name="sellerHasPropertyToSell" defaultValue={valueFor('sellerHasPropertyToSell', contact?.seller?.hasPropertyToSell ?? 'unknown')} error={fieldError('sellerHasPropertyToSell')}>
            {PROPERTY_TO_SELL.map((entry) => <option key={entry} value={entry}>{entry === 'yes' ? 'Yes' : entry === 'no' ? 'No' : entry === 'maybe' ? 'Maybe' : 'Not recorded'}</option>)}
          </SelectField>
          <TextField label="Property type" name="sellerPropertyType" maxLength={80} defaultValue={valueFor('sellerPropertyType', contact?.seller?.propertyType)} error={fieldError('sellerPropertyType')} />
          <TextField label="Bedrooms" name="sellerBedrooms" type="number" min="0" step="1" inputMode="numeric" defaultValue={valueFor('sellerBedrooms', contact?.seller?.bedrooms)} error={fieldError('sellerBedrooms')} />
          <TextField label="Bathrooms" name="sellerBathrooms" type="number" min="0" step="0.5" inputMode="decimal" defaultValue={valueFor('sellerBathrooms', contact?.seller?.bathrooms)} error={fieldError('sellerBathrooms')} />
          <TextField label="Basement" name="sellerBasement" maxLength={80} defaultValue={valueFor('sellerBasement', contact?.seller?.basement)} error={fieldError('sellerBasement')} />
          <TextField label="Parking" name="sellerParking" maxLength={80} defaultValue={valueFor('sellerParking', contact?.seller?.parking)} error={fieldError('sellerParking')} />
          <TextField label="Condition" name="sellerCondition" maxLength={80} defaultValue={valueFor('sellerCondition', contact?.seller?.condition)} error={fieldError('sellerCondition')} />
          <TextField label="Listing status" name="sellerListingStatus" maxLength={80} defaultValue={valueFor('sellerListingStatus', contact?.seller?.listingStatus)} error={fieldError('sellerListingStatus')} />
        </div>
      </details>

      <div className="flex items-center justify-end gap-5 rounded-2xl border border-line bg-surface px-4 py-3">
        <Link href={cancelHref} className="sk-text-action">Cancel</Link>
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
