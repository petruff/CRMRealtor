-- Story 3.2: canonical rich-contact lifecycle.
--
-- Forward-only migration. `contact_points` becomes the canonical phone/email
-- authority while the legacy scalar columns on `contacts` remain synchronous
-- compatibility projections. No independent rating axis is introduced:
-- `lead_type` (Hot/Warm/Nurture) remains the sole prioritization authority.
--
-- ROLLBACK: ../rollbacks/0007_rich_contact_lifecycle.rollback.sql is allowed
-- only in the verified pre-write window. After rich-contact writes, use PITR
-- or an approved forward correction so contact history is not discarded.

begin;

create type public.crm_activity_event_type_v2 as enum (
  'contact-created', 'contact-updated', 'contact-imported',
  'note-added', 'touch-recorded', 'incomplete-record-converted',
  'task-created', 'task-completed', 'task-archived',
  'contact-archived', 'contact-restored',
  'contact-point-added', 'contact-point-updated',
  'contact-point-archived', 'contact-point-restored',
  'household-updated', 'relationship-updated', 'assignment-updated',
  'custom-field-updated'
);

alter table public.activity_events
  drop constraint activity_events_target_shape;

alter table public.activity_events
  alter column type type public.crm_activity_event_type_v2
  using type::text::public.crm_activity_event_type_v2;

alter table public.activity_events
  add constraint activity_events_target_shape check (
    (type in (
      'contact-created', 'contact-updated', 'contact-imported',
      'note-added', 'touch-recorded', 'contact-archived', 'contact-restored',
      'contact-point-added', 'contact-point-updated',
      'contact-point-archived', 'contact-point-restored',
      'relationship-updated', 'assignment-updated'
    ) and contact_id is not null
      and task_id is null and incomplete_record_id is null)
    or
    (type in ('household-updated', 'custom-field-updated')
      and task_id is null and incomplete_record_id is null)
    or
    (type = 'incomplete-record-converted' and contact_id is not null
      and task_id is null and incomplete_record_id is not null)
    or
    (type in ('task-created', 'task-completed', 'task-archived')
      and task_id is not null and incomplete_record_id is null)
  );

-- Keep the Story 3.1 RPC signature stable while the persisted event enum
-- evolves. Existing callers still pass crm_activity_event_type; rich-contact
-- writers use the text-validated v2 helper below.
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
set search_path = ''
as $$
declare
  existing_event public.activity_events%rowtype;
  inserted_event public.activity_events%rowtype;
begin
  if target_workspace_id is null or target_type is null
     or target_actor_membership_id is null or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'activity event command is incomplete' using errcode = '23514';
  end if;
  if not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(
    target_actor_membership_id, target_workspace_id
  );
  insert into public.activity_events (
    workspace_id, type, contact_id, task_id, incomplete_record_id,
    actor_membership_id, occurred_at, idempotency_key
  ) values (
    target_workspace_id, target_type::text::public.crm_activity_event_type_v2,
    target_contact_id, target_task_id, target_incomplete_record_id,
    target_actor_membership_id, target_occurred_at, target_idempotency_key
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
  if existing_event.type::text <> target_type::text
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

create or replace function public.append_rich_contact_activity_event(
  target_workspace_id uuid,
  target_type text,
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
set search_path = ''
as $$
declare
  parsed_type public.crm_activity_event_type_v2;
  existing_event public.activity_events%rowtype;
  inserted_event public.activity_events%rowtype;
begin
  if target_workspace_id is null or target_type is null
     or target_actor_membership_id is null or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'rich-contact activity command is incomplete'
      using errcode = '23514';
  end if;
  parsed_type := target_type::public.crm_activity_event_type_v2;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_workspace_id, false
  );
  insert into public.activity_events (
    workspace_id, type, contact_id, task_id, incomplete_record_id,
    actor_membership_id, occurred_at, idempotency_key
  ) values (
    target_workspace_id, parsed_type, target_contact_id, target_task_id,
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
  if existing_event.type <> parsed_type
     or existing_event.actor_membership_id <> target_actor_membership_id
     or existing_event.occurred_at <> target_occurred_at
     or existing_event.contact_id is distinct from target_contact_id
     or existing_event.task_id is distinct from target_task_id
     or existing_event.incomplete_record_id is distinct from target_incomplete_record_id then
    raise exception 'activity idempotency key conflicts with another payload'
      using errcode = '23505';
  end if;
  return jsonb_build_object('event', to_jsonb(existing_event), 'noOp', true);
exception when invalid_text_representation then
  raise exception 'rich-contact activity type is not allowlisted' using errcode = '23514';
end;
$$;

revoke all on function public.append_rich_contact_activity_event(
  uuid, text, uuid, timestamptz, text, uuid, uuid, uuid
) from public;

-- Bounded domain types -----------------------------------------------------

create type public.crm_contact_point_type as enum ('phone', 'email');
create type public.crm_person_relationship_kind as enum (
  'spouse', 'partner', 'household-member', 'other'
);
create type public.crm_custom_field_type as enum (
  'text', 'number', 'date', 'boolean', 'single-select'
);

-- Canonical normalization and richer-fact validation ----------------------

create or replace function public.normalize_contact_phone(target_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  normalized text := regexp_replace(target_value, '[^0-9]', '', 'g');
begin
  if length(normalized) = 11 and left(normalized, 1) = '1' then
    normalized := substr(normalized, 2);
  end if;
  return normalized;
end;
$$;

create or replace function public.normalize_contact_email(target_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(btrim(target_value));
$$;

create or replace function public.is_valid_contact_phone(target_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select target_value is not null
    and length(btrim(target_value)) between 1 and 40
    and btrim(target_value) !~ '[[:cntrl:]]'
    and length(public.normalize_contact_phone(target_value)) between 7 and 15;
$$;

create or replace function public.is_valid_contact_email(target_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select target_value is not null
    and length(btrim(target_value)) between 1 and 254
    and btrim(target_value) !~ '[[:cntrl:]]'
    and public.normalize_contact_email(target_value)
      ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
$$;

create or replace function public.is_valid_rich_buyer_criteria(target jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  value jsonb;
begin
  if target is null then return true; end if;
  if jsonb_typeof(target) <> 'object' then return false; end if;

  if target ? 'mortgageType' then
    value := target->'mortgageType';
    if jsonb_typeof(value) <> 'string'
       or target->>'mortgageType' not in ('conventional', 'fha', 'va', 'cash', 'unknown') then
      return false;
    end if;
  end if;

  if target ? 'desiredPropertyType' then
    value := target->'desiredPropertyType';
    if jsonb_typeof(value) <> 'string'
       or length(btrim(target->>'desiredPropertyType')) not between 1 and 80
       or target->>'desiredPropertyType' ~ '[[:cntrl:]]' then
      return false;
    end if;
  end if;

  if target ? 'currentTenure' then
    value := target->'currentTenure';
    if jsonb_typeof(value) <> 'string'
       or target->>'currentTenure' not in ('owns', 'rents', 'unknown') then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.is_valid_rich_seller_criteria(target jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_name text;
  value jsonb;
begin
  if target is null then return true; end if;
  if jsonb_typeof(target) <> 'object' then return false; end if;

  if target ? 'hasPropertyToSell' then
    value := target->'hasPropertyToSell';
    if jsonb_typeof(value) <> 'string'
       or target->>'hasPropertyToSell' not in ('yes', 'no', 'maybe', 'unknown') then
      return false;
    end if;
  end if;

  foreach field_name in array array[
    'propertyType', 'basement', 'parking', 'condition', 'listingStatus'
  ] loop
    if target ? field_name then
      value := target->field_name;
      if jsonb_typeof(value) <> 'string'
         or length(btrim(target->>field_name)) not between 1 and 80
         or target->>field_name ~ '[[:cntrl:]]' then
        return false;
      end if;
    end if;
  end loop;

  foreach field_name in array array['bedrooms', 'bathrooms'] loop
    if target ? field_name then
      value := target->field_name;
      if jsonb_typeof(value) <> 'number'
         or (target->>field_name)::numeric < 0
         or abs((target->>field_name)::numeric) > 1000 then
        return false;
      end if;
    end if;
  end loop;

  return true;
exception when numeric_value_out_of_range or invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.normalize_contact_phone(text) from public;
revoke all on function public.normalize_contact_email(text) from public;
revoke all on function public.is_valid_contact_phone(text) from public;
revoke all on function public.is_valid_contact_email(text) from public;
revoke all on function public.is_valid_rich_buyer_criteria(jsonb) from public;
revoke all on function public.is_valid_rich_seller_criteria(jsonb) from public;

grant execute on function public.normalize_contact_phone(text) to authenticated, service_role;
grant execute on function public.normalize_contact_email(text) to authenticated, service_role;

-- Count-only preflight. Never include scalar values in errors or notices.
do $$
declare
  invalid_phone_count bigint;
  invalid_secondary_phone_count bigint;
  invalid_email_count bigint;
begin
  select count(*) into invalid_phone_count
  from public.contacts
  where phone is not null and length(btrim(phone)) > 0
    and not public.is_valid_contact_phone(phone);

  select count(*) into invalid_secondary_phone_count
  from public.contacts
  where secondary_phone is not null and length(btrim(secondary_phone)) > 0
    and not public.is_valid_contact_phone(secondary_phone);

  select count(*) into invalid_email_count
  from public.contacts
  where email is not null and length(btrim(email)) > 0
    and not public.is_valid_contact_email(email);

  if invalid_phone_count + invalid_secondary_phone_count + invalid_email_count > 0 then
    raise exception
      'contact-point preflight failed: invalid primary phones=%, secondary phones=%, emails=%',
      invalid_phone_count, invalid_secondary_phone_count, invalid_email_count
      using errcode = '23514';
  end if;
end;
$$;

-- Contact archive lifecycle and richer criteria stay on the canonical row. --

alter table public.contacts
  add column archived_at timestamptz,
  add column archived_by_membership_id uuid,
  add column archive_reason text,
  add constraint contacts_archived_by_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  add constraint contacts_archive_state check (
    (archived_at is null and archived_by_membership_id is null and archive_reason is null)
    or (
      archived_at is not null
      and archived_by_membership_id is not null
      and length(btrim(archive_reason)) between 1 and 500
      and archive_reason !~ '[[:cntrl:]]'
    )
  ),
  add constraint contacts_rich_buyer_criteria_valid
    check (public.is_valid_rich_buyer_criteria(buyer_criteria)),
  add constraint contacts_rich_seller_criteria_valid
    check (public.is_valid_rich_seller_criteria(seller_criteria));

create index contacts_workspace_active_next_touch_idx
  on public.contacts (workspace_id, next_touch_at, created_at)
  where archived_at is null and pipeline_stage not in ('closed', 'lost');

create index contacts_workspace_archived_idx
  on public.contacts (workspace_id, archived_at desc, id)
  where archived_at is not null;

-- Canonical contact points -------------------------------------------------

create table public.contact_points (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  contact_id                 uuid not null,
  type                       public.crm_contact_point_type not null,
  label                      text not null,
  display_value              text not null,
  normalized_value           text not null,
  is_primary                 boolean not null default false,
  email_subscribed           boolean,
  display_order              integer not null default 0,
  created_by_membership_id   uuid not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  archived_at                timestamptz,
  archived_by_membership_id  uuid,
  archive_reason             text,

  constraint contact_points_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint contact_points_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete restrict,
  constraint contact_points_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_points_archiver_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_points_id_workspace_unique unique (id, workspace_id),
  constraint contact_points_label_valid check (
    length(btrim(label)) between 1 and 80 and label !~ '[[:cntrl:]]'
  ),
  constraint contact_points_display_value_valid check (
    (type = 'phone' and public.is_valid_contact_phone(display_value))
    or (type = 'email' and public.is_valid_contact_email(display_value))
  ),
  constraint contact_points_normalized_value_valid check (
    (type = 'phone'
      and normalized_value = public.normalize_contact_phone(display_value))
    or (type = 'email'
      and normalized_value = public.normalize_contact_email(display_value))
  ),
  constraint contact_points_email_subscription_scope check (
    type = 'email' or email_subscribed is null
  ),
  constraint contact_points_display_order_valid check (display_order between 0 and 99),
  constraint contact_points_archive_state check (
    (archived_at is null and archived_by_membership_id is null and archive_reason is null)
    or (
      archived_at is not null and archived_by_membership_id is not null
      and length(btrim(archive_reason)) between 1 and 500
      and archive_reason !~ '[[:cntrl:]]'
    )
  )
);

create unique index contact_points_active_value_unique_idx
  on public.contact_points (workspace_id, contact_id, type, normalized_value)
  where archived_at is null;

create unique index contact_points_active_primary_unique_idx
  on public.contact_points (workspace_id, contact_id, type)
  where archived_at is null and is_primary;

create index contact_points_workspace_contact_order_idx
  on public.contact_points (
    workspace_id, contact_id, type, is_primary desc, display_order, created_at, id
  );

create index contact_points_workspace_normalized_idx
  on public.contact_points (workspace_id, type, normalized_value, contact_id)
  where archived_at is null;

-- Household membership groups --------------------------------------------

create table public.households (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  name                       text not null,
  created_by_membership_id   uuid not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  archived_at                timestamptz,
  archived_by_membership_id  uuid,

  constraint households_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint households_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint households_archiver_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint households_id_workspace_unique unique (id, workspace_id),
  constraint households_name_valid check (
    length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint households_archive_state check (
    (archived_at is null and archived_by_membership_id is null)
    or (archived_at is not null and archived_by_membership_id is not null)
  )
);

create index households_workspace_active_name_idx
  on public.households (workspace_id, lower(name), created_at, id)
  where archived_at is null;

create table public.household_memberships (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  household_id               uuid not null,
  contact_id                 uuid not null,
  created_by_membership_id   uuid not null,
  created_at                 timestamptz not null default now(),
  ended_at                   timestamptz,
  ended_by_membership_id     uuid,

  constraint household_memberships_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint household_memberships_household_workspace_fk
    foreign key (household_id, workspace_id)
    references public.households (id, workspace_id) on delete restrict,
  constraint household_memberships_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete restrict,
  constraint household_memberships_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint household_memberships_ender_workspace_fk
    foreign key (ended_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint household_memberships_id_workspace_unique unique (id, workspace_id),
  constraint household_memberships_end_state check (
    (ended_at is null and ended_by_membership_id is null)
    or (ended_at is not null and ended_by_membership_id is not null)
  )
);

create unique index household_memberships_active_unique_idx
  on public.household_memberships (workspace_id, household_id, contact_id)
  where ended_at is null;

create index household_memberships_workspace_contact_idx
  on public.household_memberships (workspace_id, contact_id, created_at, id);

create index household_memberships_workspace_household_idx
  on public.household_memberships (workspace_id, household_id, created_at, id);

-- Canonical unordered person relationships --------------------------------

create table public.contact_relationships (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  first_contact_id           uuid not null,
  second_contact_id          uuid not null,
  kind                       public.crm_person_relationship_kind not null,
  label                      text,
  created_by_membership_id   uuid not null,
  created_at                 timestamptz not null default now(),
  archived_at                timestamptz,
  archived_by_membership_id  uuid,

  constraint contact_relationships_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint contact_relationships_first_contact_workspace_fk
    foreign key (first_contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete restrict,
  constraint contact_relationships_second_contact_workspace_fk
    foreign key (second_contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete restrict,
  constraint contact_relationships_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_relationships_archiver_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_relationships_id_workspace_unique unique (id, workspace_id),
  constraint contact_relationships_canonical_pair check (
    first_contact_id < second_contact_id
  ),
  constraint contact_relationships_label_valid check (
    (kind = 'other' and label is not null
      and length(btrim(label)) between 1 and 80 and label !~ '[[:cntrl:]]')
    or (kind <> 'other' and label is null)
  ),
  constraint contact_relationships_archive_state check (
    (archived_at is null and archived_by_membership_id is null)
    or (archived_at is not null and archived_by_membership_id is not null)
  )
);

create unique index contact_relationships_active_pair_unique_idx
  on public.contact_relationships (workspace_id, first_contact_id, second_contact_id)
  where archived_at is null;

create index contact_relationships_workspace_first_idx
  on public.contact_relationships (workspace_id, first_contact_id, created_at, id);

create index contact_relationships_workspace_second_idx
  on public.contact_relationships (workspace_id, second_contact_id, created_at, id);

-- Durable assignment history ----------------------------------------------

create table public.contact_assignments (
  id                           uuid primary key default gen_random_uuid(),
  workspace_id                 uuid not null,
  contact_id                   uuid not null,
  assignee_membership_id       uuid not null,
  assigned_at                  timestamptz not null,
  assigned_by_membership_id    uuid not null,
  unassigned_at                timestamptz,
  unassigned_by_membership_id  uuid,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint contact_assignments_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint contact_assignments_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete restrict,
  constraint contact_assignments_assignee_workspace_fk
    foreign key (assignee_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_assignments_assigner_workspace_fk
    foreign key (assigned_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_assignments_unassigner_workspace_fk
    foreign key (unassigned_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_assignments_id_workspace_unique unique (id, workspace_id),
  constraint contact_assignments_unassignment_state check (
    (unassigned_at is null and unassigned_by_membership_id is null)
    or (
      unassigned_at is not null and unassigned_by_membership_id is not null
      and unassigned_at >= assigned_at
    )
  )
);

create unique index contact_assignments_active_unique_idx
  on public.contact_assignments (workspace_id, contact_id, assignee_membership_id)
  where unassigned_at is null;

create index contact_assignments_workspace_contact_idx
  on public.contact_assignments (workspace_id, contact_id, assigned_at desc, id);

create index contact_assignments_workspace_assignee_idx
  on public.contact_assignments (
    workspace_id, assignee_membership_id, unassigned_at, assigned_at desc, id
  );

-- Typed, bounded custom fields --------------------------------------------

create table public.contact_custom_field_definitions (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  name                       text not null,
  type                       public.crm_custom_field_type not null,
  options                    text[] not null default '{}',
  validation                 jsonb not null default '{}'::jsonb,
  display_order              integer not null default 0,
  created_by_membership_id   uuid not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  archived_at                timestamptz,
  archived_by_membership_id  uuid,

  constraint contact_custom_field_definitions_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint contact_custom_field_definitions_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_custom_field_definitions_archiver_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_custom_field_definitions_id_workspace_unique
    unique (id, workspace_id),
  constraint contact_custom_field_definitions_name_valid check (
    length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint contact_custom_field_definitions_options_valid check (
    (type = 'single-select' and cardinality(options) between 1 and 50)
    or (type <> 'single-select' and cardinality(options) = 0)
  ),
  constraint contact_custom_field_definitions_validation_object check (
    jsonb_typeof(validation) = 'object'
  ),
  constraint contact_custom_field_definitions_display_order_valid check (
    display_order between 0 and 999
  ),
  constraint contact_custom_field_definitions_archive_state check (
    (archived_at is null and archived_by_membership_id is null)
    or (archived_at is not null and archived_by_membership_id is not null)
  )
);

create unique index contact_custom_field_definitions_active_name_unique_idx
  on public.contact_custom_field_definitions (workspace_id, lower(name))
  where archived_at is null;

create index contact_custom_field_definitions_workspace_order_idx
  on public.contact_custom_field_definitions (
    workspace_id, archived_at, display_order, lower(name), id
  );

create table public.contact_custom_field_values (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  contact_id                 uuid not null,
  definition_id              uuid not null,
  text_value                 text,
  number_value               numeric,
  date_value                 date,
  boolean_value              boolean,
  selected_value             text,
  updated_at                 timestamptz not null,
  updated_by_membership_id   uuid not null,
  created_at                 timestamptz not null default now(),

  constraint contact_custom_field_values_workspace_fk
    foreign key (workspace_id) references public.workspaces (id) on delete restrict,
  constraint contact_custom_field_values_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete restrict,
  constraint contact_custom_field_values_definition_workspace_fk
    foreign key (definition_id, workspace_id)
    references public.contact_custom_field_definitions (id, workspace_id)
    on delete restrict,
  constraint contact_custom_field_values_updater_workspace_fk
    foreign key (updated_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint contact_custom_field_values_contact_definition_unique
    unique (workspace_id, contact_id, definition_id),
  constraint contact_custom_field_values_exactly_one_value check (
    num_nonnulls(
      text_value, number_value, date_value, boolean_value, selected_value
    ) = 1
  ),
  constraint contact_custom_field_values_text_bound check (
    text_value is null or (
      length(btrim(text_value)) between 1 and 2000
      and text_value !~ '[[:cntrl:]]'
    )
  ),
  constraint contact_custom_field_values_number_bound check (
    number_value is null or abs(number_value) <= 1000000000
  ),
  constraint contact_custom_field_values_selected_bound check (
    selected_value is null or (
      length(btrim(selected_value)) between 1 and 120
      and selected_value !~ '[[:cntrl:]]'
    )
  )
);

create index contact_custom_field_values_workspace_contact_idx
  on public.contact_custom_field_values (workspace_id, contact_id, definition_id);

create index contact_custom_field_values_workspace_definition_idx
  on public.contact_custom_field_values (workspace_id, definition_id, contact_id);

-- Deterministic legacy scalar backfill ------------------------------------

insert into public.contact_points (
  id, workspace_id, contact_id, type, label, display_value,
  normalized_value, is_primary, email_subscribed, display_order,
  created_by_membership_id, created_at, updated_at
)
select
  md5(contact.id::text || ':phone:primary')::uuid,
  contact.workspace_id,
  contact.id,
  'phone'::public.crm_contact_point_type,
  'primary',
  btrim(contact.phone),
  public.normalize_contact_phone(contact.phone),
  true,
  null,
  0,
  owner_membership.id,
  contact.created_at,
  contact.updated_at
from public.contacts contact
join public.workspace_members owner_membership
  on owner_membership.workspace_id = contact.workspace_id
 and owner_membership.role = 'owner'
 and owner_membership.status = 'active'
where contact.phone is not null and length(btrim(contact.phone)) > 0;

insert into public.contact_points (
  id, workspace_id, contact_id, type, label, display_value,
  normalized_value, is_primary, email_subscribed, display_order,
  created_by_membership_id, created_at, updated_at
)
select
  md5(contact.id::text || ':phone:secondary')::uuid,
  contact.workspace_id,
  contact.id,
  'phone'::public.crm_contact_point_type,
  'secondary',
  btrim(contact.secondary_phone),
  public.normalize_contact_phone(contact.secondary_phone),
  false,
  null,
  1,
  owner_membership.id,
  contact.created_at,
  contact.updated_at
from public.contacts contact
join public.workspace_members owner_membership
  on owner_membership.workspace_id = contact.workspace_id
 and owner_membership.role = 'owner'
 and owner_membership.status = 'active'
where contact.secondary_phone is not null
  and length(btrim(contact.secondary_phone)) > 0
  and (
    contact.phone is null or length(btrim(contact.phone)) = 0
    or public.normalize_contact_phone(contact.secondary_phone)
       <> public.normalize_contact_phone(contact.phone)
  );

insert into public.contact_points (
  id, workspace_id, contact_id, type, label, display_value,
  normalized_value, is_primary, email_subscribed, display_order,
  created_by_membership_id, created_at, updated_at
)
select
  md5(contact.id::text || ':email:primary')::uuid,
  contact.workspace_id,
  contact.id,
  'email'::public.crm_contact_point_type,
  'primary',
  btrim(contact.email),
  public.normalize_contact_email(contact.email),
  true,
  contact.email_subscribed,
  0,
  owner_membership.id,
  contact.created_at,
  contact.updated_at
from public.contacts contact
join public.workspace_members owner_membership
  on owner_membership.workspace_id = contact.workspace_id
 and owner_membership.role = 'owner'
 and owner_membership.status = 'active'
where contact.email is not null and length(btrim(contact.email)) > 0;

-- Shared guards and deterministic event identities ------------------------

create or replace function public.rich_contact_event_key(
  target_action text,
  target_entity_id uuid,
  target_occurred_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'rich:' || target_action || ':' || target_entity_id::text || ':' ||
    substr(encode(extensions.digest(
      convert_to(target_occurred_at::text, 'UTF8'), 'sha256'
    ), 'hex'), 1, 24);
$$;

create or replace function public.assert_rich_contact_actor(
  target_membership_id uuid,
  target_workspace_id uuid,
  require_owner boolean default false
)
returns public.workspace_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  caller_id uuid := auth.uid();
begin
  select membership.* into actor
  from public.workspace_members membership
  where membership.id = target_membership_id
    and membership.workspace_id = target_workspace_id
    and membership.status = 'active';

  if not found
     or (caller_id is not null and actor.user_id <> caller_id)
     or (require_owner and actor.role <> 'owner') then
    raise exception 'active rich-contact actor authority is required'
      using errcode = '42501';
  end if;

  return actor;
end;
$$;

create or replace function public.current_rich_contact_actor(
  target_workspace_id uuid
)
returns public.workspace_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  caller_id uuid := auth.uid();
  caller_role text := current_setting('role', true);
begin
  -- A transaction-scoped JWT GUC can outlive RESET ROLE in maintenance and
  -- migration sessions. Treat it as end-user authority only while the caller
  -- is actually operating as `authenticated`; privileged server-side writes
  -- resolve the workspace's single active owner as compatibility evidence.
  if caller_id is not null and caller_role = 'authenticated' then
    select membership.* into actor
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = caller_id
      and membership.status = 'active';
  else
    -- Compatibility path for existing server-side import/intake functions.
    select membership.* into actor
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.role = 'owner'
      and membership.status = 'active';
  end if;

  if not found then
    raise exception 'active rich-contact actor authority is required'
      using errcode = '42501';
  end if;
  return actor;
end;
$$;

create or replace function public.guard_rich_contact_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows use archive/history lifecycle and cannot be deleted', tg_table_name
    using errcode = '23514';
end;
$$;

revoke all on function public.rich_contact_event_key(text, uuid, timestamptz) from public;
revoke all on function public.assert_rich_contact_actor(uuid, uuid, boolean) from public;
revoke all on function public.current_rich_contact_actor(uuid) from public;
revoke all on function public.guard_rich_contact_delete() from public;

-- Contact-point invariants and bidirectional compatibility projection ------

create or replace function public.prepare_contact_point_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
  active_limit integer;
  target_contact_archived_at timestamptz;
begin
  if tg_op = 'INSERT' then
    perform public.assert_rich_contact_actor(
      new.created_by_membership_id, new.workspace_id, false
    );
  elsif new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.contact_id <> old.contact_id
     or new.type <> old.type
     or new.created_by_membership_id <> old.created_by_membership_id
     or new.created_at <> old.created_at then
    raise exception 'contact-point identity is immutable' using errcode = '23514';
  end if;

  new.label := btrim(new.label);
  new.display_value := btrim(new.display_value);
  new.normalized_value := case
    when new.type = 'phone' then public.normalize_contact_phone(new.display_value)
    else public.normalize_contact_email(new.display_value)
  end;

  if new.type = 'phone' then new.email_subscribed := null; end if;

  if new.archived_at is null then
    new.archived_by_membership_id := null;
    new.archive_reason := null;
  elsif new.archived_by_membership_id is null or new.archive_reason is null then
    raise exception 'contact-point archive actor and reason are required'
      using errcode = '23514';
  else
    perform public.assert_rich_contact_actor(
      new.archived_by_membership_id, new.workspace_id, false
    );
  end if;

  select contact.archived_at into target_contact_archived_at
  from public.contacts contact
  where contact.id = new.contact_id and contact.workspace_id = new.workspace_id;

  if not found then
    raise exception 'contact point contact is unavailable' using errcode = '23503';
  end if;

  if new.archived_at is null and target_contact_archived_at is not null
     and (tg_op = 'INSERT' or old.archived_at is not null
       or new.display_value is distinct from old.display_value
       or new.label is distinct from old.label
       or new.is_primary is distinct from old.is_primary) then
    raise exception 'archived contacts cannot receive active contact-point changes'
      using errcode = '23514';
  end if;

  if new.archived_at is null then
    active_limit := case when new.type = 'phone' then 3 else 2 end;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.contact_id::text || ':' || new.type::text, 0)
    );
    select count(*)::integer into active_count
    from public.contact_points point
    where point.workspace_id = new.workspace_id
      and point.contact_id = new.contact_id
      and point.type = new.type
      and point.archived_at is null
      and point.id <> new.id;
    if active_count >= active_limit then
      raise exception 'active contact-point limit exceeded' using errcode = '23514';
    end if;
  end if;

  new.updated_at := case
    when tg_op = 'INSERT' then coalesce(new.updated_at, now())
    else now()
  end;
  return new;
end;
$$;

create or replace function public.project_contact_legacy_scalars(
  target_contact_id uuid,
  target_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  projected_phone text;
  projected_secondary_phone text;
  projected_email text;
  projected_email_subscribed boolean;
  previous_projection_setting text := current_setting('omnix.contact_projection', true);
begin
  select point.display_value into projected_phone
  from public.contact_points point
  where point.workspace_id = target_workspace_id
    and point.contact_id = target_contact_id
    and point.type = 'phone'
    and point.archived_at is null
  order by point.is_primary desc, point.display_order, point.created_at, point.id
  limit 1;

  select point.display_value into projected_secondary_phone
  from public.contact_points point
  where point.workspace_id = target_workspace_id
    and point.contact_id = target_contact_id
    and point.type = 'phone'
    and point.archived_at is null
  order by point.is_primary desc, point.display_order, point.created_at, point.id
  offset 1 limit 1;

  select point.display_value, point.email_subscribed
    into projected_email, projected_email_subscribed
  from public.contact_points point
  where point.workspace_id = target_workspace_id
    and point.contact_id = target_contact_id
    and point.type = 'email'
    and point.archived_at is null
  order by point.is_primary desc, point.display_order, point.created_at, point.id
  limit 1;

  perform set_config('omnix.contact_projection', 'points_to_legacy', true);
  update public.contacts contact
     set phone = projected_phone,
         secondary_phone = projected_secondary_phone,
         email = projected_email,
         email_subscribed = coalesce(projected_email_subscribed, contact.email_subscribed)
   where contact.id = target_contact_id
     and contact.workspace_id = target_workspace_id
     and (
       contact.phone is distinct from projected_phone
       or contact.secondary_phone is distinct from projected_secondary_phone
       or contact.email is distinct from projected_email
       or (projected_email_subscribed is not null
         and contact.email_subscribed is distinct from projected_email_subscribed)
     );
  perform set_config(
    'omnix.contact_projection', coalesce(previous_projection_setting, ''), true
  );
end;
$$;

create or replace function public.project_contact_point_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('omnix.contact_projection', true) = 'legacy_to_points' then
    return new;
  end if;
  perform public.project_contact_legacy_scalars(new.contact_id, new.workspace_id);
  return new;
end;
$$;

create or replace function public.sync_one_legacy_contact_point(
  target_contact public.contacts,
  target_type public.crm_contact_point_type,
  target_old_display_value text,
  target_new_display_value text,
  target_is_primary boolean,
  target_label text,
  target_display_order integer,
  target_email_subscribed boolean,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_normalized text;
  new_normalized text;
  target_point public.contact_points%rowtype;
  event_type text;
begin
  if target_old_display_value is not null and length(btrim(target_old_display_value)) > 0 then
    old_normalized := case when target_type = 'phone'
      then public.normalize_contact_phone(target_old_display_value)
      else public.normalize_contact_email(target_old_display_value) end;
  end if;
  if target_new_display_value is not null and length(btrim(target_new_display_value)) > 0 then
    if (target_type = 'phone' and not public.is_valid_contact_phone(target_new_display_value))
       or (target_type = 'email' and not public.is_valid_contact_email(target_new_display_value)) then
      raise exception 'legacy contact scalar is invalid' using errcode = '23514';
    end if;
    new_normalized := case when target_type = 'phone'
      then public.normalize_contact_phone(target_new_display_value)
      else public.normalize_contact_email(target_new_display_value) end;
  end if;

  if new_normalized is null then
    select point.* into target_point
    from public.contact_points point
    where point.workspace_id = target_contact.workspace_id
      and point.contact_id = target_contact.id
      and point.type = target_type
      and point.archived_at is null
      and (old_normalized is null or point.normalized_value = old_normalized)
    order by
      (point.is_primary = target_is_primary) desc,
      point.display_order, point.created_at, point.id
    limit 1 for update;

    if found then
      update public.contact_points point
         set archived_at = target_occurred_at,
             archived_by_membership_id = target_actor_membership_id,
             archive_reason = 'legacy scalar compatibility update'
       where point.id = target_point.id
       returning * into target_point;
      perform public.append_rich_contact_activity_event(
        target_contact.workspace_id, 'contact-point-archived',
        target_actor_membership_id, target_occurred_at,
        public.rich_contact_event_key('contact-point-archived', target_point.id, target_occurred_at),
        target_contact.id, null, null
      );
    end if;
    return;
  end if;

  select point.* into target_point
  from public.contact_points point
  where point.workspace_id = target_contact.workspace_id
    and point.contact_id = target_contact.id
    and point.type = target_type
    and point.archived_at is null
    and point.normalized_value = new_normalized
  order by point.is_primary desc, point.display_order, point.created_at, point.id
  limit 1 for update;

  if not found and old_normalized is not null then
    select point.* into target_point
    from public.contact_points point
    where point.workspace_id = target_contact.workspace_id
      and point.contact_id = target_contact.id
      and point.type = target_type
      and point.archived_at is null
      and point.normalized_value = old_normalized
    order by
      (point.is_primary = target_is_primary) desc,
      point.display_order, point.created_at, point.id
    limit 1 for update;
  end if;

  if target_is_primary then
    update public.contact_points point
       set is_primary = false
     where point.workspace_id = target_contact.workspace_id
       and point.contact_id = target_contact.id
       and point.type = target_type
       and point.archived_at is null
       and point.is_primary
       and (target_point.id is null or point.id <> target_point.id);
  end if;

  if target_point.id is null then
    insert into public.contact_points (
      workspace_id, contact_id, type, label, display_value,
      normalized_value, is_primary, email_subscribed, display_order,
      created_by_membership_id, created_at, updated_at
    ) values (
      target_contact.workspace_id, target_contact.id, target_type,
      target_label, btrim(target_new_display_value), new_normalized,
      target_is_primary,
      case when target_type = 'email' then target_email_subscribed else null end,
      target_display_order, target_actor_membership_id,
      target_occurred_at, target_occurred_at
    ) returning * into target_point;
    event_type := 'contact-point-added';
  else
    update public.contact_points point
       set display_value = btrim(target_new_display_value),
           normalized_value = new_normalized,
           is_primary = target_is_primary,
           email_subscribed = case when target_type = 'email'
             then target_email_subscribed else null end,
           display_order = target_display_order
     where point.id = target_point.id
     returning * into target_point;
    event_type := 'contact-point-updated';
  end if;

  perform public.append_rich_contact_activity_event(
    target_contact.workspace_id, event_type,
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key(event_type::text, target_point.id, target_occurred_at),
    target_contact.id, null, null
  );
end;
$$;

create or replace function public.sync_contact_legacy_scalars_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  previous_projection_setting text := current_setting('omnix.contact_projection', true);
  occurred_at timestamptz := clock_timestamp();
begin
  if current_setting('omnix.contact_projection', true) = 'points_to_legacy' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.phone is not distinct from old.phone
     and new.secondary_phone is not distinct from old.secondary_phone
     and new.email is not distinct from old.email
     and new.email_subscribed is not distinct from old.email_subscribed then
    return new;
  end if;

  actor := public.current_rich_contact_actor(new.workspace_id);
  perform set_config('omnix.contact_projection', 'legacy_to_points', true);

  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    perform public.sync_one_legacy_contact_point(
      new, 'phone', case when tg_op = 'UPDATE' then old.phone else null end,
      new.phone, true, 'primary', 0, null, actor.id, occurred_at
    );
  end if;

  if tg_op = 'INSERT' or new.secondary_phone is distinct from old.secondary_phone then
    if new.secondary_phone is not null and new.phone is not null
       and public.normalize_contact_phone(new.secondary_phone)
         = public.normalize_contact_phone(new.phone) then
      perform public.sync_one_legacy_contact_point(
        new, 'phone', case when tg_op = 'UPDATE' then old.secondary_phone else null end,
        null, false, 'secondary', 1, null, actor.id, occurred_at
      );
    else
      perform public.sync_one_legacy_contact_point(
        new, 'phone', case when tg_op = 'UPDATE' then old.secondary_phone else null end,
        new.secondary_phone, false, 'secondary', 1, null, actor.id, occurred_at
      );
    end if;
  end if;

  if tg_op = 'INSERT' or new.email is distinct from old.email
     or new.email_subscribed is distinct from old.email_subscribed then
    perform public.sync_one_legacy_contact_point(
      new, 'email', case when tg_op = 'UPDATE' then old.email else null end,
      new.email, true, 'primary', 0, new.email_subscribed,
      actor.id, occurred_at
    );
  end if;

  perform public.project_contact_legacy_scalars(new.id, new.workspace_id);
  perform set_config(
    'omnix.contact_projection', coalesce(previous_projection_setting, ''), true
  );
  return new;
end;
$$;

revoke all on function public.prepare_contact_point_write() from public;
revoke all on function public.project_contact_legacy_scalars(uuid, uuid) from public;
revoke all on function public.project_contact_point_after_write() from public;
revoke all on function public.sync_one_legacy_contact_point(
  public.contacts, public.crm_contact_point_type, text, text, boolean,
  text, integer, boolean, uuid, timestamptz
) from public;
revoke all on function public.sync_contact_legacy_scalars_after_write() from public;

create trigger contact_points_prepare_write
  before insert or update on public.contact_points
  for each row execute function public.prepare_contact_point_write();

create trigger contact_points_project_legacy_after_write
  after insert or update on public.contact_points
  for each row execute function public.project_contact_point_after_write();

create trigger contacts_sync_legacy_scalars_after_write
  after insert or update of phone, secondary_phone, email, email_subscribed
  on public.contacts
  for each row execute function public.sync_contact_legacy_scalars_after_write();

-- Existing rows are now projected from canonical points once, deterministically.
do $$
declare
  target_contact record;
begin
  for target_contact in
    select id, workspace_id from public.contacts order by workspace_id, id
  loop
    perform public.project_contact_legacy_scalars(
      target_contact.id, target_contact.workspace_id
    );
  end loop;
end;
$$;

-- Lifecycle, definition and value guards ----------------------------------

create or replace function public.prepare_contact_archive_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.archived_at is not null then
    raise exception 'new contacts cannot start archived' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.workspace_id <> old.workspace_id
       or new.created_at <> old.created_at then
      raise exception 'contact identity is immutable' using errcode = '23514';
    end if;

    if old.archived_at is null and new.archived_at is not null then
      if new.archived_by_membership_id is null or new.archive_reason is null then
        raise exception 'contact archive actor and reason are required'
          using errcode = '23514';
      end if;
      perform public.assert_rich_contact_actor(
        new.archived_by_membership_id, new.workspace_id, false
      );
    elsif old.archived_at is not null and new.archived_at is null then
      new.archived_by_membership_id := null;
      new.archive_reason := null;
    elsif new.archived_at is not distinct from old.archived_at
       and (
         new.archived_by_membership_id is distinct from old.archived_by_membership_id
         or new.archive_reason is distinct from old.archive_reason
       ) then
      raise exception 'contact archive evidence is immutable'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_household_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    perform public.assert_rich_contact_actor(
      new.created_by_membership_id, new.workspace_id, false
    );
    if new.archived_at is not null then
      raise exception 'new households cannot start archived' using errcode = '23514';
    end if;
  elsif new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.created_by_membership_id <> old.created_by_membership_id
     or new.created_at <> old.created_at then
    raise exception 'household identity is immutable' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then
    perform public.assert_rich_contact_actor(
      new.archived_by_membership_id, new.workspace_id, false
    );
  elsif tg_op = 'UPDATE' and old.archived_at is not null and new.archived_at is null then
    new.archived_by_membership_id := null;
  end if;
  new.updated_at := case when tg_op = 'INSERT' then new.updated_at else now() end;
  return new;
end;
$$;

create or replace function public.prepare_custom_field_definition_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  option_value text;
  normalized_options text[] := '{}';
  active_definition_count integer;
begin
  new.name := btrim(new.name);
  perform public.assert_rich_contact_actor(
    case when tg_op = 'INSERT'
      then new.created_by_membership_id
      else coalesce(new.archived_by_membership_id, old.created_by_membership_id)
    end,
    new.workspace_id,
    true
  );

  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.workspace_id <> old.workspace_id
    or new.created_by_membership_id <> old.created_by_membership_id
    or new.created_at <> old.created_at
  ) then
    raise exception 'custom-field definition identity is immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.type <> old.type and exists (
    select 1 from public.contact_custom_field_values value
    where value.workspace_id = old.workspace_id
      and value.definition_id = old.id
  ) then
    raise exception 'custom-field type change requires an explicit value migration preview'
      using errcode = '23514';
  end if;

  if new.type = 'single-select' then
    foreach option_value in array new.options loop
      option_value := btrim(option_value);
      if length(option_value) not between 1 and 120
         or option_value ~ '[[:cntrl:]]'
         or lower(option_value) = any(array(
           select lower(existing_option) from unnest(normalized_options) existing_option
         )) then
        raise exception 'custom-field options must be unique bounded printable values'
          using errcode = '23514';
      end if;
      normalized_options := array_append(normalized_options, option_value);
    end loop;
    new.options := normalized_options;
  else
    new.options := '{}';
  end if;

  if new.archived_at is null then
    new.archived_by_membership_id := null;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.workspace_id::text || ':custom-fields', 0)
    );
    select count(*)::integer into active_definition_count
    from public.contact_custom_field_definitions definition
    where definition.workspace_id = new.workspace_id
      and definition.archived_at is null
      and definition.id <> new.id;
    if active_definition_count >= 100 then
      raise exception 'active custom-field definition limit exceeded'
        using errcode = '23514';
    end if;
  elsif new.archived_by_membership_id is null then
    raise exception 'custom-field archive actor is required' using errcode = '23514';
  end if;

  new.validation := case new.type
    when 'text' then '{"maxLength":2000}'::jsonb
    when 'number' then '{"minimum":-1000000000,"maximum":1000000000}'::jsonb
    when 'date' then '{"format":"date"}'::jsonb
    when 'boolean' then '{"type":"boolean"}'::jsonb
    else jsonb_build_object('allowedValues', to_jsonb(new.options))
  end;
  new.updated_at := case when tg_op = 'INSERT' then new.updated_at else now() end;
  return new;
end;
$$;

create or replace function public.prepare_custom_field_value_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition public.contact_custom_field_definitions%rowtype;
begin
  perform public.assert_rich_contact_actor(
    new.updated_by_membership_id, new.workspace_id, false
  );

  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.workspace_id <> old.workspace_id
    or new.contact_id <> old.contact_id or new.definition_id <> old.definition_id
    or new.created_at <> old.created_at
  ) then
    raise exception 'custom-field value identity is immutable' using errcode = '23514';
  end if;

  select candidate.* into definition
  from public.contact_custom_field_definitions candidate
  where candidate.id = new.definition_id
    and candidate.workspace_id = new.workspace_id;

  if not found or definition.archived_at is not null then
    raise exception 'active custom-field definition is required'
      using errcode = '23514';
  end if;

  if (definition.type = 'text' and new.text_value is null)
     or (definition.type = 'number' and new.number_value is null)
     or (definition.type = 'date' and new.date_value is null)
     or (definition.type = 'boolean' and new.boolean_value is null)
     or (definition.type = 'single-select' and new.selected_value is null) then
    raise exception 'custom-field value type does not match its definition'
      using errcode = '23514';
  end if;

  if definition.type = 'single-select'
     and not (new.selected_value = any(definition.options)) then
    raise exception 'custom-field selected value is not allowlisted'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_contact_archive_write() from public;
revoke all on function public.prepare_household_write() from public;
revoke all on function public.prepare_custom_field_definition_write() from public;
revoke all on function public.prepare_custom_field_value_write() from public;

create trigger contacts_prepare_archive_write
  before insert or update on public.contacts
  for each row execute function public.prepare_contact_archive_write();

create trigger households_prepare_write
  before insert or update on public.households
  for each row execute function public.prepare_household_write();

create trigger contact_custom_field_definitions_prepare_write
  before insert or update on public.contact_custom_field_definitions
  for each row execute function public.prepare_custom_field_definition_write();

create trigger contact_custom_field_values_prepare_write
  before insert or update on public.contact_custom_field_values
  for each row execute function public.prepare_custom_field_value_write();

create trigger contacts_reject_hard_delete
  before delete on public.contacts
  for each row execute function public.guard_rich_contact_delete();

create trigger contact_points_reject_hard_delete
  before delete on public.contact_points
  for each row execute function public.guard_rich_contact_delete();

create trigger households_reject_hard_delete
  before delete on public.households
  for each row execute function public.guard_rich_contact_delete();

create trigger household_memberships_reject_hard_delete
  before delete on public.household_memberships
  for each row execute function public.guard_rich_contact_delete();

create trigger contact_relationships_reject_hard_delete
  before delete on public.contact_relationships
  for each row execute function public.guard_rich_contact_delete();

create trigger contact_assignments_reject_hard_delete
  before delete on public.contact_assignments
  for each row execute function public.guard_rich_contact_delete();

create trigger contact_custom_field_definitions_reject_hard_delete
  before delete on public.contact_custom_field_definitions
  for each row execute function public.guard_rich_contact_delete();

create trigger contact_custom_field_values_reject_hard_delete
  before delete on public.contact_custom_field_values
  for each row execute function public.guard_rich_contact_delete();

-- Story 3.1 task guard replacement: archived contacts cannot receive new work.
create or replace function public.prepare_task_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_crm_actor_membership(
      new.creator_membership_id,
      new.workspace_id
    );
    if not public.crm_membership_is_active(
      new.assignee_membership_id,
      new.workspace_id
    ) then
      raise exception 'active assignee membership is required' using errcode = '42501';
    end if;
    if new.contact_id is not null and exists (
      select 1 from public.contacts contact
      where contact.id = new.contact_id
        and contact.workspace_id = new.workspace_id
        and contact.archived_at is not null
    ) then
      raise exception 'archived contacts cannot receive new tasks' using errcode = '23514';
    end if;
    if new.status <> 'open' then
      raise exception 'new tasks must be open' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.creator_membership_id <> old.creator_membership_id
     or new.created_at <> old.created_at then
    raise exception 'task identity is immutable' using errcode = '23514';
  end if;

  if new.assignee_membership_id is distinct from old.assignee_membership_id
     and not public.crm_membership_is_active(
       new.assignee_membership_id,
       new.workspace_id
     ) then
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
      perform public.assert_crm_actor_membership(
        new.completed_by_membership_id,
        new.workspace_id
      );
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
      perform public.assert_crm_actor_membership(
        new.archived_by_membership_id,
        new.workspace_id
      );
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

-- RLS and least privileges -------------------------------------------------

alter table public.contacts force row level security;
alter table public.contact_points enable row level security;
alter table public.contact_points force row level security;
alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.household_memberships enable row level security;
alter table public.household_memberships force row level security;
alter table public.contact_relationships enable row level security;
alter table public.contact_relationships force row level security;
alter table public.contact_assignments enable row level security;
alter table public.contact_assignments force row level security;
alter table public.contact_custom_field_definitions enable row level security;
alter table public.contact_custom_field_definitions force row level security;
alter table public.contact_custom_field_values enable row level security;
alter table public.contact_custom_field_values force row level security;

create policy contact_points_workspace_select on public.contact_points
  for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy households_workspace_select on public.households
  for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy household_memberships_workspace_select on public.household_memberships
  for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy contact_relationships_workspace_select on public.contact_relationships
  for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy contact_assignments_workspace_select on public.contact_assignments
  for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy contact_custom_field_definitions_workspace_select
  on public.contact_custom_field_definitions
  for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy contact_custom_field_values_workspace_select
  on public.contact_custom_field_values
  for select to authenticated
  using (public.has_workspace_access(workspace_id));

revoke delete, truncate, references, trigger on public.contacts from anon, authenticated;

revoke all on table public.contact_points from public, anon, authenticated, service_role;
revoke all on table public.households from public, anon, authenticated, service_role;
revoke all on table public.household_memberships from public, anon, authenticated, service_role;
revoke all on table public.contact_relationships from public, anon, authenticated, service_role;
revoke all on table public.contact_assignments from public, anon, authenticated, service_role;
revoke all on table public.contact_custom_field_definitions from public, anon, authenticated, service_role;
revoke all on table public.contact_custom_field_values from public, anon, authenticated, service_role;

grant select on table public.contact_points to authenticated, service_role;
grant select on table public.households to authenticated, service_role;
grant select on table public.household_memberships to authenticated, service_role;
grant select on table public.contact_relationships to authenticated, service_role;
grant select on table public.contact_assignments to authenticated, service_role;
grant select on table public.contact_custom_field_definitions to authenticated, service_role;
grant select on table public.contact_custom_field_values to authenticated, service_role;

grant usage on type public.crm_contact_point_type to authenticated, service_role;
grant usage on type public.crm_person_relationship_kind to authenticated, service_role;
grant usage on type public.crm_custom_field_type to authenticated, service_role;

-- Contact-point RPCs -------------------------------------------------------

create or replace function public.add_contact_point(
  target_contact_id uuid,
  target_type public.crm_contact_point_type,
  target_label text,
  target_display_value text,
  target_normalized_value text,
  target_is_primary boolean,
  target_email_subscribed boolean,
  target_display_order integer,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_points
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_contact public.contacts%rowtype;
  created_point public.contact_points%rowtype;
  expected_normalized text;
begin
  select contact.* into target_contact
  from public.contacts contact
  where contact.id = target_contact_id
  for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_contact.workspace_id, false
  );
  if target_contact.archived_at is not null then
    raise exception 'archived contacts cannot receive contact points'
      using errcode = '23514';
  end if;

  expected_normalized := case when target_type = 'phone'
    then public.normalize_contact_phone(target_display_value)
    else public.normalize_contact_email(target_display_value) end;
  if target_normalized_value is distinct from expected_normalized then
    raise exception 'contact-point normalized value does not match display value'
      using errcode = '23514';
  end if;

  insert into public.contact_points (
    workspace_id, contact_id, type, label, display_value, normalized_value,
    is_primary, email_subscribed, display_order, created_by_membership_id,
    created_at, updated_at
  ) values (
    target_contact.workspace_id, target_contact.id, target_type,
    target_label, target_display_value, target_normalized_value,
    target_is_primary, target_email_subscribed, target_display_order,
    target_actor_membership_id, target_occurred_at, target_occurred_at
  ) returning * into created_point;

  perform public.append_rich_contact_activity_event(
    target_contact.workspace_id, 'contact-point-added',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('contact-point-added', created_point.id, target_occurred_at),
    target_contact.id, null, null
  );
  return created_point;
end;
$$;

create or replace function public.update_contact_point(
  target_point_id uuid,
  target_label text,
  target_display_value text,
  target_normalized_value text,
  target_is_primary boolean,
  target_email_subscribed boolean,
  target_display_order integer,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_points
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_point public.contact_points%rowtype;
  updated_point public.contact_points%rowtype;
  expected_normalized text;
begin
  select point.* into target_point
  from public.contact_points point
  where point.id = target_point_id
  for update;
  if not found then raise exception 'contact point not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_point.workspace_id, false
  );
  if target_point.archived_at is not null then
    raise exception 'archived contact points must be restored before update'
      using errcode = '23514';
  end if;
  expected_normalized := case when target_point.type = 'phone'
    then public.normalize_contact_phone(target_display_value)
    else public.normalize_contact_email(target_display_value) end;
  if target_normalized_value is distinct from expected_normalized then
    raise exception 'contact-point normalized value does not match display value'
      using errcode = '23514';
  end if;

  if target_is_primary and not target_point.is_primary then
    update public.contact_points point set is_primary = false
    where point.workspace_id = target_point.workspace_id
      and point.contact_id = target_point.contact_id
      and point.type = target_point.type
      and point.archived_at is null and point.is_primary
      and point.id <> target_point.id;
  end if;

  update public.contact_points point
     set label = target_label,
         display_value = target_display_value,
         normalized_value = target_normalized_value,
         is_primary = target_is_primary,
         email_subscribed = target_email_subscribed,
         display_order = target_display_order,
         updated_at = target_occurred_at
   where point.id = target_point.id
   returning * into updated_point;

  perform public.append_rich_contact_activity_event(
    target_point.workspace_id, 'contact-point-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('contact-point-updated', target_point.id, target_occurred_at),
    target_point.contact_id, null, null
  );
  return updated_point;
end;
$$;

create or replace function public.archive_contact_point(
  target_point_id uuid,
  target_actor_membership_id uuid,
  target_reason text,
  target_occurred_at timestamptz
)
returns public.contact_points
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_point public.contact_points%rowtype;
begin
  select point.* into target_point
  from public.contact_points point where point.id = target_point_id for update;
  if not found then raise exception 'contact point not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_point.workspace_id, false
  );
  if target_point.archived_at is not null then return target_point; end if;

  update public.contact_points point
     set archived_at = target_occurred_at,
         archived_by_membership_id = target_actor_membership_id,
         archive_reason = target_reason,
         updated_at = target_occurred_at
   where point.id = target_point.id returning * into target_point;
  perform public.append_rich_contact_activity_event(
    target_point.workspace_id, 'contact-point-archived',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('contact-point-archived', target_point.id, target_occurred_at),
    target_point.contact_id, null, null
  );
  return target_point;
end;
$$;

create or replace function public.restore_contact_point(
  target_point_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_points
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_point public.contact_points%rowtype;
begin
  select point.* into target_point
  from public.contact_points point where point.id = target_point_id for update;
  if not found then raise exception 'contact point not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_point.workspace_id, false
  );
  if target_point.archived_at is null then return target_point; end if;
  update public.contact_points point
     set archived_at = null, archived_by_membership_id = null,
         archive_reason = null, updated_at = target_occurred_at
   where point.id = target_point.id returning * into target_point;
  perform public.append_rich_contact_activity_event(
    target_point.workspace_id, 'contact-point-restored',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('contact-point-restored', target_point.id, target_occurred_at),
    target_point.contact_id, null, null
  );
  return target_point;
end;
$$;

-- Household RPCs -----------------------------------------------------------

create or replace function public.create_household(
  target_name text,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  created_household public.households%rowtype;
begin
  select membership.* into actor from public.workspace_members membership
  where membership.id = target_actor_membership_id;
  if not found then raise exception 'actor membership not found' using errcode = '42501'; end if;
  actor := public.assert_rich_contact_actor(actor.id, actor.workspace_id, false);
  insert into public.households (
    workspace_id, name, created_by_membership_id, created_at, updated_at
  ) values (
    actor.workspace_id, target_name, actor.id, target_occurred_at, target_occurred_at
  ) returning * into created_household;
  perform public.append_rich_contact_activity_event(
    actor.workspace_id, 'household-updated', actor.id, target_occurred_at,
    public.rich_contact_event_key('household-created', created_household.id, target_occurred_at),
    null, null, null
  );
  return created_household;
end;
$$;

create or replace function public.update_household(
  target_household_id uuid,
  target_name text,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare target_household public.households%rowtype;
begin
  select household.* into target_household from public.households household
  where household.id = target_household_id for update;
  if not found then raise exception 'household not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_household.workspace_id, false
  );
  if target_household.archived_at is not null then
    raise exception 'archived households must be restored before update'
      using errcode = '23514';
  end if;
  update public.households household set name = target_name, updated_at = target_occurred_at
  where household.id = target_household.id returning * into target_household;
  perform public.append_rich_contact_activity_event(
    target_household.workspace_id, 'household-updated', target_actor_membership_id,
    target_occurred_at,
    public.rich_contact_event_key('household-updated', target_household.id, target_occurred_at),
    null, null, null
  );
  return target_household;
end;
$$;

create or replace function public.archive_household(
  target_household_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare target_household public.households%rowtype;
begin
  select household.* into target_household from public.households household
  where household.id = target_household_id for update;
  if not found then raise exception 'household not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_household.workspace_id, false
  );
  if target_household.archived_at is not null then return target_household; end if;
  update public.households household
     set archived_at = target_occurred_at,
         archived_by_membership_id = target_actor_membership_id,
         updated_at = target_occurred_at
   where household.id = target_household.id returning * into target_household;
  perform public.append_rich_contact_activity_event(
    target_household.workspace_id, 'household-updated', target_actor_membership_id,
    target_occurred_at,
    public.rich_contact_event_key('household-archived', target_household.id, target_occurred_at),
    null, null, null
  );
  return target_household;
end;
$$;

create or replace function public.restore_household(
  target_household_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare target_household public.households%rowtype;
begin
  select household.* into target_household from public.households household
  where household.id = target_household_id for update;
  if not found then raise exception 'household not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_household.workspace_id, false
  );
  if target_household.archived_at is null then return target_household; end if;
  update public.households household
     set archived_at = null, archived_by_membership_id = null,
         updated_at = target_occurred_at
   where household.id = target_household.id returning * into target_household;
  perform public.append_rich_contact_activity_event(
    target_household.workspace_id, 'household-updated', target_actor_membership_id,
    target_occurred_at,
    public.rich_contact_event_key('household-restored', target_household.id, target_occurred_at),
    null, null, null
  );
  return target_household;
end;
$$;

create or replace function public.add_household_member(
  target_household_id uuid,
  target_contact_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.household_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household public.households%rowtype;
  created_membership public.household_memberships%rowtype;
begin
  select household.* into target_household from public.households household
  where household.id = target_household_id for update;
  if not found then raise exception 'household not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_household.workspace_id, false
  );
  if target_household.archived_at is not null or exists (
    select 1 from public.contacts contact
    where contact.id = target_contact_id
      and contact.workspace_id = target_household.workspace_id
      and contact.archived_at is not null
  ) then
    raise exception 'active household and contact are required' using errcode = '23514';
  end if;
  insert into public.household_memberships (
    workspace_id, household_id, contact_id,
    created_by_membership_id, created_at
  ) values (
    target_household.workspace_id, target_household.id, target_contact_id,
    target_actor_membership_id, target_occurred_at
  ) returning * into created_membership;
  perform public.append_rich_contact_activity_event(
    target_household.workspace_id, 'household-updated', target_actor_membership_id,
    target_occurred_at,
    public.rich_contact_event_key('household-member-added', created_membership.id, target_occurred_at),
    target_contact_id, null, null
  );
  return created_membership;
end;
$$;

create or replace function public.remove_household_member(
  target_household_id uuid,
  target_contact_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_membership public.household_memberships%rowtype;
begin
  select membership.* into target_membership
  from public.household_memberships membership
  where membership.household_id = target_household_id
    and membership.contact_id = target_contact_id
    and membership.ended_at is null
  for update;
  if not found then return; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_membership.workspace_id, false
  );
  update public.household_memberships membership
     set ended_at = target_occurred_at,
         ended_by_membership_id = target_actor_membership_id
   where membership.id = target_membership.id;
  perform public.append_rich_contact_activity_event(
    target_membership.workspace_id, 'household-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key(
      'household-member-removed', target_membership.id, target_occurred_at
    ),
    target_contact_id, null, null
  );
end;
$$;

-- Person relationship RPCs ------------------------------------------------

create or replace function public.add_contact_relationship(
  target_first_contact_id uuid,
  target_second_contact_id uuid,
  target_kind public.crm_person_relationship_kind,
  target_label text,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_first_id uuid := least(target_first_contact_id, target_second_contact_id);
  canonical_second_id uuid := greatest(target_first_contact_id, target_second_contact_id);
  target_workspace_id uuid;
  created_relationship public.contact_relationships%rowtype;
begin
  if target_first_contact_id = target_second_contact_id then
    raise exception 'a contact cannot relate to themselves' using errcode = '23514';
  end if;
  select first_contact.workspace_id into target_workspace_id
  from public.contacts first_contact
  where first_contact.id = canonical_first_id
    and first_contact.archived_at is null;
  if not found or not exists (
    select 1 from public.contacts second_contact
    where second_contact.id = canonical_second_id
      and second_contact.workspace_id = target_workspace_id
      and second_contact.archived_at is null
  ) then
    raise exception 'active same-workspace contacts are required'
      using errcode = '23503';
  end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_workspace_id, false
  );

  insert into public.contact_relationships (
    workspace_id, first_contact_id, second_contact_id, kind, label,
    created_by_membership_id, created_at
  ) values (
    target_workspace_id, canonical_first_id, canonical_second_id,
    target_kind, target_label, target_actor_membership_id, target_occurred_at
  ) returning * into created_relationship;
  perform public.append_rich_contact_activity_event(
    target_workspace_id, 'relationship-updated', target_actor_membership_id,
    target_occurred_at,
    public.rich_contact_event_key('relationship-added', created_relationship.id, target_occurred_at),
    canonical_first_id, null, null
  );
  return created_relationship;
end;
$$;

create or replace function public.archive_contact_relationship(
  target_relationship_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare target_relationship public.contact_relationships%rowtype;
begin
  select relationship.* into target_relationship
  from public.contact_relationships relationship
  where relationship.id = target_relationship_id for update;
  if not found then raise exception 'relationship not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_relationship.workspace_id, false
  );
  if target_relationship.archived_at is not null then return target_relationship; end if;
  update public.contact_relationships relationship
     set archived_at = target_occurred_at,
         archived_by_membership_id = target_actor_membership_id
   where relationship.id = target_relationship.id
   returning * into target_relationship;
  perform public.append_rich_contact_activity_event(
    target_relationship.workspace_id, 'relationship-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('relationship-archived', target_relationship.id, target_occurred_at),
    target_relationship.first_contact_id, null, null
  );
  return target_relationship;
end;
$$;

create or replace function public.restore_contact_relationship(
  target_relationship_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare target_relationship public.contact_relationships%rowtype;
begin
  select relationship.* into target_relationship
  from public.contact_relationships relationship
  where relationship.id = target_relationship_id for update;
  if not found then raise exception 'relationship not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_relationship.workspace_id, false
  );
  if target_relationship.archived_at is null then return target_relationship; end if;
  if exists (
    select 1 from public.contact_relationships active_relationship
    where active_relationship.workspace_id = target_relationship.workspace_id
      and active_relationship.first_contact_id = target_relationship.first_contact_id
      and active_relationship.second_contact_id = target_relationship.second_contact_id
      and active_relationship.archived_at is null
      and active_relationship.id <> target_relationship.id
  ) then
    raise exception 'an active relationship already exists for this pair'
      using errcode = '23505';
  end if;
  update public.contact_relationships relationship
     set archived_at = null, archived_by_membership_id = null
   where relationship.id = target_relationship.id
   returning * into target_relationship;
  perform public.append_rich_contact_activity_event(
    target_relationship.workspace_id, 'relationship-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('relationship-restored', target_relationship.id, target_occurred_at),
    target_relationship.first_contact_id, null, null
  );
  return target_relationship;
end;
$$;

-- Assignment RPCs ----------------------------------------------------------

create or replace function public.assign_contact(
  target_contact_id uuid,
  target_assignee_membership_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_contact public.contacts%rowtype;
  created_assignment public.contact_assignments%rowtype;
begin
  select contact.* into target_contact from public.contacts contact
  where contact.id = target_contact_id for update;
  if not found then raise exception 'contact not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_contact.workspace_id, false
  );
  if target_contact.archived_at is not null then
    raise exception 'archived contacts cannot receive assignments'
      using errcode = '23514';
  end if;
  if not public.crm_membership_is_active(
    target_assignee_membership_id, target_contact.workspace_id
  ) then
    raise exception 'active same-workspace assignee is required'
      using errcode = '42501';
  end if;
  insert into public.contact_assignments (
    workspace_id, contact_id, assignee_membership_id, assigned_at,
    assigned_by_membership_id, created_at, updated_at
  ) values (
    target_contact.workspace_id, target_contact.id, target_assignee_membership_id,
    target_occurred_at, target_actor_membership_id,
    target_occurred_at, target_occurred_at
  ) returning * into created_assignment;
  perform public.append_rich_contact_activity_event(
    target_contact.workspace_id, 'assignment-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('assignment-added', created_assignment.id, target_occurred_at),
    target_contact.id, null, null
  );
  return created_assignment;
end;
$$;

create or replace function public.unassign_contact(
  target_assignment_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare target_assignment public.contact_assignments%rowtype;
begin
  select assignment.* into target_assignment
  from public.contact_assignments assignment
  where assignment.id = target_assignment_id for update;
  if not found then raise exception 'contact assignment not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_assignment.workspace_id, false
  );
  if target_assignment.unassigned_at is not null then return target_assignment; end if;
  update public.contact_assignments assignment
     set unassigned_at = target_occurred_at,
         unassigned_by_membership_id = target_actor_membership_id,
         updated_at = target_occurred_at
   where assignment.id = target_assignment.id
   returning * into target_assignment;
  perform public.append_rich_contact_activity_event(
    target_assignment.workspace_id, 'assignment-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('assignment-removed', target_assignment.id, target_occurred_at),
    target_assignment.contact_id, null, null
  );
  return target_assignment;
end;
$$;

-- Custom-field RPCs --------------------------------------------------------

create or replace function public.create_contact_custom_field_definition(
  target_name text,
  target_type public.crm_custom_field_type,
  target_options text[],
  target_display_order integer,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_custom_field_definitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  created_definition public.contact_custom_field_definitions%rowtype;
begin
  select membership.* into actor from public.workspace_members membership
  where membership.id = target_actor_membership_id;
  if not found then raise exception 'actor membership not found' using errcode = '42501'; end if;
  actor := public.assert_rich_contact_actor(actor.id, actor.workspace_id, true);
  insert into public.contact_custom_field_definitions (
    workspace_id, name, type, options, display_order,
    created_by_membership_id, created_at, updated_at
  ) values (
    actor.workspace_id, target_name, target_type,
    coalesce(target_options, '{}'), target_display_order,
    actor.id, target_occurred_at, target_occurred_at
  ) returning * into created_definition;
  perform public.append_rich_contact_activity_event(
    actor.workspace_id, 'custom-field-updated', actor.id, target_occurred_at,
    public.rich_contact_event_key('custom-field-created', created_definition.id, target_occurred_at),
    null, null, null
  );
  return created_definition;
end;
$$;

create or replace function public.archive_contact_custom_field_definition(
  target_definition_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_custom_field_definitions
language plpgsql
security definer
set search_path = ''
as $$
declare target_definition public.contact_custom_field_definitions%rowtype;
begin
  select definition.* into target_definition
  from public.contact_custom_field_definitions definition
  where definition.id = target_definition_id for update;
  if not found then raise exception 'custom-field definition not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_definition.workspace_id, true
  );
  if target_definition.archived_at is not null then return target_definition; end if;
  update public.contact_custom_field_definitions definition
     set archived_at = target_occurred_at,
         archived_by_membership_id = target_actor_membership_id,
         updated_at = target_occurred_at
   where definition.id = target_definition.id
   returning * into target_definition;
  perform public.append_rich_contact_activity_event(
    target_definition.workspace_id, 'custom-field-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('custom-field-archived', target_definition.id, target_occurred_at),
    null, null, null
  );
  return target_definition;
end;
$$;

create or replace function public.set_contact_custom_field_value(
  target_contact_id uuid,
  target_definition_id uuid,
  target_value jsonb,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns public.contact_custom_field_values
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_contact public.contacts%rowtype;
  definition public.contact_custom_field_definitions%rowtype;
  stored_value public.contact_custom_field_values%rowtype;
  parsed_text text;
  parsed_date date;
begin
  select contact.* into target_contact from public.contacts contact
  where contact.id = target_contact_id for update;
  if not found then raise exception 'contact not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_contact.workspace_id, false
  );
  if target_contact.archived_at is not null then
    raise exception 'archived contacts cannot receive custom-field changes'
      using errcode = '23514';
  end if;
  select candidate.* into definition
  from public.contact_custom_field_definitions candidate
  where candidate.id = target_definition_id
    and candidate.workspace_id = target_contact.workspace_id
    and candidate.archived_at is null;
  if not found then
    raise exception 'active custom-field definition not found' using errcode = 'P0002';
  end if;

  if definition.type = 'text' then
    if jsonb_typeof(target_value) <> 'string' then
      raise exception 'custom text value is invalid' using errcode = '23514';
    end if;
    parsed_text := target_value #>> '{}';
    if length(btrim(parsed_text)) not between 1 and 2000
       or parsed_text ~ '[[:cntrl:]]' then
      raise exception 'custom text value is invalid' using errcode = '23514';
    end if;
  elsif definition.type = 'number' then
    if jsonb_typeof(target_value) <> 'number'
       or abs((target_value #>> '{}')::numeric) > 1000000000 then
      raise exception 'custom number value is invalid' using errcode = '23514';
    end if;
  elsif definition.type = 'boolean' then
    if jsonb_typeof(target_value) <> 'boolean' then
      raise exception 'custom boolean value is invalid' using errcode = '23514';
    end if;
  elsif definition.type = 'date' then
    if jsonb_typeof(target_value) <> 'string' then
      raise exception 'custom date value is invalid' using errcode = '23514';
    end if;
    parsed_text := target_value #>> '{}';
    if parsed_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'custom date value is invalid' using errcode = '23514';
    end if;
    parsed_date := parsed_text::date;
    if to_char(parsed_date, 'YYYY-MM-DD') <> parsed_text then
      raise exception 'custom date value is invalid' using errcode = '23514';
    end if;
  else
    if jsonb_typeof(target_value) <> 'string' then
      raise exception 'custom selected value is invalid' using errcode = '23514';
    end if;
    parsed_text := target_value #>> '{}';
    if not (parsed_text = any(definition.options)) then
      raise exception 'custom selected value is not allowlisted' using errcode = '23514';
    end if;
  end if;

  insert into public.contact_custom_field_values (
    workspace_id, contact_id, definition_id,
    text_value, number_value, date_value, boolean_value, selected_value,
    updated_at, updated_by_membership_id, created_at
  ) values (
    target_contact.workspace_id, target_contact.id, definition.id,
    case when definition.type = 'text' then btrim(parsed_text) end,
    case when definition.type = 'number' then (target_value #>> '{}')::numeric end,
    case when definition.type = 'date' then parsed_date end,
    case when definition.type = 'boolean' then (target_value #>> '{}')::boolean end,
    case when definition.type = 'single-select' then parsed_text end,
    target_occurred_at, target_actor_membership_id, target_occurred_at
  )
  on conflict (workspace_id, contact_id, definition_id) do update
    set text_value = excluded.text_value,
        number_value = excluded.number_value,
        date_value = excluded.date_value,
        boolean_value = excluded.boolean_value,
        selected_value = excluded.selected_value,
        updated_at = excluded.updated_at,
        updated_by_membership_id = excluded.updated_by_membership_id
  returning * into stored_value;

  perform public.append_rich_contact_activity_event(
    target_contact.workspace_id, 'custom-field-updated',
    target_actor_membership_id, target_occurred_at,
    public.rich_contact_event_key('custom-value-updated', stored_value.id, target_occurred_at),
    target_contact.id, null, null
  );
  return stored_value;
exception when numeric_value_out_of_range or invalid_text_representation then
  raise exception 'custom-field value is invalid' using errcode = '23514';
end;
$$;

-- Contact archive/restore RPCs --------------------------------------------

create or replace function public.archive_contact(
  target_contact_id uuid,
  target_actor_membership_id uuid,
  target_reason text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_contact public.contacts%rowtype;
begin
  select contact.* into target_contact from public.contacts contact
  where contact.id = target_contact_id for update;
  if not found then raise exception 'contact not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_contact.workspace_id, false
  );
  if target_contact.archived_at is null then
    update public.contacts contact
       set archived_at = target_occurred_at,
           archived_by_membership_id = target_actor_membership_id,
           archive_reason = target_reason
     where contact.id = target_contact.id returning * into target_contact;
    perform public.append_rich_contact_activity_event(
      target_contact.workspace_id, 'contact-archived',
      target_actor_membership_id, target_occurred_at,
      public.rich_contact_event_key('contact-archived', target_contact.id, target_occurred_at),
      target_contact.id, null, null
    );
  end if;
  return jsonb_build_object(
    'contactId', target_contact.id::text,
    'workspaceId', target_contact.workspace_id::text,
    'archivedAt', target_contact.archived_at,
    'archivedByMembershipId', target_contact.archived_by_membership_id::text,
    'archiveReason', target_contact.archive_reason
  );
end;
$$;

create or replace function public.restore_contact(
  target_contact_id uuid,
  target_actor_membership_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_contact public.contacts%rowtype;
begin
  select contact.* into target_contact from public.contacts contact
  where contact.id = target_contact_id for update;
  if not found then raise exception 'contact not found' using errcode = 'P0002'; end if;
  perform public.assert_rich_contact_actor(
    target_actor_membership_id, target_contact.workspace_id, false
  );
  if target_contact.archived_at is not null then
    update public.contacts contact
       set archived_at = null, archived_by_membership_id = null, archive_reason = null
     where contact.id = target_contact.id returning * into target_contact;
    perform public.append_rich_contact_activity_event(
      target_contact.workspace_id, 'contact-restored',
      target_actor_membership_id, target_occurred_at,
      public.rich_contact_event_key('contact-restored', target_contact.id, target_occurred_at),
      target_contact.id, null, null
    );
  end if;
  return jsonb_build_object(
    'contactId', target_contact.id::text,
    'workspaceId', target_contact.workspace_id::text,
    'archivedAt', target_contact.archived_at,
    'archivedByMembershipId', target_contact.archived_by_membership_id,
    'archiveReason', target_contact.archive_reason
  );
end;
$$;

-- Story 3.1 conversion validators gain only the exact Story 3.2 facts. ------

create or replace function public.is_valid_buyer_conversion_payload(target jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.jsonb_object_has_only(target, array[
      'priceMin', 'priceMax', 'areas', 'beds', 'baths', 'timeline',
      'preApproved', 'lender', 'mortgageType', 'desiredPropertyType',
      'currentTenure'
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
      and length(btrim(target->>'timeline')) between 1 and 500
      and (target->>'timeline') !~ '[[:cntrl:]]'))
    and (not (target ? 'preApproved') or jsonb_typeof(target->'preApproved') = 'boolean')
    and (not (target ? 'lender') or (jsonb_typeof(target->'lender') = 'string'
      and length(btrim(target->>'lender')) between 1 and 300
      and (target->>'lender') !~ '[[:cntrl:]]'))
    and public.is_valid_rich_buyer_criteria(target);
$$;

create or replace function public.is_valid_seller_conversion_payload(target jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.jsonb_object_has_only(target, array[
      'propertyAddress', 'targetPrice', 'timeline', 'motivation',
      'hasPropertyToSell', 'propertyType', 'basement', 'parking',
      'condition', 'listingStatus', 'bedrooms', 'bathrooms'
    ])
    and (not (target ? 'propertyAddress') or (
      jsonb_typeof(target->'propertyAddress') = 'string'
      and length(btrim(target->>'propertyAddress')) between 1 and 300
      and (target->>'propertyAddress') !~ '[[:cntrl:]]'))
    and (not (target ? 'targetPrice') or (
      jsonb_typeof(target->'targetPrice') = 'number'
      and (target->>'targetPrice')::numeric >= 0))
    and (not (target ? 'timeline') or (
      jsonb_typeof(target->'timeline') = 'string'
      and length(btrim(target->>'timeline')) between 1 and 500
      and (target->>'timeline') !~ '[[:cntrl:]]'))
    and (not (target ? 'motivation') or (
      jsonb_typeof(target->'motivation') = 'string'
      and length(btrim(target->>'motivation')) between 1 and 2000
      and (target->>'motivation') !~ '[[:cntrl:]]'))
    and public.is_valid_rich_seller_criteria(target);
$$;

-- Identity resolution includes archived contacts and never uses households. --

create or replace function public.resolve_contact_import_identity(
  target_workspace_id uuid,
  target_provider text,
  target_external_id text,
  target_email text,
  target_phone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  normalized_email text;
  normalized_phone text;
  matched_contact_ids uuid[];
  resolved_contact public.contacts%rowtype;
  matched_by text;
begin
  actor := public.current_rich_contact_actor(target_workspace_id);
  if target_provider is not null
     and target_provider !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'import provider is invalid' using errcode = '23514';
  end if;
  if target_external_id is not null
     and length(btrim(target_external_id)) not between 1 and 255 then
    raise exception 'external identity is invalid' using errcode = '23514';
  end if;
  if target_email is not null and length(btrim(target_email)) > 0 then
    if not public.is_valid_contact_email(target_email) then
      raise exception 'email identity is invalid' using errcode = '23514';
    end if;
    normalized_email := public.normalize_contact_email(target_email);
  end if;
  if target_phone is not null and length(btrim(target_phone)) > 0 then
    if not public.is_valid_contact_phone(target_phone) then
      raise exception 'phone identity is invalid' using errcode = '23514';
    end if;
    normalized_phone := public.normalize_contact_phone(target_phone);
  end if;

  select array_agg(distinct match.contact_id order by match.contact_id)
    into matched_contact_ids
  from (
    select link.contact_id
    from public.contact_external_links link
    where target_provider is not null and target_external_id is not null
      and link.workspace_id = target_workspace_id
      and link.provider = target_provider
      and link.external_id = target_external_id
    union all
    select point.contact_id
    from public.contact_points point
    where normalized_email is not null
      and point.workspace_id = target_workspace_id
      and point.type = 'email'
      and point.normalized_value = normalized_email
      and point.archived_at is null
    union all
    select point.contact_id
    from public.contact_points point
    where normalized_phone is not null
      and point.workspace_id = target_workspace_id
      and point.type = 'phone'
      and point.normalized_value = normalized_phone
      and point.archived_at is null
  ) match;

  if coalesce(cardinality(matched_contact_ids), 0) = 0 then
    return jsonb_build_object(
      'outcome', 'none', 'contactId', null, 'matchedBy', null,
      'matchCount', 0
    );
  elsif cardinality(matched_contact_ids) > 1 then
    return jsonb_build_object(
      'outcome', 'ambiguous-identity', 'contactId', null, 'matchedBy', null,
      'matchCount', cardinality(matched_contact_ids)
    );
  end if;

  select contact.* into resolved_contact
  from public.contacts contact
  where contact.id = matched_contact_ids[1]
    and contact.workspace_id = target_workspace_id;

  matched_by := case
    when target_provider is not null and target_external_id is not null and exists (
      select 1 from public.contact_external_links link
      where link.workspace_id = target_workspace_id
        and link.provider = target_provider
        and link.external_id = target_external_id
        and link.contact_id = resolved_contact.id
    ) then 'external-id'
    when normalized_email is not null and exists (
      select 1 from public.contact_points point
      where point.workspace_id = target_workspace_id
        and point.contact_id = resolved_contact.id
        and point.type = 'email' and point.normalized_value = normalized_email
        and point.archived_at is null
    ) then 'email'
    else 'phone'
  end;

  return jsonb_build_object(
    'outcome', case when resolved_contact.archived_at is null
      then 'active-match' else 'archived-match' end,
    'contactId', resolved_contact.id::text,
    'matchedBy', matched_by,
    'matchCount', 1
  );
end;
$$;

-- One collapsed import target group, one database transaction. -------------
-- Plan v1 keys (camelCase): action, contactId, contact, points, householdIds,
-- assigneeMembershipIds, customValues, externalLink, note,
-- activityIdempotencyKey. A collapsed merge row is represented as an
-- `unchanged` target group and may still add its link/note/import receipt.
-- Field definitions are never created here and households never match identity.

create or replace function public.apply_contact_import_group(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_group_idempotency_key text,
  target_request_hash text,
  target_plan jsonb,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  compatibility_owner_id uuid;
  existing_receipt public.contact_intake_receipts%rowtype;
  action_name text;
  contact_payload jsonb;
  resolved_contact public.contacts%rowtype;
  item jsonb;
  activity_key text;
  created_note public.notes%rowtype;
  notes_added boolean := false;
  result jsonb;
begin
  if target_plan is null or jsonb_typeof(target_plan) <> 'object'
     or not public.jsonb_object_has_only(target_plan, array[
       'action', 'contactId', 'contact', 'points', 'householdIds',
       'assigneeMembershipIds', 'customValues', 'externalLink', 'note',
       'activityIdempotencyKey'
     ])
     or target_group_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or target_request_hash !~ '^[a-f0-9]{64}$'
     or target_occurred_at is null then
    raise exception 'contact import group command is invalid' using errcode = '23514';
  end if;
  actor := public.assert_rich_contact_actor(
    target_actor_membership_id, target_workspace_id, false
  );

  select receipt.* into existing_receipt
  from public.contact_intake_receipts receipt
  where receipt.workspace_id = target_workspace_id
    and receipt.idempotency_key = target_group_idempotency_key
  for update;
  if found then
    if existing_receipt.request_hash <> target_request_hash then
      raise exception 'contact import group replay payload conflicts with original'
        using errcode = '23505';
    end if;
    return existing_receipt.response_json || jsonb_build_object('noOp', true);
  end if;

  action_name := target_plan->>'action';
  contact_payload := coalesce(target_plan->'contact', '{}'::jsonb);
  activity_key := target_plan->>'activityIdempotencyKey';
  if action_name not in ('create', 'update', 'unchanged')
     or activity_key !~ '^[A-Za-z0-9._:-]{1,128}$'
     or jsonb_typeof(coalesce(target_plan->'points', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(target_plan->'points', '[]'::jsonb)) > 5
     or jsonb_typeof(coalesce(target_plan->'householdIds', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(target_plan->'householdIds', '[]'::jsonb)) > 20
     or jsonb_typeof(coalesce(target_plan->'assigneeMembershipIds', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(target_plan->'assigneeMembershipIds', '[]'::jsonb)) > 20
     or jsonb_typeof(coalesce(target_plan->'customValues', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(target_plan->'customValues', '[]'::jsonb)) > 100 then
    raise exception 'contact import group plan is invalid or exceeds a bound'
      using errcode = '23514';
  end if;
  if target_plan ? 'note' and (
    jsonb_typeof(target_plan->'note') <> 'string'
    or length(btrim(target_plan->>'note')) not between 1 and 5000
  ) then
    raise exception 'contact import note must contain 1-5000 characters'
      using errcode = '23514';
  end if;

  select membership.user_id into strict compatibility_owner_id
  from public.workspace_members membership
  where membership.workspace_id = target_workspace_id
    and membership.role = 'owner' and membership.status = 'active';

  if action_name = 'create' then
    if not public.is_valid_contact_conversion_payload(contact_payload, true) then
      raise exception 'contact import create payload is invalid' using errcode = '23514';
    end if;
    insert into public.contacts (
      owner_id, workspace_id, first_name, last_name, preferred_name,
      phone, secondary_phone, email, mailing_address, city, state, postal_code,
      birthdate, home_purchase_date, lead_type, relationship, intent, source,
      pipeline_stage, buyer_criteria, seller_criteria, referred_by_id,
      last_contacted_at, next_touch_at, touch_date_overridden, tags,
      email_subscribed, created_at, updated_at
    ) values (
      compatibility_owner_id, target_workspace_id,
      contact_payload->>'firstName', contact_payload->>'lastName',
      contact_payload->>'preferredName', contact_payload->>'phone',
      contact_payload->>'secondaryPhone', contact_payload->>'email',
      contact_payload->>'mailingAddress', contact_payload->>'city',
      contact_payload->>'state', contact_payload->>'postalCode',
      case when contact_payload ? 'birthdate'
        then (contact_payload->>'birthdate')::date end,
      case when contact_payload ? 'homePurchaseDate'
        then (contact_payload->>'homePurchaseDate')::date end,
      (contact_payload->>'leadType')::public.lead_type,
      (contact_payload->>'relationship')::public.relationship,
      (contact_payload->>'intent')::public.intent,
      (contact_payload->>'source')::public.lead_source,
      (contact_payload->>'pipelineStage')::public.pipeline_stage,
      contact_payload->'buyer', contact_payload->'seller',
      case when contact_payload ? 'referredById'
        then (contact_payload->>'referredById')::uuid end,
      case when contact_payload ? 'lastContactedAt'
        then (contact_payload->>'lastContactedAt')::timestamptz end,
      case when contact_payload ? 'nextTouchAt'
        then (contact_payload->>'nextTouchAt')::date end,
      coalesce((contact_payload->>'touchDateOverridden')::boolean, false),
      coalesce(array(
        select value from jsonb_array_elements_text(contact_payload->'tags') value
      ), '{}'::text[]),
      coalesce((contact_payload->>'emailSubscribed')::boolean, true),
      target_occurred_at, target_occurred_at
    ) returning * into resolved_contact;
    perform public.append_rich_contact_activity_event(
      target_workspace_id, 'contact-created', actor.id, target_occurred_at,
      'contact-created:' || resolved_contact.id::text,
      resolved_contact.id, null, null
    );
  else
    if jsonb_typeof(target_plan->'contactId') <> 'string' then
      raise exception 'contact import update target is required' using errcode = '23514';
    end if;
    select contact.* into resolved_contact
    from public.contacts contact
    where contact.id = (target_plan->>'contactId')::uuid
      and contact.workspace_id = target_workspace_id
    for update;
    if not found then raise exception 'contact import target not found' using errcode = 'P0002'; end if;
    if resolved_contact.archived_at is not null then
      raise exception 'archived-match requires explicit restore and rerun'
        using errcode = '23514';
    end if;
    if action_name = 'update' then
      if not public.is_valid_contact_conversion_payload(contact_payload, false) then
        raise exception 'contact import update payload is invalid' using errcode = '23514';
      end if;
      update public.contacts contact set
        first_name = case when contact_payload ? 'firstName' then contact_payload->>'firstName' else contact.first_name end,
        last_name = case when contact_payload ? 'lastName' then contact_payload->>'lastName' else contact.last_name end,
        preferred_name = case when contact_payload ? 'preferredName' then contact_payload->>'preferredName' else contact.preferred_name end,
        phone = case when contact_payload ? 'phone' then contact_payload->>'phone' else contact.phone end,
        secondary_phone = case when contact_payload ? 'secondaryPhone' then contact_payload->>'secondaryPhone' else contact.secondary_phone end,
        email = case when contact_payload ? 'email' then contact_payload->>'email' else contact.email end,
        mailing_address = case when contact_payload ? 'mailingAddress' then contact_payload->>'mailingAddress' else contact.mailing_address end,
        city = case when contact_payload ? 'city' then contact_payload->>'city' else contact.city end,
        state = case when contact_payload ? 'state' then contact_payload->>'state' else contact.state end,
        postal_code = case when contact_payload ? 'postalCode' then contact_payload->>'postalCode' else contact.postal_code end,
        birthdate = case when contact_payload ? 'birthdate' then (contact_payload->>'birthdate')::date else contact.birthdate end,
        home_purchase_date = case when contact_payload ? 'homePurchaseDate' then (contact_payload->>'homePurchaseDate')::date else contact.home_purchase_date end,
        lead_type = case when contact_payload ? 'leadType' then (contact_payload->>'leadType')::public.lead_type else contact.lead_type end,
        relationship = case when contact_payload ? 'relationship' then (contact_payload->>'relationship')::public.relationship else contact.relationship end,
        intent = case when contact_payload ? 'intent' then (contact_payload->>'intent')::public.intent else contact.intent end,
        source = case when contact_payload ? 'source' then (contact_payload->>'source')::public.lead_source else contact.source end,
        pipeline_stage = case when contact_payload ? 'pipelineStage' then (contact_payload->>'pipelineStage')::public.pipeline_stage else contact.pipeline_stage end,
        buyer_criteria = case when contact_payload ? 'buyer' then contact_payload->'buyer' else contact.buyer_criteria end,
        seller_criteria = case when contact_payload ? 'seller' then contact_payload->'seller' else contact.seller_criteria end,
        referred_by_id = case when contact_payload ? 'referredById' then (contact_payload->>'referredById')::uuid else contact.referred_by_id end,
        last_contacted_at = case when contact_payload ? 'lastContactedAt' then (contact_payload->>'lastContactedAt')::timestamptz else contact.last_contacted_at end,
        next_touch_at = case when contact_payload ? 'nextTouchAt' then (contact_payload->>'nextTouchAt')::date else contact.next_touch_at end,
        touch_date_overridden = case when contact_payload ? 'touchDateOverridden' then (contact_payload->>'touchDateOverridden')::boolean else contact.touch_date_overridden end,
        tags = case when contact_payload ? 'tags' then array(select value from jsonb_array_elements_text(contact_payload->'tags') value) else contact.tags end,
        email_subscribed = case when contact_payload ? 'emailSubscribed' then (contact_payload->>'emailSubscribed')::boolean else contact.email_subscribed end
      where contact.id = resolved_contact.id returning * into resolved_contact;
      perform public.append_rich_contact_activity_event(
        target_workspace_id, 'contact-updated', actor.id, target_occurred_at,
        public.rich_contact_event_key('contact-import-updated', resolved_contact.id, target_occurred_at),
        resolved_contact.id, null, null
      );
    elsif contact_payload <> '{}'::jsonb then
      raise exception 'unchanged import plan cannot mutate contact fields'
        using errcode = '23514';
    end if;
  end if;

  for item in select value from jsonb_array_elements(
    coalesce(target_plan->'points', '[]'::jsonb)
  ) element(value) loop
    if jsonb_typeof(item) <> 'object' or not public.jsonb_object_has_only(item, array[
      'type', 'label', 'displayValue', 'normalizedValue', 'isPrimary',
      'emailSubscribed', 'displayOrder'
    ]) then raise exception 'import contact point mapping is invalid' using errcode = '23514'; end if;
    perform public.add_contact_point(
      resolved_contact.id, (item->>'type')::public.crm_contact_point_type,
      item->>'label', item->>'displayValue', item->>'normalizedValue',
      (item->>'isPrimary')::boolean,
      case when item ? 'emailSubscribed' then (item->>'emailSubscribed')::boolean end,
      (item->>'displayOrder')::integer, actor.id, target_occurred_at
    );
  end loop;

  for item in select value from jsonb_array_elements(
    coalesce(target_plan->'householdIds', '[]'::jsonb)
  ) element(value) loop
    perform public.add_household_member(
      (item #>> '{}')::uuid, resolved_contact.id, actor.id, target_occurred_at
    );
  end loop;

  for item in select value from jsonb_array_elements(
    coalesce(target_plan->'assigneeMembershipIds', '[]'::jsonb)
  ) element(value) loop
    perform public.assign_contact(
      resolved_contact.id, (item #>> '{}')::uuid, actor.id, target_occurred_at
    );
  end loop;

  for item in select value from jsonb_array_elements(
    coalesce(target_plan->'customValues', '[]'::jsonb)
  ) element(value) loop
    if jsonb_typeof(item) <> 'object'
       or not public.jsonb_object_has_only(item, array['definitionId', 'value']) then
      raise exception 'import custom-field mapping is invalid' using errcode = '23514';
    end if;
    perform public.set_contact_custom_field_value(
      resolved_contact.id, (item->>'definitionId')::uuid, item->'value',
      actor.id, target_occurred_at
    );
  end loop;

  if target_plan ? 'externalLink' then
    item := target_plan->'externalLink';
    if jsonb_typeof(item) <> 'object'
       or not public.jsonb_object_has_only(item, array['provider', 'externalId']) then
      raise exception 'import external link mapping is invalid' using errcode = '23514';
    end if;
    insert into public.contact_external_links (
      owner_id, workspace_id, contact_id, provider, external_id
    ) values (
      compatibility_owner_id, target_workspace_id, resolved_contact.id,
      item->>'provider', item->>'externalId'
    ) on conflict (workspace_id, provider, external_id) do update
      set contact_id = case
        when public.contact_external_links.contact_id = excluded.contact_id
          then excluded.contact_id
        else public.contact_external_links.contact_id
      end;
    if not exists (
      select 1 from public.contact_external_links link
      where link.workspace_id = target_workspace_id
        and link.provider = item->>'provider'
        and link.external_id = item->>'externalId'
        and link.contact_id = resolved_contact.id
    ) then
      raise exception 'external identity is linked to another contact'
        using errcode = '23505';
    end if;
  end if;

  if target_plan ? 'note' then
    -- Serialize exact-note dedupe for the contact so concurrent groups cannot
    -- both observe absence. Existing import behavior intentionally reuses an
    -- exact note rather than appending duplicate evidence.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        resolved_contact.id::text || ':note:' ||
        encode(extensions.digest(
          convert_to(btrim(target_plan->>'note'), 'UTF8'), 'sha256'
        ), 'hex'),
        0
      )
    );
    if not exists (
      select 1 from public.notes note
      where note.workspace_id = target_workspace_id
        and note.contact_id = resolved_contact.id
        and btrim(note.body) = btrim(target_plan->>'note')
    ) then
      insert into public.notes (
        contact_id, owner_id, workspace_id, body, created_at
      ) values (
        resolved_contact.id, compatibility_owner_id, target_workspace_id,
        btrim(target_plan->>'note'), target_occurred_at
      ) returning * into created_note;
      perform public.append_rich_contact_activity_event(
        target_workspace_id, 'note-added', actor.id, target_occurred_at,
        'note-added:' || created_note.id::text,
        resolved_contact.id, null, null
      );
      notes_added := true;
    end if;
  end if;

  perform public.append_rich_contact_activity_event(
    target_workspace_id, 'contact-imported', actor.id, target_occurred_at,
    activity_key, resolved_contact.id, null, null
  );
  result := jsonb_build_object(
    'contactId', resolved_contact.id::text,
    'action', action_name,
    'notesAdded', notes_added,
    'noOp', false
  );
  insert into public.contact_intake_receipts (
    owner_id, workspace_id, idempotency_key, request_hash,
    status_code, response_json, created_at
  ) values (
    compatibility_owner_id, target_workspace_id,
    target_group_idempotency_key, target_request_hash,
    200, result, target_occurred_at
  );
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'contact import group contains an invalid typed value'
    using errcode = '23514';
end;
$$;

-- Active-contact read surface. Explicit archived detail continues on contacts.
create view public.active_contacts
with (security_invoker = true)
as
select contact.*
from public.contacts contact
where contact.archived_at is null;

revoke all on table public.active_contacts from public, anon, authenticated, service_role;
grant select on table public.active_contacts to authenticated, service_role;

-- RPC privileges are explicit; new tables remain read-only to clients. -----

revoke all on function public.add_contact_point(
  uuid, public.crm_contact_point_type, text, text, text, boolean, boolean,
  integer, uuid, timestamptz
) from public;
revoke all on function public.update_contact_point(
  uuid, text, text, text, boolean, boolean, integer, uuid, timestamptz
) from public;
revoke all on function public.archive_contact_point(uuid, uuid, text, timestamptz) from public;
revoke all on function public.restore_contact_point(uuid, uuid, timestamptz) from public;
revoke all on function public.create_household(text, uuid, timestamptz) from public;
revoke all on function public.update_household(uuid, text, uuid, timestamptz) from public;
revoke all on function public.archive_household(uuid, uuid, timestamptz) from public;
revoke all on function public.restore_household(uuid, uuid, timestamptz) from public;
revoke all on function public.add_household_member(uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.remove_household_member(
  uuid, uuid, uuid, timestamptz
) from public;
revoke all on function public.add_contact_relationship(
  uuid, uuid, public.crm_person_relationship_kind, text, uuid, timestamptz
) from public;
revoke all on function public.archive_contact_relationship(uuid, uuid, timestamptz) from public;
revoke all on function public.restore_contact_relationship(uuid, uuid, timestamptz) from public;
revoke all on function public.assign_contact(uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.unassign_contact(uuid, uuid, timestamptz) from public;
revoke all on function public.create_contact_custom_field_definition(
  text, public.crm_custom_field_type, text[], integer, uuid, timestamptz
) from public;
revoke all on function public.archive_contact_custom_field_definition(
  uuid, uuid, timestamptz
) from public;
revoke all on function public.set_contact_custom_field_value(
  uuid, uuid, jsonb, uuid, timestamptz
) from public;
revoke all on function public.archive_contact(uuid, uuid, text, timestamptz) from public;
revoke all on function public.restore_contact(uuid, uuid, timestamptz) from public;
revoke all on function public.resolve_contact_import_identity(
  uuid, text, text, text, text
) from public;
revoke all on function public.apply_contact_import_group(
  uuid, uuid, text, text, jsonb, timestamptz
) from public;

grant execute on function public.add_contact_point(
  uuid, public.crm_contact_point_type, text, text, text, boolean, boolean,
  integer, uuid, timestamptz
) to authenticated;
grant execute on function public.update_contact_point(
  uuid, text, text, text, boolean, boolean, integer, uuid, timestamptz
) to authenticated;
grant execute on function public.archive_contact_point(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.restore_contact_point(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.create_household(text, uuid, timestamptz) to authenticated;
grant execute on function public.update_household(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function public.archive_household(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.restore_household(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.add_household_member(uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.remove_household_member(
  uuid, uuid, uuid, timestamptz
) to authenticated;
grant execute on function public.add_contact_relationship(
  uuid, uuid, public.crm_person_relationship_kind, text, uuid, timestamptz
) to authenticated;
grant execute on function public.archive_contact_relationship(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.restore_contact_relationship(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.assign_contact(uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.unassign_contact(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.create_contact_custom_field_definition(
  text, public.crm_custom_field_type, text[], integer, uuid, timestamptz
) to authenticated;
grant execute on function public.archive_contact_custom_field_definition(
  uuid, uuid, timestamptz
) to authenticated;
grant execute on function public.set_contact_custom_field_value(
  uuid, uuid, jsonb, uuid, timestamptz
) to authenticated;
grant execute on function public.archive_contact(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.restore_contact(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.resolve_contact_import_identity(
  uuid, text, text, text, text
) to authenticated, service_role;
grant execute on function public.apply_contact_import_group(
  uuid, uuid, text, text, jsonb, timestamptz
) to authenticated, service_role;

-- Embedded schema documentation -------------------------------------------

comment on table public.contact_points is
  'Canonical Story 3.2 phone/email points; legacy contact scalars are transactional projections.';
comment on table public.households is
  'Workspace-local grouping only; household membership never authorizes or deduplicates contacts.';
comment on table public.household_memberships is
  'Durable household membership history; ended_at removes active membership without deletion.';
comment on table public.contact_relationships is
  'Canonical unordered contact pairs with one active relationship per pair.';
comment on table public.contact_assignments is
  'Contact-to-active-workspace-member assignment history with explicit unassignment evidence.';
comment on table public.contact_custom_field_definitions is
  'Owner-defined bounded typed data; never executable expressions, schema or SQL.';
comment on table public.contact_custom_field_values is
  'Exactly one typed value per workspace/contact/definition.';
comment on view public.active_contacts is
  'Default contact read surface excluding archived contacts; archived detail uses contacts explicitly.';
comment on function public.apply_contact_import_group(
  uuid, uuid, text, text, jsonb, timestamptz
) is
  'Atomic per-target-group import v1. All contact/point/household/assignment/custom/link/activity writes commit or roll back together.';

-- Fail-closed migration verification --------------------------------------

do $$
declare
  target_table text;
  expected_backfill_count bigint;
  actual_backfill_count bigint;
begin
  foreach target_table in array array[
    'contact_points', 'households', 'household_memberships',
    'contact_relationships', 'contact_assignments',
    'contact_custom_field_definitions', 'contact_custom_field_values'
  ] loop
    if not exists (
      select 1 from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = target_table
        and column_info.column_name = 'workspace_id'
        and column_info.is_nullable = 'NO'
    ) then
      raise exception 'workspace authority missing on %', target_table;
    end if;
    if exists (
      select 1 from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = target_table
        and column_info.column_name in ('owner_id', 'rating')
    ) then
      raise exception 'legacy owner or independent rating found on %', target_table;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relname = target_table
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then
      raise exception 'forced RLS missing on %', target_table;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'contacts'
      and column_info.column_name = 'rating'
  ) then
    raise exception 'independent contact rating is prohibited';
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
    into expected_backfill_count
  from public.contacts;

  select count(*) into actual_backfill_count
  from public.contact_points;
  if actual_backfill_count <> expected_backfill_count then
    raise exception 'contact-point backfill count mismatch: expected %, actual %',
      expected_backfill_count, actual_backfill_count;
  end if;
end;
$$;

commit;
