-- Repair stale Google capability projections only from immutable OAuth evidence.
begin;

create or replace function connector_private.repair_google_connection_capabilities(
  target_connection_id uuid,
  target_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  completion public.google_oauth_completions%rowtype;
  capability_bundle text;
  required text[];
  granted text[];
  state_value text;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
    and connection.provider = 'google'
    and connection.status in ('active', 'degraded')
  for update;

  if not found or target_occurred_at is null then
    raise exception 'active Google connection required' using errcode = 'P0002';
  end if;

  select oauth_completion.* into completion
  from public.google_oauth_completions oauth_completion
  where oauth_completion.connection_id = target_connection.id
    and oauth_completion.workspace_id = target_connection.workspace_id
    and oauth_completion.account_key_hash = target_connection.provider_account_key_hash
    and oauth_completion.granted_scopes is not distinct from target_connection.granted_scopes
  order by oauth_completion.occurred_at desc, oauth_completion.id desc
  limit 1;

  if not found then
    raise exception 'current Google OAuth evidence required' using errcode = 'P0002';
  end if;

  foreach capability_bundle in array array['gmail-send', 'gmail-metadata', 'calendar-app-created'] loop
    required := connector_private.google_bundle_scopes(capability_bundle);
    granted := array(
      select scope
      from unnest(target_connection.granted_scopes) scope
      where scope = any(required)
    );
    state_value := case when not exists(
      select 1 from unnest(required) required_scope
      where required_scope <> all(target_connection.granted_scopes)
    ) then 'active' else 'missing' end;

    insert into public.google_connection_capabilities(
      workspace_id, connection_id, bundle, required_scopes, granted_scopes, state,
      account_key_hash, authorized_by_membership_id, authorized_at, revoked_at,
      last_error_category, created_at, updated_at
    ) values (
      target_connection.workspace_id, target_connection.id, capability_bundle, required, granted,
      state_value, target_connection.provider_account_key_hash,
      case when state_value = 'active' then completion.actor_membership_id else null end,
      case when state_value = 'active' then completion.occurred_at else null end,
      null, case when state_value = 'missing' then 'scope_missing' else null end,
      target_occurred_at, target_occurred_at
    ) on conflict on constraint google_connection_capabilities_connection_bundle_unique do update set
      required_scopes = excluded.required_scopes,
      granted_scopes = excluded.granted_scopes,
      state = excluded.state,
      account_key_hash = excluded.account_key_hash,
      authorized_by_membership_id = excluded.authorized_by_membership_id,
      authorized_at = excluded.authorized_at,
      revoked_at = null,
      last_error_category = excluded.last_error_category,
      updated_at = excluded.updated_at;
  end loop;

end;
$$;

revoke all on function connector_private.repair_google_connection_capabilities(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.repair_google_connection_capabilities(
  target_connection_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
    and connection.provider = 'google'
    and connection.status in ('active', 'degraded');

  if not found then
    raise exception 'active Google connection required' using errcode = 'P0002';
  end if;

  perform public.connector_current_membership(target_connection.workspace_id, false);
  perform connector_private.repair_google_connection_capabilities(
    target_connection.id,
    target_occurred_at
  );
  return public.read_google_connection_capability_state(target_connection.id);
end;
$$;

revoke all on function public.repair_google_connection_capabilities(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.repair_google_connection_capabilities(uuid, timestamptz)
  to authenticated;

comment on function public.repair_google_connection_capabilities(uuid, timestamptz) is
  'Idempotently rebuilds Google capability projections from matching immutable OAuth completion evidence.';

-- Repair existing false-ready projections during deployment. Connections without
-- exact current OAuth evidence remain untouched and continue to fail closed.
do $$
declare
  candidate record;
begin
  for candidate in
    select connection.id
    from public.connector_connections connection
    where connection.provider = 'google'
      and connection.status in ('active', 'degraded')
      and exists (
        select 1
        from public.google_oauth_completions completion
        where completion.connection_id = connection.id
          and completion.workspace_id = connection.workspace_id
          and completion.account_key_hash = connection.provider_account_key_hash
          and completion.granted_scopes is not distinct from connection.granted_scopes
      )
  loop
    perform connector_private.repair_google_connection_capabilities(candidate.id, now());
  end loop;
end;
$$;

commit;
