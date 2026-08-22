-- Story 3.7: typed, workspace-scoped provenance for every preserved import cell.
--
-- Schema proposal approved by the active story contract:
--   * one immutable fact per import group/source key;
--   * typed scalar JSON, never a raw row/file blob;
--   * membership-derived workspace authority and read-only RLS;
--   * the existing atomic import-group RPC remains the sole write boundary.
-- Rollback: supabase/rollbacks/0026_contact_import_source_facts.rollback.sql
-- is intentionally pre-write only. After facts exist, use PITR or a reviewed
-- forward migration so imported provenance is never silently discarded.
begin;

create table public.contact_import_source_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  actor_membership_id uuid not null,
  provider text not null,
  schema_version text not null,
  source_key text not null,
  source_label text not null,
  category text not null,
  value_type text not null,
  value_json jsonb not null,
  value_hash text not null,
  source_row_number integer,
  group_idempotency_key text not null,
  request_hash text not null,
  captured_at timestamptz not null,
  constraint contact_import_source_facts_contact_fk
    foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint contact_import_source_facts_actor_fk
    foreign key (actor_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint contact_import_source_facts_provider check (
    provider ~ '^[a-z0-9][a-z0-9-]{1,79}$'
  ),
  constraint contact_import_source_facts_schema check (
    schema_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'
  ),
  constraint contact_import_source_facts_key check (
    source_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'
  ),
  constraint contact_import_source_facts_label check (
    length(btrim(source_label)) between 1 and 120
    and source_label !~ '[[:cntrl:]]'
  ),
  constraint contact_import_source_facts_category check (
    category in ('identity','ownership','address','real-estate','engagement','verification','consent','other')
  ),
  constraint contact_import_source_facts_value_type check (
    value_type in ('text','number','boolean','date','timestamp')
  ),
  constraint contact_import_source_facts_typed_value check (
    (value_type = 'text'
      and jsonb_typeof(value_json) = 'string'
      and length(value_json #>> '{}') between 1 and 5000
      and (value_json #>> '{}') !~ '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]')
    or (value_type = 'number' and jsonb_typeof(value_json) = 'number')
    or (value_type = 'boolean' and jsonb_typeof(value_json) = 'boolean')
    or (value_type = 'date' and jsonb_typeof(value_json) = 'string'
      and (value_json #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$')
    or (value_type = 'timestamp' and jsonb_typeof(value_json) = 'string'
      and (value_json #>> '{}') ~ '^\d{4}-\d{2}-\d{2}T')
  ),
  constraint contact_import_source_facts_hashes check (
    value_hash ~ '^[0-9a-f]{64}$' and request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint contact_import_source_facts_row check (
    source_row_number is null or source_row_number between 1 and 100000
  ),
  constraint contact_import_source_facts_group_key check (
    length(group_idempotency_key) between 1 and 200
  ),
  constraint contact_import_source_facts_group_key_unique
    unique (workspace_id, group_idempotency_key, source_key)
);

create index contact_import_source_facts_profile_idx
  on public.contact_import_source_facts(workspace_id, contact_id, provider, captured_at desc, source_key);

alter table public.contact_import_source_facts enable row level security;
alter table public.contact_import_source_facts force row level security;
revoke all on public.contact_import_source_facts from public, anon, authenticated;
grant select on public.contact_import_source_facts to authenticated;

create policy contact_import_source_facts_member_read
on public.contact_import_source_facts for select to authenticated
using (public.has_workspace_access(workspace_id));

create function public.contact_import_source_facts_immutable_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'contact import source facts are immutable' using errcode = '23514';
end;
$$;

create trigger contact_import_source_facts_immutable
before update or delete on public.contact_import_source_facts
for each row execute function public.contact_import_source_facts_immutable_guard();

-- Preserve the 0025 wrapper and add source facts without modifying the frozen
-- 0007 import transaction. The outer call and every fact insert share one SQL
-- transaction, so a bad fact cannot leave a contact, receipt or partial profile.
alter function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz)
  rename to apply_contact_import_group_v2;
revoke all on function public.apply_contact_import_group_v2(uuid,uuid,text,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.apply_contact_import_group(
  target_workspace_id uuid, target_actor_membership_id uuid,
  target_group_idempotency_key text, target_request_hash text,
  target_plan jsonb, target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source_profile jsonb := target_plan->'sourceProfile';
  compatible_plan jsonb := target_plan - 'sourceProfile';
  source_facts jsonb;
  source_fact jsonb;
  result jsonb;
  resolved_contact_id uuid;
  normalized_value jsonb;
  resolved_value_hash text;
  existing_fact public.contact_import_source_facts%rowtype;
  source_row integer;
begin
  if source_profile is not null then
    if jsonb_typeof(source_profile) <> 'object'
      or source_profile - array['provider','schemaVersion','facts'] <> '{}'::jsonb
      or jsonb_typeof(source_profile->'provider') <> 'string'
      or jsonb_typeof(source_profile->'schemaVersion') <> 'string'
      or jsonb_typeof(source_profile->'facts') <> 'array'
      or jsonb_array_length(source_profile->'facts') > 100 then
      raise exception 'contact import source profile is invalid' using errcode = '22023';
    end if;
    source_facts := source_profile->'facts';
  end if;

  result := public.apply_contact_import_group_v2(
    target_workspace_id, target_actor_membership_id,
    target_group_idempotency_key, target_request_hash,
    compatible_plan, target_occurred_at
  );
  resolved_contact_id := (result->>'contactId')::uuid;

  if source_profile is null then
    return result;
  end if;

  if not exists (
    select 1 from public.workspace_members member
    where member.id = target_actor_membership_id
      and member.workspace_id = target_workspace_id
      and member.status = 'active'
  ) then
    raise exception 'active import membership is required' using errcode = '42501';
  end if;

  for source_fact in select value from jsonb_array_elements(source_facts)
  loop
    if jsonb_typeof(source_fact) <> 'object'
      or source_fact - array['key','label','category','valueType','value','sourceRowNumber'] <> '{}'::jsonb
      or not (source_fact ?& array['key','label','category','valueType','value'])
      or jsonb_typeof(source_fact->'key') <> 'string'
      or jsonb_typeof(source_fact->'label') <> 'string'
      or jsonb_typeof(source_fact->'category') <> 'string'
      or jsonb_typeof(source_fact->'valueType') <> 'string' then
      raise exception 'contact import source fact is invalid' using errcode = '22023';
    end if;

    normalized_value := source_fact->'value';
    if normalized_value = 'null'::jsonb then
      raise exception 'contact import source fact value is invalid' using errcode = '22023';
    end if;
    source_row := case when source_fact ? 'sourceRowNumber'
      then (source_fact->>'sourceRowNumber')::integer else null end;
    -- JSONB text is canonical for object key order and sufficient for a
    -- redacted integrity hash; the value itself remains workspace-authorized.
    resolved_value_hash := encode(extensions.digest(normalized_value::text, 'sha256'), 'hex');

    insert into public.contact_import_source_facts(
      workspace_id, contact_id, actor_membership_id, provider, schema_version,
      source_key, source_label, category, value_type, value_json, value_hash,
      source_row_number, group_idempotency_key, request_hash, captured_at
    ) values (
      target_workspace_id, resolved_contact_id, target_actor_membership_id,
      source_profile->>'provider', source_profile->>'schemaVersion',
      source_fact->>'key', source_fact->>'label', source_fact->>'category',
      source_fact->>'valueType', normalized_value, resolved_value_hash,
      source_row, target_group_idempotency_key, target_request_hash, target_occurred_at
    ) on conflict (workspace_id, group_idempotency_key, source_key) do nothing;

    select * into strict existing_fact
      from public.contact_import_source_facts fact
      where fact.workspace_id = target_workspace_id
        and fact.group_idempotency_key = target_group_idempotency_key
        and fact.source_key = source_fact->>'key';
    if existing_fact.contact_id <> resolved_contact_id
      or existing_fact.actor_membership_id <> target_actor_membership_id
      or existing_fact.provider <> source_profile->>'provider'
      or existing_fact.schema_version <> source_profile->>'schemaVersion'
      or existing_fact.source_label <> source_fact->>'label'
      or existing_fact.category <> source_fact->>'category'
      or existing_fact.value_type <> source_fact->>'valueType'
      or existing_fact.value_hash <> resolved_value_hash
      or existing_fact.source_row_number is distinct from source_row
      or existing_fact.request_hash <> target_request_hash then
      raise exception 'divergent contact import source fact replay' using errcode = '23505';
    end if;
  end loop;

  return result;
end;
$$;

revoke all on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz) from public;
grant execute on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz)
  to authenticated, service_role;

comment on table public.contact_import_source_facts is
  'Immutable typed per-cell import provenance. It stores no raw file or arbitrary source row blob and never grants messaging consent.';
comment on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz) is
  'Atomic import-group v3: preserves the v2 contact transaction and appends bounded typed sourceProfile facts in the same transaction.';

commit;
