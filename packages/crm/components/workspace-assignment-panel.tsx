'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { BriefcaseBusiness, Search } from 'lucide-react';
import type { Contact } from '@/lib/domain/contact';
import type { ContactAssignment } from '@/lib/domain/rich-contact';
import type { WorkspaceMembership } from '@/lib/domain/workspace';
import { INITIAL_RICH_CONTACT_ACTION_STATE } from '@/app/contacts/action-state';
import { setAssignmentAction } from '@/app/contacts/rich-actions';

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="sk-primary-button shrink-0">{pending ? 'Assigning…' : 'Assign'}</button>;
}

function memberLabel(member: WorkspaceMembership, currentMembershipId: string, members: readonly WorkspaceMembership[]): string {
  const role = member.role === 'owner' ? 'Owner' : 'Assistant';
  if (member.id === currentMembershipId) return `You · ${role}`;
  if (member.role === 'owner') return 'Workspace owner';
  const assistants = members.filter((item) => item.status === 'active' && item.role === 'assistant');
  const position = assistants.findIndex((item) => item.id === member.id);
  return assistants.length > 1 && position >= 0 ? `Assistant ${position + 1}` : 'Assistant';
}

function AssignmentRow({ contact, assignments, members, currentMembershipId }: { contact: Contact; assignments: readonly ContactAssignment[]; members: readonly WorkspaceMembership[]; currentMembershipId: string }) {
  const [state, action] = useActionState(setAssignmentAction, INITIAL_RICH_CONTACT_ACTION_STATE);
  const activeIds = new Set(assignments.filter((assignment) => !assignment.unassignedAt).map((assignment) => assignment.assigneeMembershipId));
  return (
    <li className="min-w-0 bg-surface p-4 sm:p-5">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-ink">{contact.firstName} {contact.lastName}</p>
        <p className="mt-1 break-words text-xs text-muted">
          {activeIds.size ? members.filter((member) => activeIds.has(member.id)).map((member) => memberLabel(member, currentMembershipId, members)).join(', ') : 'Unassigned'}
        </p>
      </div>
      <form action={action} className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
        <input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="intent" value="add" />
        <label className="sk-field min-w-0 flex-1"><span className="sr-only">Assign {contact.firstName} {contact.lastName}</span><select name="assigneeMembershipId" required className="sk-input"><option value="">Select active member</option>{members.filter((member) => member.status === 'active' && !activeIds.has(member.id)).map((member) => <option key={member.id} value={member.id}>{memberLabel(member, currentMembershipId, members)}</option>)}</select></label>
        <Submit />
      </form>
      {state.message ? <p role={state.status === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${state.status === 'error' ? 'text-hot' : 'text-nurture'}`}>{state.message}</p> : null}
    </li>
  );
}

const INITIAL_CONTACT_LIMIT = 24;

export function WorkspaceAssignmentPanel({ contacts, assignments, members, currentMembershipId }: { contacts: readonly Contact[]; assignments: readonly ContactAssignment[]; members: readonly WorkspaceMembership[]; currentMembershipId: string }) {
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_CONTACT_LIMIT);
  const assignmentsByContact = useMemo(() => {
    const grouped = new Map<string, ContactAssignment[]>();
    for (const assignment of assignments) {
      const current = grouped.get(assignment.contactId) ?? [];
      current.push(assignment);
      grouped.set(assignment.contactId, current);
    }
    return grouped;
  }, [assignments]);
  const filteredContacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    if (!normalized) return contacts;
    return contacts.filter((contact) => (
      `${contact.firstName} ${contact.lastName}`.toLocaleLowerCase('en-US').includes(normalized)
    ));
  }, [contacts, query]);
  const visibleContacts = filteredContacts.slice(0, visibleLimit);
  const remaining = filteredContacts.length - visibleContacts.length;

  return (
    <section className="mt-10" aria-labelledby="assignment-overview-title">
      <div className="mb-4 flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><BriefcaseBusiness className="size-5" aria-hidden /></span><div><h2 id="assignment-overview-title" className="font-display text-2xl text-ink">Contact responsibility</h2><p className="mt-1 text-sm text-muted">Assign active workspace members without changing membership authority.</p></div></div>
      {contacts.length ? (
        <>
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1 sm:max-w-md">
              <span className="sr-only">Search contacts to assign</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleLimit(INITIAL_CONTACT_LIMIT);
                }}
                placeholder="Search contacts to assign"
                className="sk-input pl-10"
              />
            </label>
            <p className="text-xs text-muted" aria-live="polite">
              Showing {visibleContacts.length} of {filteredContacts.length} matching contacts
            </p>
          </div>
          {visibleContacts.length ? (
            <ul className="sk-group grid gap-px lg:grid-cols-2">
              {visibleContacts.map((contact) => (
                <AssignmentRow
                  key={contact.id}
                  contact={contact}
                  assignments={assignmentsByContact.get(contact.id) ?? []}
                  members={members}
                  currentMembershipId={currentMembershipId}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">No contacts match that search.</p>
          )}
          {remaining > 0 ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                className="sk-secondary-button"
                onClick={() => setVisibleLimit((current) => current + INITIAL_CONTACT_LIMIT)}
              >
                Show {Math.min(INITIAL_CONTACT_LIMIT, remaining)} more
              </button>
            </div>
          ) : null}
        </>
      ) : <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">No active contacts are available for assignment.</p>}
    </section>
  );
}
