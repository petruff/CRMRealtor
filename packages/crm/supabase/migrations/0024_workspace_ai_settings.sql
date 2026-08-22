-- Omnix workspace AI settings: redacted public state + private encrypted key.
begin;

create table public.workspace_ai_configurations (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider text not null default 'google-gemini',
  model text not null,
  enabled boolean not null default false,
  data_policy text not null default 'paid-private',
  secret_version integer,
  key_fingerprint text,
  configured_at timestamptz,
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_membership_id uuid not null,
  constraint workspace_ai_provider check (provider = 'google-gemini'),
  constraint workspace_ai_model check (model in ('gemini-3.5-flash-lite', 'gemini-3.6-flash')),
  constraint workspace_ai_policy check (data_policy = 'paid-private'),
  constraint workspace_ai_secret_state check (
    (secret_version is null and key_fingerprint is null and enabled = false)
    or (secret_version > 0 and key_fingerprint ~ '^[0-9a-f]{12}$' and configured_at is not null)
  ),
  constraint workspace_ai_actor_fk foreign key (updated_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict
);

alter table public.workspace_ai_configurations enable row level security;
alter table public.workspace_ai_configurations force row level security;
revoke all on public.workspace_ai_configurations from public, anon, authenticated;
grant select on public.workspace_ai_configurations to authenticated;

create policy workspace_ai_member_read on public.workspace_ai_configurations
for select to authenticated using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = workspace_ai_configurations.workspace_id
    and member.user_id = auth.uid()
    and member.status = 'active'
));

create table connector_private.workspace_ai_secret_envelopes (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  secret_version integer not null check (secret_version > 0),
  envelope jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint workspace_ai_envelope_shape check (
    envelope->>'schemaVersion' = 'connector-secret-envelope.v1'
    and envelope->>'algorithm' = 'AES-256-GCM'
    and envelope->>'kekVersion' ~ '^[A-Za-z0-9_-]{1,32}$'
    and envelope->>'aadHash' ~ '^[0-9a-f]{64}$'
    and length(envelope->>'ciphertext') between 4 and 100000
  )
);

revoke all on connector_private.workspace_ai_secret_envelopes from public, anon, authenticated, service_role;

create or replace function public.save_workspace_ai_configuration(
  target_workspace_id uuid,
  target_model text,
  target_enabled boolean,
  target_key_fingerprint text,
  target_expected_secret_version integer,
  target_secret_envelope jsonb,
  target_occurred_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member public.workspace_members%rowtype;
  current_version integer;
  next_version integer;
  saved public.workspace_ai_configurations%rowtype;
begin
  member := public.connector_current_membership(target_workspace_id, true);
  if target_model not in ('gemini-3.5-flash-lite', 'gemini-3.6-flash') then
    raise exception 'unsupported Gemini model' using errcode = '22023';
  end if;
  if target_key_fingerprint !~ '^[0-9a-f]{12}$' or target_secret_envelope is null then
    raise exception 'invalid Gemini secret input' using errcode = '22023';
  end if;

  select secret_version into current_version
  from public.workspace_ai_configurations
  where workspace_id = target_workspace_id for update;
  current_version := coalesce(current_version, 0);
  if current_version <> target_expected_secret_version then
    raise exception 'Gemini secret version conflict' using errcode = '40001';
  end if;
  next_version := current_version + 1;

  insert into connector_private.workspace_ai_secret_envelopes(
    workspace_id, secret_version, envelope, created_at, updated_at
  ) values (target_workspace_id, next_version, target_secret_envelope, target_occurred_at, target_occurred_at)
  on conflict (workspace_id) do update set
    secret_version = excluded.secret_version,
    envelope = excluded.envelope,
    updated_at = excluded.updated_at;

  insert into public.workspace_ai_configurations(
    workspace_id, model, enabled, secret_version, key_fingerprint,
    configured_at, removed_at, updated_at, updated_by_membership_id
  ) values (
    target_workspace_id, target_model, target_enabled, next_version, target_key_fingerprint,
    target_occurred_at, null, target_occurred_at, member.id
  ) on conflict (workspace_id) do update set
    model = excluded.model,
    enabled = excluded.enabled,
    secret_version = excluded.secret_version,
    key_fingerprint = excluded.key_fingerprint,
    configured_at = excluded.configured_at,
    removed_at = null,
    updated_at = excluded.updated_at,
    updated_by_membership_id = excluded.updated_by_membership_id
  returning * into saved;

  return jsonb_build_object(
    'workspaceId', saved.workspace_id,
    'provider', saved.provider,
    'model', saved.model,
    'enabled', saved.enabled,
    'secretVersion', saved.secret_version,
    'keyFingerprint', saved.key_fingerprint,
    'configuredAt', saved.configured_at,
    'updatedAt', saved.updated_at
  );
end;
$$;

create or replace function public.remove_workspace_ai_configuration(
  target_workspace_id uuid,
  target_expected_secret_version integer,
  target_occurred_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member public.workspace_members%rowtype;
  current_version integer;
begin
  member := public.connector_current_membership(target_workspace_id, true);
  select secret_version into current_version from public.workspace_ai_configurations
    where workspace_id = target_workspace_id for update;
  if current_version is null then
    return jsonb_build_object('workspaceId', target_workspace_id, 'removed', true, 'noOp', true);
  end if;
  if current_version <> target_expected_secret_version then
    raise exception 'Gemini secret version conflict' using errcode = '40001';
  end if;
  delete from connector_private.workspace_ai_secret_envelopes where workspace_id = target_workspace_id;
  update public.workspace_ai_configurations set
    enabled = false, secret_version = null, key_fingerprint = null,
    removed_at = target_occurred_at, updated_at = target_occurred_at,
    updated_by_membership_id = member.id
  where workspace_id = target_workspace_id;
  return jsonb_build_object('workspaceId', target_workspace_id, 'removed', true, 'noOp', false);
end;
$$;

create or replace function public.set_workspace_ai_enabled(
  target_workspace_id uuid,
  target_expected_secret_version integer,
  target_enabled boolean,
  target_occurred_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member public.workspace_members%rowtype;
  saved public.workspace_ai_configurations%rowtype;
begin
  member := public.connector_current_membership(target_workspace_id, true);
  update public.workspace_ai_configurations set
    enabled = target_enabled,
    updated_at = target_occurred_at,
    updated_by_membership_id = member.id
  where workspace_id = target_workspace_id
    and secret_version = target_expected_secret_version
  returning * into saved;
  if not found then raise exception 'Gemini secret version conflict' using errcode = '40001'; end if;
  return jsonb_build_object('workspaceId', saved.workspace_id, 'enabled', saved.enabled, 'updatedAt', saved.updated_at);
end;
$$;

create or replace function public.read_workspace_ai_secret_envelope(
  target_workspace_id uuid,
  target_authenticated_user_id uuid,
  target_membership_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_members member
    where member.id = target_membership_id
      and member.workspace_id = target_workspace_id
      and member.user_id = target_authenticated_user_id
      and member.status = 'active'
  ) then
    raise exception 'active workspace membership required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'workspaceId', configuration.workspace_id,
    'model', configuration.model,
    'enabled', configuration.enabled,
    'dataPolicy', configuration.data_policy,
    'secretVersion', configuration.secret_version,
    'envelope', secret.envelope
  ) into result
  from public.workspace_ai_configurations configuration
  join connector_private.workspace_ai_secret_envelopes secret using (workspace_id)
  where configuration.workspace_id = target_workspace_id
    and configuration.enabled = true
    and configuration.data_policy = 'paid-private'
    and configuration.secret_version = secret.secret_version;
  return result;
end;
$$;

revoke all on function public.save_workspace_ai_configuration(uuid,text,boolean,text,integer,jsonb,timestamptz) from public;
revoke all on function public.remove_workspace_ai_configuration(uuid,integer,timestamptz) from public;
revoke all on function public.set_workspace_ai_enabled(uuid,integer,boolean,timestamptz) from public;
revoke all on function public.read_workspace_ai_secret_envelope(uuid,uuid,uuid) from public;
revoke all on function public.read_workspace_ai_secret_envelope(uuid,uuid,uuid) from anon, authenticated;
grant execute on function public.save_workspace_ai_configuration(uuid,text,boolean,text,integer,jsonb,timestamptz) to authenticated;
grant execute on function public.remove_workspace_ai_configuration(uuid,integer,timestamptz) to authenticated;
grant execute on function public.set_workspace_ai_enabled(uuid,integer,boolean,timestamptz) to authenticated;
grant execute on function public.read_workspace_ai_secret_envelope(uuid,uuid,uuid) to service_role;

commit;
