-- Omnix Story 3.2 manual rollback — PRE-WRITE WINDOW ONLY.
--
-- Prefer the pre-migration pg_dump/PITR snapshot. This script removes the
-- rich-contact model and its history, so it fails closed after any observable
-- Story 3.2 write. Run only with ON_ERROR_STOP as the database owner.

begin;

do $$
declare
  expected_point_count bigint;
  actual_point_count bigint;
begin
  if exists (
    select 1 from public.activity_events event
    where event.type::text in (
      'contact-archived', 'contact-restored',
      'contact-point-added', 'contact-point-updated',
      'contact-point-archived', 'contact-point-restored',
      'household-updated', 'relationship-updated', 'assignment-updated',
      'custom-field-updated'
    )
  ) then
    raise exception
      '0007 rollback is restricted to the pre-write window; rich lifecycle evidence exists';
  end if;

  if exists (
    select 1 from public.contacts
    where archived_at is not null or archived_by_membership_id is not null
       or archive_reason is not null
  ) then
    raise exception
      '0007 rollback is restricted to the pre-write window; archived contacts exist';
  end if;

  if exists (select 1 from public.households)
     or exists (select 1 from public.household_memberships)
     or exists (select 1 from public.contact_relationships)
     or exists (select 1 from public.contact_assignments)
     or exists (select 1 from public.contact_custom_field_definitions)
     or exists (select 1 from public.contact_custom_field_values) then
    raise exception
      '0007 rollback is restricted to the pre-write window; rich contact rows exist';
  end if;

  select
    count(*) filter (where phone is not null and length(btrim(phone)) > 0)
    + count(*) filter (
      where secondary_phone is not null and length(btrim(secondary_phone)) > 0
        and (phone is null or length(btrim(phone)) = 0
          or public.normalize_contact_phone(secondary_phone)
             <> public.normalize_contact_phone(phone))
    )
    + count(*) filter (where email is not null and length(btrim(email)) > 0)
    into expected_point_count
  from public.contacts;

  select count(*) into actual_point_count from public.contact_points;
  if actual_point_count <> expected_point_count then
    raise exception
      '0007 rollback is restricted to the pre-write window; contact-point count diverged';
  end if;

  if exists (
    select 1
    from public.contact_points point
    where not exists (
      select 1
      from (
        select md5(contact.id::text || ':phone:primary')::uuid as id
        from public.contacts contact
        where contact.phone is not null and length(btrim(contact.phone)) > 0
        union all
        select md5(contact.id::text || ':phone:secondary')::uuid
        from public.contacts contact
        where contact.secondary_phone is not null
          and length(btrim(contact.secondary_phone)) > 0
          and (contact.phone is null or length(btrim(contact.phone)) = 0
            or public.normalize_contact_phone(contact.secondary_phone)
               <> public.normalize_contact_phone(contact.phone))
        union all
        select md5(contact.id::text || ':email:primary')::uuid
        from public.contacts contact
        where contact.email is not null and length(btrim(contact.email)) > 0
      ) expected
      where expected.id = point.id
    )
  ) then
    raise exception
      '0007 rollback is restricted to the pre-write window; non-backfill contact points exist';
  end if;
end;
$$;

drop view public.active_contacts;

drop trigger contacts_sync_legacy_scalars_after_write on public.contacts;
drop trigger contacts_prepare_archive_write on public.contacts;
drop trigger contacts_reject_hard_delete on public.contacts;
drop trigger contact_points_prepare_write on public.contact_points;
drop trigger contact_points_project_legacy_after_write on public.contact_points;
drop trigger contact_points_reject_hard_delete on public.contact_points;
drop trigger households_prepare_write on public.households;
drop trigger households_reject_hard_delete on public.households;
drop trigger household_memberships_reject_hard_delete on public.household_memberships;
drop trigger contact_relationships_reject_hard_delete on public.contact_relationships;
drop trigger contact_assignments_reject_hard_delete on public.contact_assignments;
drop trigger contact_custom_field_definitions_prepare_write
  on public.contact_custom_field_definitions;
drop trigger contact_custom_field_definitions_reject_hard_delete
  on public.contact_custom_field_definitions;
drop trigger contact_custom_field_values_prepare_write
  on public.contact_custom_field_values;
drop trigger contact_custom_field_values_reject_hard_delete
  on public.contact_custom_field_values;

drop function public.apply_contact_import_group(uuid, uuid, text, text, jsonb, timestamptz);
drop function public.resolve_contact_import_identity(uuid, text, text, text, text);
drop function public.restore_contact(uuid, uuid, timestamptz);
drop function public.archive_contact(uuid, uuid, text, timestamptz);
drop function public.set_contact_custom_field_value(uuid, uuid, jsonb, uuid, timestamptz);
drop function public.archive_contact_custom_field_definition(uuid, uuid, timestamptz);
drop function public.create_contact_custom_field_definition(
  text, public.crm_custom_field_type, text[], integer, uuid, timestamptz
);
drop function public.unassign_contact(uuid, uuid, timestamptz);
drop function public.assign_contact(uuid, uuid, uuid, timestamptz);
drop function public.restore_contact_relationship(uuid, uuid, timestamptz);
drop function public.archive_contact_relationship(uuid, uuid, timestamptz);
drop function public.add_contact_relationship(
  uuid, uuid, public.crm_person_relationship_kind, text, uuid, timestamptz
);
drop function public.remove_household_member(uuid, uuid, uuid, timestamptz);
drop function public.add_household_member(uuid, uuid, uuid, timestamptz);
drop function public.restore_household(uuid, uuid, timestamptz);
drop function public.archive_household(uuid, uuid, timestamptz);
drop function public.update_household(uuid, text, uuid, timestamptz);
drop function public.create_household(text, uuid, timestamptz);
drop function public.restore_contact_point(uuid, uuid, timestamptz);
drop function public.archive_contact_point(uuid, uuid, text, timestamptz);
drop function public.update_contact_point(
  uuid, text, text, text, boolean, boolean, integer, uuid, timestamptz
);
drop function public.add_contact_point(
  uuid, public.crm_contact_point_type, text, text, text, boolean, boolean,
  integer, uuid, timestamptz
);

drop function public.prepare_contact_archive_write();
drop function public.prepare_household_write();
drop function public.prepare_custom_field_definition_write();
drop function public.prepare_custom_field_value_write();
drop function public.sync_contact_legacy_scalars_after_write();
drop function public.sync_one_legacy_contact_point(
  public.contacts, public.crm_contact_point_type, text, text, boolean,
  text, integer, boolean, uuid, timestamptz
);
drop function public.project_contact_point_after_write();
drop function public.project_contact_legacy_scalars(uuid, uuid);
drop function public.prepare_contact_point_write();
drop function public.guard_rich_contact_delete();
drop function public.current_rich_contact_actor(uuid);
drop function public.rich_contact_event_key(text, uuid, timestamptz);

drop table public.contact_custom_field_values;
drop table public.contact_custom_field_definitions;
drop table public.contact_assignments;
drop table public.contact_relationships;
drop table public.household_memberships;
drop table public.households;
drop table public.contact_points;

drop index public.contacts_workspace_active_next_touch_idx;
drop index public.contacts_workspace_archived_idx;
alter table public.contacts
  drop constraint contacts_rich_buyer_criteria_valid,
  drop constraint contacts_rich_seller_criteria_valid,
  drop constraint contacts_archive_state,
  drop constraint contacts_archived_by_workspace_fk,
  drop column archive_reason,
  drop column archived_by_membership_id,
  drop column archived_at,
  no force row level security;

grant delete, truncate, references, trigger on table public.contacts
  to anon, authenticated;

create or replace function public.prepare_task_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_crm_actor_membership(new.creator_membership_id, new.workspace_id);
    if not public.crm_membership_is_active(new.assignee_membership_id, new.workspace_id) then
      raise exception 'active assignee membership is required' using errcode = '42501';
    end if;
    if new.status <> 'open' then
      raise exception 'new tasks must be open' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.creator_membership_id <> old.creator_membership_id
     or new.created_at <> old.created_at then
    raise exception 'task identity is immutable' using errcode = '23514';
  end if;
  if new.assignee_membership_id is distinct from old.assignee_membership_id
     and not public.crm_membership_is_active(new.assignee_membership_id, new.workspace_id) then
    raise exception 'active assignee membership is required' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if old.status = 'archived' then
      raise exception 'archived tasks cannot be reopened' using errcode = '23514';
    elsif old.status = 'open' and new.status not in ('completed', 'archived') then
      raise exception 'invalid task transition' using errcode = '23514';
    elsif old.status = 'completed' and new.status not in ('open', 'archived') then
      raise exception 'invalid task transition' using errcode = '23514';
    end if;
    if new.status = 'completed' then
      if new.completed_by_membership_id is null then
        raise exception 'completion actor membership is required' using errcode = '23514';
      end if;
      perform public.assert_crm_actor_membership(new.completed_by_membership_id, new.workspace_id);
      new.completed_at := coalesce(new.completed_at, now());
      new.archived_at := null;
      new.archived_by_membership_id := null;
    elsif new.status = 'open' then
      new.completed_at := null;
      new.completed_by_membership_id := null;
      new.archived_at := null;
      new.archived_by_membership_id := null;
    elsif new.status = 'archived' then
      if new.archived_by_membership_id is null then
        raise exception 'archive actor membership is required' using errcode = '23514';
      end if;
      perform public.assert_crm_actor_membership(new.archived_by_membership_id, new.workspace_id);
      new.archived_at := coalesce(new.archived_at, now());
    end if;
  elsif new.completed_at is distinct from old.completed_at
     or new.completed_by_membership_id is distinct from old.completed_by_membership_id
     or new.archived_at is distinct from old.archived_at
     or new.archived_by_membership_id is distinct from old.archived_by_membership_id then
    raise exception 'task transition evidence is immutable' using errcode = '23514';
  end if;
  if new.status = old.status or new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.is_valid_buyer_conversion_payload(target jsonb)
returns boolean
language sql
immutable
as $$
  select public.jsonb_object_has_only(target, array[
      'priceMin', 'priceMax', 'areas', 'beds', 'baths', 'timeline',
      'preApproved', 'lender'
    ])
    and (not (target ? 'priceMin') or (jsonb_typeof(target->'priceMin') = 'number'
      and (target->>'priceMin')::numeric >= 0))
    and (not (target ? 'priceMax') or (jsonb_typeof(target->'priceMax') = 'number'
      and (target->>'priceMax')::numeric >= 0))
    and (not (target ? 'beds') or (jsonb_typeof(target->'beds') = 'number'
      and (target->>'beds')::numeric >= 0))
    and (not (target ? 'baths') or (jsonb_typeof(target->'baths') = 'number'
      and (target->>'baths')::numeric >= 0))
    and (not (target ? 'areas') or (public.jsonb_is_string_array(target->'areas', true)
      and jsonb_array_length(target->'areas') <= 50))
    and (not (target ? 'timeline') or (jsonb_typeof(target->'timeline') = 'string'
      and length(trim(target->>'timeline')) between 1 and 500
      and (target->>'timeline') !~ '[[:cntrl:]]'))
    and (not (target ? 'preApproved') or jsonb_typeof(target->'preApproved') = 'boolean')
    and (not (target ? 'lender') or (jsonb_typeof(target->'lender') = 'string'
      and length(trim(target->>'lender')) between 1 and 300
      and (target->>'lender') !~ '[[:cntrl:]]'));
$$;

create or replace function public.is_valid_seller_conversion_payload(target jsonb)
returns boolean
language sql
immutable
as $$
  select public.jsonb_object_has_only(target, array[
      'propertyAddress', 'targetPrice', 'timeline', 'motivation'
    ])
    and (not (target ? 'propertyAddress') or (
      jsonb_typeof(target->'propertyAddress') = 'string'
      and length(trim(target->>'propertyAddress')) between 1 and 300
      and (target->>'propertyAddress') !~ '[[:cntrl:]]'))
    and (not (target ? 'targetPrice') or (
      jsonb_typeof(target->'targetPrice') = 'number'
      and (target->>'targetPrice')::numeric >= 0))
    and (not (target ? 'timeline') or (
      jsonb_typeof(target->'timeline') = 'string'
      and length(trim(target->>'timeline')) between 1 and 500
      and (target->>'timeline') !~ '[[:cntrl:]]'))
    and (not (target ? 'motivation') or (
      jsonb_typeof(target->'motivation') = 'string'
      and length(trim(target->>'motivation')) between 1 and 2000
      and (target->>'motivation') !~ '[[:cntrl:]]'));
$$;

drop function public.is_valid_rich_buyer_criteria(jsonb);
drop function public.is_valid_rich_seller_criteria(jsonb);
drop function public.is_valid_contact_phone(text);
drop function public.is_valid_contact_email(text);
drop function public.normalize_contact_phone(text);
drop function public.normalize_contact_email(text);

drop function public.append_rich_contact_activity_event(
  uuid, text, uuid, timestamptz, text, uuid, uuid, uuid
);
alter table public.activity_events drop constraint activity_events_target_shape;
alter table public.activity_events
  alter column type type public.crm_activity_event_type
  using type::text::public.crm_activity_event_type;
alter table public.activity_events
  add constraint activity_events_target_shape check (
    (type in ('contact-created', 'contact-updated', 'contact-imported',
      'note-added', 'touch-recorded') and contact_id is not null
      and task_id is null and incomplete_record_id is null)
    or
    (type = 'incomplete-record-converted' and contact_id is not null
      and task_id is null and incomplete_record_id is not null)
    or
    (type in ('task-created', 'task-completed', 'task-archived')
      and task_id is not null and incomplete_record_id is null)
  );

create or replace function public.append_activity_event(
  target_workspace_id uuid,
  target_type public.crm_activity_event_type,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz,
  target_idempotency_key text,
  target_contact_id uuid default null,
  target_task_id uuid default null,
  target_incomplete_record_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_event public.activity_events;
  inserted_event public.activity_events;
begin
  if target_workspace_id is null or target_type is null
     or target_actor_membership_id is null or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'activity event command is incomplete' using errcode = '23514';
  end if;
  if not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(target_actor_membership_id, target_workspace_id);
  insert into public.activity_events (
    workspace_id, type, contact_id, task_id, incomplete_record_id,
    actor_membership_id, occurred_at, idempotency_key
  ) values (
    target_workspace_id, target_type, target_contact_id, target_task_id,
    target_incomplete_record_id, target_actor_membership_id,
    target_occurred_at, target_idempotency_key
  ) on conflict (workspace_id, idempotency_key) do nothing
  returning * into inserted_event;
  if inserted_event.id is not null then
    return jsonb_build_object('event', to_jsonb(inserted_event), 'noOp', false);
  end if;
  select event.* into strict existing_event
  from public.activity_events event
  where event.workspace_id = target_workspace_id
    and event.idempotency_key = target_idempotency_key
  for update;
  if existing_event.type <> target_type
     or existing_event.actor_membership_id <> target_actor_membership_id
     or existing_event.occurred_at <> target_occurred_at
     or existing_event.contact_id is distinct from target_contact_id
     or existing_event.task_id is distinct from target_task_id
     or existing_event.incomplete_record_id is distinct from target_incomplete_record_id then
    raise exception 'activity idempotency key conflicts with another payload'
      using errcode = '23505';
  end if;
  return jsonb_build_object('event', to_jsonb(existing_event), 'noOp', true);
end;
$$;

drop type public.crm_activity_event_type_v2;
drop type public.crm_custom_field_type;
drop type public.crm_person_relationship_kind;
drop type public.crm_contact_point_type;

commit;
