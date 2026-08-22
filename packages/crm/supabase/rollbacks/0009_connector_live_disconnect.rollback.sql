-- Omnix Story 3.5 live-disconnect rollback — PRE-REQUEST WINDOW ONLY.
--
-- A revocation request is durable authority and confirmed completion may have
-- cryptoshredded the only stored encrypted material. This script refuses to
-- run after any revocation job exists. After that boundary use a reviewed
-- forward migration or managed PITR; never infer deleted cryptographic bytes.

begin;

do $$
begin
  if exists (select 1 from public.connector_revocation_jobs) then
    raise exception
      '0009 rollback is restricted to the pre-request window; durable revocation authority exists';
  end if;
end;
$$;

drop function public.transition_connector_revocation_job(
  uuid, uuid, bigint, text, text, timestamptz, jsonb, timestamptz
);
drop function public.read_connector_revocation_secret_envelope(
  uuid, uuid, bigint, text, timestamptz
);
drop function public.start_connector_revocation_attempt(
  uuid, uuid, bigint, timestamptz
);
drop function public.claim_connector_revocation_jobs(
  uuid, integer, integer, timestamptz
);

drop trigger connector_revocation_jobs_guard_delete on public.connector_revocation_jobs;
drop trigger connector_revocation_jobs_prepare_update on public.connector_revocation_jobs;
drop function public.prepare_connector_revocation_job_update();
drop table public.connector_revocation_jobs;
drop type public.connector_revocation_job_state;

-- Restore the 0006 connection-state guard.
create or replace function public.prepare_connector_connection_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.provider <> old.provider
     or new.created_by_membership_id <> old.created_by_membership_id
     or new.created_at <> old.created_at then
    raise exception 'connector connection identity is immutable' using errcode = '55000';
  end if;

  if new.status <> old.status and not (
    (old.status = 'authorizing' and new.status in ('active', 'reauthorization_required', 'disconnected_unconfirmed'))
    or (old.status = 'active' and new.status in ('degraded', 'reauthorization_required', 'revoking'))
    or (old.status = 'degraded' and new.status in ('active', 'reauthorization_required', 'revoking'))
    or (old.status = 'reauthorization_required' and new.status in ('authorizing', 'active', 'revoking'))
    or (old.status = 'revoking' and new.status in ('disconnected', 'disconnected_unconfirmed'))
    or (old.status in ('disconnected', 'disconnected_unconfirmed') and new.status = 'authorizing')
  ) then
    raise exception 'invalid connector connection transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Restore the 0006 metadata-only owner request contract.
create or replace function public.request_connector_disconnect(
  target_connection_id uuid,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  no_op boolean := false;
begin
  if target_correlation_id is null then
    raise exception 'correlation ID is required' using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
  for update;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_connection.workspace_id, true);

  if target_connection.status in ('disconnected', 'disconnected_unconfirmed', 'revoking') then
    no_op := true;
  elsif target_connection.status in ('active', 'degraded', 'reauthorization_required') then
    update public.connector_connections set status = 'revoking'
     where id = target_connection.id returning * into target_connection;
    insert into public.connector_receipt_events (
      workspace_id, connection_id, event_type, event_key, correlation_id,
      redacted_metadata
    ) values (
      target_connection.workspace_id, target_connection.id,
      'revocation.requested', 'revocation.requested:' || target_correlation_id::text,
      target_correlation_id, jsonb_build_object('actorMembershipId', actor.id)
    );
  else
    raise exception 'connection cannot be disconnected from state %', target_connection.status
      using errcode = '23514';
  end if;

  return jsonb_build_object('connection', to_jsonb(target_connection), 'noOp', no_op);
end;
$$;

-- Restore the 0006 normal job claim without connection-state filtering.
create or replace function public.claim_connector_jobs(
  target_worker_id uuid,
  target_batch_size integer default 10,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_job public.connector_jobs%rowtype;
begin
  if target_worker_id is null
     or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid connector claim request' using errcode = '22023';
  end if;

  for candidate in
    select job.id from public.connector_jobs job
    where job.state in ('queued', 'retry_wait')
      and job.scheduled_at <= target_now
      and job.attempt_count < job.max_attempts
    order by job.priority desc, job.scheduled_at, job.created_at, job.id
    for update skip locked limit target_batch_size
  loop
    update public.connector_jobs
       set state = 'leased', lease_owner = target_worker_id,
           lease_expires_at = target_now + make_interval(secs => target_lease_seconds),
           fencing_token = fencing_token + 1
     where id = candidate.id returning * into claimed_job;
    return next claimed_job;
  end loop;
  return;
end;
$$;

-- Restore the 0006 generic service state writer.
create or replace function public.record_connector_connection_state(
  target_connection_id uuid,
  target_status public.connector_connection_status,
  target_provider_account_key_hash text,
  target_granted_scopes text[],
  target_remote_identity_summary jsonb,
  target_last_probe_at timestamptz,
  target_last_error_category text,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  receipt_type public.connector_receipt_event_type;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id for update;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  if target_status in ('active', 'degraded', 'reauthorization_required')
     and target_provider_account_key_hash is null then
    raise exception 'remote account binding hash is required' using errcode = '22023';
  end if;

  update public.connector_connections
     set status = target_status,
         provider_account_key_hash = coalesce(target_provider_account_key_hash, provider_account_key_hash),
         granted_scopes = coalesce(target_granted_scopes, granted_scopes),
         remote_identity_summary = coalesce(target_remote_identity_summary, remote_identity_summary),
         last_probe_at = coalesce(target_last_probe_at, last_probe_at),
         last_error_category = target_last_error_category,
         disconnected_at = case
           when target_status in ('disconnected', 'disconnected_unconfirmed')
             then coalesce(disconnected_at, now()) else null end
   where id = target_connection_id returning * into target_connection;

  if target_status in ('disconnected', 'disconnected_unconfirmed') then
    receipt_type := 'revocation.completed';
  elsif target_last_probe_at is not null then
    receipt_type := 'connection.probed';
  end if;

  if receipt_type is not null then
    insert into public.connector_receipt_events (
      workspace_id, connection_id, event_type, event_key, correlation_id,
      error_category, redacted_metadata
    ) values (
      target_connection.workspace_id, target_connection.id, receipt_type,
      receipt_type::text || ':' || target_correlation_id::text,
      target_correlation_id, target_last_error_category,
      jsonb_build_object('status', target_connection.status,
        'confirmed', target_connection.status = 'disconnected')
    ) on conflict (workspace_id, event_key) do nothing;
  end if;

  return jsonb_build_object('connection', to_jsonb(target_connection), 'noOp', false);
end;
$$;

revoke all on function public.request_connector_disconnect(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_connector_disconnect(uuid, uuid) to authenticated;

revoke all on function public.claim_connector_jobs(uuid, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) to service_role;

revoke all on function public.record_connector_connection_state(uuid, public.connector_connection_status, text, text[], jsonb, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_connector_connection_state(uuid, public.connector_connection_status, text, text[], jsonb, timestamptz, text, uuid)
  to service_role;

commit;
