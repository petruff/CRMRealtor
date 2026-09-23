'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Archive,
  AtSign,
  BriefcaseBusiness,
  ContactRound,
  Home,
  Link2,
  Plus,
  RotateCcw,
  Save,
  Users,
} from 'lucide-react';
import type { Contact } from '@/lib/domain/contact';
import type { WorkspaceMembership } from '@/lib/domain/workspace';
import type {
  ContactAssignment,
  ContactCustomFieldValue,
  ContactImportSourceFactRecord,
  ContactPoint,
  CustomFieldDefinition,
  Household,
  PersonRelationship,
} from '@/lib/domain/rich-contact';
import {
  INITIAL_RICH_CONTACT_ACTION_STATE,
  type RichContactActionState,
} from '@/app/contacts/action-state';
import {
  addRelationshipAction,
  archiveContactLifecycleAction,
  archiveCustomFieldAction,
  archiveHouseholdAction,
  createCustomFieldAction,
  createHouseholdAction,
  restoreContactLifecycleAction,
  saveContactPointAction,
  setAssignmentAction,
  setContactPointStatusAction,
  setCustomFieldValueAction,
  setHouseholdMembershipAction,
  setRelationshipStatusAction,
} from '@/app/contacts/rich-actions';

export interface HouseholdView extends Household {
  memberContactIds: readonly string[];
}

function Submit({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'text' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={tone === 'primary' ? 'sk-primary-button' : 'sk-text-action'}>
      {pending ? 'Saving…' : children}
    </button>
  );
}

function Feedback({ state }: { state: RichContactActionState }) {
  return state.message ? (
    <p role={state.status === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${state.status === 'error' ? 'text-hot' : 'text-nurture'}`}>
      {state.message}
    </p>
  ) : null;
}

function PointCard({ point, contactId, readOnly }: { point: ContactPoint; contactId: string; readOnly: boolean }) {
  const [saveState, saveAction] = useActionState(saveContactPointAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [statusState, statusAction] = useActionState(setContactPointStatusAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const archived = Boolean(point.archivedAt);
  return (
    <li className="min-w-0 bg-surface p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-ink">{point.displayValue}</p>
          <p className="mt-0.5 text-xs text-muted">{point.label} · {point.type}{point.isPrimary ? ' · Primary' : ''}{point.type === 'email' ? point.emailSubscribed ? ' · Subscribed' : ' · Opted out' : ''}</p>
        </div>
        {archived ? <span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] text-subtle">Archived</span> : null}
      </div>
      {!readOnly && !archived ? (
        <details className="mt-3 rounded-xl bg-surface-2 p-3">
          <summary className="inline-flex min-h-9 cursor-pointer items-center text-xs font-medium text-[var(--sk-body-link-color)] hover:underline">Edit contact point</summary>
          <form action={saveAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="contactId" value={contactId} />
            <input type="hidden" name="pointId" value={point.id} />
            <input type="hidden" name="type" value={point.type} />
            <label className="sk-field"><span className="sk-label">Label</span><input name="label" maxLength={80} required defaultValue={point.label} autoComplete="off" className="sk-input" /></label>
            <label className="sk-field"><span className="sk-label">{point.type === 'phone' ? 'Phone' : 'Email'}</span><input name="displayValue" maxLength={point.type === 'phone' ? 40 : 254} required defaultValue={point.displayValue} className="sk-input" type={point.type === 'phone' ? 'tel' : 'email'} autoComplete={point.type === 'phone' ? 'tel' : 'email'} /></label>
            {point.type === 'email' ? <label className="sk-field"><span className="sk-label">Email consent</span><select name="emailSubscribed" defaultValue={point.emailSubscribed === false ? 'false' : 'true'} className="sk-input"><option value="true">Subscribed</option><option value="false">Opted out</option></select></label> : null}
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input name="isPrimary" type="checkbox" defaultChecked={point.isPrimary} className="size-5 accent-accent" /> Primary {point.type}</label>
            <input type="hidden" name="displayOrder" value={point.displayOrder} />
            <div className="sm:col-span-2"><Submit><Save className="size-4" /> Save point</Submit></div>
          </form>
          <Feedback state={saveState} />
          <form action={statusAction} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="contactId" value={contactId} /><input type="hidden" name="pointId" value={point.id} /><input type="hidden" name="intent" value="archive" />
            <label className="sk-field"><span className="sk-label">Archive reason</span><input name="reason" maxLength={240} required className="sk-input" placeholder="No longer in use" /></label>
            <div className="mt-2"><Submit tone="text"><Archive className="size-4" /> Archive point</Submit></div>
          </form>
          <Feedback state={statusState} />
        </details>
      ) : null}
      {!readOnly && archived ? (
        <form action={statusAction} className="mt-3">
          <input type="hidden" name="contactId" value={contactId} /><input type="hidden" name="pointId" value={point.id} /><input type="hidden" name="intent" value="restore" />
          <Submit tone="text"><RotateCcw className="size-4" /> Restore point</Submit>
          <Feedback state={statusState} />
        </form>
      ) : null}
    </li>
  );
}

function CustomValueForm({ definition, saved, contactId, readOnly }: { definition: CustomFieldDefinition; saved?: ContactCustomFieldValue; contactId: string; readOnly: boolean }) {
  const [state, action] = useActionState(setCustomFieldValueAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const value = saved?.value;
  return (
    <form action={action} className="min-w-0 rounded-xl bg-surface-2 p-3">
      <input type="hidden" name="contactId" value={contactId} /><input type="hidden" name="definitionId" value={definition.id} />
      <label className="sk-field">
        <span className="sk-label">{definition.name}</span>
        {definition.type === 'boolean' ? (
          <select name="value" defaultValue={value === true ? 'true' : 'false'} disabled={readOnly} className="sk-input"><option value="false">No</option><option value="true">Yes</option></select>
        ) : definition.type === 'single-select' ? (
          <select name="value" defaultValue={String(value ?? '')} disabled={readOnly} className="sk-input"><option value="">Not recorded</option>{definition.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
        ) : (
          <input name="value" type={definition.type === 'number' ? 'number' : definition.type === 'date' ? 'date' : 'text'} defaultValue={value === undefined ? '' : String(value)} disabled={readOnly} maxLength={definition.type === 'text' ? 2000 : 120} className="sk-input" />
        )}
      </label>
      {!readOnly ? <div className="mt-2"><Submit><Save className="size-4" /> Save</Submit></div> : null}
      <Feedback state={state} />
    </form>
  );
}

function memberLabel(member: WorkspaceMembership) {
  return `${member.role === 'owner' ? 'Owner' : 'Assistant'} · ${member.userId}`;
}

const IMPORTED_PROFILE_GROUPS: readonly {
  key: ContactImportSourceFactRecord['category'];
  label: string;
}[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'ownership', label: 'Ownership & source' },
  { key: 'address', label: 'Addresses' },
  { key: 'real-estate', label: 'Real-estate preferences' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'verification', label: 'Verification' },
  { key: 'consent', label: 'Consent evidence' },
  { key: 'other', label: 'Other source facts' },
];

function importedFactValue(fact: ContactImportSourceFactRecord): string {
  if (fact.valueType === 'boolean') return fact.value ? 'Yes' : 'No';
  return String(fact.value);
}

export function ImportedContactProfile({ facts }: { facts: readonly ContactImportSourceFactRecord[] }) {
  if (!facts.length) return null;
  const providers = Array.from(new Set(facts.map((fact) => fact.provider)));
  return (
    <details className="sk-form-section mt-5" open>
      <summary className="flex items-center gap-2">
        <ContactRound className="size-4 text-accent" aria-hidden />
        Imported profile · {facts.length} preserved fact{facts.length === 1 ? '' : 's'}
      </summary>
      <div className="border-t border-line p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-muted">
          Read-only source evidence from {providers.join(', ')}. These values preserve the migration record and do not grant messaging consent.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {IMPORTED_PROFILE_GROUPS.map((group, groupIndex) => {
            const groupedFacts = facts.filter((fact) => fact.category === group.key);
            if (!groupedFacts.length) return null;
            return (
              <details key={group.key} className="min-w-0 rounded-2xl border border-line bg-surface-2" open={groupIndex === 0}>
                <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink">
                  <span>{group.label}</span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{groupedFacts.length}</span>
                </summary>
                <dl className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
                  {groupedFacts.map((fact) => (
                    <div key={fact.id} className="min-w-0 bg-surface p-4">
                      <dt className="text-xs font-medium text-muted">{fact.label}</dt>
                      <dd className="mt-1 break-words text-sm text-ink">{importedFactValue(fact)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            );
          })}
        </div>
      </div>
    </details>
  );
}

export function RichContactWorkspace({
  contact,
  points,
  households,
  relationships,
  assignments,
  members,
  contacts,
  definitions,
  customValues,
  importedFacts,
  archived,
  isOwner,
  archiveReturnContext,
}: {
  contact: Contact;
  points: readonly ContactPoint[];
  households: readonly HouseholdView[];
  relationships: readonly PersonRelationship[];
  assignments: readonly ContactAssignment[];
  members: readonly WorkspaceMembership[];
  contacts: readonly Contact[];
  definitions: readonly CustomFieldDefinition[];
  customValues: readonly ContactCustomFieldValue[];
  importedFacts: readonly ContactImportSourceFactRecord[];
  archived: boolean;
  isOwner: boolean;
  /** Serialized list context; the server re-validates it before choosing the next contact. */
  archiveReturnContext?: string;
}) {
  const [pointState, pointAction] = useActionState(saveContactPointAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [householdState, householdAction] = useActionState(createHouseholdAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [membershipState, membershipAction] = useActionState(setHouseholdMembershipAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [householdArchiveState, householdArchiveAction] = useActionState(archiveHouseholdAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [relationshipState, relationshipAction] = useActionState(addRelationshipAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [relationshipStatusState, relationshipStatusAction] = useActionState(setRelationshipStatusAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [assignmentState, assignmentAction] = useActionState(setAssignmentAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [definitionState, definitionAction] = useActionState(createCustomFieldAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [definitionArchiveState, definitionArchiveAction] = useActionState(archiveCustomFieldAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [archiveState, archiveAction] = useActionState(archiveContactLifecycleAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [restoreState, restoreAction] = useActionState(restoreContactLifecycleAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const [pointType, setPointType] = useState<'phone' | 'email'>('phone');
  const activeMembers = members.filter((member) => member.status === 'active');
  const activeDefinitions = definitions.filter((definition) => !definition.archivedAt);
  const importedDefinitions = activeDefinitions.filter((definition) => definition.name.startsWith('1st Class · '));
  const editableDefinitions = activeDefinitions.filter((definition) => !definition.name.startsWith('1st Class · '));
  const activeAssignments = assignments.filter((assignment) => !assignment.unassignedAt);

  return (
    <section className="mt-10" aria-labelledby="rich-record-title">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><ContactRound className="size-5" aria-hidden /></span>
        <div><h2 id="rich-record-title" className="font-display text-2xl text-ink">Relationship record</h2><p className="mt-1 text-sm text-muted">Canonical contact points, household context, responsibility and custom facts.</p></div>
      </div>

      {archived ? (
        <div className="mb-5 rounded-[var(--sk-card-radius)] border border-warm-border bg-warm-soft p-5 sm:p-6">
          <h3 className="font-display text-xl text-ink">Archived record · read only</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">History and relationship context remain visible. Restore this same contact ID before adding tasks or changing facts.</p>
          <form action={restoreAction} className="mt-4"><input type="hidden" name="contactId" value={contact.id} /><Submit><RotateCcw className="size-4" /> Restore contact</Submit><Feedback state={restoreState} /></form>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <details className="sk-form-section" open>
          <summary className="flex items-center gap-2"><AtSign className="size-4 text-accent" aria-hidden /> Contact points</summary>
          <div className="border-t border-line p-4 sm:p-5">
            <ul className="sk-group grid gap-px">{points.map((point) => <PointCard key={point.id} point={point} contactId={contact.id} readOnly={archived} />)}</ul>
            {!points.length ? <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">No canonical contact points yet.</p> : null}
            {!archived ? (
              <form action={pointAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="contactId" value={contact.id} />
                <label className="sk-field"><span className="sk-label">Type</span><select name="type" value={pointType} onChange={(event) => setPointType(event.target.value as 'phone' | 'email')} className="sk-input"><option value="phone">Phone</option><option value="email">Email</option></select></label>
                <label className="sk-field"><span className="sk-label">Label</span><input name="label" required maxLength={80} autoComplete="off" className="sk-input" placeholder="Mobile, work, personal" /></label>
                <label className="sk-field"><span className="sk-label">{pointType === 'phone' ? 'Phone number' : 'Email address'}</span><input name="displayValue" required maxLength={pointType === 'phone' ? 40 : 254} type={pointType === 'phone' ? 'tel' : 'email'} autoComplete={pointType === 'phone' ? 'tel' : 'email'} className="sk-input" /></label>
                {pointType === 'email' ? <label className="sk-field"><span className="sk-label">Email consent</span><select name="emailSubscribed" defaultValue="true" className="sk-input"><option value="true">Subscribed</option><option value="false">Opted out</option></select></label> : null}
                <label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input name="isPrimary" type="checkbox" className="size-5 accent-accent" /> Make primary</label>
                <input type="hidden" name="displayOrder" value={points.filter((point) => point.type === pointType && !point.archivedAt).length} />
                <div><Submit><Plus className="size-4" /> Add point</Submit></div>
              </form>
            ) : null}
            <Feedback state={pointState} />
          </div>
        </details>

        <details className="sk-form-section" open>
          <summary className="flex items-center gap-2"><Home className="size-4 text-accent" aria-hidden /> Households</summary>
          <div className="border-t border-line p-4 sm:p-5">
            <ul className="grid gap-2">
              {households.filter((item) => !item.archivedAt).map((household) => {
                const joined = household.memberContactIds.includes(contact.id);
                return <li key={household.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-ink">{household.name}</p><p className="text-xs text-muted">{household.memberContactIds.length} member{household.memberContactIds.length === 1 ? '' : 's'}</p></div>{!archived ? <div className="flex flex-wrap items-center gap-1"><form action={membershipAction}><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="intent" value={joined ? 'remove' : 'add'} /><Submit tone="text">{joined ? 'Remove' : 'Add'}</Submit></form><form action={householdArchiveAction}><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="householdId" value={household.id} /><Submit tone="text"><Archive className="size-4" /> Archive</Submit></form></div> : joined ? <span className="text-xs text-muted">Member</span> : null}</li>;
              })}
            </ul>
            {!archived ? <form action={householdAction} className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row"><input type="hidden" name="contactId" value={contact.id} /><label className="sk-field min-w-0 flex-1"><span className="sk-label">New household</span><input name="name" required maxLength={80} autoComplete="off" className="sk-input" placeholder="Monroe household" /></label><div className="sm:self-end"><Submit><Plus className="size-4" /> Create</Submit></div></form> : null}
            <Feedback state={householdArchiveState.status !== 'idle' ? householdArchiveState : membershipState.status === 'idle' ? householdState : membershipState} />
          </div>
        </details>

        <details className="sk-form-section">
          <summary className="flex items-center gap-2"><Link2 className="size-4 text-accent" aria-hidden /> Person relationships</summary>
          <div className="border-t border-line p-4 sm:p-5">
            <ul className="grid gap-2">{relationships.map((relationship) => {
              const otherId = relationship.firstContactId === contact.id ? relationship.secondContactId : relationship.firstContactId;
              const other = contacts.find((entry) => entry.id === otherId);
              return <li key={relationship.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-ink">{other ? `${other.firstName} ${other.lastName}` : otherId}</p><p className="text-xs text-muted">{relationship.kind === 'other' ? relationship.label : relationship.kind}{relationship.archivedAt ? ' · Archived' : ''}</p></div>{!archived ? <form action={relationshipStatusAction}><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="relationshipId" value={relationship.id} /><input type="hidden" name="intent" value={relationship.archivedAt ? 'restore' : 'archive'} /><Submit tone="text">{relationship.archivedAt ? 'Restore' : 'Archive'}</Submit></form> : null}</li>;
            })}</ul>
            {!archived ? <form action={relationshipAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="contactId" value={contact.id} /><label className="sk-field"><span className="sk-label">Person</span><select name="secondContactId" required className="sk-input"><option value="">Select a contact</option>{contacts.filter((entry) => entry.id !== contact.id && !entry.archivedAt).map((entry) => <option key={entry.id} value={entry.id}>{entry.firstName} {entry.lastName}</option>)}</select></label><label className="sk-field"><span className="sk-label">Relationship</span><select name="kind" className="sk-input"><option value="spouse">Spouse</option><option value="partner">Partner</option><option value="household-member">Household member</option><option value="other">Other</option></select></label><label className="sk-field sm:col-span-2"><span className="sk-label">Other label (only when Other)</span><input name="label" maxLength={80} autoComplete="off" className="sk-input" /></label><div><Submit><Plus className="size-4" /> Add relationship</Submit></div></form> : null}
            <Feedback state={relationshipStatusState.status === 'idle' ? relationshipState : relationshipStatusState} />
          </div>
        </details>

        <details className="sk-form-section">
          <summary className="flex items-center gap-2"><BriefcaseBusiness className="size-4 text-accent" aria-hidden /> Assignments</summary>
          <div className="border-t border-line p-4 sm:p-5">
            <ul className="grid gap-2">{activeAssignments.map((assignment) => { const member = members.find((item) => item.id === assignment.assigneeMembershipId); return <li key={assignment.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3"><p className="break-words text-sm text-ink">{member ? memberLabel(member) : assignment.assigneeMembershipId}</p>{!archived ? <form action={assignmentAction}><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="assignmentId" value={assignment.id} /><input type="hidden" name="intent" value="remove" /><Submit tone="text">Unassign</Submit></form> : null}</li>; })}</ul>
            {!activeAssignments.length ? <p className="text-sm text-muted">No active assignment.</p> : null}
            {!archived ? <form action={assignmentAction} className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row"><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="intent" value="add" /><label className="sk-field min-w-0 flex-1"><span className="sk-label">Assign active member</span><select name="assigneeMembershipId" required className="sk-input"><option value="">Select a member</option>{activeMembers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><div className="sm:self-end"><Submit><Users className="size-4" /> Assign</Submit></div></form> : null}
            <Feedback state={assignmentState} />
          </div>
        </details>

        <details className="sk-form-section xl:col-span-2">
          <summary className="flex items-center gap-2"><ContactRound className="size-4 text-accent" aria-hidden /> Custom fields</summary>
          <div className="border-t border-line p-4 sm:p-5">
            {isOwner ? <ul className="mb-4 grid gap-2">{definitions.filter((definition) => !definition.name.startsWith('1st Class · ')).map((definition) => <li key={definition.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-ink">{definition.name}</p><p className="text-xs text-muted">{definition.type}{definition.archivedAt ? ' · Archived' : ''}</p></div>{!definition.archivedAt && !archived ? <form action={definitionArchiveAction}><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="definitionId" value={definition.id} /><Submit tone="text"><Archive className="size-4" /> Archive</Submit></form> : null}</li>)}</ul> : null}
            <div className="grid gap-3 sm:grid-cols-2">{editableDefinitions.map((definition) => <CustomValueForm key={definition.id} definition={definition} saved={customValues.find((value) => value.definitionId === definition.id)} contactId={contact.id} readOnly={archived} />)}</div>
            {!editableDefinitions.length ? <p className="text-sm text-muted">No active custom fields.</p> : null}
            {isOwner && !archived ? <form action={definitionAction} className="mt-5 grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"><input type="hidden" name="contactId" value={contact.id} /><label className="sk-field"><span className="sk-label">Field name</span><input name="name" required maxLength={80} autoComplete="off" className="sk-input" /></label><label className="sk-field"><span className="sk-label">Type</span><select name="type" className="sk-input"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes / no</option><option value="single-select">Single select</option></select></label><label className="sk-field sm:col-span-2"><span className="sk-label">Options (single select only)</span><input name="options" autoComplete="off" className="sk-input" placeholder="Option one, option two" /></label><input type="hidden" name="displayOrder" value={activeDefinitions.length} /><div><Submit><Plus className="size-4" /> Create field</Submit></div></form> : null}
            <Feedback state={definitionState} />
            <Feedback state={definitionArchiveState} />
          </div>
        </details>
      </div>

      <ImportedContactProfile facts={importedFacts} />

      {!importedFacts.length && importedDefinitions.length ? (
        <details className="sk-form-section mt-5">
          <summary className="flex items-center gap-2"><ContactRound className="size-4 text-accent" aria-hidden /> Imported profile · First Class</summary>
          <div className="border-t border-line p-4 sm:p-5">
            <p className="mb-4 text-sm text-muted">Original migration values are preserved read-only for audit and reference. Messaging consent is still governed by Omnix.</p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {importedDefinitions.map((definition) => {
                const saved = customValues.find((value) => value.definitionId === definition.id);
                if (!saved) return null;
                return <div key={definition.id} className="min-w-0 border-b border-line pb-2"><dt className="text-xs font-medium text-muted">{definition.name.slice('1st Class · '.length)}</dt><dd className="mt-1 break-words text-sm text-ink">{String(saved.value)}</dd></div>;
              })}
            </dl>
          </div>
        </details>
      ) : null}

      {!archived ? (
        <details className="mt-5 rounded-[var(--sk-card-radius)] border border-hot-border bg-hot-soft p-5 sm:p-6">
          <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium text-hot"><Archive className="size-4" aria-hidden /> Archive contact</summary>
          <p className="mt-2 text-sm leading-relaxed text-muted">Archiving removes this person from active work surfaces while preserving the same ID, notes, tasks, mail and relationship history.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{archiveReturnContext ? 'After archiving, the next contact in this list opens.' : 'After archiving, you return to your contacts.'}</p>
          <form key={archiveState.values ? JSON.stringify(archiveState.values) : 'archive'} action={archiveAction} className="mt-4 max-w-xl"><input type="hidden" name="contactId" value={contact.id} />{archiveReturnContext ? <input type="hidden" name="returnContext" value={archiveReturnContext} /> : null}<label className="sk-field"><span className="sk-label">Reason</span><input name="reason" required maxLength={240} defaultValue={archiveState.values?.reason} className="sk-input" placeholder="No longer actively managed" /></label><div className="mt-3"><Submit tone="text"><Archive className="size-4" /> Archive record</Submit></div><Feedback state={archiveState} /></form>
        </details>
      ) : null}
    </section>
  );
}
