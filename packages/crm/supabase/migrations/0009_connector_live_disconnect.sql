-- Omnix — durable provider revocation and cryptographic disconnect
-- Story 3.5 HIGH remediation: an owner disconnect request is durable and
-- provider revocation is executed by a leased, fenced service worker.
--
-- Forward-only migration. Apply after 0008_connector_kek_rewrap.sql.
-- Manual rollback is documented separately and is pre-completion only.

begin;

create type public.connector_revocation_job_state as enum (
  'queued',
  'leased',
  'executing',
  'retry_wait',
  'succeeded',
  'disconnected_unconfirmed'
);

create table public.connector_revocation_jobs (
  id                            uuid primary key default gen_random_uuid(),
  workspace_id                  uuid not null references public.workspaces (id) on delete restrict,
  connection_id                 uuid not null,
  provider                      text not null,
  state                         public.connector_revocation_job_state not null default 'queued',
  requested_by_membership_id    uuid not null,
  correlation_id                uuid not null,
  attempt_count                 integer not null default 0,
  max_attempts                  integer not null default 5,
  scheduled_at                  timestamptz not null default now(),
  lease_owner                   uuid,
  lease_expires_at              timestamptz,
  fencing_token                 bigint not null default 0,
  last_error_category           text,
  started_at                    timestamptz,
  completed_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint connector_revocation_jobs_connection_unique unique (connection_id),
  constraint connector_revocation_jobs_id_workspace_unique unique (id, workspace_id),
  constraint connector_revocation_jobs_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_revocation_jobs_requester_workspace_fk
    foreign key (requested_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_revocation_jobs_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_revocation_jobs_attempts check (
    attempt_count >= 0 and max_attempts between 1 and 20
    and attempt_count <= max_attempts
  ),
  constraint connector_revocation_jobs_fencing check (fencing_token >= 0),
  constraint connector_revocation_jobs_error_category check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_revocation_jobs_lease_pair check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint connector_revocation_jobs_state_lease check (
    (state in ('leased', 'executing') and lease_owner is not null)
    or (state not in ('leased', 'executing') and lease_owner is null)
  ),
  constraint connector_revocation_jobs_terminal_time check (
    (state in ('succeeded', 'disconnected_unconfirmed') and completed_at is not null)
    or (state not in ('succeeded', 'disconnected_unconfirmed') and completed_at is null)
  )
);

create index connector_revocation_jobs_due_claim_idx
  on public.connector_revocation_jobs (scheduled_at, created_at, id)
  where state in ('queued', 'retry_wait');

create index connector_revocation_jobs_workspace_state_idx
  on public.connector_revocation_jobs (workspace_id, state, scheduled_at);

create index connector_revocation_jobs_expired_lease_idx
  on public.connector_revocation_jobs (lease_expires_at, id)
  where lease_owner is not null;

create or replace function public.prepare_connector_revocation_job_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.connection_id is distinct from old.connection_id
     or new.provider is distinct from old.provider
     or new.requested_by_membership_id is distinct from old.requested_by_membership_id
     or new.correlation_id is distinct from old.correlation_id
     or new.created_at is distinct from old.created_at then
    raise exception 'connector revocation job authorization binding is immutable'
      using errcode = '55000';
  end if;

  if new.fencing_token < old.fencing_token then
    raise exception 'connector revocation fencing token cannot decrease'
      using errcode = '23514';
  end if;

  if new.state <> old.state and not (
    (old.state in ('queued', 'retry_wait') and new.state = 'leased')
    or (old.state = 'leased' and new.state in ('executing', 'retry_wait', 'disconnected_unconfirmed'))
    or (old.state = 'executing' and new.state in ('retry_wait', 'succeeded', 'disconnected_unconfirmed'))
  ) then
    raise exception 'invalid connector revocation transition: % -> %', old.state, new.state
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.prepare_connector_revocation_job_update() from public;

create trigger connector_revocation_jobs_prepare_update
  before update on public.connector_revocation_jobs
  for each row execute function public.prepare_connector_revocation_job_update();

create trigger connector_revocation_jobs_guard_delete
  before delete on public.connector_revocation_jobs
  for each row execute function public.guard_connector_append_only();

alter table public.connector_revocation_jobs enable row level security;
alter table public.connector_revocation_jobs force row level security;

create policy connector_revocation_jobs_member_select
  on public.connector_revocation_jobs for select to authenticated
  using (public.has_workspace_access(workspace_id));

revoke all on table public.connector_revocation_jobs from anon, authenticated, service_role;
grant select on table public.connector_revocation_jobs to authenticated, service_role;

-- Expand the connection guard so partial OAuth connections may be revoked and
-- only the fenced revocation transition can record a terminal disconnect.
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
    (old.status = 'authorizing' and new.status in ('active', 'reauthorization_required', 'revoking', 'disconnected_unconfirmed'))
    or (old.status = 'active' and new.status in ('degraded', 'reauthorization_required', 'revoking'))
    or (old.status = 'degraded' and new.status in ('active', 'reauthorization_required', 'revoking'))
    or (old.status = 'reauthorization_required' and new.status in ('authorizing', 'active', 'revoking'))
    or (old.status = 'revoking' and new.status in ('disconnected', 'disconnected_unconfirmed'))
    or (old.status = 'disconnected' and new.status = 'disconnected_unconfirmed')
    or (old.status in ('disconnected', 'disconnected_unconfirmed') and new.status = 'authorizing')
  ) then
    raise exception 'invalid connector connection transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if new.status <> old.status
     and new.status in ('disconnected', 'disconnected_unconfirmed')
     and coalesce(current_setting('omnix.connector_revocation_transition', true), '') <> 'on' then
    raise exception 'terminal connector disconnect requires fenced revocation evidence'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Prevent normal provider work from being claimed once an owner requests
-- revocation. In-flight executing work drains before the revocation claim.
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
    select job.id
    from public.connector_jobs job
    join public.connector_connections connection
      on connection.id = job.connection_id
     and connection.workspace_id = job.workspace_id
    where job.state in ('queued', 'retry_wait')
      and job.scheduled_at <= target_now
      and job.attempt_count < job.max_attempts
      and connection.status in ('active', 'degraded')
    order by job.priority desc, job.scheduled_at, job.created_at, job.id
    for update of job skip locked
    limit target_batch_size
  loop
    update public.connector_jobs
       set state = 'leased',
           lease_owner = target_worker_id,
           lease_expires_at = target_now + make_interval(secs => target_lease_seconds),
           fencing_token = fencing_token + 1
     where id = candidate.id
     returning * into claimed_job;

    return next claimed_job;
  end loop;

  return;
end;
$$;

-- Existing generic connection state persistence remains useful for probes and
-- reauthorization, but cannot manufacture a terminal revocation outcome.
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
  if target_status in ('disconnected', 'disconnected_unconfirmed', 'revoking') then
    raise exception 'revocation state requires the durable disconnect workflow'
      using errcode = '42501';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
  for update;

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
         disconnected_at = null
   where id = target_connection_id
   returning * into target_connection;

  if target_last_probe_at is not null then
    receipt_type := 'connection.probed';
    insert into public.connector_receipt_events (
      workspace_id, connection_id, provider, event_type, event_key, correlation_id,
      error_category, redacted_metadata
    ) values (
      target_connection.workspace_id, target_connection.id, target_connection.provider, receipt_type,
      receipt_type::text || ':' || target_correlation_id::text,
      target_correlation_id, target_last_error_category,
      jsonb_build_object('status', target_connection.status, 'provider', target_connection.provider)
    ) on conflict (workspace_id, event_key) do nothing;
  end if;

  return jsonb_build_object('connection', to_jsonb(target_connection), 'noOp', false);
end;
$$;

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
  target_job public.connector_revocation_jobs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
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

  select job.* into target_job
  from public.connector_revocation_jobs job
  where job.connection_id = target_connection.id
  for update;

  if found then
    no_op := true;
  else
    if target_connection.status in ('active', 'degraded', 'reauthorization_required', 'authorizing') then
      update public.connector_connections
         set status = 'revoking', last_error_category = null
       where id = target_connection.id
       returning * into target_connection;

      insert into public.connector_revocation_jobs (
        workspace_id, connection_id, provider, requested_by_membership_id,
        correlation_id
      ) values (
        target_connection.workspace_id, target_connection.id,
        target_connection.provider, actor.id, target_correlation_id
      ) returning * into target_job;
    elsif target_connection.status in ('disconnected', 'disconnected_unconfirmed') then
      -- Legacy terminal rows predate durable provider evidence. Preserve their
      -- secret material and represent them honestly as unconfirmed.
      perform set_config('omnix.connector_revocation_transition', 'on', true);
      update public.connector_connections
         set status = 'disconnected_unconfirmed',
             disconnected_at = coalesce(disconnected_at, now()),
             last_error_category = 'legacy_disconnect_unconfirmed'
       where id = target_connection.id
       returning * into target_connection;
      perform set_config('omnix.connector_revocation_transition', 'off', true);

      insert into public.connector_revocation_jobs (
        workspace_id, connection_id, provider, state,
        requested_by_membership_id, correlation_id, last_error_category,
        completed_at
      ) values (
        target_connection.workspace_id, target_connection.id,
        target_connection.provider, 'disconnected_unconfirmed', actor.id,
        target_correlation_id, 'legacy_disconnect_unconfirmed', now()
      ) returning * into target_job;
    elsif target_connection.status = 'revoking' then
      insert into public.connector_revocation_jobs (
        workspace_id, connection_id, provider, requested_by_membership_id,
        correlation_id
      ) values (
        target_connection.workspace_id, target_connection.id,
        target_connection.provider, actor.id, target_correlation_id
      ) returning * into target_job;
    else
      raise exception 'connection cannot be disconnected from state %', target_connection.status
        using errcode = '23514';
    end if;
  end if;

  select receipt.* into target_receipt
  from public.connector_receipt_events receipt
  where receipt.workspace_id = target_job.workspace_id
    and receipt.event_key = 'revocation.requested:' || target_job.id::text;

  if not found then
    insert into public.connector_receipt_events (
      workspace_id, connection_id, provider, event_type, event_key, correlation_id,
      error_category, redacted_metadata
    ) values (
      target_job.workspace_id, target_job.connection_id, target_job.provider,
      'revocation.requested', 'revocation.requested:' || target_job.id::text,
      target_job.correlation_id, target_job.last_error_category,
      jsonb_build_object(
        'provider', target_job.provider,
        'revocationJobId', target_job.id,
        'actorMembershipId', target_job.requested_by_membership_id
      )
    )
    returning * into target_receipt;
  end if;

  return jsonb_build_object(
    'connection', to_jsonb(target_connection),
    'receipt', to_jsonb(target_receipt),
    'revocationJob', to_jsonb(target_job),
    'noOp', no_op
  );
end;
$$;

create or replace function public.claim_connector_revocation_jobs(
  target_worker_id uuid,
  target_batch_size integer default 10,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_job public.connector_revocation_jobs%rowtype;
  target_connection public.connector_connections%rowtype;
  claimed_items jsonb := '[]'::jsonb;
begin
  if target_worker_id is null
     or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid connector revocation claim request' using errcode = '22023';
  end if;

  for candidate in
    select job.id
    from public.connector_revocation_jobs job
    where (
        (job.state in ('queued', 'retry_wait') and job.scheduled_at <= target_now)
        or (job.state = 'leased' and job.lease_expires_at <= target_now)
      )
      and job.attempt_count < job.max_attempts
      and not exists (
        select 1 from public.connector_jobs normal_job
        where normal_job.connection_id = job.connection_id
          and normal_job.state in ('leased', 'executing', 'reconciliation_required')
      )
    order by job.scheduled_at, job.created_at, job.id
    for update of job skip locked
    limit target_batch_size
  loop
    update public.connector_revocation_jobs
       set state = 'leased',
           lease_owner = target_worker_id,
           lease_expires_at = target_now + make_interval(secs => target_lease_seconds),
           fencing_token = fencing_token + 1
     where id = candidate.id
     returning * into claimed_job;

    select connection.* into strict target_connection
    from public.connector_connections connection
    where connection.id = claimed_job.connection_id
      and connection.workspace_id = claimed_job.workspace_id;

    claimed_items := claimed_items || jsonb_build_array(jsonb_build_object(
      'id', claimed_job.id,
      'workspaceId', claimed_job.workspace_id,
      'connectionId', claimed_job.connection_id,
      'provider', claimed_job.provider,
      'state', claimed_job.state,
      'attemptCount', claimed_job.attempt_count,
      'maxAttempts', claimed_job.max_attempts,
      'scheduledAt', claimed_job.scheduled_at,
      'leaseOwner', claimed_job.lease_owner,
      'leaseExpiresAt', claimed_job.lease_expires_at,
      'fencingToken', claimed_job.fencing_token,
      'correlationId', claimed_job.correlation_id,
      'connection', to_jsonb(target_connection)
    ));
  end loop;

  return jsonb_build_object('count', jsonb_array_length(claimed_items), 'jobs', claimed_items);
end;
$$;

create or replace function public.start_connector_revocation_attempt(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_started_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job public.connector_revocation_jobs%rowtype;
  target_connection public.connector_connections%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
begin
  select job.* into target_job
  from public.connector_revocation_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception 'connector revocation job not found' using errcode = 'P0002';
  end if;

  if target_job.state = 'executing'
     and target_job.lease_owner = target_worker_id
     and target_job.fencing_token = target_fencing_token
     and target_job.lease_expires_at > target_started_at then
    select * into target_connection from public.connector_connections where id = target_job.connection_id;
    select * into target_receipt from public.connector_receipt_events
     where workspace_id = target_job.workspace_id
       and event_key = 'revocation.attempt.started:' || target_job.id::text || ':' || target_fencing_token::text;
    return jsonb_build_object('revocationJob', to_jsonb(target_job), 'connection', to_jsonb(target_connection), 'receipt', to_jsonb(target_receipt), 'noOp', true);
  end if;

  if target_job.state <> 'leased'
     or target_job.lease_owner <> target_worker_id
     or target_job.fencing_token <> target_fencing_token
     or target_job.lease_expires_at <= target_started_at then
    raise exception 'stale or invalid connector revocation lease' using errcode = '40001';
  end if;

  if target_job.attempt_count >= target_job.max_attempts then
    raise exception 'connector revocation attempt budget exhausted' using errcode = '23514';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_job.connection_id
    and connection.workspace_id = target_job.workspace_id
    and connection.status = 'revoking'
  for share;

  if not found then
    raise exception 'connector connection is not revoking' using errcode = '23514';
  end if;

  update public.connector_revocation_jobs
     set state = 'executing', attempt_count = attempt_count + 1,
         started_at = target_started_at
   where id = target_job.id
   returning * into target_job;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, provider, event_type, event_key, correlation_id,
    attempt_number, fencing_token, redacted_metadata, occurred_at
  ) values (
    target_job.workspace_id, target_job.connection_id, target_job.provider, 'attempt.started',
    'revocation.attempt.started:' || target_job.id::text || ':' || target_fencing_token::text,
    target_job.correlation_id, target_job.attempt_count, target_fencing_token,
    jsonb_build_object('provider', target_job.provider, 'revocationJobId', target_job.id),
    target_started_at
  ) returning * into target_receipt;

  return jsonb_build_object(
    'revocationJob', to_jsonb(target_job),
    'connection', to_jsonb(target_connection),
    'receipt', to_jsonb(target_receipt),
    'noOp', false
  );
end;
$$;

create or replace function public.read_connector_revocation_secret_envelope(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_secret_type text,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_job public.connector_revocation_jobs%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  select job.* into target_job
  from public.connector_revocation_jobs job
  where job.id = target_job_id
    and job.state in ('leased', 'executing')
    and job.lease_owner = target_worker_id
    and job.fencing_token = target_fencing_token
    and job.lease_expires_at > target_now;

  if not found then
    raise exception 'active connector revocation lease required' using errcode = '42501';
  end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_job.connection_id
    and secret.workspace_id = target_job.workspace_id
    and secret.secret_type = target_secret_type
    and secret.destroyed_at is null;

  if not found then
    raise exception 'connector secret envelope unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'secretId', target_secret.id,
    'secretType', target_secret.secret_type,
    'secretVersion', target_secret.secret_version,
    'ciphertext', encode(target_secret.ciphertext, 'base64'),
    'nonce', encode(target_secret.nonce, 'base64'),
    'authTag', encode(target_secret.auth_tag, 'base64'),
    'wrappedDek', encode(target_secret.wrapped_dek, 'base64'),
    'wrapNonce', encode(target_secret.wrap_nonce, 'base64'),
    'wrapAuthTag', encode(target_secret.wrap_auth_tag, 'base64'),
    'kekVersion', target_secret.kek_version,
    'aadHash', target_secret.aad_hash,
    'expiresAt', target_secret.expires_at
  );
end;
$$;

create or replace function public.transition_connector_revocation_job(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_outcome text,
  target_error_category text default null,
  target_next_attempt_at timestamptz default null,
  target_evidence jsonb default '{}'::jsonb,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job public.connector_revocation_jobs%rowtype;
  target_connection public.connector_connections%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  confirmation_kind text;
  next_state public.connector_revocation_job_state;
  receipt_type public.connector_receipt_event_type;
  receipt_key text;
  exhausted boolean;
begin
  if target_outcome not in ('confirmed', 'retry', 'unknown', 'terminal')
     or target_evidence is null
     or jsonb_typeof(target_evidence) <> 'object'
     or octet_length(target_evidence::text) > 4096
     or not (target_evidence - array['confirmationKind','providerRequestHash','providerStatus','reasonCode']) = '{}'::jsonb
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid connector revocation transition request' using errcode = '22023';
  end if;

  if target_evidence ? 'providerRequestHash'
     and target_evidence->>'providerRequestHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid provider request hash' using errcode = '22023';
  end if;

  confirmation_kind := target_evidence->>'confirmationKind';

  select job.* into target_job
  from public.connector_revocation_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception 'connector revocation job not found' using errcode = 'P0002';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_job.connection_id
    and connection.workspace_id = target_job.workspace_id
  for update;

  if target_job.state in ('succeeded', 'disconnected_unconfirmed') then
    if (target_job.state = 'succeeded' and target_outcome <> 'confirmed')
       or (target_job.state = 'disconnected_unconfirmed' and target_outcome = 'confirmed') then
      raise exception 'divergent terminal connector revocation replay' using errcode = '23505';
    end if;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
     where receipt.workspace_id = target_job.workspace_id
       and receipt.event_key = 'revocation.completed:' || target_job.id::text;
    return jsonb_build_object('revocationJob', to_jsonb(target_job), 'connection', to_jsonb(target_connection), 'receipt', to_jsonb(target_receipt), 'noOp', true);
  end if;

  if target_job.state <> 'executing'
     or target_job.lease_owner <> target_worker_id
     or target_job.fencing_token <> target_fencing_token
     or target_job.lease_expires_at <= target_now then
    raise exception 'stale or invalid connector revocation lease' using errcode = '40001';
  end if;

  if target_outcome = 'confirmed' then
    if confirmation_kind is null
       or confirmation_kind not in ('provider-confirmed', 'no-revocation-endpoint')
       or target_error_category is not null
       or target_next_attempt_at is not null then
      raise exception 'confirmed revocation requires accepted provider evidence'
        using errcode = '23514';
    end if;
    next_state := 'succeeded';
    receipt_type := 'revocation.completed';
    receipt_key := 'revocation.completed:' || target_job.id::text;
  elsif target_outcome in ('retry', 'unknown') then
    if target_error_category is null or target_next_attempt_at is null
       or target_next_attempt_at <= target_now then
      raise exception 'retryable revocation requires error category and future schedule'
        using errcode = '23514';
    end if;
    exhausted := target_job.attempt_count >= target_job.max_attempts;
    if exhausted then
      next_state := 'disconnected_unconfirmed';
      receipt_type := 'revocation.completed';
      receipt_key := 'revocation.completed:' || target_job.id::text;
    else
      next_state := 'retry_wait';
      receipt_type := case when target_outcome = 'unknown' then 'provider.unknown'::public.connector_receipt_event_type else 'job.retry-scheduled'::public.connector_receipt_event_type end;
      receipt_key := 'revocation.' || target_outcome || ':' || target_job.id::text || ':' || target_job.attempt_count::text;
    end if;
  else
    if target_error_category is null or target_next_attempt_at is not null then
      raise exception 'terminal unconfirmed revocation requires error category only'
        using errcode = '23514';
    end if;
    next_state := 'disconnected_unconfirmed';
    receipt_type := 'revocation.completed';
    receipt_key := 'revocation.completed:' || target_job.id::text;
  end if;

  if next_state = 'succeeded' then
    update connector_private.connector_connection_secrets
       set ciphertext = null, nonce = null, auth_tag = null,
           wrapped_dek = null, wrap_nonce = null, wrap_auth_tag = null,
           destroyed_at = target_now, updated_at = target_now
     where connection_id = target_job.connection_id
       and workspace_id = target_job.workspace_id
       and destroyed_at is null;

    update connector_private.connector_payload_envelopes
       set ciphertext = null, nonce = null, auth_tag = null,
           wrapped_dek = null, wrap_nonce = null, wrap_auth_tag = null,
           destroyed_at = target_now, updated_at = target_now
     where connection_id = target_job.connection_id
       and workspace_id = target_job.workspace_id
       and destroyed_at is null;

    delete from connector_private.connector_oauth_transactions
     where connection_id = target_job.connection_id
       and workspace_id = target_job.workspace_id;

    delete from connector_private.connector_sync_cursors
     where connection_id = target_job.connection_id
       and workspace_id = target_job.workspace_id;

    update connector_private.connector_webhook_bindings
       set revoked_at = coalesce(revoked_at, target_now)
     where connection_id = target_job.connection_id
       and workspace_id = target_job.workspace_id;

    update public.connector_jobs
       set state = 'cancelled', cancelled_at = target_now,
           lease_owner = null, lease_expires_at = null,
           last_error_category = 'connection_revoked'
     where connection_id = target_job.connection_id
       and workspace_id = target_job.workspace_id
       and state in ('queued', 'retry_wait');

    perform set_config('omnix.connector_revocation_transition', 'on', true);
    update public.connector_connections
       set status = 'disconnected', disconnected_at = target_now,
           last_error_category = null, granted_scopes = '{}',
           remote_identity_summary = '{}'::jsonb
     where id = target_job.connection_id
     returning * into target_connection;
    perform set_config('omnix.connector_revocation_transition', 'off', true);
  elsif next_state = 'disconnected_unconfirmed' then
    perform set_config('omnix.connector_revocation_transition', 'on', true);
    update public.connector_connections
       set status = 'disconnected_unconfirmed', disconnected_at = target_now,
           last_error_category = target_error_category
     where id = target_job.connection_id
     returning * into target_connection;
    perform set_config('omnix.connector_revocation_transition', 'off', true);
  end if;

  update public.connector_revocation_jobs
     set state = next_state,
         scheduled_at = case when next_state = 'retry_wait' then target_next_attempt_at else scheduled_at end,
         lease_owner = null, lease_expires_at = null,
         last_error_category = target_error_category,
         completed_at = case when next_state in ('succeeded', 'disconnected_unconfirmed') then target_now else null end
   where id = target_job.id
   returning * into target_job;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, provider, event_type, event_key, correlation_id,
    attempt_number, fencing_token, provider_request_hash, provider_status,
    error_category, redacted_metadata, occurred_at
  ) values (
    target_job.workspace_id, target_job.connection_id, target_job.provider, receipt_type,
    receipt_key, target_job.correlation_id, target_job.attempt_count,
    target_fencing_token, nullif(target_evidence->>'providerRequestHash', ''),
    nullif(target_evidence->>'providerStatus', ''), target_error_category,
    target_evidence || jsonb_build_object(
      'provider', target_job.provider,
      'revocationJobId', target_job.id,
      'confirmed', next_state = 'succeeded',
      'status', next_state
    ), target_now
  ) returning * into target_receipt;

  return jsonb_build_object(
    'revocationJob', to_jsonb(target_job),
    'connection', to_jsonb(target_connection),
    'receipt', to_jsonb(target_receipt),
    'noOp', false
  );
end;
$$;

revoke all on function public.request_connector_disconnect(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_connector_revocation_jobs(uuid, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.start_connector_revocation_attempt(uuid, uuid, bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.read_connector_revocation_secret_envelope(uuid, uuid, bigint, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_connector_revocation_job(uuid, uuid, bigint, text, text, timestamptz, jsonb, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.request_connector_disconnect(uuid, uuid) to authenticated;
grant execute on function public.claim_connector_revocation_jobs(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.start_connector_revocation_attempt(uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.read_connector_revocation_secret_envelope(uuid, uuid, bigint, text, timestamptz) to service_role;
grant execute on function public.transition_connector_revocation_job(uuid, uuid, bigint, text, text, timestamptz, jsonb, timestamptz) to service_role;

do $$
declare target_function text;
begin
  if not exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'connector_revocation_jobs'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then
    raise exception 'connector_revocation_jobs must force RLS';
  end if;

  if has_table_privilege('authenticated', 'public.connector_revocation_jobs', 'INSERT')
     or has_table_privilege('authenticated', 'public.connector_revocation_jobs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.connector_revocation_jobs', 'DELETE') then
    raise exception 'authenticated has forbidden direct revocation job mutation';
  end if;

  foreach target_function in array array[
    'claim_connector_revocation_jobs(uuid,integer,integer,timestamp with time zone)',
    'start_connector_revocation_attempt(uuid,uuid,bigint,timestamp with time zone)',
    'read_connector_revocation_secret_envelope(uuid,uuid,bigint,text,timestamp with time zone)',
    'transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamp with time zone,jsonb,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', 'public.' || target_function, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || target_function, 'EXECUTE')
       or not has_function_privilege('service_role', 'public.' || target_function, 'EXECUTE') then
      raise exception 'revocation RPC privilege mismatch: %', target_function;
    end if;
  end loop;
end;
$$;

comment on table public.connector_revocation_jobs is
  'Workspace-visible durable provider revocation jobs. Authenticated roles are read-only; service workers mutate only through leased and fenced RPCs.';
comment on function public.claim_connector_revocation_jobs(uuid, integer, integer, timestamptz) is
  'Service-role bounded SKIP LOCKED claim. Returns redacted connection metadata and no encrypted material.';
comment on function public.start_connector_revocation_attempt(uuid, uuid, bigint, timestamptz) is
  'Service-role fenced attempt start that appends deterministic attempt.started evidence.';
comment on function public.read_connector_revocation_secret_envelope(uuid, uuid, bigint, text, timestamptz) is
  'Service-role lease/fence-bound encrypted credential read for provider revocation; plaintext never enters Postgres.';
comment on function public.transition_connector_revocation_job(uuid, uuid, bigint, text, text, timestamptz, jsonb, timestamptz) is
  'Service-role fenced revocation transition. Confirmed evidence cryptoshreds material; terminal uncertainty preserves it for recovery.';

commit;
