-- Story 3.19: reversible notes, orthogonal qualification, provider-aware Omnix AI.
begin;

create type public.crm_qualification_status as enum ('qualified', 'needs-qualification');

alter table public.contacts
  add column qualification_status public.crm_qualification_status not null default 'qualified';
create index contacts_workspace_qualification_idx
  on public.contacts(workspace_id, qualification_status)
  where archived_at is null;

alter table public.notes
  add column archived_at timestamptz,
  add column archived_by_membership_id uuid,
  add column archive_reason text,
  add constraint notes_archive_actor_fk foreign key (archived_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  add constraint notes_archive_state check (
    (archived_at is null and archived_by_membership_id is null and archive_reason is null)
    or (archived_at is not null and archived_by_membership_id is not null
      and length(trim(archive_reason)) between 3 and 500)
  );
-- Migration 0004 intentionally removed broad legacy grants. Re-open only the
-- two operations used by the repository; lifecycle UPDATE stays RPC-only.
grant select, insert on public.notes to authenticated;

create type public.crm_note_lifecycle_event_type as enum ('archived', 'restored');
create table public.note_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  contact_id uuid not null,
  event_type public.crm_note_lifecycle_event_type not null,
  actor_membership_id uuid not null,
  reason text,
  correlation_id uuid not null,
  occurred_at timestamptz not null,
  constraint note_lifecycle_actor_fk foreign key (actor_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint note_lifecycle_contact_fk foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete cascade,
  constraint note_lifecycle_reason check (
    (event_type = 'archived' and length(trim(reason)) between 3 and 500)
    or (event_type = 'restored' and reason is null)
  ),
  unique(workspace_id, correlation_id)
);
create index note_lifecycle_note_idx on public.note_lifecycle_events(note_id, occurred_at desc);
alter table public.note_lifecycle_events enable row level security;
alter table public.note_lifecycle_events force row level security;
revoke all on public.note_lifecycle_events from public, anon, authenticated;
grant select on public.note_lifecycle_events to authenticated;
create policy note_lifecycle_member_read on public.note_lifecycle_events
for select to authenticated using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = note_lifecycle_events.workspace_id
    and member.user_id = auth.uid() and member.status = 'active'
));

create function public.notes_immutable_content_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.contact_id <> old.contact_id or new.workspace_id <> old.workspace_id
    or new.owner_id <> old.owner_id or new.body <> old.body or new.created_at <> old.created_at then
    raise exception 'note content is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger notes_immutable_content
before update on public.notes for each row execute function public.notes_immutable_content_guard();

create function public.archive_contact_note(
  target_note_id uuid, target_reason text, target_correlation_id uuid,
  target_occurred_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.workspace_members%rowtype; target public.notes%rowtype; replay public.note_lifecycle_events%rowtype;
begin
  select * into target from public.notes where id = target_note_id for update;
  if not found then raise exception 'note not found' using errcode = 'P0002'; end if;
  member := public.connector_current_membership(target.workspace_id, false);
  if length(trim(coalesce(target_reason, ''))) not between 3 and 500 then
    raise exception 'archive reason is invalid' using errcode = '22023';
  end if;
  select * into replay from public.note_lifecycle_events
    where workspace_id = target.workspace_id and correlation_id = target_correlation_id;
  if found then
    if replay.note_id <> target_note_id or replay.event_type <> 'archived' or replay.reason <> trim(target_reason) then
      raise exception 'divergent note lifecycle replay' using errcode = '23505';
    end if;
    return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id,
      'archivedAt', target.archived_at, 'noOp', true);
  end if;
  if target.archived_at is not null then
    return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id,
      'archivedAt', target.archived_at, 'noOp', true);
  end if;
  update public.notes set archived_at = target_occurred_at,
    archived_by_membership_id = member.id, archive_reason = trim(target_reason)
    where id = target.id returning * into target;
  insert into public.note_lifecycle_events(workspace_id,note_id,contact_id,event_type,
    actor_membership_id,reason,correlation_id,occurred_at)
  values(target.workspace_id,target.id,target.contact_id,'archived',member.id,
    trim(target_reason),target_correlation_id,target_occurred_at);
  return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id,
    'archivedAt', target.archived_at, 'noOp', false);
end; $$;

create function public.restore_contact_note(
  target_note_id uuid, target_correlation_id uuid,
  target_occurred_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.workspace_members%rowtype; target public.notes%rowtype; replay public.note_lifecycle_events%rowtype;
begin
  select * into target from public.notes where id = target_note_id for update;
  if not found then raise exception 'note not found' using errcode = 'P0002'; end if;
  member := public.connector_current_membership(target.workspace_id, false);
  select * into replay from public.note_lifecycle_events
    where workspace_id = target.workspace_id and correlation_id = target_correlation_id;
  if found then
    if replay.note_id <> target_note_id or replay.event_type <> 'restored' then
      raise exception 'divergent note lifecycle replay' using errcode = '23505';
    end if;
    return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id,
      'restoredAt', replay.occurred_at, 'noOp', true);
  end if;
  if target.archived_at is null then
    return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id,
      'restoredAt', target_occurred_at, 'noOp', true);
  end if;
  update public.notes set archived_at = null, archived_by_membership_id = null, archive_reason = null
    where id = target.id returning * into target;
  insert into public.note_lifecycle_events(workspace_id,note_id,contact_id,event_type,
    actor_membership_id,reason,correlation_id,occurred_at)
  values(target.workspace_id,target.id,target.contact_id,'restored',member.id,null,
    target_correlation_id,target_occurred_at);
  return jsonb_build_object('noteId', target.id, 'contactId', target.contact_id,
    'restoredAt', target_occurred_at, 'noOp', false);
end; $$;

revoke all on function public.archive_contact_note(uuid,text,uuid,timestamptz) from public;
revoke all on function public.restore_contact_note(uuid,uuid,timestamptz) from public;
grant execute on function public.archive_contact_note(uuid,text,uuid,timestamptz) to authenticated;
grant execute on function public.restore_contact_note(uuid,uuid,timestamptz) to authenticated;

-- Preserve the frozen 0007 atomic importer and wrap it so explicit qualification
-- is applied in the same database transaction without broadening identity rules.
alter function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz)
  rename to apply_contact_import_group_v1;
revoke all on function public.apply_contact_import_group_v1(uuid,uuid,text,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.apply_contact_import_group(
  target_workspace_id uuid, target_actor_membership_id uuid,
  target_group_idempotency_key text, target_request_hash text,
  target_plan jsonb, target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare qualification text; compatible_plan jsonb; result jsonb; contact_id uuid;
begin
  qualification := target_plan#>>'{contact,qualificationStatus}';
  if qualification is not null and qualification not in ('qualified','needs-qualification') then
    raise exception 'qualification status is invalid' using errcode='23514';
  end if;
  compatible_plan := case when qualification is null then target_plan
    else jsonb_set(target_plan,'{contact}',(target_plan->'contact') - 'qualificationStatus') end;
  result := public.apply_contact_import_group_v1(target_workspace_id,target_actor_membership_id,
    target_group_idempotency_key,target_request_hash,compatible_plan,target_occurred_at);
  if qualification is not null then
    contact_id := (result->>'contactId')::uuid;
    update public.contacts set qualification_status=qualification::public.crm_qualification_status
      where id=contact_id and workspace_id=target_workspace_id;
    if not found then raise exception 'import qualification target is invalid' using errcode='23514'; end if;
  end if;
  return result;
end; $$;
revoke all on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz) from public;
grant execute on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz) to authenticated, service_role;

-- Generalize the single existing workspace AI configuration. One workspace still has one key.
alter table public.workspace_ai_configurations drop constraint workspace_ai_provider;
alter table public.workspace_ai_configurations drop constraint workspace_ai_model;
alter table public.workspace_ai_configurations
  add constraint workspace_ai_provider check (provider in ('google-gemini','anthropic-claude')),
  add constraint workspace_ai_model check (model in (
    'gemini-3.5-flash-lite','gemini-3.6-flash','claude-sonnet-4-20250514','claude-3-5-haiku-20241022'
  ));

create or replace function public.save_workspace_ai_configuration_v2(
  target_workspace_id uuid, target_provider text, target_model text, target_enabled boolean,
  target_key_fingerprint text, target_expected_secret_version integer,
  target_secret_envelope jsonb, target_occurred_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.workspace_members%rowtype; current_version integer; next_version integer;
  saved public.workspace_ai_configurations%rowtype;
begin
  member := public.connector_current_membership(target_workspace_id, true);
  if (target_provider = 'google-gemini' and target_model not in ('gemini-3.5-flash-lite','gemini-3.6-flash'))
    or (target_provider = 'anthropic-claude' and target_model not in ('claude-sonnet-4-20250514','claude-3-5-haiku-20241022'))
    or target_provider not in ('google-gemini','anthropic-claude') then
    raise exception 'unsupported workspace AI provider or model' using errcode = '22023';
  end if;
  if target_key_fingerprint !~ '^[0-9a-f]{12}$' or target_secret_envelope is null then
    raise exception 'invalid workspace AI secret input' using errcode = '22023'; end if;
  select secret_version into current_version from public.workspace_ai_configurations
    where workspace_id = target_workspace_id for update;
  current_version := coalesce(current_version,0);
  if current_version <> target_expected_secret_version then
    raise exception 'workspace AI secret version conflict' using errcode = '40001'; end if;
  next_version := current_version + 1;
  insert into connector_private.workspace_ai_secret_envelopes(workspace_id,secret_version,envelope,created_at,updated_at)
  values(target_workspace_id,next_version,target_secret_envelope,target_occurred_at,target_occurred_at)
  on conflict(workspace_id) do update set secret_version=excluded.secret_version,
    envelope=excluded.envelope,updated_at=excluded.updated_at;
  insert into public.workspace_ai_configurations(workspace_id,provider,model,enabled,secret_version,
    key_fingerprint,configured_at,removed_at,updated_at,updated_by_membership_id)
  values(target_workspace_id,target_provider,target_model,target_enabled,next_version,
    target_key_fingerprint,target_occurred_at,null,target_occurred_at,member.id)
  on conflict(workspace_id) do update set provider=excluded.provider,model=excluded.model,
    enabled=excluded.enabled,secret_version=excluded.secret_version,key_fingerprint=excluded.key_fingerprint,
    configured_at=excluded.configured_at,removed_at=null,updated_at=excluded.updated_at,
    updated_by_membership_id=excluded.updated_by_membership_id returning * into saved;
  return jsonb_build_object('workspaceId',saved.workspace_id,'provider',saved.provider,'model',saved.model,
    'enabled',saved.enabled,'secretVersion',saved.secret_version,'keyFingerprint',saved.key_fingerprint,
    'configuredAt',saved.configured_at,'updatedAt',saved.updated_at);
end; $$;

create or replace function public.read_workspace_ai_secret_envelope(
  target_workspace_id uuid,target_authenticated_user_id uuid,target_membership_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  if not exists(select 1 from public.workspace_members member where member.id=target_membership_id
    and member.workspace_id=target_workspace_id and member.user_id=target_authenticated_user_id
    and member.status='active') then raise exception 'active workspace membership required' using errcode='42501'; end if;
  select jsonb_build_object('workspaceId',configuration.workspace_id,'provider',configuration.provider,
    'model',configuration.model,'enabled',configuration.enabled,'dataPolicy',configuration.data_policy,
    'secretVersion',configuration.secret_version,'envelope',secret.envelope) into result
  from public.workspace_ai_configurations configuration
  join connector_private.workspace_ai_secret_envelopes secret using(workspace_id)
  where configuration.workspace_id=target_workspace_id and configuration.enabled=true
    and configuration.data_policy='paid-private' and configuration.secret_version=secret.secret_version;
  return result;
end; $$;

revoke all on function public.save_workspace_ai_configuration_v2(uuid,text,text,boolean,text,integer,jsonb,timestamptz) from public;
grant execute on function public.save_workspace_ai_configuration_v2(uuid,text,text,boolean,text,integer,jsonb,timestamptz) to authenticated;

commit;
