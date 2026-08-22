'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { BriefcaseBusiness } from 'lucide-react';
import type { Contact } from '@/lib/domain/contact';
import type { ContactAssignment } from '@/lib/domain/rich-contact';
import type { WorkspaceMembership } from '@/lib/domain/workspace';
import { INITIAL_RICH_CONTACT_ACTION_STATE } from '@/app/contacts/action-state';
import { setAssignmentAction } from '@/app/contacts/rich-actions';

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="sk-primary-button shrink-0">{pending ? 'Assigning…' : 'Assign'}</button>;
}

function AssignmentRow({ contact, assignments, members }: { contact: Contact; assignments: readonly ContactAssignment[]; members: readonly WorkspaceMembership[] }) {
  const [state, action] = useActionState(setAssignmentAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const activeIds = new Set(assignments.filter((assignment) => !assignment.unassignedAt).map((assignment) => assignment.assigneeMembershipId));
  return (
    <li className="min-w-0 bg-surface p-4 sm:p-5">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-ink">{contact.firstName} {contact.lastName}</p>
        <p className="mt-1 break-words text-xs text-muted">
          {activeIds.size ? members.filter((member) => activeIds.has(member.id)).map((member) => `${member.role} · ${member.userId}`).join(', ') : 'Unassigned'}
        </p>
      </div>
      <form action={action} className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
        <input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="intent" value="add" />
        <label className="sk-field min-w-0 flex-1"><span className="sr-only">Assign {contact.firstName} {contact.lastName}</span><select name="assigneeMembershipId" required className="sk-input"><option value="">Select active member</option>{members.filter((member) => member.status === 'active' && !activeIds.has(member.id)).map((member) => <option key={member.id} value={member.id}>{member.role} · {member.userId}</option>)}</select></label>
        <Submit />
      </form>
      {state.message ? <p role={state.status === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${state.status === 'error' ? 'text-hot' : 'text-nurture'}`}>{state.message}</p> : null}
    </li>
  );
}

export function WorkspaceAssignmentPanel({ contacts, assignments, members }: { contacts: readonly Contact[]; assignments: readonly ContactAssignment[]; members: readonly WorkspaceMembership[] }) {
  return (
    <section className="mt-10" aria-labelledby="assignment-overview-title">
      <div className="mb-4 flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><BriefcaseBusiness className="size-5" aria-hidden /></span><div><h2 id="assignment-overview-title" className="font-display text-2xl text-ink">Contact responsibility</h2><p className="mt-1 text-sm text-muted">Assign active workspace members without changing membership authority.</p></div></div>
      {contacts.length ? <ul className="sk-group grid gap-px lg:grid-cols-2">{contacts.map((contact) => <AssignmentRow key={contact.id} contact={contact} assignments={assignments.filter((assignment) => assignment.contactId === contact.id)} members={members} />)}</ul> : <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">No active contacts are available for assignment.</p>}
    </section>
  );
}
