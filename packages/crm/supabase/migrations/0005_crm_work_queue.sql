-- Omnix — CRM work queue foundation
-- Story 3.1: persisted Smart Lists, incomplete-record quarantine, mutable
-- follow-up tasks and immutable CRM activity evidence.
--
-- New rows are authorized only by workspace_id plus Story 3.0 active
-- membership. No new table carries or trusts legacy owner_id.

begin;

do $$
begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.workspace_members') is null
     or to_regprocedure('public.has_workspace_access(uuid)') is null then
    raise exception 'migration 0004 shared workspace authority is required';
  end if;
end;
$$;

-- Domain enums -------------------------------------------------------------

create type smart_list_status as enum ('active', 'archived');
create type incomplete_record_status as enum ('pending', 'converted', 'archived');
create type incomplete_conversion_action as enum ('create', 'update', 'unchanged');
create type crm_task_status as enum ('open', 'completed', 'archived');
create type crm_activity_event_type as enum (
  'contact-created',
  'contact-updated',
  'contact-imported',
  'note-added',
  'touch-recorded',
  'incomplete-record-converted',
  'task-created',
  'task-completed',
  'task-archived'
);

-- Closed JSON validation helpers ------------------------------------------

create or replace function jsonb_object_has_only(
  target jsonb,
  allowed_keys text[]
)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(target) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(target) as key_name
      where not (key_name = any (allowed_keys))
    );
$$;

create or replace function jsonb_is_string_array(target jsonb, allow_empty boolean)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(target) = 'array'
    and (allow_empty or jsonb_array_length(target) > 0)
    and not exists (
      select 1
      from jsonb_array_elements(target) as item(value)
      where jsonb_typeof(item.value) <> 'string'
         or length(trim(item.value #>> '{}')) = 0
         or length(item.value #>> '{}') > 200
         or (item.value #>> '{}') ~ '[[:cntrl:]]'
    );
$$;

create or replace function is_iso_date_value(target jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  parsed_date date;
  date_text text;
begin
  if jsonb_typeof(target) <> 'string' then
    return false;
  end if;

  date_text := target #>> '{}';
  if date_text !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;

  parsed_date := date_text::date;
  return parsed_date::text = date_text;
exception when others then
  return false;
end;
$$;

create or replace function is_valid_smart_list_definition(target jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  criterion jsonb;
  criterion_field text;
  criterion_operator text;
  enum_value jsonb;
begin
  if not public.jsonb_object_has_only(
    target,
    array['schemaVersion', 'criteria', 'sort']
  )
     or target->>'schemaVersion' <> 'smart-list-filter.v1'
     or jsonb_typeof(target->'criteria') <> 'array'
     or jsonb_array_length(target->'criteria') > 20 then
    return false;
  end if;

  if target ? 'sort' then
    if not public.jsonb_object_has_only(target->'sort', array['field', 'direction'])
       or target#>>'{sort,field}' not in ('priority', 'name', 'nextTouchAt', 'createdAt')
       or target#>>'{sort,direction}' not in ('asc', 'desc') then
      return false;
    end if;
  end if;

  for criterion in select value from jsonb_array_elements(target->'criteria') loop
    if jsonb_typeof(criterion) <> 'object'
       or jsonb_typeof(criterion->'field') <> 'string'
       or jsonb_typeof(criterion->'operator') <> 'string' then
      return false;
    end if;

    criterion_field := criterion->>'field';
    criterion_operator := criterion->>'operator';

    if criterion_field = 'nextTouchAt' and criterion_operator = 'empty' then
      if not public.jsonb_object_has_only(criterion, array['field', 'operator']) then
        return false;
      end if;
      continue;
    end if;

    if not public.jsonb_object_has_only(criterion, array['field', 'operator', 'value'])
       or not (criterion ? 'value') then
      return false;
    end if;

    if criterion_field = 'query' then
      if criterion_operator not in ('contains', 'eq')
         or jsonb_typeof(criterion->'value') <> 'string'
         or length(trim(criterion->>'value')) not between 1 and 200
         or (criterion->>'value') ~ '[[:cntrl:]]' then
        return false;
      end if;
    elsif criterion_field in (
      'city', 'state', 'postalCode', 'buyer.timeline', 'seller.timeline'
    ) then
      if criterion_operator not in ('contains', 'eq')
         or jsonb_typeof(criterion->'value') <> 'string'
         or length(trim(criterion->>'value')) not between 1 and 200
         or (criterion->>'value') ~ '[[:cntrl:]]' then
        return false;
      end if;
    elsif criterion_field in (
      'leadType', 'relationship', 'intent', 'source', 'pipelineStage'
    ) then
      if criterion_operator = 'eq' then
        if jsonb_typeof(criterion->'value') <> 'string' then
          return false;
        end if;
      elsif criterion_operator = 'in' then
        if not public.jsonb_is_string_array(criterion->'value', false) then
          return false;
        end if;
      else
        return false;
      end if;

      for enum_value in
        select case
          when criterion_operator = 'eq' then criterion->'value'
          else value
        end
        from jsonb_array_elements(
          case
            when criterion_operator = 'eq' then jsonb_build_array(criterion->'value')
            else criterion->'value'
          end
        )
      loop
        if (criterion_field = 'leadType'
              and enum_value #>> '{}' not in ('hot', 'warm', 'nurture'))
           or (criterion_field = 'relationship'
              and enum_value #>> '{}' not in ('lead', 'active-client', 'past-client', 'sphere'))
           or (criterion_field = 'intent'
              and enum_value #>> '{}' not in ('buyer', 'seller', 'both', 'investor', 'renter', 'unknown'))
           or (criterion_field = 'source'
              and enum_value #>> '{}' not in ('cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other'))
           or (criterion_field = 'pipelineStage'
              and enum_value #>> '{}' not in ('new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost')) then
          return false;
        end if;
      end loop;
    elsif criterion_field in ('buyer.priceMin', 'buyer.priceMax') then
      if criterion_operator not in ('min', 'max')
         or jsonb_typeof(criterion->'value') <> 'number'
         or (criterion->>'value')::numeric < 0 then
        return false;
      end if;
    elsif criterion_field = 'tags' then
      if criterion_operator not in ('any', 'all')
         or not public.jsonb_is_string_array(criterion->'value', false)
         or jsonb_array_length(criterion->'value') > 50
         or exists (
           select 1
           from jsonb_array_elements_text(criterion->'value') tag(value)
           where length(tag.value) > 80
         ) then
        return false;
      end if;
    elsif criterion_field = 'nextTouchAt' then
      if criterion_operator not in ('before', 'on', 'after')
         or not public.is_iso_date_value(criterion->'value') then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function is_valid_incomplete_candidate(target jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  key_name text;
  maximum_length integer;
begin
  if not public.jsonb_object_has_only(target, array[
    'firstName', 'lastName', 'preferredName', 'phone', 'secondaryPhone',
    'email', 'mailingAddress', 'city', 'state', 'postalCode', 'birthdate',
    'homePurchaseDate', 'leadType', 'relationship', 'intent', 'source',
    'pipelineStage', 'tags', 'emailSubscribed'
  ]) then
    return false;
  end if;

  foreach key_name in array array[
    'firstName', 'lastName', 'preferredName', 'phone', 'secondaryPhone',
    'email', 'mailingAddress', 'city', 'state', 'postalCode'
  ] loop
    if target ? key_name then
      maximum_length := case key_name
        when 'firstName' then 120
        when 'lastName' then 120
        when 'preferredName' then 120
        when 'phone' then 40
        when 'secondaryPhone' then 40
        when 'email' then 254
        when 'mailingAddress' then 300
        when 'city' then 120
        when 'state' then 80
        when 'postalCode' then 24
      end;
      if jsonb_typeof(target->key_name) <> 'string'
         or length(trim(target->>key_name)) not between 1 and maximum_length
         or (target->>key_name) ~ '[[:cntrl:]]' then
        return false;
      end if;
    end if;
  end loop;

  if target ? 'email'
     and (
       target->>'email' <> lower(target->>'email')
       or target->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     ) then
    return false;
  end if;
  if target ? 'phone' and target->>'phone' !~ '^[0-9]{7,15}$' then
    return false;
  end if;
  if target ? 'secondaryPhone'
     and target->>'secondaryPhone' !~ '^[0-9]{7,15}$' then
    return false;
  end if;

  if target ? 'birthdate' and not public.is_iso_date_value(target->'birthdate') then
    return false;
  end if;
  if target ? 'homePurchaseDate'
     and not public.is_iso_date_value(target->'homePurchaseDate') then
    return false;
  end if;
  if target ? 'leadType'
     and (jsonb_typeof(target->'leadType') <> 'string'
       or target->>'leadType' not in ('hot', 'warm', 'nurture')) then
    return false;
  end if;
  if target ? 'relationship'
     and (jsonb_typeof(target->'relationship') <> 'string'
       or target->>'relationship' not in ('lead', 'active-client', 'past-client', 'sphere')) then
    return false;
  end if;
  if target ? 'intent'
     and (jsonb_typeof(target->'intent') <> 'string'
       or target->>'intent' not in ('buyer', 'seller', 'both', 'investor', 'renter', 'unknown')) then
    return false;
  end if;
  if target ? 'source'
     and (jsonb_typeof(target->'source') <> 'string'
       or target->>'source' not in ('cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other')) then
    return false;
  end if;
  if target ? 'pipelineStage'
     and (jsonb_typeof(target->'pipelineStage') <> 'string'
       or target->>'pipelineStage' not in ('new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost')) then
    return false;
  end if;
  if target ? 'tags' then
    if not public.jsonb_is_string_array(target->'tags', true)
       or jsonb_array_length(target->'tags') > 50
       or exists (
         select 1
         from jsonb_array_elements_text(target->'tags') tag(value)
         where length(tag.value) > 80
       )
       or (
         select count(distinct tag.value)
         from jsonb_array_elements_text(target->'tags') tag(value)
       ) <> jsonb_array_length(target->'tags') then
      return false;
    end if;
  end if;
  if target ? 'emailSubscribed'
     and jsonb_typeof(target->'emailSubscribed') <> 'boolean' then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function is_valid_incomplete_reasons(target jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(target) = 'array'
    and jsonb_array_length(target) > 0
    and not exists (
      select 1
      from jsonb_array_elements(target) as reason(value)
      where not public.jsonb_object_has_only(reason.value, array['field', 'code', 'message'])
         or jsonb_typeof(reason.value->'field') <> 'string'
         or jsonb_typeof(reason.value->'code') <> 'string'
         or jsonb_typeof(reason.value->'message') <> 'string'
         or length(trim(reason.value->>'field')) = 0
         or length(trim(reason.value->>'code')) = 0
         or length(trim(reason.value->>'message')) = 0
    );
$$;

grant execute on function jsonb_object_has_only(jsonb, text[]) to authenticated;
grant execute on function jsonb_is_string_array(jsonb, boolean) to authenticated;
grant execute on function is_iso_date_value(jsonb) to authenticated;
grant execute on function is_valid_smart_list_definition(jsonb) to authenticated;
grant execute on function is_valid_incomplete_candidate(jsonb) to authenticated;
grant execute on function is_valid_incomplete_reasons(jsonb) to authenticated;

-- Core tables --------------------------------------------------------------

create table smart_lists (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references workspaces (id) on delete restrict,
  name                      text not null,
  definition                jsonb not null,
  status                    smart_list_status not null default 'active',
  created_by_membership_id  uuid not null,
  archived_at               timestamptz,
  archived_by_membership_id uuid,
  archive_reason            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint smart_lists_id_workspace_unique unique (id, workspace_id),
  constraint smart_lists_created_by_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint smart_lists_archived_by_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint smart_lists_name_length check (length(trim(name)) between 1 and 80),
  constraint smart_lists_definition_valid check (
    public.is_valid_smart_list_definition(definition)
  ),
  constraint smart_lists_archive_reason_length check (
    archive_reason is null or length(archive_reason) <= 500
  ),
  constraint smart_lists_archive_state check (
    (status = 'active' and archived_at is null
      and archived_by_membership_id is null and archive_reason is null)
    or
    (status = 'archived' and archived_at is not null
      and archived_by_membership_id is not null)
  )
);

create table incomplete_records (
  id                              uuid primary key default gen_random_uuid(),
  workspace_id                    uuid not null references workspaces (id) on delete restrict,
  source                          text not null,
  external_id                     text,
  candidate                       jsonb not null,
  validation_reasons              jsonb not null,
  status                          incomplete_record_status not null default 'pending',
  intake_idempotency_key          text,
  intake_request_hash             text,
  converted_contact_id            uuid,
  conversion_action               incomplete_conversion_action,
  conversion_idempotency_key      text,
  conversion_request_hash         text,
  converted_at                    timestamptz,
  converted_by_membership_id      uuid,
  archived_at                     timestamptz,
  archived_by_membership_id       uuid,
  archive_reason                  text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  constraint incomplete_records_id_workspace_unique unique (id, workspace_id),
  constraint incomplete_records_contact_workspace_fk
    foreign key (converted_contact_id, workspace_id)
    references contacts (id, workspace_id) on delete restrict,
  constraint incomplete_records_converted_by_workspace_fk
    foreign key (converted_by_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint incomplete_records_archived_by_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint incomplete_records_source_length check (
    length(trim(source)) between 1 and 64
  ),
  constraint incomplete_records_external_id_length check (
    external_id is null or length(trim(external_id)) between 1 and 255
  ),
  constraint incomplete_records_candidate_valid check (
    public.is_valid_incomplete_candidate(candidate)
  ),
  constraint incomplete_records_reasons_valid check (
    public.is_valid_incomplete_reasons(validation_reasons)
  ),
  constraint incomplete_records_identity_signal check (
    coalesce(length(trim(candidate->>'firstName')), 0) > 0
    or coalesce(length(trim(candidate->>'lastName')), 0) > 0
    or coalesce(length(trim(candidate->>'preferredName')), 0) > 0
    or coalesce(length(trim(candidate->>'phone')), 0) > 0
    or coalesce(length(trim(candidate->>'email')), 0) > 0
    or external_id is not null
  ),
  constraint incomplete_records_intake_key_pair check (
    (intake_idempotency_key is null and intake_request_hash is null)
    or
    (length(trim(intake_idempotency_key)) > 0
      and intake_request_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint incomplete_records_conversion_key_pair check (
    (conversion_idempotency_key is null and conversion_request_hash is null)
    or
    (length(trim(conversion_idempotency_key)) > 0
      and conversion_request_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint incomplete_records_archive_reason_length check (
    archive_reason is null or length(trim(archive_reason)) between 1 and 500
  ),
  constraint incomplete_records_state check (
    (status = 'pending'
      and converted_contact_id is null and conversion_action is null
      and conversion_idempotency_key is null and conversion_request_hash is null
      and converted_at is null and converted_by_membership_id is null
      and archived_at is null and archived_by_membership_id is null
      and archive_reason is null)
    or
    (status = 'converted'
      and converted_contact_id is not null and conversion_action is not null
      and conversion_idempotency_key is not null and conversion_request_hash is not null
      and converted_at is not null and converted_by_membership_id is not null
      and archived_at is null and archived_by_membership_id is null
      and archive_reason is null)
    or
    (status = 'archived'
      and converted_contact_id is null and conversion_action is null
      and conversion_idempotency_key is null and conversion_request_hash is null
      and converted_at is null and converted_by_membership_id is null
      and archived_at is not null and archived_by_membership_id is not null
      and archive_reason is not null)
  )
);

create unique index incomplete_records_workspace_intake_key_idx
  on incomplete_records (workspace_id, intake_idempotency_key)
  where intake_idempotency_key is not null;

create unique index incomplete_records_workspace_conversion_key_idx
  on incomplete_records (workspace_id, conversion_idempotency_key)
  where conversion_idempotency_key is not null;

create table tasks (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references workspaces (id) on delete restrict,
  contact_id                uuid,
  title                     text not null,
  description               text,
  due_at                    timestamptz not null,
  status                    crm_task_status not null default 'open',
  creator_membership_id     uuid not null,
  assignee_membership_id    uuid not null,
  create_idempotency_key    text,
  create_request_hash       text,
  completed_at              timestamptz,
  completed_by_membership_id uuid,
  archived_at               timestamptz,
  archived_by_membership_id uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint tasks_id_workspace_unique unique (id, workspace_id),
  constraint tasks_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references contacts (id, workspace_id) on delete restrict,
  constraint tasks_creator_workspace_fk
    foreign key (creator_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint tasks_assignee_workspace_fk
    foreign key (assignee_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint tasks_completed_by_workspace_fk
    foreign key (completed_by_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint tasks_archived_by_workspace_fk
    foreign key (archived_by_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint tasks_title_present check (length(trim(title)) > 0),
  constraint tasks_title_length check (length(title) <= 160),
  constraint tasks_title_printable check (title !~ '[[:cntrl:]]'),
  constraint tasks_description_valid check (
    description is null
    or (length(description) between 1 and 2000 and description !~ '[[:cntrl:]]')
  ),
  constraint tasks_create_key_pair check (
    (create_idempotency_key is null and create_request_hash is null)
    or
    (create_idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'
      and create_request_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint tasks_state check (
    (status = 'open'
      and completed_at is null and completed_by_membership_id is null
      and archived_at is null and archived_by_membership_id is null)
    or
    (status = 'completed'
      and completed_at is not null and completed_by_membership_id is not null
      and archived_at is null and archived_by_membership_id is null)
    or
    (status = 'archived'
      and archived_at is not null and archived_by_membership_id is not null
      and ((completed_at is null and completed_by_membership_id is null)
        or (completed_at is not null and completed_by_membership_id is not null)))
  )
);

create table activity_events (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces (id) on delete restrict,
  type                  crm_activity_event_type not null,
  contact_id            uuid,
  task_id               uuid,
  incomplete_record_id  uuid,
  actor_membership_id   uuid not null,
  occurred_at           timestamptz not null,
  created_at            timestamptz not null default now(),
  idempotency_key       text not null,

  constraint activity_events_id_workspace_unique unique (id, workspace_id),
  constraint activity_events_workspace_key_unique unique (workspace_id, idempotency_key),
  constraint activity_events_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references contacts (id, workspace_id) on delete restrict,
  constraint activity_events_task_workspace_fk
    foreign key (task_id, workspace_id)
    references tasks (id, workspace_id) on delete restrict,
  constraint activity_events_incomplete_workspace_fk
    foreign key (incomplete_record_id, workspace_id)
    references incomplete_records (id, workspace_id) on delete restrict,
  constraint activity_events_actor_workspace_fk
    foreign key (actor_membership_id, workspace_id)
    references workspace_members (id, workspace_id) on delete restrict,
  constraint activity_events_idempotency_key_present check (
    idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  constraint activity_events_target_shape check (
    (type in ('contact-created', 'contact-updated', 'contact-imported',
      'note-added', 'touch-recorded') and contact_id is not null
      and task_id is null and incomplete_record_id is null)
    or
    (type = 'incomplete-record-converted' and contact_id is not null
      and task_id is null and incomplete_record_id is not null)
    or
    (type in ('task-created', 'task-completed', 'task-archived')
      and task_id is not null and incomplete_record_id is null)
  )
);

-- Query-path indexes -------------------------------------------------------

create index smart_lists_workspace_status_updated_idx
  on smart_lists (workspace_id, status, updated_at desc);

create index incomplete_records_workspace_status_created_idx
  on incomplete_records (workspace_id, status, created_at desc);

create index tasks_workspace_open_due_idx
  on tasks (workspace_id, due_at, created_at)
  where status = 'open';

create index tasks_workspace_status_due_idx
  on tasks (workspace_id, status, due_at, created_at);

create index tasks_workspace_contact_created_idx
  on tasks (workspace_id, contact_id, created_at desc)
  where contact_id is not null;

create index tasks_workspace_assignee_due_idx
  on tasks (workspace_id, assignee_membership_id, status, due_at);

create unique index tasks_workspace_create_key_idx
  on tasks (workspace_id, create_idempotency_key)
  where create_idempotency_key is not null;

create index activity_events_workspace_occurred_idx
  on activity_events (workspace_id, occurred_at desc, created_at desc);

create index activity_events_workspace_contact_occurred_idx
  on activity_events (workspace_id, contact_id, occurred_at desc)
  where contact_id is not null;

create index activity_events_workspace_task_occurred_idx
  on activity_events (workspace_id, task_id, occurred_at desc)
  where task_id is not null;

-- Membership and mutation guards ------------------------------------------

create or replace function crm_membership_is_active(
  target_membership_id uuid,
  target_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.id = target_membership_id
      and membership.workspace_id = target_workspace_id
      and membership.status = 'active'
  );
$$;

create or replace function assert_crm_actor_membership(
  target_membership_id uuid,
  target_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  membership_user_id uuid;
  caller_id uuid := auth.uid();
begin
  select membership.user_id
    into membership_user_id
    from public.workspace_members membership
    where membership.id = target_membership_id
      and membership.workspace_id = target_workspace_id
      and membership.status = 'active';

  if membership_user_id is null
     or (caller_id is not null and caller_id <> membership_user_id) then
    raise exception 'active actor membership is required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function crm_membership_is_active(uuid, uuid) from public;
revoke all on function assert_crm_actor_membership(uuid, uuid) from public;

create or replace function guard_crm_work_queue_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are archived, not deleted', tg_table_name
    using errcode = '23514';
end;
$$;

create or replace function prepare_smart_list_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_crm_actor_membership(
      new.created_by_membership_id,
      new.workspace_id
    );
    if new.status <> 'active' then
      raise exception 'new Smart Lists must be active' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.created_by_membership_id <> old.created_by_membership_id
     or new.created_at <> old.created_at then
    raise exception 'Smart List identity is immutable' using errcode = '23514';
  end if;

  if new.status = 'archived' and old.status <> 'archived' then
    if new.archived_by_membership_id is null then
      raise exception 'archive actor membership is required' using errcode = '23514';
    end if;
    perform public.assert_crm_actor_membership(
      new.archived_by_membership_id,
      new.workspace_id
    );
    new.archived_at := coalesce(new.archived_at, now());
  elsif new.status = 'active' and old.status = 'archived' then
    new.archived_at := null;
    new.archived_by_membership_id := null;
    new.archive_reason := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function prepare_incomplete_record_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'new incomplete records must be pending' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.created_at <> old.created_at then
    raise exception 'incomplete record identity is immutable' using errcode = '23514';
  end if;

  if old.status = 'converted' then
    raise exception 'converted incomplete records are immutable' using errcode = '23514';
  elsif old.status = 'archived' and new.status not in ('archived', 'pending') then
    raise exception 'archived incomplete records can only be restored' using errcode = '23514';
  elsif old.status = 'pending' and new.status = 'converted' then
    -- Direct authenticated UPDATE is blocked by RLS. The conversion RPC runs
    -- as the table owner after validating and applying the whole transaction.
    null;
  end if;

  if new.status = 'archived' and old.status <> 'archived' then
    if new.archived_by_membership_id is null or new.archive_reason is null then
      raise exception 'archive actor and reason are required' using errcode = '23514';
    end if;
    perform public.assert_crm_actor_membership(
      new.archived_by_membership_id,
      new.workspace_id
    );
    new.archived_at := coalesce(new.archived_at, now());
  elsif new.status = 'pending' and old.status = 'archived' then
    new.archived_at := null;
    new.archived_by_membership_id := null;
    new.archive_reason := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function prepare_task_write()
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

create or replace function prepare_activity_event_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_crm_actor_membership(
    new.actor_membership_id,
    new.workspace_id
  );
  return new;
end;
$$;

create or replace function guard_activity_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'activity events are append-only' using errcode = '23514';
end;
$$;

revoke all on function guard_crm_work_queue_delete() from public;
revoke all on function prepare_smart_list_write() from public;
revoke all on function prepare_incomplete_record_write() from public;
revoke all on function prepare_task_write() from public;
revoke all on function prepare_activity_event_insert() from public;
revoke all on function guard_activity_event_mutation() from public;

create trigger smart_lists_prepare_write
  before insert or update on smart_lists
  for each row execute function prepare_smart_list_write();
create trigger smart_lists_guard_delete
  before delete on smart_lists
  for each row execute function guard_crm_work_queue_delete();

create trigger incomplete_records_prepare_write
  before insert or update on incomplete_records
  for each row execute function prepare_incomplete_record_write();
create trigger incomplete_records_guard_delete
  before delete on incomplete_records
  for each row execute function guard_crm_work_queue_delete();

create trigger tasks_prepare_write
  before insert or update on tasks
  for each row execute function prepare_task_write();
create trigger tasks_guard_delete
  before delete on tasks
  for each row execute function guard_crm_work_queue_delete();

create trigger activity_events_prepare_insert
  before insert on activity_events
  for each row execute function prepare_activity_event_insert();
create trigger activity_events_guard_update
  before update on activity_events
  for each row execute function guard_activity_event_mutation();
create trigger activity_events_guard_delete
  before delete on activity_events
  for each row execute function guard_activity_event_mutation();

-- Idempotent command RPCs --------------------------------------------------

create or replace function is_valid_buyer_conversion_payload(target jsonb)
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

create or replace function is_valid_seller_conversion_payload(target jsonb)
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

create or replace function is_valid_contact_conversion_payload(
  target jsonb,
  require_full boolean
)
returns boolean
language plpgsql
immutable
as $$
declare
  key_name text;
  maximum_length integer;
  parsed_uuid uuid;
  parsed_timestamp timestamptz;
begin
  if not public.jsonb_object_has_only(target, array[
    'firstName', 'lastName', 'preferredName', 'phone', 'secondaryPhone',
    'email', 'mailingAddress', 'city', 'state', 'postalCode', 'birthdate',
    'homePurchaseDate', 'leadType', 'relationship', 'intent', 'source',
    'pipelineStage', 'buyer', 'seller', 'referredById', 'lastContactedAt',
    'nextTouchAt', 'touchDateOverridden', 'tags', 'emailSubscribed'
  ]) then
    return false;
  end if;

  if require_full and not (
    target ?& array[
      'firstName', 'lastName', 'leadType', 'relationship', 'intent',
      'source', 'pipelineStage', 'tags'
    ]
  ) then
    return false;
  end if;

  if not require_full and target = '{}'::jsonb then
    return false;
  end if;

  foreach key_name in array array[
    'firstName', 'lastName', 'preferredName', 'phone', 'secondaryPhone',
    'email', 'mailingAddress', 'city', 'state', 'postalCode'
  ] loop
    if target ? key_name then
      maximum_length := case key_name
        when 'firstName' then 120
        when 'lastName' then 120
        when 'preferredName' then 120
        when 'phone' then 40
        when 'secondaryPhone' then 40
        when 'email' then 254
        when 'mailingAddress' then 300
        when 'city' then 120
        when 'state' then 80
        when 'postalCode' then 24
      end;
      if jsonb_typeof(target->key_name) <> 'string'
         or length(target->>key_name) > maximum_length
         or (key_name not in ('firstName', 'lastName')
           and length(trim(target->>key_name)) = 0)
         or (target->>key_name) ~ '[[:cntrl:]]' then
        return false;
      end if;
    end if;
  end loop;

  if target ? 'email'
     and (
       target->>'email' <> lower(target->>'email')
       or target->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     ) then
    return false;
  end if;
  if target ? 'phone' and target->>'phone' !~ '^[0-9]{7,15}$' then
    return false;
  end if;
  if target ? 'secondaryPhone'
     and target->>'secondaryPhone' !~ '^[0-9]{7,15}$' then
    return false;
  end if;

  if require_full and (
    coalesce(length(trim(target->>'firstName')), 0) = 0
    and coalesce(length(trim(target->>'lastName')), 0) = 0
  ) then
    return false;
  end if;

  if target ? 'birthdate' and not public.is_iso_date_value(target->'birthdate') then
    return false;
  end if;
  if target ? 'homePurchaseDate'
     and not public.is_iso_date_value(target->'homePurchaseDate') then
    return false;
  end if;
  if target ? 'nextTouchAt'
     and not public.is_iso_date_value(target->'nextTouchAt') then
    return false;
  end if;

  if target ? 'leadType'
     and (jsonb_typeof(target->'leadType') <> 'string'
       or target->>'leadType' not in ('hot', 'warm', 'nurture')) then
    return false;
  end if;
  if target ? 'relationship'
     and (jsonb_typeof(target->'relationship') <> 'string'
       or target->>'relationship' not in ('lead', 'active-client', 'past-client', 'sphere')) then
    return false;
  end if;
  if target ? 'intent'
     and (jsonb_typeof(target->'intent') <> 'string'
       or target->>'intent' not in ('buyer', 'seller', 'both', 'investor', 'renter', 'unknown')) then
    return false;
  end if;
  if target ? 'source'
     and (jsonb_typeof(target->'source') <> 'string'
       or target->>'source' not in ('cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other')) then
    return false;
  end if;
  if target ? 'pipelineStage'
     and (jsonb_typeof(target->'pipelineStage') <> 'string'
       or target->>'pipelineStage' not in ('new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost')) then
    return false;
  end if;

  if target ? 'buyer'
     and not public.is_valid_buyer_conversion_payload(target->'buyer') then
    return false;
  end if;
  if target ? 'seller'
     and not public.is_valid_seller_conversion_payload(target->'seller') then
    return false;
  end if;
  if target ? 'tags' then
    if not public.jsonb_is_string_array(target->'tags', true)
       or jsonb_array_length(target->'tags') > 50
       or exists (
         select 1 from jsonb_array_elements_text(target->'tags') tag(value)
         where length(tag.value) > 80
       )
       or (
         select count(distinct tag.value)
         from jsonb_array_elements_text(target->'tags') tag(value)
       ) <> jsonb_array_length(target->'tags') then
      return false;
    end if;
  end if;
  if target ? 'touchDateOverridden'
     and jsonb_typeof(target->'touchDateOverridden') <> 'boolean' then
    return false;
  end if;
  if target ? 'emailSubscribed'
     and jsonb_typeof(target->'emailSubscribed') <> 'boolean' then
    return false;
  end if;

  if target ? 'referredById' then
    if jsonb_typeof(target->'referredById') <> 'string' then
      return false;
    end if;
    parsed_uuid := (target->>'referredById')::uuid;
  end if;

  if target ? 'lastContactedAt' then
    if jsonb_typeof(target->'lastContactedAt') <> 'string' then
      return false;
    end if;
    parsed_timestamp := (target->>'lastContactedAt')::timestamptz;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function incomplete_candidate_contact_input(target_candidate jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  key_name text;
  result jsonb := jsonb_build_object(
    'firstName', coalesce(target_candidate->>'firstName', ''),
    'lastName', coalesce(target_candidate->>'lastName', ''),
    'leadType', coalesce(target_candidate->>'leadType', 'warm'),
    'relationship', coalesce(target_candidate->>'relationship', 'lead'),
    'intent', coalesce(target_candidate->>'intent', 'unknown'),
    'source', coalesce(target_candidate->>'source', 'other'),
    'pipelineStage', coalesce(target_candidate->>'pipelineStage', 'new'),
    'tags', coalesce(target_candidate->'tags', '[]'::jsonb),
    'emailSubscribed', coalesce((target_candidate->>'emailSubscribed')::boolean, true),
    'touchDateOverridden', false
  );
begin
  foreach key_name in array array[
    'preferredName', 'phone', 'secondaryPhone', 'email', 'mailingAddress',
    'city', 'state', 'postalCode', 'birthdate', 'homePurchaseDate'
  ] loop
    if target_candidate ? key_name then
      result := result || jsonb_build_object(key_name, target_candidate->key_name);
    end if;
  end loop;
  return result;
exception when others then
  return null;
end;
$$;

create or replace function incomplete_candidate_contact_patch(
  target_candidate jsonb,
  target_contact contacts
)
returns jsonb
language plpgsql
immutable
as $$
declare
  key_name text;
  current_value jsonb;
  result jsonb := '{}'::jsonb;
begin
  for key_name in select jsonb_object_keys(target_candidate) loop
    current_value := case key_name
      when 'firstName' then to_jsonb(target_contact.first_name)
      when 'lastName' then to_jsonb(target_contact.last_name)
      when 'preferredName' then to_jsonb(target_contact.preferred_name)
      when 'phone' then to_jsonb(target_contact.phone)
      when 'secondaryPhone' then to_jsonb(target_contact.secondary_phone)
      when 'email' then to_jsonb(target_contact.email)
      when 'mailingAddress' then to_jsonb(target_contact.mailing_address)
      when 'city' then to_jsonb(target_contact.city)
      when 'state' then to_jsonb(target_contact.state)
      when 'postalCode' then to_jsonb(target_contact.postal_code)
      when 'birthdate' then to_jsonb(target_contact.birthdate::text)
      when 'homePurchaseDate' then to_jsonb(target_contact.home_purchase_date::text)
      when 'leadType' then to_jsonb(target_contact.lead_type::text)
      when 'relationship' then to_jsonb(target_contact.relationship::text)
      when 'intent' then to_jsonb(target_contact.intent::text)
      when 'source' then to_jsonb(target_contact.source::text)
      when 'pipelineStage' then to_jsonb(target_contact.pipeline_stage::text)
      when 'tags' then to_jsonb(target_contact.tags)
      when 'emailSubscribed' then to_jsonb(target_contact.email_subscribed)
      else null
    end;
    if current_value is distinct from target_candidate->key_name then
      result := result || jsonb_build_object(key_name, target_candidate->key_name);
    end if;
  end loop;
  return result;
exception when others then
  return null;
end;
$$;

create or replace function is_valid_incomplete_conversion_plan(target jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  action_name text;
  change_name text;
  payload_key text;
  payload_key_count integer;
  matched_contact_id uuid;
begin
  if not public.jsonb_object_has_only(target, array[
    'action', 'matchedContactId', 'contactInput', 'contactPatch', 'matchedBy',
    'changes'
  ])
     or jsonb_typeof(target->'action') <> 'string'
     or jsonb_typeof(target->'changes') <> 'array'
     or jsonb_array_length(target->'changes') > 25
     or exists (
       select 1
       from jsonb_array_elements(target->'changes') change(value)
       where jsonb_typeof(change.value) <> 'string'
     ) then
    return false;
  end if;

  for change_name in select jsonb_array_elements_text(target->'changes') loop
    if change_name not in (
      'firstName', 'lastName', 'preferredName', 'phone', 'secondaryPhone',
      'email', 'mailingAddress', 'city', 'state', 'postalCode', 'birthdate',
      'homePurchaseDate', 'leadType', 'relationship', 'intent', 'source',
      'pipelineStage', 'buyer', 'seller', 'referredById', 'lastContactedAt',
      'nextTouchAt', 'touchDateOverridden', 'tags', 'emailSubscribed'
    ) then
      return false;
    end if;
  end loop;
  if (
    select count(distinct change.value)
    from jsonb_array_elements_text(target->'changes') change(value)
  ) <> jsonb_array_length(target->'changes') then
    return false;
  end if;

  action_name := target->>'action';

  if target ? 'matchedBy'
     and (
       jsonb_typeof(target->'matchedBy') <> 'string'
       or target->>'matchedBy' not in ('external-id', 'email', 'phone')
     ) then
    return false;
  end if;

  if action_name = 'create' then
    if not (target ? 'contactInput')
       or target ? 'matchedContactId'
       or target ? 'contactPatch'
       or target ? 'matchedBy'
       or not public.is_valid_contact_conversion_payload(target->'contactInput', true) then
      return false;
    end if;
    select count(*) into payload_key_count
    from jsonb_object_keys(target->'contactInput');
    if payload_key_count <> jsonb_array_length(target->'changes') then
      return false;
    end if;
    for payload_key in select jsonb_object_keys(target->'contactInput') loop
      if not (target->'changes' @> jsonb_build_array(payload_key)) then
        return false;
      end if;
    end loop;
    return true;
  elsif action_name = 'update' then
    if not (target ? 'matchedContactId') or not (target ? 'contactPatch')
       or target ? 'contactInput' then
      return false;
    end if;
    matched_contact_id := (target->>'matchedContactId')::uuid;
    if not public.is_valid_contact_conversion_payload(target->'contactPatch', false) then
      return false;
    end if;
    select count(*) into payload_key_count
    from jsonb_object_keys(target->'contactPatch');
    if payload_key_count <> jsonb_array_length(target->'changes') then
      return false;
    end if;
    for payload_key in select jsonb_object_keys(target->'contactPatch') loop
      if not (target->'changes' @> jsonb_build_array(payload_key)) then
        return false;
      end if;
    end loop;
    return true;
  elsif action_name = 'unchanged' then
    if not (target ? 'matchedContactId')
       or target ? 'contactInput' or target ? 'contactPatch'
       or jsonb_array_length(target->'changes') <> 0 then
      return false;
    end if;
    matched_contact_id := (target->>'matchedContactId')::uuid;
    return true;
  end if;

  return false;
exception when others then
  return false;
end;
$$;

grant execute on function is_valid_buyer_conversion_payload(jsonb) to authenticated;
grant execute on function is_valid_seller_conversion_payload(jsonb) to authenticated;
grant execute on function is_valid_contact_conversion_payload(jsonb, boolean) to authenticated;
grant execute on function is_valid_incomplete_conversion_plan(jsonb) to authenticated;
grant execute on function incomplete_candidate_contact_input(jsonb) to authenticated;
grant execute on function incomplete_candidate_contact_patch(jsonb, contacts) to authenticated;

create or replace function append_activity_event(
  target_workspace_id uuid,
  target_type crm_activity_event_type,
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
  perform public.assert_crm_actor_membership(
    target_actor_membership_id,
    target_workspace_id
  );

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
    return jsonb_build_object(
      'event', to_jsonb(inserted_event),
      'noOp', false
    );
  end if;

  -- ON CONFLICT waits for an in-flight winner before returning. Locking and
  -- comparing that committed row makes no-op truth race-safe.
  select event.*
    into strict existing_event
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

  return jsonb_build_object(
    'event', to_jsonb(existing_event),
    'noOp', true
  );
end;
$$;

create or replace function create_incomplete_record(
  target_workspace_id uuid,
  target_source text,
  target_external_id text,
  target_candidate jsonb,
  target_validation_reasons jsonb,
  target_intake_idempotency_key text,
  target_actor_membership_id uuid
)
returns incomplete_records
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_hash text;
  existing_record public.incomplete_records;
  inserted_record public.incomplete_records;
begin
  if not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(
    target_actor_membership_id,
    target_workspace_id
  );

  request_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'source', target_source,
    'externalId', target_external_id,
    'candidate', target_candidate,
    'reasons', target_validation_reasons
  )::text, 'UTF8'), 'sha256'), 'hex');

  if target_intake_idempotency_key is null then
    insert into public.incomplete_records (
      workspace_id, source, external_id, candidate, validation_reasons
    ) values (
      target_workspace_id, target_source, target_external_id, target_candidate,
      target_validation_reasons
    ) returning * into inserted_record;

    return inserted_record;
  end if;

  if length(trim(target_intake_idempotency_key)) = 0 then
    raise exception 'intake idempotency key cannot be empty' using errcode = '23514';
  end if;

  -- The partial unique index is the serialization point. A concurrent replay
  -- either inserts this row or waits for the winning transaction and then
  -- compares the committed request hash below.
  insert into public.incomplete_records (
    workspace_id, source, external_id, candidate, validation_reasons,
    intake_idempotency_key, intake_request_hash
  ) values (
    target_workspace_id, target_source, target_external_id, target_candidate,
    target_validation_reasons, target_intake_idempotency_key, request_hash
  )
  on conflict (workspace_id, intake_idempotency_key)
    where intake_idempotency_key is not null
  do nothing
  returning * into inserted_record;

  if found then
    return inserted_record;
  end if;

  select record.*
    into strict existing_record
    from public.incomplete_records record
    where record.workspace_id = target_workspace_id
      and record.intake_idempotency_key = target_intake_idempotency_key
    for update;

  if existing_record.intake_request_hash = request_hash then
    return existing_record;
  end if;

  raise exception 'intake idempotency key conflicts with another payload'
    using errcode = '23505';
end;
$$;

create or replace function create_task_with_event(
  target_workspace_id uuid,
  target_contact_id uuid,
  target_title text,
  target_description text,
  target_due_at timestamptz,
  target_creator_membership_id uuid,
  target_assignee_membership_id uuid,
  target_task_idempotency_key text,
  target_event_idempotency_key text,
  target_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_hash text;
  inserted_task public.tasks;
  existing_task public.tasks;
  event_receipt jsonb;
  existing_event public.activity_events;
begin
  if target_workspace_id is null or target_title is null
     or target_due_at is null or target_creator_membership_id is null
     or target_assignee_membership_id is null or target_created_at is null
     or target_task_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$'
     or target_event_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'task create command is incomplete or invalid'
      using errcode = '23514';
  end if;

  if not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(
    target_creator_membership_id,
    target_workspace_id
  );
  if not public.crm_membership_is_active(
    target_assignee_membership_id,
    target_workspace_id
  ) then
    raise exception 'active assignee membership is required' using errcode = '42501';
  end if;

  request_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'contactId', target_contact_id,
    'title', target_title,
    'description', target_description,
    'dueAt', target_due_at,
    'creatorMembershipId', target_creator_membership_id,
    'assigneeMembershipId', target_assignee_membership_id,
    'eventIdempotencyKey', target_event_idempotency_key,
    'createdAt', target_created_at
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.tasks (
    workspace_id, contact_id, title, description, due_at,
    creator_membership_id, assignee_membership_id,
    create_idempotency_key, create_request_hash, created_at, updated_at
  ) values (
    target_workspace_id, target_contact_id, target_title, target_description,
    target_due_at, target_creator_membership_id, target_assignee_membership_id,
    target_task_idempotency_key, request_hash, target_created_at, target_created_at
  ) on conflict (workspace_id, create_idempotency_key)
    where create_idempotency_key is not null
    do nothing
  returning * into inserted_task;

  if inserted_task.id is not null then
    event_receipt := public.append_activity_event(
      target_workspace_id,
      'task-created',
      target_creator_membership_id,
      target_created_at,
      target_event_idempotency_key,
      target_contact_id,
      inserted_task.id,
      null
    );

    return jsonb_build_object(
      'task', to_jsonb(inserted_task),
      'event', event_receipt->'event',
      'noOp', false
    );
  end if;

  -- The unique insert waits for an in-flight winner. Lock the committed task
  -- and require its complete request fingerprint plus atomic event receipt.
  select task.*
    into strict existing_task
    from public.tasks task
    where task.workspace_id = target_workspace_id
      and task.create_idempotency_key = target_task_idempotency_key
    for update;

  if existing_task.create_request_hash <> request_hash then
    raise exception 'task idempotency key conflicts with another payload'
      using errcode = '23505';
  end if;

  select event.*
    into existing_event
    from public.activity_events event
    where event.workspace_id = target_workspace_id
      and event.idempotency_key = target_event_idempotency_key
    for update;

  if not found
     or existing_event.type <> 'task-created'
     or existing_event.task_id <> existing_task.id
     or existing_event.contact_id is distinct from existing_task.contact_id
     or existing_event.actor_membership_id <> target_creator_membership_id
     or existing_event.occurred_at <> target_created_at then
    raise exception 'task replay receipt is missing or inconsistent'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'task', to_jsonb(existing_task),
    'event', to_jsonb(existing_event),
    'noOp', true
  );
end;
$$;

create or replace function transition_tasks_with_events(
  target_workspace_id uuid,
  target_task_ids uuid[],
  target_status crm_task_status,
  target_actor_membership_id uuid,
  target_transitioned_at timestamptz,
  target_event_commands jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_count integer;
  target_task_id uuid;
  task_row public.tasks;
  event_command jsonb;
  event_receipt jsonb;
  expected_event_type crm_activity_event_type;
  result_tasks jsonb := '[]'::jsonb;
  result_events jsonb := '[]'::jsonb;
  no_op_task_ids jsonb := '[]'::jsonb;
begin
  if target_task_ids is null
     or cardinality(target_task_ids) not between 1 and 100
     or array_position(target_task_ids, null) is not null
     or (select count(distinct task_id) from unnest(target_task_ids) task_id)
        <> cardinality(target_task_ids)
     or target_actor_membership_id is null
     or target_transitioned_at is null
     or jsonb_typeof(target_event_commands) <> 'array' then
    raise exception 'task transition command is invalid or out of bounds'
      using errcode = '23514';
  end if;

  if target_status = 'open' then
    if cardinality(target_task_ids) <> 1
       or jsonb_array_length(target_event_commands) <> 0 then
      raise exception 'reopen accepts one task and no activity event command'
        using errcode = '23514';
    end if;
  else
    expected_event_type := case
      when target_status = 'completed' then 'task-completed'::crm_activity_event_type
      else 'task-archived'::crm_activity_event_type
    end;

    if jsonb_array_length(target_event_commands) <> cardinality(target_task_ids)
       or exists (
         select 1
         from jsonb_array_elements(target_event_commands) command(value)
         where not public.jsonb_object_has_only(
             command.value, array['taskId', 'type', 'idempotencyKey']
           )
            or jsonb_typeof(command.value->'taskId') <> 'string'
            or jsonb_typeof(command.value->'type') <> 'string'
            or jsonb_typeof(command.value->'idempotencyKey') <> 'string'
            or command.value->>'type' <> expected_event_type::text
            or command.value->>'idempotencyKey' !~ '^[A-Za-z0-9._:-]{1,128}$'
            or not ((command.value->>'taskId')::uuid = any(target_task_ids))
       )
       or exists (
         select command.value->>'taskId'
         from jsonb_array_elements(target_event_commands) command(value)
         group by command.value->>'taskId'
         having count(*) <> 1
       )
       or exists (
         select command.value->>'idempotencyKey'
         from jsonb_array_elements(target_event_commands) command(value)
         group by command.value->>'idempotencyKey'
         having count(*) <> 1
       ) then
      raise exception 'transition event commands do not match the task selection'
        using errcode = '23514';
    end if;
  end if;

  if not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(
    target_actor_membership_id,
    target_workspace_id
  );

  -- Lock the complete explicit set in deterministic order before previewing
  -- no-ops. A missing or foreign ID aborts the entire command.
  perform 1
  from public.tasks task
  where task.workspace_id = target_workspace_id
    and task.id = any(target_task_ids)
  order by array_position(target_task_ids, task.id)
  for update;

  get diagnostics selected_count = row_count;
  if selected_count <> cardinality(target_task_ids) then
    raise exception 'task selection contains missing or cross-workspace IDs'
      using errcode = '42501';
  end if;

  foreach target_task_id in array target_task_ids loop
    select task.* into strict task_row
    from public.tasks task
    where task.workspace_id = target_workspace_id
      and task.id = target_task_id;

    if (target_status = 'completed' and task_row.status = 'completed')
       or (target_status = 'archived' and task_row.status = 'archived')
       or (target_status = 'open' and task_row.status = 'open') then
      no_op_task_ids := no_op_task_ids || jsonb_build_array(task_row.id::text);
      result_tasks := result_tasks || jsonb_build_array(to_jsonb(task_row));
      continue;
    end if;

    if task_row.status = 'archived' and target_status in ('open', 'completed') then
      raise exception 'archived tasks cannot transition' using errcode = '23514';
    end if;

    if target_status = 'completed' then
      update public.tasks task
         set status = 'completed',
             completed_at = target_transitioned_at,
             completed_by_membership_id = target_actor_membership_id,
             updated_at = target_transitioned_at
       where task.id = target_task_id
         and task.workspace_id = target_workspace_id
       returning * into task_row;
    elsif target_status = 'archived' then
      update public.tasks task
         set status = 'archived',
             archived_at = target_transitioned_at,
             archived_by_membership_id = target_actor_membership_id,
             updated_at = target_transitioned_at
       where task.id = target_task_id
         and task.workspace_id = target_workspace_id
       returning * into task_row;
    else
      update public.tasks task
         set status = 'open',
             completed_at = null,
             completed_by_membership_id = null,
             archived_at = null,
             archived_by_membership_id = null,
             updated_at = target_transitioned_at
       where task.id = target_task_id
         and task.workspace_id = target_workspace_id
       returning * into task_row;
    end if;

    result_tasks := result_tasks || jsonb_build_array(to_jsonb(task_row));

    if target_status <> 'open' then
      select command.value into strict event_command
      from jsonb_array_elements(target_event_commands) command(value)
      where command.value->>'taskId' = target_task_id::text;

      event_receipt := public.append_activity_event(
        target_workspace_id,
        expected_event_type,
        target_actor_membership_id,
        target_transitioned_at,
        event_command->>'idempotencyKey',
        task_row.contact_id,
        task_row.id,
        null
      );
      result_events := result_events || jsonb_build_array(event_receipt->'event');
    end if;
  end loop;

  return jsonb_build_object(
    'tasks', result_tasks,
    'events', result_events,
    'noOpTaskIds', no_op_task_ids
  );
end;
$$;

create or replace function transition_tasks(
  target_workspace_id uuid,
  target_task_ids uuid[],
  target_status crm_task_status,
  target_actor_membership_id uuid
)
returns setof tasks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  task_count integer;
begin
  if target_task_ids is null
     or cardinality(target_task_ids) not between 1 and 100
     or array_position(target_task_ids, null) is not null
     or (select count(distinct task_id) from unnest(target_task_ids) task_id)
        <> cardinality(target_task_ids) then
    raise exception 'task selection must contain 1 to 100 unique IDs'
      using errcode = '23514';
  end if;

  if target_status not in ('open', 'completed', 'archived') then
    raise exception 'unsupported task status transition' using errcode = '23514';
  end if;

  if target_status = 'open' and cardinality(target_task_ids) <> 1 then
    raise exception 'bulk reopen is not supported' using errcode = '23514';
  end if;

  if not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(
    target_actor_membership_id,
    target_workspace_id
  );

  select count(*)::integer
    into task_count
    from public.tasks task
    where task.workspace_id = target_workspace_id
      and task.id = any(target_task_ids);

  if task_count <> cardinality(target_task_ids) then
    raise exception 'task selection contains missing or cross-workspace IDs'
      using errcode = '42501';
  end if;

  if target_status in ('open', 'completed') and exists (
    select 1 from public.tasks task
    where task.workspace_id = target_workspace_id
      and task.id = any(target_task_ids)
      and task.status = 'archived'
  ) then
    raise exception 'archived tasks cannot transition' using errcode = '23514';
  end if;

  if target_status = 'completed' then
    update public.tasks task
       set status = 'completed',
           completed_by_membership_id = target_actor_membership_id
     where task.workspace_id = target_workspace_id
       and task.id = any(target_task_ids)
       and task.status = 'open';
  elsif target_status = 'archived' then
    update public.tasks task
       set status = 'archived',
           archived_by_membership_id = target_actor_membership_id
     where task.workspace_id = target_workspace_id
       and task.id = any(target_task_ids)
       and task.status <> 'archived';
  else
    update public.tasks task
       set status = 'open',
           completed_at = null,
           completed_by_membership_id = null,
           archived_at = null,
           archived_by_membership_id = null
     where task.workspace_id = target_workspace_id
       and task.id = any(target_task_ids)
       and task.status = 'completed';
  end if;

  return query
    select task.*
    from public.tasks task
    where task.workspace_id = target_workspace_id
      and task.id = any(target_task_ids)
    order by array_position(target_task_ids, task.id);
end;
$$;

create or replace function convert_incomplete_record(
  target_record_id uuid,
  target_candidate jsonb,
  target_plan jsonb,
  target_idempotency_key text,
  target_actor_membership_id uuid,
  target_converted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  locked_record public.incomplete_records;
  converted_record public.incomplete_records;
  action_name incomplete_conversion_action;
  contact_payload jsonb;
  contact_patch jsonb;
  expected_contact_patch jsonb;
  matched_contact public.contacts;
  resolved_contact_id uuid;
  compatibility_owner_id uuid;
  request_hash text;
  existing_link_contact_id uuid;
begin
  if target_record_id is null or target_candidate is null or target_plan is null
     or target_actor_membership_id is null or target_converted_at is null
     or length(trim(target_idempotency_key)) = 0
     or not public.is_valid_incomplete_candidate(target_candidate)
     or not public.is_valid_incomplete_conversion_plan(target_plan) then
    raise exception 'conversion command is invalid or contains unknown fields'
      using errcode = '23514';
  end if;

  select record.*
    into locked_record
    from public.incomplete_records record
    where record.id = target_record_id
    for update;

  if not found or not public.has_workspace_access(locked_record.workspace_id) then
    raise exception 'incomplete record not found or not authorized'
      using errcode = '42501';
  end if;
  perform public.assert_crm_actor_membership(
    target_actor_membership_id,
    locked_record.workspace_id
  );

  request_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'candidate', target_candidate,
    'plan', target_plan
  )::text, 'UTF8'), 'sha256'), 'hex');

  if locked_record.status = 'converted' then
    if locked_record.conversion_idempotency_key = target_idempotency_key
       and locked_record.conversion_request_hash = request_hash
       and locked_record.converted_by_membership_id = target_actor_membership_id then
      return jsonb_build_object(
        'record', to_jsonb(locked_record),
        'contactId', locked_record.converted_contact_id::text,
        'action', locked_record.conversion_action::text,
        'noOp', true
      );
    end if;
    raise exception 'conversion replay conflicts with the original result'
      using errcode = '23505';
  elsif locked_record.status = 'archived' then
    raise exception 'archived incomplete record must be restored before conversion'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.incomplete_records record
    where record.workspace_id = locked_record.workspace_id
      and record.conversion_idempotency_key = target_idempotency_key
      and record.id <> locked_record.id
  ) then
    raise exception 'conversion idempotency key is already in use'
      using errcode = '23505';
  end if;

  select membership.user_id
    into strict compatibility_owner_id
    from public.workspace_members membership
    where membership.workspace_id = locked_record.workspace_id
      and membership.role = 'owner'
      and membership.status = 'active';

  action_name := (target_plan->>'action')::incomplete_conversion_action;

  if action_name = 'create' then
    contact_payload := target_plan->'contactInput';
    if contact_payload is distinct from public.incomplete_candidate_contact_input(target_candidate) then
      raise exception 'create conversion plan does not match corrected candidate'
        using errcode = '23514';
    end if;

    insert into public.contacts (
      owner_id, workspace_id, first_name, last_name, preferred_name,
      phone, secondary_phone, email, mailing_address, city, state, postal_code,
      birthdate, home_purchase_date, lead_type, relationship, intent, source,
      pipeline_stage, buyer_criteria, seller_criteria, referred_by_id,
      last_contacted_at, next_touch_at, touch_date_overridden, tags,
      email_subscribed
    ) values (
      compatibility_owner_id,
      locked_record.workspace_id,
      contact_payload->>'firstName',
      contact_payload->>'lastName',
      contact_payload->>'preferredName',
      contact_payload->>'phone',
      contact_payload->>'secondaryPhone',
      contact_payload->>'email',
      contact_payload->>'mailingAddress',
      contact_payload->>'city',
      contact_payload->>'state',
      contact_payload->>'postalCode',
      case when contact_payload ? 'birthdate'
        then (contact_payload->>'birthdate')::date else null end,
      case when contact_payload ? 'homePurchaseDate'
        then (contact_payload->>'homePurchaseDate')::date else null end,
      (contact_payload->>'leadType')::lead_type,
      (contact_payload->>'relationship')::relationship,
      (contact_payload->>'intent')::intent,
      (contact_payload->>'source')::lead_source,
      (contact_payload->>'pipelineStage')::pipeline_stage,
      contact_payload->'buyer',
      contact_payload->'seller',
      case when contact_payload ? 'referredById'
        then (contact_payload->>'referredById')::uuid else null end,
      case when contact_payload ? 'lastContactedAt'
        then (contact_payload->>'lastContactedAt')::timestamptz else null end,
      case when contact_payload ? 'nextTouchAt'
        then (contact_payload->>'nextTouchAt')::date else null end,
      coalesce((contact_payload->>'touchDateOverridden')::boolean, false),
      coalesce(array(
        select value from jsonb_array_elements_text(contact_payload->'tags') value
      ), '{}'::text[]),
      coalesce((contact_payload->>'emailSubscribed')::boolean, true)
    ) returning id into resolved_contact_id;
  else
    resolved_contact_id := (target_plan->>'matchedContactId')::uuid;

    select contact.*
      into matched_contact
      from public.contacts contact
      where contact.id = resolved_contact_id
        and contact.workspace_id = locked_record.workspace_id
      for update;
    if not found then
      raise exception 'matched contact is outside the conversion workspace'
        using errcode = '42501';
    end if;

    expected_contact_patch := public.incomplete_candidate_contact_patch(
      target_candidate,
      matched_contact
    );

    if action_name = 'update' then
      contact_patch := target_plan->'contactPatch';
      if expected_contact_patch = '{}'::jsonb
         or contact_patch is distinct from expected_contact_patch then
        raise exception 'update conversion plan does not match corrected candidate'
          using errcode = '23514';
      end if;

      update public.contacts contact
         set first_name = case when contact_patch ? 'firstName'
               then contact_patch->>'firstName' else contact.first_name end,
             last_name = case when contact_patch ? 'lastName'
               then contact_patch->>'lastName' else contact.last_name end,
             preferred_name = case when contact_patch ? 'preferredName'
               then contact_patch->>'preferredName' else contact.preferred_name end,
             phone = case when contact_patch ? 'phone'
               then contact_patch->>'phone' else contact.phone end,
             secondary_phone = case when contact_patch ? 'secondaryPhone'
               then contact_patch->>'secondaryPhone' else contact.secondary_phone end,
             email = case when contact_patch ? 'email'
               then contact_patch->>'email' else contact.email end,
             mailing_address = case when contact_patch ? 'mailingAddress'
               then contact_patch->>'mailingAddress' else contact.mailing_address end,
             city = case when contact_patch ? 'city'
               then contact_patch->>'city' else contact.city end,
             state = case when contact_patch ? 'state'
               then contact_patch->>'state' else contact.state end,
             postal_code = case when contact_patch ? 'postalCode'
               then contact_patch->>'postalCode' else contact.postal_code end,
             birthdate = case when contact_patch ? 'birthdate'
               then (contact_patch->>'birthdate')::date else contact.birthdate end,
             home_purchase_date = case when contact_patch ? 'homePurchaseDate'
               then (contact_patch->>'homePurchaseDate')::date else contact.home_purchase_date end,
             lead_type = case when contact_patch ? 'leadType'
               then (contact_patch->>'leadType')::lead_type else contact.lead_type end,
             relationship = case when contact_patch ? 'relationship'
               then (contact_patch->>'relationship')::relationship else contact.relationship end,
             intent = case when contact_patch ? 'intent'
               then (contact_patch->>'intent')::intent else contact.intent end,
             source = case when contact_patch ? 'source'
               then (contact_patch->>'source')::lead_source else contact.source end,
             pipeline_stage = case when contact_patch ? 'pipelineStage'
               then (contact_patch->>'pipelineStage')::pipeline_stage else contact.pipeline_stage end,
             buyer_criteria = case when contact_patch ? 'buyer'
               then contact_patch->'buyer' else contact.buyer_criteria end,
             seller_criteria = case when contact_patch ? 'seller'
               then contact_patch->'seller' else contact.seller_criteria end,
             referred_by_id = case when contact_patch ? 'referredById'
               then (contact_patch->>'referredById')::uuid else contact.referred_by_id end,
             last_contacted_at = case when contact_patch ? 'lastContactedAt'
               then (contact_patch->>'lastContactedAt')::timestamptz else contact.last_contacted_at end,
             next_touch_at = case when contact_patch ? 'nextTouchAt'
               then (contact_patch->>'nextTouchAt')::date else contact.next_touch_at end,
             touch_date_overridden = case when contact_patch ? 'touchDateOverridden'
               then (contact_patch->>'touchDateOverridden')::boolean
               else contact.touch_date_overridden end,
             tags = case when contact_patch ? 'tags'
               then array(select value from jsonb_array_elements_text(contact_patch->'tags') value)
               else contact.tags end,
             email_subscribed = case when contact_patch ? 'emailSubscribed'
               then (contact_patch->>'emailSubscribed')::boolean
               else contact.email_subscribed end
       where contact.id = resolved_contact_id
         and contact.workspace_id = locked_record.workspace_id;
    elsif expected_contact_patch <> '{}'::jsonb then
      raise exception 'unchanged conversion plan omits candidate changes'
        using errcode = '23514';
    end if;
  end if;

  if locked_record.external_id is not null
     and locked_record.source ~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    insert into public.contact_external_links (
      owner_id, workspace_id, contact_id, provider, external_id
    ) values (
      compatibility_owner_id, locked_record.workspace_id, resolved_contact_id,
      locked_record.source, locked_record.external_id
    ) on conflict (workspace_id, provider, external_id) do nothing;

    select link.contact_id
      into existing_link_contact_id
      from public.contact_external_links link
      where link.workspace_id = locked_record.workspace_id
        and link.provider = locked_record.source
        and link.external_id = locked_record.external_id;

    if existing_link_contact_id <> resolved_contact_id then
      raise exception 'external identity is linked to another contact'
        using errcode = '23505';
    end if;
  end if;

  update public.incomplete_records record
     set candidate = target_candidate,
         status = 'converted',
         converted_contact_id = resolved_contact_id,
         conversion_action = action_name,
         conversion_idempotency_key = target_idempotency_key,
         conversion_request_hash = request_hash,
         converted_at = target_converted_at,
         converted_by_membership_id = target_actor_membership_id
   where record.id = locked_record.id
   returning * into converted_record;

  perform public.append_activity_event(
    converted_record.workspace_id,
    'incomplete-record-converted',
    target_actor_membership_id,
    target_converted_at,
    target_idempotency_key,
    resolved_contact_id,
    null,
    converted_record.id
  );

  return jsonb_build_object(
    'record', to_jsonb(converted_record),
    'contactId', resolved_contact_id::text,
    'action', action_name::text,
    'noOp', false
  );
end;
$$;

revoke all on function append_activity_event(
  uuid, crm_activity_event_type, uuid, timestamptz, text, uuid, uuid, uuid
) from public;
revoke all on function create_incomplete_record(
  uuid, text, text, jsonb, jsonb, text, uuid
) from public;
revoke all on function create_task_with_event(
  uuid, uuid, text, text, timestamptz, uuid, uuid, text, text, timestamptz
) from public;
revoke all on function transition_tasks_with_events(
  uuid, uuid[], crm_task_status, uuid, timestamptz, jsonb
) from public;
revoke all on function transition_tasks(uuid, uuid[], crm_task_status, uuid) from public;
revoke all on function convert_incomplete_record(
  uuid, jsonb, jsonb, text, uuid, timestamptz
) from public;

grant execute on function append_activity_event(
  uuid, crm_activity_event_type, uuid, timestamptz, text, uuid, uuid, uuid
) to authenticated;
grant execute on function create_incomplete_record(
  uuid, text, text, jsonb, jsonb, text, uuid
) to authenticated;
grant execute on function create_task_with_event(
  uuid, uuid, text, text, timestamptz, uuid, uuid, text, text, timestamptz
) to authenticated;
grant execute on function transition_tasks_with_events(
  uuid, uuid[], crm_task_status, uuid, timestamptz, jsonb
) to authenticated;
grant execute on function convert_incomplete_record(
  uuid, jsonb, jsonb, text, uuid, timestamptz
) to authenticated;

-- Membership-derived RLS ---------------------------------------------------

alter table smart_lists enable row level security;
alter table incomplete_records enable row level security;
alter table tasks enable row level security;
alter table activity_events enable row level security;

create policy smart_lists_member_select on smart_lists
  for select to authenticated
  using (has_workspace_access(workspace_id));
create policy smart_lists_member_insert on smart_lists
  for insert to authenticated
  with check (has_workspace_access(workspace_id));
create policy smart_lists_member_update on smart_lists
  for update to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

create policy incomplete_records_member_select on incomplete_records
  for select to authenticated
  using (has_workspace_access(workspace_id));
create policy incomplete_records_member_insert on incomplete_records
  for insert to authenticated
  with check (has_workspace_access(workspace_id));
create policy incomplete_records_member_update on incomplete_records
  for update to authenticated
  using (has_workspace_access(workspace_id) and status <> 'converted')
  with check (has_workspace_access(workspace_id) and status <> 'converted');

create policy tasks_member_select on tasks
  for select to authenticated
  using (has_workspace_access(workspace_id));

create policy activity_events_member_select on activity_events
  for select to authenticated
  using (has_workspace_access(workspace_id));

grant select, insert, update on smart_lists to authenticated;
grant select, insert, update on incomplete_records to authenticated;
grant select on tasks to authenticated;
grant select on activity_events to authenticated;

-- Final fail-closed verification ------------------------------------------

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'smart_lists', 'incomplete_records', 'tasks', 'activity_events'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = tenant_table
        and column_name = 'workspace_id'
        and is_nullable = 'NO'
    ) then
      raise exception 'missing non-null workspace_id on %', tenant_table;
    end if;

    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = tenant_table
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on %', tenant_table;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = tenant_table
        and column_name = 'owner_id'
    ) then
      raise exception 'legacy owner_id is forbidden on %', tenant_table;
    end if;
  end loop;
end;
$$;

comment on table smart_lists is
  'Workspace-scoped persisted Smart List definitions; archive replaces deletion.';
comment on column smart_lists.definition is
  'Validated smart-list-filter.v1 data only; never SQL, regex or executable code.';
comment on table incomplete_records is
  'Data-minimized quarantine for invalid intake rows with at least one safe identity signal.';
comment on table tasks is
  'Mutable workspace follow-up tasks with guarded status transition evidence.';
comment on table activity_events is
  'Immutable, append-only CRM event evidence with workspace-scoped idempotency.';
comment on column incomplete_records.intake_request_hash is
  'SHA-256 fingerprint of the allowlisted intake projection for replay conflict detection.';
comment on column incomplete_records.conversion_request_hash is
  'SHA-256 fingerprint of the validated conversion command for replay conflict detection.';

commit;
