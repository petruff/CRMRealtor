-- Client request (Sept 2026): notes can be corrected after they are saved.
--
-- This supersedes the append-only rule from 0001/0025 without weakening it:
-- * identity stays immutable (id, contact, workspace, owner, created_at);
-- * the only path that changes a body is edit_contact_note(), which first
--   preserves the replaced text in note_revisions (append-only) and then bumps
--   notes.revision, so every earlier version remains auditable;
-- * authenticated clients still have no UPDATE privilege on notes;
-- * archived notes and notes of archived contacts stay read only;
-- * concurrent edits are rejected through an expected-revision check.
-- Additive only: existing notes keep revision 1 and no edit metadata.
begin;

alter table public.notes
  add column revision integer not null default 1,
  add column updated_at timestamptz,
  add column edited_by_membership_id uuid,
  add constraint notes_revision_positive check (revision >= 1),
  add constraint notes_edit_actor_fk foreign key (edited_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  add constraint notes_edit_state check (
    (revision = 1 and updated_at is null and edited_by_membership_id is null)
    or (revision > 1 and updated_at is not null and edited_by_membership_id is not null)
  );

create table public.note_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  contact_id uuid not null,
  -- The revision number the preserved body had while it was current.
  revision integer not null check (revision >= 1),
  body text not null check (length(trim(body)) > 0),
  replaced_by_membership_id uuid not null,
  replaced_at timestamptz not null,
  correlation_id uuid not null,
  constraint note_revisions_actor_fk foreign key (replaced_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint note_revisions_contact_fk foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete cascade,
  unique (note_id, revision),
  unique (workspace_id, correlation_id)
);
create index note_revisions_note_idx on public.note_revisions(note_id, revision desc);
alter table public.note_revisions enable row level security;
alter table public.note_revisions force row level security;
revoke all on public.note_revisions from public, anon, authenticated;
grant select on public.note_revisions to authenticated;
create policy note_revisions_member_read on public.note_revisions
for select to authenticated using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = note_revisions.workspace_id
    and member.user_id = auth.uid() and member.status = 'active'
));
-- Revisions are evidence: they may be inserted by the edit RPC but never rewritten.
create trigger note_revisions_append_only
before update on public.note_revisions
for each row execute function public.guard_connector_append_only();

create or replace function public.notes_immutable_content_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.contact_id <> old.contact_id or new.workspace_id <> old.workspace_id
    or new.owner_id <> old.owner_id or new.created_at <> old.created_at then
    raise exception 'note content is immutable' using errcode = '23514';
  end if;
  if new.body <> old.body or new.revision <> old.revision then
    if old.archived_at is not null or new.archived_at is not null
      or new.revision <> old.revision + 1
      or new.updated_at is null or new.edited_by_membership_id is null
      or not exists (
        select 1 from public.note_revisions preserved
        where preserved.note_id = old.id and preserved.revision = old.revision
          and preserved.body = old.body
      ) then
      raise exception 'note content is immutable' using errcode = '23514';
    end if;
  elsif new.updated_at is distinct from old.updated_at
    or new.edited_by_membership_id is distinct from old.edited_by_membership_id then
    raise exception 'note content is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.edit_contact_note(
  target_note_id uuid, target_expected_revision integer, target_body text,
  target_correlation_id uuid, target_occurred_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.workspace_members%rowtype;
  target public.notes%rowtype;
  replay public.note_revisions%rowtype;
  contact_archived_at timestamptz;
  next_body text := btrim(coalesce(target_body, ''), E' \t\r\n');
begin
  select * into target from public.notes where id = target_note_id for update;
  if not found then raise exception 'note not found' using errcode = 'P0002'; end if;
  member := public.connector_current_membership(target.workspace_id, false);
  select * into replay from public.note_revisions
    where workspace_id = target.workspace_id and correlation_id = target_correlation_id;
  if found then
    if replay.note_id <> target.id then
      raise exception 'divergent note edit replay' using errcode = '23505';
    end if;
    return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id, 'body', target.body,
      'createdAt', target.created_at, 'revision', target.revision, 'updatedAt', target.updated_at,
      'editedByMembershipId', target.edited_by_membership_id, 'noOp', true);
  end if;
  select archived_at into contact_archived_at from public.contacts
    where id = target.contact_id and workspace_id = target.workspace_id;
  if contact_archived_at is not null or target.archived_at is not null then
    raise exception 'archived notes and contacts are read only' using errcode = '55000';
  end if;
  if length(next_body) = 0 then
    raise exception 'note body is required' using errcode = '22023';
  end if;
  if target_expected_revision is null or target_expected_revision <> target.revision then
    raise exception 'note revision conflict' using errcode = '40001';
  end if;
  if next_body = target.body then
    return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id, 'body', target.body,
      'createdAt', target.created_at, 'revision', target.revision, 'updatedAt', target.updated_at,
      'editedByMembershipId', target.edited_by_membership_id, 'noOp', true);
  end if;
  insert into public.note_revisions(workspace_id, note_id, contact_id, revision, body,
    replaced_by_membership_id, replaced_at, correlation_id)
  values (target.workspace_id, target.id, target.contact_id, target.revision, target.body,
    member.id, target_occurred_at, target_correlation_id);
  update public.notes set body = next_body, revision = target.revision + 1,
    updated_at = target_occurred_at, edited_by_membership_id = member.id
    where id = target.id returning * into target;
  return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id, 'body', target.body,
    'createdAt', target.created_at, 'revision', target.revision, 'updatedAt', target.updated_at,
    'editedByMembershipId', target.edited_by_membership_id, 'noOp', false);
end; $$;

revoke all on function public.edit_contact_note(uuid,integer,text,uuid,timestamptz) from public, anon;
grant execute on function public.edit_contact_note(uuid,integer,text,uuid,timestamptz) to authenticated;

commit;
