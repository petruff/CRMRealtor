-- Omnix — Google push, ambiguity reconciliation and Calendar lifecycle authority
-- Story 4.2 forward-only remediation. Apply after 0001..0020.
-- Raw Gmail addresses, history ids, Pub/Sub bodies, provider identifiers and
-- OAuth tokens remain private/encrypted. Public evidence is hash-only.

begin;

create type public.google_gmail_wakeup_job_state as enum (
  'queued','leased','executing','retry_wait','succeeded','failed'
);

create table connector_private.google_gmail_watch_ingress_authorities (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete restrict,
  connection_id            uuid not null,
  watch_resource_id        uuid not null,
  binding_version          integer not null default 1,
  endpoint_key_hash        text not null,
  exact_external_url_hash  text not null,
  subscription_hash        text not null,
  oidc_audience_hash       text not null,
  account_email_hash       text not null,
  created_at               timestamptz not null,
  updated_at               timestamptz not null,
  revoked_at               timestamptz,
  constraint google_gmail_watch_ingress_connection_unique unique(connection_id),
  constraint google_gmail_watch_ingress_endpoint_unique unique(endpoint_key_hash),
  constraint google_gmail_watch_ingress_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_watch_ingress_watch_workspace_fk
    foreign key(watch_resource_id,workspace_id)
    references connector_private.google_gmail_watch_resources(id,workspace_id) on delete restrict,
  constraint google_gmail_watch_ingress_version check(binding_version>0),
  constraint google_gmail_watch_ingress_hashes check(
    endpoint_key_hash ~ '^[0-9a-f]{64}$'
    and exact_external_url_hash ~ '^[0-9a-f]{64}$'
    and subscription_hash ~ '^[0-9a-f]{64}$'
    and oidc_audience_hash ~ '^[0-9a-f]{64}$'
    and account_email_hash ~ '^[0-9a-f]{64}$'
  )
);

create table public.google_gmail_history_wakeup_jobs (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  state                 public.google_gmail_wakeup_job_state not null default 'queued',
  wake_generation       bigint not null default 1,
  claimed_generation    bigint,
  scheduled_at          timestamptz not null,
  attempt_count         integer not null default 0,
  max_attempts          integer not null default 12,
  lease_owner           uuid,
  lease_expires_at      timestamptz,
  fencing_token         bigint not null default 0,
  correlation_id        uuid not null,
  last_history_id_hash  text not null,
  last_message_id_hash  text not null,
  job_kind              text not null default 'history-sync',
  last_error_category   text,
  completed_at          timestamptz,
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  constraint google_gmail_wakeup_jobs_id_workspace_unique unique(id,workspace_id),
  constraint google_gmail_wakeup_jobs_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_wakeup_jobs_generation check(
    wake_generation>0 and (claimed_generation is null or claimed_generation>0)
  ),
  constraint google_gmail_wakeup_jobs_attempts check(
    attempt_count>=0 and max_attempts between 1 and 20 and attempt_count<=max_attempts
  ),
  constraint google_gmail_wakeup_jobs_fence check(fencing_token>=0),
  constraint google_gmail_wakeup_jobs_hashes check(
    last_history_id_hash ~ '^[0-9a-f]{64}$'
    and last_message_id_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_gmail_wakeup_jobs_kind check(job_kind in ('history-sync','watch-renewal')),
  constraint google_gmail_wakeup_jobs_error check(
    last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint google_gmail_wakeup_jobs_lease check(
    (state in ('leased','executing') and lease_owner is not null and lease_expires_at is not null)
    or (state not in ('leased','executing') and lease_owner is null and lease_expires_at is null)
  ),
  constraint google_gmail_wakeup_jobs_terminal check(
    (state in ('succeeded','failed') and completed_at is not null)
    or (state not in ('succeeded','failed') and completed_at is null)
  )
);

create unique index google_gmail_wakeup_jobs_active_connection_idx
  on public.google_gmail_history_wakeup_jobs(connection_id)
  where state in ('queued','leased','executing','retry_wait');
create index google_gmail_wakeup_jobs_due_idx
  on public.google_gmail_history_wakeup_jobs(scheduled_at,created_at,id)
  where state in ('queued','retry_wait');
create index google_gmail_wakeup_jobs_workspace_idx
  on public.google_gmail_history_wakeup_jobs(workspace_id,state,updated_at desc);

create table public.google_gmail_watch_deliveries (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete restrict,
  connection_id           uuid not null,
  wakeup_job_id           uuid not null,
  pubsub_message_id_hash  text not null,
  history_id_hash         text not null,
  account_email_hash      text not null,
  published_at            timestamptz not null,
  received_at             timestamptz not null,
  correlation_id          uuid not null,
  created_at              timestamptz not null default now(),
  constraint google_gmail_watch_deliveries_id_workspace_unique unique(id,workspace_id),
  constraint google_gmail_watch_deliveries_message_unique unique(connection_id,pubsub_message_id_hash),
  constraint google_gmail_watch_deliveries_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_watch_deliveries_job_workspace_fk
    foreign key(wakeup_job_id,workspace_id)
    references public.google_gmail_history_wakeup_jobs(id,workspace_id) on delete restrict,
  constraint google_gmail_watch_deliveries_hashes check(
    pubsub_message_id_hash ~ '^[0-9a-f]{64}$'
    and history_id_hash ~ '^[0-9a-f]{64}$'
    and account_email_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_gmail_watch_deliveries_time check(
    received_at>=published_at-interval '10 minutes'
  )
);

create index google_gmail_watch_deliveries_workspace_idx
  on public.google_gmail_watch_deliveries(workspace_id,received_at desc);

create table public.google_gmail_send_reconciliations (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete restrict,
  connection_id            uuid not null,
  job_id                   uuid not null,
  draft_id                 uuid not null,
  operation_marker_hash    text not null,
  strategy                 text not null,
  state                    text not null,
  max_scan                 integer not null default 100,
  attempt_count            integer not null default 0,
  last_scan_evidence_hash  text,
  last_outcome             text,
  correlation_id           uuid not null,
  created_at               timestamptz not null,
  updated_at               timestamptz not null,
  resolved_at              timestamptz,
  constraint google_gmail_send_reconciliations_id_workspace_unique unique(id,workspace_id),
  constraint google_gmail_send_reconciliations_job_unique unique(job_id),
  constraint google_gmail_send_reconciliations_marker_unique unique(connection_id,operation_marker_hash),
  constraint google_gmail_send_reconciliations_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_send_reconciliations_job_workspace_fk
    foreign key(job_id,workspace_id)
    references public.connector_jobs(id,workspace_id) on delete restrict,
  constraint google_gmail_send_reconciliations_draft_workspace_fk
    foreign key(draft_id,workspace_id)
    references public.google_email_drafts(id,workspace_id) on delete restrict,
  constraint google_gmail_send_reconciliations_hashes check(
    operation_marker_hash ~ '^[0-9a-f]{64}$'
    and (last_scan_evidence_hash is null or last_scan_evidence_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint google_gmail_send_reconciliations_strategy check(
    strategy in ('bounded-metadata-scan','unavailable-no-resend')
  ),
  constraint google_gmail_send_reconciliations_state check(
    state in ('pending','unresolved','matched','conflict','unavailable')
  ),
  constraint google_gmail_send_reconciliations_outcome check(
    last_outcome is null or last_outcome in ('not-found','ambiguous','unavailable','matched')
  ),
  constraint google_gmail_send_reconciliations_scan check(max_scan=100 and attempt_count>=0),
  constraint google_gmail_send_reconciliations_resolution check(
    (state in ('matched','conflict','unavailable') and resolved_at is not null)
    or (state not in ('matched','conflict','unavailable') and resolved_at is null)
  )
);

create index google_gmail_send_reconciliations_workspace_idx
  on public.google_gmail_send_reconciliations(workspace_id,state,updated_at desc);

alter table connector_private.google_gmail_resources
  add column source_wakeup_job_id uuid,
  add constraint google_gmail_resources_wakeup_job_workspace_fk
    foreign key(source_wakeup_job_id,workspace_id)
    references public.google_gmail_history_wakeup_jobs(id,workspace_id) on delete restrict,
  add constraint google_gmail_resources_one_source check(
    num_nonnulls(source_job_id,source_wakeup_job_id)<=1
  );

create unique index google_gmail_resources_source_wakeup_job_message_idx
  on connector_private.google_gmail_resources(connection_id,source_wakeup_job_id,message_external_id)
  where source_wakeup_job_id is not null;

alter table public.google_calendar_task_states
  drop constraint google_calendar_task_states_state,
  add constraint google_calendar_task_states_state check(
    state in ('pending','synced','active','completed','cancelled','deleted',
              'conflict','remote-deleted','review','disconnected')
  );

alter table connector_private.google_calendar_task_resources
  add column lifecycle_state text not null default 'active',
  add column last_job_id uuid,
  add column lifecycle_evidence_hash text,
  add column completed_at timestamptz,
  add column cancelled_at timestamptz,
  add column deleted_at timestamptz,
  add constraint google_calendar_task_resources_last_job_workspace_fk
    foreign key(last_job_id,workspace_id)
    references public.connector_jobs(id,workspace_id) on delete restrict,
  add constraint google_calendar_task_resources_lifecycle_state check(
    lifecycle_state in ('active','completed','cancelled','deleted')
  ),
  add constraint google_calendar_task_resources_lifecycle_hash check(
    lifecycle_evidence_hash is null or lifecycle_evidence_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint google_calendar_task_resources_lifecycle_time check(
    (lifecycle_state='active' and completed_at is null and cancelled_at is null and deleted_at is null)
    or (lifecycle_state='completed' and completed_at is not null and cancelled_at is null and deleted_at is null)
    or (lifecycle_state='cancelled' and cancelled_at is not null and deleted_at is null)
    or (lifecycle_state='deleted' and deleted_at is not null)
  );

alter table public.google_gmail_history_wakeup_jobs enable row level security;
alter table public.google_gmail_history_wakeup_jobs force row level security;
alter table public.google_gmail_watch_deliveries enable row level security;
alter table public.google_gmail_watch_deliveries force row level security;
alter table public.google_gmail_send_reconciliations enable row level security;
alter table public.google_gmail_send_reconciliations force row level security;

create policy google_gmail_wakeup_jobs_member_select
  on public.google_gmail_history_wakeup_jobs for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy google_gmail_watch_deliveries_member_select
  on public.google_gmail_watch_deliveries for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy google_gmail_send_reconciliations_member_select
  on public.google_gmail_send_reconciliations for select to authenticated
  using(public.has_workspace_access(workspace_id));

revoke all on table public.google_gmail_history_wakeup_jobs,
  public.google_gmail_watch_deliveries,public.google_gmail_send_reconciliations
  from anon,authenticated,service_role;
grant select on table public.google_gmail_history_wakeup_jobs,
  public.google_gmail_watch_deliveries,public.google_gmail_send_reconciliations
  to authenticated,service_role;
revoke all on table connector_private.google_gmail_watch_ingress_authorities
  from public,anon,authenticated,service_role;

create trigger google_gmail_watch_deliveries_guard_mutation
before update or delete on public.google_gmail_watch_deliveries
for each row execute function public.guard_connector_append_only();

-- Extended Google action authority ---------------------------------------

create or replace function connector_private.google_bundle_for_action(target_action text)
returns text language sql immutable security definer set search_path='' as $$
  select case target_action
    when 'gmail.send' then 'gmail-send'
    when 'gmail.sync-metadata' then 'gmail-metadata'
    when 'calendar.create-omnix-calendar' then 'calendar-app-created'
    when 'calendar.upsert-omnix-event' then 'calendar-app-created'
    when 'calendar.complete-omnix-event' then 'calendar-app-created'
    when 'calendar.cancel-omnix-event' then 'calendar-app-created'
    when 'calendar.delete-omnix-event' then 'calendar-app-created'
    when 'calendar.sync' then 'calendar-app-created'
    else null end;
$$;

-- Gmail watch ingress and durable wake-up queue --------------------------

create or replace function public.bind_google_gmail_watch_ingress_authority(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_expected_version integer,target_endpoint_key_hash text,
  target_exact_external_url_hash text,target_subscription_hash text,
  target_oidc_audience_hash text,target_account_email_hash text,
  target_occurred_at timestamptz,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype;
 target_watch connector_private.google_gmail_watch_resources%rowtype;
 target_binding connector_private.google_gmail_watch_ingress_authorities%rowtype;
 no_op boolean:=false;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type<>'gmail.sync-metadata' or target_correlation_id is null
  or target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
  or target_exact_external_url_hash !~ '^[0-9a-f]{64}$'
  or target_subscription_hash !~ '^[0-9a-f]{64}$'
  or target_oidc_audience_hash !~ '^[0-9a-f]{64}$'
  or target_account_email_hash !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid Gmail push authority binding' using errcode='22023';
 end if;
 if target_account_email_hash<>encode(extensions.digest(pg_catalog.convert_to(lower(trim((select display_label
   from public.connector_connections where id=target_job.connection_id))),'UTF8'),'sha256'),'hex') then
  raise exception 'Gmail push account binding mismatch' using errcode='42501';
 end if;
 select watch.* into target_watch from connector_private.google_gmail_watch_resources watch
  where watch.connection_id=target_job.connection_id and watch.revoked_at is null
   and watch.expires_at>target_occurred_at for update;
 if not found then raise exception 'current Gmail watch required' using errcode='P0002'; end if;
 select binding.* into target_binding from connector_private.google_gmail_watch_ingress_authorities binding
  where binding.connection_id=target_job.connection_id for update;
 if found then
  if target_binding.endpoint_key_hash=target_endpoint_key_hash
   and target_binding.exact_external_url_hash=target_exact_external_url_hash
   and target_binding.subscription_hash=target_subscription_hash
   and target_binding.oidc_audience_hash=target_oidc_audience_hash
   and target_binding.account_email_hash=target_account_email_hash
   and target_binding.watch_resource_id=target_watch.id and target_binding.revoked_at is null then
   if target_expected_version is not null and target_expected_version<>target_binding.binding_version then
    raise exception 'Gmail push binding version conflict' using errcode='40001'; end if;
   no_op:=true;
  else
   if target_expected_version is null or target_expected_version<>target_binding.binding_version then
    raise exception 'Gmail push binding version conflict' using errcode='40001'; end if;
   update connector_private.google_gmail_watch_ingress_authorities set
    watch_resource_id=target_watch.id,binding_version=binding_version+1,
    endpoint_key_hash=target_endpoint_key_hash,exact_external_url_hash=target_exact_external_url_hash,
    subscription_hash=target_subscription_hash,oidc_audience_hash=target_oidc_audience_hash,
    account_email_hash=target_account_email_hash,revoked_at=null,updated_at=target_occurred_at
   where id=target_binding.id returning * into target_binding;
  end if;
 else
  if target_expected_version is not null then
   raise exception 'Gmail push binding version conflict' using errcode='40001'; end if;
  insert into connector_private.google_gmail_watch_ingress_authorities(
   workspace_id,connection_id,watch_resource_id,endpoint_key_hash,exact_external_url_hash,
   subscription_hash,oidc_audience_hash,account_email_hash,created_at,updated_at)
  values(target_job.workspace_id,target_job.connection_id,target_watch.id,target_endpoint_key_hash,
   target_exact_external_url_hash,target_subscription_hash,target_oidc_audience_hash,
   target_account_email_hash,target_occurred_at,target_occurred_at) returning * into target_binding;
 end if;
 return jsonb_build_object('binding',jsonb_build_object(
  'workspaceId',target_binding.workspace_id,'connectionId',target_binding.connection_id,
  'bindingVersion',target_binding.binding_version,'endpointBound',true,
  'subscriptionHash',target_binding.subscription_hash,'oidcAudienceHash',target_binding.oidc_audience_hash,
  'accountEmailHash',target_binding.account_email_hash,'revokedAt',target_binding.revoked_at),
  'watch',jsonb_build_object('resourceVersion',target_watch.resource_version,
   'expiresAt',target_watch.expires_at),'correlationId',target_correlation_id,'noOp',no_op);
end;
$$;

create or replace function public.register_google_gmail_push_wakeup(
  target_endpoint_key_hash text,target_exact_external_url_hash text,
  target_subscription_hash text,target_oidc_audience_hash text,
  target_pubsub_message_id_hash text,target_account_email_hash text,
  target_history_id_hash text,target_published_at timestamptz,
  target_received_at timestamptz,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_binding connector_private.google_gmail_watch_ingress_authorities%rowtype;
 target_delivery public.google_gmail_watch_deliveries%rowtype;
 target_job public.google_gmail_history_wakeup_jobs%rowtype; no_op boolean:=false;
begin
 if target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
  or target_exact_external_url_hash !~ '^[0-9a-f]{64}$'
  or target_subscription_hash !~ '^[0-9a-f]{64}$'
  or target_oidc_audience_hash !~ '^[0-9a-f]{64}$'
  or target_pubsub_message_id_hash !~ '^[0-9a-f]{64}$'
  or target_account_email_hash !~ '^[0-9a-f]{64}$'
  or target_history_id_hash !~ '^[0-9a-f]{64}$'
  or target_correlation_id is null or target_received_at is null or target_published_at is null
  or target_published_at>target_received_at+interval '10 minutes' then
  raise exception 'invalid verified Gmail push delivery' using errcode='22023'; end if;
 select binding.* into target_binding from connector_private.google_gmail_watch_ingress_authorities binding
 join public.connector_connections connection on connection.id=binding.connection_id
  and connection.workspace_id=binding.workspace_id
 join public.google_connection_capabilities capability on capability.connection_id=binding.connection_id
  and capability.workspace_id=binding.workspace_id and capability.bundle='gmail-metadata'
  and capability.state='active' and capability.account_key_hash=connection.provider_account_key_hash
 where binding.endpoint_key_hash=target_endpoint_key_hash and binding.revoked_at is null
  and binding.exact_external_url_hash=target_exact_external_url_hash
  and binding.subscription_hash=target_subscription_hash
  and binding.oidc_audience_hash=target_oidc_audience_hash
  and binding.account_email_hash=target_account_email_hash
  and connection.provider='google' and connection.status in ('active','degraded') for update;
 if not found then raise exception 'verified Gmail push authority not found' using errcode='42501'; end if;
 perform 1 from connector_private.google_gmail_watch_resources watch
  where watch.id=target_binding.watch_resource_id and watch.workspace_id=target_binding.workspace_id
   and watch.connection_id=target_binding.connection_id and watch.revoked_at is null
   and watch.expires_at>target_received_at;
 if not found then raise exception 'current Gmail watch required' using errcode='42501'; end if;
 select delivery.* into target_delivery from public.google_gmail_watch_deliveries delivery
  where delivery.connection_id=target_binding.connection_id
   and delivery.pubsub_message_id_hash=target_pubsub_message_id_hash;
 if found then
  if target_delivery.history_id_hash<>target_history_id_hash
   or target_delivery.account_email_hash<>target_account_email_hash
   or target_delivery.published_at<>target_published_at then
   raise exception 'Gmail push replay conflicts' using errcode='23505'; end if;
  select job.* into strict target_job from public.google_gmail_history_wakeup_jobs job
   where job.id=target_delivery.wakeup_job_id;
  return jsonb_build_object('accepted',true,'noOp',true,'delivery',to_jsonb(target_delivery),
   'wakeupJob',to_jsonb(target_job));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('google-gmail-wakeup:'||target_binding.connection_id::text,0));
 select job.* into target_job from public.google_gmail_history_wakeup_jobs job
  where job.connection_id=target_binding.connection_id
   and job.state in ('queued','leased','executing','retry_wait') for update;
 if found then
  update public.google_gmail_history_wakeup_jobs set wake_generation=wake_generation+1,
   last_history_id_hash=target_history_id_hash,last_message_id_hash=target_pubsub_message_id_hash,
   scheduled_at=least(scheduled_at,target_received_at),updated_at=target_received_at
  where id=target_job.id returning * into target_job;
 else
  insert into public.google_gmail_history_wakeup_jobs(workspace_id,connection_id,state,
   scheduled_at,correlation_id,last_history_id_hash,last_message_id_hash,created_at,updated_at)
  values(target_binding.workspace_id,target_binding.connection_id,'queued',target_received_at,
   target_correlation_id,target_history_id_hash,target_pubsub_message_id_hash,target_received_at,target_received_at)
  returning * into target_job;
 end if;
 insert into public.google_gmail_watch_deliveries(workspace_id,connection_id,wakeup_job_id,
  pubsub_message_id_hash,history_id_hash,account_email_hash,published_at,received_at,correlation_id)
 values(target_binding.workspace_id,target_binding.connection_id,target_job.id,
  target_pubsub_message_id_hash,target_history_id_hash,target_account_email_hash,
  target_published_at,target_received_at,target_correlation_id) returning * into target_delivery;
 update public.google_sync_health set state=case when state='full_resync_required' then state else 'syncing' end,
  last_callback_at=target_received_at,updated_at=target_received_at
 where connection_id=target_binding.connection_id and stream_key='google.gmail-history';
 return jsonb_build_object('accepted',true,'noOp',no_op,'delivery',to_jsonb(target_delivery),
  'wakeupJob',to_jsonb(target_job));
end;
$$;

create or replace function public.claim_google_gmail_history_wakeup_jobs(
  target_worker_id uuid,target_batch_size integer,target_lease_seconds integer,target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare claimed jsonb;
begin
 if target_worker_id is null or target_batch_size not between 1 and 100
  or target_lease_seconds not between 15 and 900 or target_now is null then
  raise exception 'invalid Gmail wakeup claim' using errcode='22023'; end if;
 with candidates as (
  select job.id from public.google_gmail_history_wakeup_jobs job
  join public.connector_connections connection on connection.id=job.connection_id
   and connection.workspace_id=job.workspace_id and connection.provider='google'
   and connection.status in ('active','degraded')
  join public.google_connection_capabilities capability on capability.connection_id=job.connection_id
   and capability.workspace_id=job.workspace_id and capability.bundle='gmail-metadata'
   and capability.state='active' and capability.account_key_hash=connection.provider_account_key_hash
  where ((job.state in ('queued','retry_wait') and job.scheduled_at<=target_now)
    or (job.state in ('leased','executing') and job.lease_expires_at<=target_now))
   and job.attempt_count<job.max_attempts
  order by job.scheduled_at,job.created_at,job.id for update of job skip locked limit target_batch_size
 ), claimed_rows as (
  update public.google_gmail_history_wakeup_jobs job set state='leased',lease_owner=target_worker_id,
   lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),
   fencing_token=fencing_token+1,last_error_category=null,updated_at=target_now
  from candidates where job.id=candidates.id returning job.*
 ) select coalesce(jsonb_agg(to_jsonb(claimed_rows) order by created_at,id),'[]'::jsonb) into claimed from claimed_rows;
 return jsonb_build_object('count',jsonb_array_length(claimed),'jobs',claimed);
end;
$$;

create or replace function public.start_google_gmail_history_wakeup_attempt(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
begin
 update public.google_gmail_history_wakeup_jobs set state='executing',attempt_count=attempt_count+1,
  claimed_generation=wake_generation,updated_at=target_now
 where id=target_job_id and state='leased' and lease_owner=target_worker_id
  and fencing_token=target_fencing_token and lease_expires_at>target_now and attempt_count<max_attempts
 returning * into target_job;
 if not found then raise exception 'active fenced Gmail wakeup lease required' using errcode='42501'; end if;
 return jsonb_build_object('job',to_jsonb(target_job));
end;
$$;

create or replace function public.schedule_due_google_gmail_watch_renewals(
 target_now timestamptz,target_horizon_seconds integer,target_limit integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_watch record; target_job public.google_gmail_history_wakeup_jobs%rowtype;
 jobs jsonb:='[]'::jsonb; created boolean;
begin
 if target_now is null or target_horizon_seconds not between 300 and 604800
  or target_limit not between 1 and 100 then
  raise exception 'invalid Gmail watch renewal schedule' using errcode='22023'; end if;
 for target_watch in
  select watch.*,binding.binding_version from connector_private.google_gmail_watch_resources watch
  join connector_private.google_gmail_watch_ingress_authorities binding on binding.watch_resource_id=watch.id
   and binding.connection_id=watch.connection_id and binding.workspace_id=watch.workspace_id and binding.revoked_at is null
  join public.connector_connections connection on connection.id=watch.connection_id
   and connection.workspace_id=watch.workspace_id and connection.provider='google'
   and connection.status in ('active','degraded')
  join public.google_connection_capabilities capability on capability.connection_id=watch.connection_id
   and capability.workspace_id=watch.workspace_id and capability.bundle='gmail-metadata'
   and capability.state='active' and capability.account_key_hash=connection.provider_account_key_hash
  where watch.revoked_at is null and watch.expires_at<=target_now+make_interval(secs=>target_horizon_seconds)
   and not exists(select 1 from public.google_gmail_history_wakeup_jobs active_job
    where active_job.connection_id=watch.connection_id and active_job.state in ('queued','leased','executing','retry_wait'))
  order by watch.expires_at,watch.connection_id for update of watch skip locked limit target_limit
 loop
  insert into public.google_gmail_history_wakeup_jobs(workspace_id,connection_id,state,job_kind,
   scheduled_at,correlation_id,last_history_id_hash,last_message_id_hash,created_at,updated_at)
  values(target_watch.workspace_id,target_watch.connection_id,'queued','watch-renewal',target_now,
   gen_random_uuid(),target_watch.resource_key_hash,target_watch.channel_key_hash,target_now,target_now)
  returning * into target_job;
  jobs:=jobs||jsonb_build_array(to_jsonb(target_job));
 end loop;
 return jsonb_build_object('count',jsonb_array_length(jobs),'jobs',jobs);
end;
$$;

create or replace function public.renew_google_gmail_watch_from_wakeup(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
 target_expected_watch_resource_version integer,target_expected_binding_version integer,
 target_channel_key_hash text,target_resource_key_hash text,target_expires_at timestamptz,
 target_expected_endpoint_key_hash text,target_expected_exact_external_url_hash text,
 target_expected_subscription_hash text,target_expected_oidc_audience_hash text,
 target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
 target_watch connector_private.google_gmail_watch_resources%rowtype;
 target_binding connector_private.google_gmail_watch_ingress_authorities%rowtype;
 target_receipt public.connector_receipt_events%rowtype;
begin
 target_job:=connector_private.google_authorized_wakeup_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.job_kind<>'watch-renewal' or target_channel_key_hash !~ '^[0-9a-f]{64}$'
  or target_resource_key_hash !~ '^[0-9a-f]{64}$' or target_expires_at<=target_occurred_at
  or target_expected_endpoint_key_hash !~ '^[0-9a-f]{64}$'
  or target_expected_exact_external_url_hash !~ '^[0-9a-f]{64}$'
  or target_expected_subscription_hash !~ '^[0-9a-f]{64}$'
  or target_expected_oidc_audience_hash !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid Gmail watch renewal result' using errcode='22023'; end if;
 select * into target_watch from connector_private.google_gmail_watch_resources
  where connection_id=target_job.connection_id for update;
 select * into target_binding from connector_private.google_gmail_watch_ingress_authorities
  where connection_id=target_job.connection_id for update;
 if not found or target_watch.id is null or target_watch.resource_version<>target_expected_watch_resource_version
  or target_binding.binding_version<>target_expected_binding_version
  or target_binding.endpoint_key_hash<>target_expected_endpoint_key_hash
  or target_binding.exact_external_url_hash<>target_expected_exact_external_url_hash
  or target_binding.subscription_hash<>target_expected_subscription_hash
  or target_binding.oidc_audience_hash<>target_expected_oidc_audience_hash
  or target_binding.revoked_at is not null then
  raise exception 'Gmail watch renewal CAS/routing conflict' using errcode='40001'; end if;
 update connector_private.google_gmail_watch_resources set channel_key_hash=target_channel_key_hash,
  resource_key_hash=target_resource_key_hash,resource_version=resource_version+1,
  expires_at=target_expires_at,revoked_at=null,updated_at=target_occurred_at
 where id=target_watch.id returning * into target_watch;
 update connector_private.google_gmail_watch_ingress_authorities set watch_resource_id=target_watch.id,
  binding_version=binding_version+1,updated_at=target_occurred_at where id=target_binding.id returning * into target_binding;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
  correlation_id,fencing_token,provider_request_hash,provider_status,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google','sync.applied',
  'google.gmail.watch-renewed:'||target_job.id::text,target_job.correlation_id,target_job.fencing_token,
  target_resource_key_hash,'renewed',jsonb_build_object('wakeupJobId',target_job.id,
   'resourceVersion',target_watch.resource_version,'bindingVersion',target_binding.binding_version,
   'expiresAt',target_watch.expires_at),target_occurred_at) returning * into target_receipt;
 update public.google_gmail_history_wakeup_jobs set state='succeeded',lease_owner=null,lease_expires_at=null,
  completed_at=target_occurred_at,last_error_category=null,updated_at=target_occurred_at
  where id=target_job.id returning * into target_job;
 return jsonb_build_object('job',to_jsonb(target_job),'watch',jsonb_build_object(
  'resourceVersion',target_watch.resource_version,'expiresAt',target_watch.expires_at,
  'bindingVersion',target_binding.binding_version),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function connector_private.google_authorized_wakeup_job(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns public.google_gmail_history_wakeup_jobs language plpgsql stable security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
begin
 select job.* into target_job from public.google_gmail_history_wakeup_jobs job
 join public.connector_connections connection on connection.id=job.connection_id
  and connection.workspace_id=job.workspace_id and connection.provider='google'
  and connection.status in ('active','degraded')
 join public.google_connection_capabilities capability on capability.connection_id=job.connection_id
  and capability.workspace_id=job.workspace_id and capability.bundle='gmail-metadata'
  and capability.state='active' and capability.account_key_hash=connection.provider_account_key_hash
 where job.id=target_job_id and job.state='executing' and job.lease_owner=target_worker_id
  and job.fencing_token=target_fencing_token and job.lease_expires_at>target_now
  and capability.required_scopes=connector_private.google_bundle_scopes('gmail-metadata')
  and not exists(select 1 from unnest(capability.required_scopes) scope
   where scope<>all(capability.granted_scopes))
  and not exists(select 1 from unnest(capability.required_scopes) scope
   where scope<>all(connection.granted_scopes));
 if not found then raise exception 'active fenced Gmail wakeup job required' using errcode='42501'; end if;
 return target_job;
end;
$$;

create or replace function public.read_google_gmail_history_wakeup_authority(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
 target_connection public.connector_connections%rowtype;
 target_access connector_private.connector_connection_secrets%rowtype;
 target_refresh connector_private.connector_connection_secrets%rowtype;
 target_cursor connector_private.connector_sync_cursors%rowtype;
 target_watch connector_private.google_gmail_watch_resources%rowtype;
 target_binding connector_private.google_gmail_watch_ingress_authorities%rowtype;
 access_state text;
begin
 target_job:=connector_private.google_authorized_wakeup_job(target_job_id,target_worker_id,target_fencing_token,target_now);
 select * into strict target_connection from public.connector_connections where id=target_job.connection_id;
 select * into target_access from connector_private.connector_connection_secrets
  where connection_id=target_job.connection_id and secret_type='google-access-token' and destroyed_at is null;
 if not found then raise exception 'live Google access token required' using errcode='P0002'; end if;
 select * into target_refresh from connector_private.connector_connection_secrets
  where connection_id=target_job.connection_id and secret_type='google-refresh-token'
   and destroyed_at is null and (expires_at is null or expires_at>target_now);
 access_state:=case when target_access.expires_at is not null and target_access.expires_at<=target_now
  then 'refresh-required' else 'live' end;
 if access_state='refresh-required' and target_refresh.id is null then
  raise exception 'current Google refresh token required for expired access token' using errcode='P0002'; end if;
 select * into target_cursor from connector_private.connector_sync_cursors
  where connection_id=target_job.connection_id and stream_key='google.gmail-history';
 select * into strict target_binding from connector_private.google_gmail_watch_ingress_authorities
  where connection_id=target_job.connection_id and revoked_at is null;
 select * into strict target_watch from connector_private.google_gmail_watch_resources
  where id=target_binding.watch_resource_id and connection_id=target_job.connection_id and revoked_at is null;
 return jsonb_build_object('job',jsonb_build_object('jobId',target_job.id,
  'workspaceId',target_job.workspace_id,'connectionId',target_job.connection_id,
  'wakeGeneration',target_job.wake_generation,'claimedGeneration',target_job.claimed_generation,
  'attemptCount',target_job.attempt_count,'maxAttempts',target_job.max_attempts,
  'fencingToken',target_job.fencing_token,'leaseExpiresAt',target_job.lease_expires_at,
  'jobKind',target_job.job_kind,'maxPageSize',500),
  'connectionEmail',target_connection.display_label,'accessState',access_state,
  'accessEnvelope',jsonb_build_object('secretId',target_access.id,'secretType',target_access.secret_type,
   'secretVersion',target_access.secret_version,'ciphertext',encode(target_access.ciphertext,'base64'),
   'nonce',encode(target_access.nonce,'base64'),'authTag',encode(target_access.auth_tag,'base64'),
   'wrappedDek',encode(target_access.wrapped_dek,'base64'),'wrapNonce',encode(target_access.wrap_nonce,'base64'),
   'wrapAuthTag',encode(target_access.wrap_auth_tag,'base64'),'kekVersion',target_access.kek_version,
   'aadHash',target_access.aad_hash,'expiresAt',target_access.expires_at),
  'refreshEnvelope',case when target_refresh.id is null then null else jsonb_build_object(
   'secretId',target_refresh.id,'secretType',target_refresh.secret_type,'secretVersion',target_refresh.secret_version,
   'ciphertext',encode(target_refresh.ciphertext,'base64'),'nonce',encode(target_refresh.nonce,'base64'),
   'authTag',encode(target_refresh.auth_tag,'base64'),'wrappedDek',encode(target_refresh.wrapped_dek,'base64'),
   'wrapNonce',encode(target_refresh.wrap_nonce,'base64'),'wrapAuthTag',encode(target_refresh.wrap_auth_tag,'base64'),
   'kekVersion',target_refresh.kek_version,'aadHash',target_refresh.aad_hash,'expiresAt',target_refresh.expires_at) end,
  'cursorEnvelope',case when target_cursor.id is null then null else jsonb_build_object(
   'cursorId',target_cursor.id,'stream',target_cursor.stream_key,'cursorVersion',target_cursor.cursor_version,
   'ciphertext',encode(target_cursor.ciphertext,'base64'),'nonce',encode(target_cursor.nonce,'base64'),
   'authTag',encode(target_cursor.auth_tag,'base64'),'wrappedDek',encode(target_cursor.wrapped_dek,'base64'),
   'wrapNonce',encode(target_cursor.wrap_nonce,'base64'),'wrapAuthTag',encode(target_cursor.wrap_auth_tag,'base64'),
   'kekVersion',target_cursor.kek_version,'aadHash',target_cursor.aad_hash,'expiresAt',target_cursor.expires_at) end,
  'watch',jsonb_build_object('resourceVersion',target_watch.resource_version,'expiresAt',target_watch.expires_at,
   'bindingVersion',target_binding.binding_version,'subscriptionHash',target_binding.subscription_hash));
end;
$$;

create or replace function public.refresh_google_gmail_history_wakeup_access_token(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
 target_expected_access_secret_version integer,target_access_envelope jsonb,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
 secret_metadata jsonb; target_receipt public.connector_receipt_events%rowtype;
begin
 target_job:=connector_private.google_authorized_wakeup_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 perform 1 from connector_private.connector_connection_secrets
  where connection_id=target_job.connection_id and secret_type='google-refresh-token'
   and destroyed_at is null and (expires_at is null or expires_at>target_occurred_at) for update;
 if not found then raise exception 'current Google refresh token required' using errcode='P0002'; end if;
 secret_metadata:=connector_private.upsert_google_secret(target_job.connection_id,'google-access-token',
  target_expected_access_secret_version,target_access_envelope,target_occurred_at);
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
  correlation_id,fencing_token,provider_request_hash,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google','oauth.token-refreshed',
  'google.gmail.wakeup.token-refreshed:'||target_job.id::text||':'||(secret_metadata->>'secretVersion'),
  target_job.correlation_id,target_job.fencing_token,target_access_envelope->>'aadHash',
  jsonb_build_object('wakeupJobId',target_job.id,'previousSecretVersion',target_expected_access_secret_version,
   'secretVersion',(secret_metadata->>'secretVersion')::integer,'expiresAt',secret_metadata->>'expiresAt'),target_occurred_at)
 returning * into target_receipt;
 return jsonb_build_object('secret',secret_metadata,'receipt',to_jsonb(target_receipt));
end;
$$;

create or replace function public.commit_google_gmail_history_wakeup_checkpoint(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
 target_expected_cursor_version integer,target_cursor_envelope jsonb,
 target_checkpoint_hash text,target_has_more boolean,target_last_provider_event_at timestamptz,
 target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
 target_cursor connector_private.connector_sync_cursors%rowtype;
 target_health public.google_sync_health%rowtype; target_receipt public.connector_receipt_events%rowtype;
 target_expires_at timestamptz; requeued boolean;
begin
 target_job:=connector_private.google_authorized_wakeup_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_checkpoint_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(target_cursor_envelope)<>'object'
  or not (target_cursor_envelope ?& array['ciphertext','nonce','authTag','wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash','expiresAt'])
  or (select count(*) from jsonb_object_keys(target_cursor_envelope))<>9
  or target_cursor_envelope->>'kekVersion' !~ '^[A-Za-z0-9_.-]{1,64}$'
  or target_cursor_envelope->>'aadHash' !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid Gmail wakeup checkpoint' using errcode='22023'; end if;
 target_expires_at:=case when jsonb_typeof(target_cursor_envelope->'expiresAt')='null' then null
  else (target_cursor_envelope->>'expiresAt')::timestamptz end;
 select * into target_cursor from connector_private.connector_sync_cursors
  where connection_id=target_job.connection_id and stream_key='google.gmail-history' for update;
 if found then
  if target_cursor.cursor_version is distinct from target_expected_cursor_version then
   raise exception 'Google cursor version conflict' using errcode='40001'; end if;
  update connector_private.connector_sync_cursors set cursor_version=cursor_version+1,
   ciphertext=decode(target_cursor_envelope->>'ciphertext','base64'),nonce=decode(target_cursor_envelope->>'nonce','base64'),
   auth_tag=decode(target_cursor_envelope->>'authTag','base64'),wrapped_dek=decode(target_cursor_envelope->>'wrappedDek','base64'),
   wrap_nonce=decode(target_cursor_envelope->>'wrapNonce','base64'),wrap_auth_tag=decode(target_cursor_envelope->>'wrapAuthTag','base64'),
   kek_version=target_cursor_envelope->>'kekVersion',aad_hash=target_cursor_envelope->>'aadHash',
   expires_at=target_expires_at,updated_at=target_occurred_at where id=target_cursor.id returning * into target_cursor;
 else
  if target_expected_cursor_version is not null then raise exception 'Google cursor version conflict' using errcode='40001'; end if;
  insert into connector_private.connector_sync_cursors(workspace_id,connection_id,stream_key,ciphertext,nonce,auth_tag,
   wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,expires_at,created_at,updated_at)
  values(target_job.workspace_id,target_job.connection_id,'google.gmail-history',
   decode(target_cursor_envelope->>'ciphertext','base64'),decode(target_cursor_envelope->>'nonce','base64'),
   decode(target_cursor_envelope->>'authTag','base64'),decode(target_cursor_envelope->>'wrappedDek','base64'),
   decode(target_cursor_envelope->>'wrapNonce','base64'),decode(target_cursor_envelope->>'wrapAuthTag','base64'),
   target_cursor_envelope->>'kekVersion',target_cursor_envelope->>'aadHash',target_expires_at,
   target_occurred_at,target_occurred_at) returning * into target_cursor;
 end if;
 requeued:=target_has_more or target_job.wake_generation>target_job.claimed_generation;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
  correlation_id,fencing_token,provider_request_hash,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google','sync.applied',
  'google.gmail.wakeup.checkpoint:'||target_job.id::text||':'||target_checkpoint_hash,
  target_job.correlation_id,target_job.fencing_token,target_checkpoint_hash,
  jsonb_build_object('wakeupJobId',target_job.id,'cursorVersion',target_cursor.cursor_version,
   'hasMore',target_has_more,'requeued',requeued,'claimedGeneration',target_job.claimed_generation,
   'wakeGeneration',target_job.wake_generation),target_occurred_at) returning * into target_receipt;
 insert into public.google_sync_health(workspace_id,connection_id,stream_key,state,cursor_generation,
  cursor_version,last_checkpoint_hash,last_receipt_id,last_started_at,last_success_at,lag_seconds,
  last_error_category,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,'google.gmail-history',
  case when requeued then 'syncing' else 'healthy' end,1,target_cursor.cursor_version,
  target_checkpoint_hash,target_receipt.id,target_occurred_at,case when requeued then null else target_occurred_at end,
  case when target_last_provider_event_at is null then null else greatest(0,extract(epoch from target_occurred_at-target_last_provider_event_at)::integer) end,
  null,target_occurred_at,target_occurred_at)
 on conflict(connection_id,stream_key) do update set state=excluded.state,
  cursor_generation=public.google_sync_health.cursor_generation+1,cursor_version=excluded.cursor_version,
  last_checkpoint_hash=excluded.last_checkpoint_hash,last_receipt_id=excluded.last_receipt_id,
  last_started_at=coalesce(public.google_sync_health.last_started_at,excluded.last_started_at),
  last_success_at=coalesce(excluded.last_success_at,public.google_sync_health.last_success_at),
  lag_seconds=excluded.lag_seconds,last_error_category=null,updated_at=excluded.updated_at returning * into target_health;
 update public.google_gmail_history_wakeup_jobs set state=case when requeued then 'queued'::public.google_gmail_wakeup_job_state
   else 'succeeded'::public.google_gmail_wakeup_job_state end,
  scheduled_at=case when requeued then target_occurred_at else scheduled_at end,
  lease_owner=null,lease_expires_at=null,last_error_category=null,
  completed_at=case when requeued then null else target_occurred_at end,updated_at=target_occurred_at
 where id=target_job.id returning * into target_job;
 return jsonb_build_object('job',to_jsonb(target_job),'cursor',jsonb_build_object(
  'cursorVersion',target_cursor.cursor_version,'kekVersion',target_cursor.kek_version,'expiresAt',target_cursor.expires_at),
  'health',to_jsonb(target_health),'receipt',to_jsonb(target_receipt),'requeued',requeued);
end;
$$;

create or replace function public.transition_google_gmail_history_wakeup_job(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_outcome text,
 target_error_category text,target_next_attempt_at timestamptz,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
 target_health public.google_sync_health%rowtype; target_receipt public.connector_receipt_events%rowtype;
 next_state public.google_gmail_wakeup_job_state; exhausted boolean;
begin
 target_job:=connector_private.google_authorized_wakeup_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_outcome not in ('retry','cursor_expired','failed')
  or target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$' then
  raise exception 'invalid Gmail wakeup transition' using errcode='22023'; end if;
 exhausted:=target_job.attempt_count>=target_job.max_attempts;
 if target_outcome='retry' and not exhausted then
  if target_next_attempt_at is null or target_next_attempt_at<=target_occurred_at then
   raise exception 'future retry schedule required' using errcode='23514'; end if;
  next_state:='retry_wait';
 elsif target_outcome='cursor_expired' then
  next_state:='queued';
 else next_state:='failed'; end if;
 if target_outcome='cursor_expired' then
  delete from connector_private.connector_sync_cursors where connection_id=target_job.connection_id
   and stream_key='google.gmail-history';
 end if;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
  correlation_id,fencing_token,error_category,reconciliation_result,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google',
  case when next_state='retry_wait' then 'job.retry-scheduled'::public.connector_receipt_event_type
   when target_outcome='cursor_expired' then 'sync.reviewed'::public.connector_receipt_event_type
   else 'job.failed'::public.connector_receipt_event_type end,
  'google.gmail.wakeup.'||target_outcome||':'||target_job.id::text||':'||target_job.attempt_count::text,
  target_job.correlation_id,target_job.fencing_token,target_error_category,
  case when target_outcome='cursor_expired' then 'full-resync-required' else next_state::text end,
  jsonb_build_object('wakeupJobId',target_job.id,'outcome',target_outcome),target_occurred_at)
 returning * into target_receipt;
 insert into public.google_sync_health(workspace_id,connection_id,stream_key,state,cursor_generation,
  last_receipt_id,last_error_category,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,'google.gmail-history',
  case when target_outcome='cursor_expired' then 'full_resync_required'
   when next_state='retry_wait' then 'degraded' else 'degraded' end,0,target_receipt.id,target_error_category,
  target_occurred_at,target_occurred_at)
 on conflict(connection_id,stream_key) do update set state=excluded.state,last_receipt_id=excluded.last_receipt_id,
  last_error_category=excluded.last_error_category,updated_at=excluded.updated_at returning * into target_health;
 update public.google_gmail_history_wakeup_jobs set state=next_state,
  scheduled_at=case when next_state='retry_wait' then target_next_attempt_at
   when next_state='queued' then target_occurred_at else scheduled_at end,
  lease_owner=null,lease_expires_at=null,last_error_category=target_error_category,
  completed_at=case when next_state='failed' then target_occurred_at else null end,updated_at=target_occurred_at
 where id=target_job.id returning * into target_job;
 return jsonb_build_object('job',to_jsonb(target_job),'health',to_jsonb(target_health),
  'receipt',to_jsonb(target_receipt));
end;
$$;

create or replace function public.bind_google_gmail_wakeup_metadata_resource(
 target_wakeup_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
 target_message_id text,target_thread_id text,target_direction text,
 target_normalized_counterpart_email text,target_counterpart_kind text,
 target_labels text[],target_provider_occurred_at timestamptz,
 target_resource_hash text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
 target_connection public.connector_connections%rowtype;
 target_resource connector_private.google_gmail_resources%rowtype;
 target_review public.google_gmail_metadata_reviews%rowtype;
 target_receipt public.connector_receipt_events%rowtype; target_activity public.activity_events%rowtype;
 actor public.workspace_members%rowtype; matched_point public.contact_points%rowtype;
 matched_contact public.contacts%rowtype; counterpart_hash text; resolution text;
 active_count integer; archived_count integer;
begin
 target_job:=connector_private.google_authorized_wakeup_job(target_wakeup_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_message_id !~ '^[A-Za-z0-9_-]+$' or length(target_message_id)>256
  or target_thread_id !~ '^[A-Za-z0-9_-]+$' or length(target_thread_id)>256
  or target_direction not in ('incoming','outgoing')
  or target_counterpart_kind not in ('single','self-only','group-address')
  or target_resource_hash !~ '^[0-9a-f]{64}$'
  or target_normalized_counterpart_email<>public.normalize_contact_email(target_normalized_counterpart_email)
  or not public.is_valid_contact_email(target_normalized_counterpart_email)
  or cardinality(target_labels)>100 or exists(select 1 from unnest(target_labels) label
   where length(label) not between 1 and 200 or label ~ '[[:cntrl:]]') then
  raise exception 'invalid minimized Gmail wakeup metadata item' using errcode='22023'; end if;
 counterpart_hash:=encode(extensions.digest(pg_catalog.convert_to(target_normalized_counterpart_email,'UTF8'),'sha256'),'hex');
 select * into target_resource from connector_private.google_gmail_resources
  where connection_id=target_job.connection_id and resource_hash=target_resource_hash for update;
 if found then
  if target_resource.message_external_id<>target_message_id or target_resource.thread_external_id<>target_thread_id
   or target_resource.direction<>target_direction or target_resource.counterpart_hash<>counterpart_hash
   or target_resource.provider_occurred_at<>target_provider_occurred_at or target_resource.labels<>target_labels then
   raise exception 'Gmail metadata replay conflicts' using errcode='23505'; end if;
  if target_resource.review_reason is not null then select * into target_review
   from public.google_gmail_metadata_reviews where connection_id=target_job.connection_id
    and resource_hash=target_resource_hash; end if;
  select * into target_receipt from public.connector_receipt_events
   where workspace_id=target_job.workspace_id and event_key='google.gmail.metadata:'||target_resource_hash;
  return jsonb_build_object('resource',jsonb_build_object('resourceHash',target_resource.resource_hash,
   'linkState',case when target_resource.review_reason is null then 'linked' else 'review' end,
   'contactId',target_resource.contact_id,'contactPointId',target_resource.contact_point_id,
   'activityEventId',target_resource.activity_event_id),'review',case when target_review.id is null then null else to_jsonb(target_review) end,
   'receipt',to_jsonb(target_receipt),'noOp',true);
 end if;
 select * into strict target_connection from public.connector_connections where id=target_job.connection_id;
 if target_counterpart_kind='self-only'
  or target_normalized_counterpart_email=public.normalize_contact_email(target_connection.display_label) then resolution:='self-only';
 elsif target_counterpart_kind='group-address' then resolution:='group-address';
 else
  select count(*)::integer into active_count from public.contact_points point join public.contacts contact
   on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
   where point.workspace_id=target_job.workspace_id and point.type='email'
    and point.normalized_value=target_normalized_counterpart_email and point.archived_at is null and contact.archived_at is null;
  if active_count=1 then
   select point.* into matched_point from public.contact_points point join public.contacts contact
    on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_job.workspace_id and point.type='email'
     and point.normalized_value=target_normalized_counterpart_email and point.archived_at is null and contact.archived_at is null;
   select * into strict matched_contact from public.contacts where id=matched_point.contact_id
    and workspace_id=matched_point.workspace_id; resolution:=null;
  elsif active_count>1 then resolution:='shared-email';
  else
   select count(*)::integer into archived_count from public.contact_points point join public.contacts contact
    on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_job.workspace_id and point.type='email'
     and point.normalized_value=target_normalized_counterpart_email
     and (point.archived_at is not null or contact.archived_at is not null);
   resolution:=case when archived_count>0 then 'archived-email' else 'no-canonical-match' end;
  end if;
 end if;
 if resolution is null then
  select * into actor from public.workspace_members where workspace_id=target_job.workspace_id
   and role='owner' and status='active'
   order by (id=target_connection.created_by_membership_id) desc,created_at,id limit 1;
  if not found then raise exception 'active owner required for Gmail activity evidence' using errcode='42501'; end if;
  insert into public.activity_events(workspace_id,type,contact_id,actor_membership_id,occurred_at,idempotency_key)
  values(target_job.workspace_id,'email-metadata-linked'::public.crm_activity_event_type_v2,
   matched_contact.id,actor.id,target_provider_occurred_at,'google-gmail:'||target_resource_hash)
  on conflict(workspace_id,idempotency_key) do nothing returning * into target_activity;
  if target_activity.id is null then select * into strict target_activity from public.activity_events
   where workspace_id=target_job.workspace_id and idempotency_key='google-gmail:'||target_resource_hash; end if;
 end if;
 insert into connector_private.google_gmail_resources(workspace_id,connection_id,message_external_id,
  thread_external_id,resource_hash,counterpart_hash,direction,labels,provider_occurred_at,
  contact_id,contact_point_id,activity_event_id,source_wakeup_job_id,review_reason,correlation_id,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,target_message_id,target_thread_id,target_resource_hash,
  counterpart_hash,target_direction,target_labels,target_provider_occurred_at,matched_contact.id,matched_point.id,
  target_activity.id,target_job.id,resolution,target_job.correlation_id,target_occurred_at,target_occurred_at)
 returning * into target_resource;
 if resolution is not null then
  insert into public.google_gmail_metadata_reviews(workspace_id,connection_id,resource_hash,counterpart_hash,
   reason,direction,provider_occurred_at,correlation_id,occurred_at,created_at)
  values(target_job.workspace_id,target_job.connection_id,target_resource_hash,counterpart_hash,resolution,
   target_direction,target_provider_occurred_at,target_job.correlation_id,target_occurred_at,target_occurred_at)
  returning * into target_review;
 end if;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
  correlation_id,fencing_token,provider_request_hash,error_category,reconciliation_result,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google',
  case when resolution is null then 'sync.applied'::public.connector_receipt_event_type else 'sync.reviewed'::public.connector_receipt_event_type end,
  'google.gmail.metadata:'||target_resource_hash,target_job.correlation_id,target_job.fencing_token,
  target_resource_hash,resolution,case when resolution is null then 'linked' else 'review-required' end,
  jsonb_build_object('resourceHash',target_resource_hash,'direction',target_direction,
   'linkState',case when resolution is null then 'linked' else 'review' end,
   'contactId',matched_contact.id,'contactPointId',matched_point.id,'activityEventId',target_activity.id,
   'reviewReason',resolution,'wakeupJobId',target_job.id),target_occurred_at) returning * into target_receipt;
 return jsonb_build_object('resource',jsonb_build_object('resourceHash',target_resource.resource_hash,
  'linkState',case when resolution is null then 'linked' else 'review' end,
  'contactId',target_resource.contact_id,'contactPointId',target_resource.contact_point_id,
  'activityEventId',target_resource.activity_event_id),'review',case when target_review.id is null then null else to_jsonb(target_review) end,
  'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

-- Gmail send ambiguity never searches with Gmail q. The raw RFC Message-ID /
-- Omnix marker remains in the approved encrypted payload; SQL stores its hash.

create or replace function public.record_google_gmail_send_ambiguity(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
 target_operation_marker_hash text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_draft public.google_email_drafts%rowtype;
 target_reconciliation public.google_gmail_send_reconciliations%rowtype;
 target_receipt public.connector_receipt_events%rowtype; target_strategy text;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type<>'gmail.send' or target_job.state<>'executing'
  or target_operation_marker_hash !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid Gmail send ambiguity evidence' using errcode='22023'; end if;
 select draft.* into target_draft from public.google_email_drafts draft
  where draft.connection_id=target_job.connection_id and draft.workspace_id=target_job.workspace_id
   and draft.prepared_intent_id=target_job.intent_id and draft.prepared_intent_version=target_job.intent_version
   and draft.current_payload_ref=target_job.payload_ref and draft.current_payload_hash=target_job.payload_hash for update;
 if not found then raise exception 'approved Gmail draft binding required' using errcode='42501'; end if;
 target_strategy:=case when exists(select 1 from public.google_connection_capabilities capability
  where capability.connection_id=target_job.connection_id and capability.bundle='gmail-metadata'
   and capability.state='active' and capability.account_key_hash=(select provider_account_key_hash
    from public.connector_connections where id=target_job.connection_id))
  then 'bounded-metadata-scan' else 'unavailable-no-resend' end;
 select * into target_reconciliation from public.google_gmail_send_reconciliations
  where job_id=target_job.id for update;
 if found then
  if target_reconciliation.operation_marker_hash<>target_operation_marker_hash
   or target_reconciliation.draft_id<>target_draft.id or target_reconciliation.strategy<>target_strategy then
   raise exception 'Gmail send ambiguity replay conflicts' using errcode='23505'; end if;
  select * into target_receipt from public.connector_receipt_events where workspace_id=target_job.workspace_id
   and event_key='google.gmail.send-ambiguity:'||target_job.id::text;
  return jsonb_build_object('reconciliation',to_jsonb(target_reconciliation),'draft',to_jsonb(target_draft),
   'receipt',to_jsonb(target_receipt),'noOp',true);
 end if;
 insert into public.google_gmail_send_reconciliations(workspace_id,connection_id,job_id,draft_id,
  operation_marker_hash,strategy,state,correlation_id,created_at,updated_at,resolved_at)
 values(target_job.workspace_id,target_job.connection_id,target_job.id,target_draft.id,
  target_operation_marker_hash,target_strategy,case when target_strategy='unavailable-no-resend' then 'unavailable' else 'pending' end,
  target_job.correlation_id,target_occurred_at,target_occurred_at,
  case when target_strategy='unavailable-no-resend' then target_occurred_at else null end)
 returning * into target_reconciliation;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
  intent_version_id,event_type,event_key,correlation_id,attempt_number,fencing_token,
  provider_request_hash,error_category,reconciliation_result,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
  target_job.intent_version_id,'provider.unknown','google.gmail.send-ambiguity:'||target_job.id::text,
  target_job.correlation_id,target_job.attempt_count,target_job.fencing_token,target_operation_marker_hash,
  'provider_outcome_unknown',case when target_strategy='bounded-metadata-scan' then 'scan-required' else 'unavailable-no-resend' end,
  jsonb_build_object('draftId',target_draft.id,'draftVersion',target_draft.current_version,
   'strategy',target_strategy,'maxScan',100,'noResend',true),target_occurred_at) returning * into target_receipt;
 return jsonb_build_object('reconciliation',to_jsonb(target_reconciliation),'draft',to_jsonb(target_draft),
  'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.read_google_gmail_send_reconciliation_state(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype;
 target_reconciliation public.google_gmail_send_reconciliations%rowtype;
 target_capability public.google_connection_capabilities%rowtype;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_now);
 if target_job.action_type<>'gmail.send' or target_job.state<>'reconciliation_required' then
  raise exception 'fenced Gmail reconciliation job required' using errcode='42501'; end if;
 select * into strict target_reconciliation from public.google_gmail_send_reconciliations
  where job_id=target_job.id;
 if target_reconciliation.strategy='bounded-metadata-scan' then
  select * into target_capability from public.google_connection_capabilities
   where connection_id=target_job.connection_id and bundle='gmail-metadata' and state='active';
  if not found then raise exception 'active Gmail metadata capability required for bounded scan' using errcode='42501'; end if;
 end if;
 return jsonb_build_object('reconciliation',jsonb_build_object(
  'id',target_reconciliation.id,'jobId',target_reconciliation.job_id,
  'draftId',target_reconciliation.draft_id,'markerHash',target_reconciliation.operation_marker_hash,
  'strategy',target_reconciliation.strategy,'state',target_reconciliation.state,
  'maxScan',target_reconciliation.max_scan,'attemptCount',target_reconciliation.attempt_count,
  'failClosed',true),'metadataCapability',case when target_capability.id is null then null else jsonb_build_object(
   'bundle',target_capability.bundle,'state',target_capability.state,
   'requiredScopes',target_capability.required_scopes,'accountKeyHash',target_capability.account_key_hash) end);
end;
$$;

create or replace function public.record_google_gmail_send_reconciliation_unresolved(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
 target_marker_hash text,target_scan_evidence_hash text,target_outcome text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype;
 target_reconciliation public.google_gmail_send_reconciliations%rowtype;
 target_receipt public.connector_receipt_events%rowtype;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type<>'gmail.send' or target_job.state<>'reconciliation_required'
  or target_marker_hash !~ '^[0-9a-f]{64}$' or target_scan_evidence_hash !~ '^[0-9a-f]{64}$'
  or target_outcome not in ('not-found','ambiguous','unavailable') then
  raise exception 'invalid Gmail reconciliation result' using errcode='22023'; end if;
 select * into target_reconciliation from public.google_gmail_send_reconciliations
  where job_id=target_job.id for update;
 if not found or target_reconciliation.operation_marker_hash<>target_marker_hash then
  raise exception 'exact Gmail reconciliation marker required' using errcode='42501'; end if;
 if target_reconciliation.state='matched' then raise exception 'matched Gmail send cannot be unresolved' using errcode='23514'; end if;
 if target_reconciliation.last_scan_evidence_hash=target_scan_evidence_hash
  and target_reconciliation.last_outcome=target_outcome then
  select * into target_receipt from public.connector_receipt_events where workspace_id=target_job.workspace_id
   and event_key='google.gmail.send-reconciliation:'||target_job.id::text||':'||target_scan_evidence_hash;
  return jsonb_build_object('reconciliation',to_jsonb(target_reconciliation),'receipt',to_jsonb(target_receipt),'noOp',true);
 end if;
 update public.google_gmail_send_reconciliations set state=case when target_outcome='ambiguous' then 'conflict'
   when target_outcome='unavailable' then 'unavailable' else 'unresolved' end,
  attempt_count=attempt_count+1,last_scan_evidence_hash=target_scan_evidence_hash,last_outcome=target_outcome,
  resolved_at=case when target_outcome in ('ambiguous','unavailable') then target_occurred_at else null end,
  updated_at=target_occurred_at where id=target_reconciliation.id returning * into target_reconciliation;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
  intent_version_id,event_type,event_key,correlation_id,attempt_number,fencing_token,
  provider_request_hash,error_category,reconciliation_result,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
  target_job.intent_version_id,'reconciliation.resolved',
  'google.gmail.send-reconciliation:'||target_job.id::text||':'||target_scan_evidence_hash,
  target_job.correlation_id,target_job.attempt_count,target_job.fencing_token,target_scan_evidence_hash,
  case when target_outcome='not-found' then 'provider_result_not_found'
   when target_outcome='ambiguous' then 'provider_result_ambiguous' else 'reconciliation_unavailable' end,
  target_outcome,jsonb_build_object('draftId',target_reconciliation.draft_id,
   'strategy',target_reconciliation.strategy,'outcome',target_outcome,'noResend',true),target_occurred_at)
 returning * into target_receipt;
 return jsonb_build_object('reconciliation',to_jsonb(target_reconciliation),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function connector_private.mark_google_gmail_send_reconciliation_matched()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_job_id is not null and new.draft_id is not null then
  update public.google_gmail_send_reconciliations set state='matched',last_outcome='matched',
   last_scan_evidence_hash=new.resource_hash,resolved_at=new.updated_at,updated_at=new.updated_at
  where job_id=new.source_job_id and state<>'matched';
 end if;
 return new;
end;
$$;

create trigger google_gmail_send_reconciliation_matched
after insert on connector_private.google_gmail_resources for each row
execute function connector_private.mark_google_gmail_send_reconciliation_matched();

-- Existing authorized Calendar connections receive only the new owner-bound
-- lifecycle policies. Future OAuth completion uses the extended helper above.
with eligible as (
 select connection.workspace_id,connection.created_by_membership_id,capability.id as correlation_id,
  capability.authorized_at as granted_at,action.action_type
 from public.connector_connections connection
 join public.workspace_members owner on owner.id=connection.created_by_membership_id
  and owner.workspace_id=connection.workspace_id and owner.role='owner' and owner.status='active'
 join public.google_connection_capabilities capability on capability.connection_id=connection.id
  and capability.workspace_id=connection.workspace_id and capability.bundle='calendar-app-created'
  and capability.state='active' and capability.account_key_hash=connection.provider_account_key_hash
 cross join (values('calendar.complete-omnix-event'),('calendar.cancel-omnix-event'),
  ('calendar.delete-omnix-event')) action(action_type)
 where connection.provider='google' and connection.status in ('active','degraded')
)
insert into public.connector_automation_policies(workspace_id,action_type,version,approval_mode,
 allowlisted_actions,target_constraints,compliance_requirements,execution_limits,
 created_by_membership_id,correlation_id,created_at)
select eligible.workspace_id,eligible.action_type,1,'owner_required',array[eligible.action_type]::text[],
 jsonb_build_object('provider','google','capabilityBundle','calendar-app-created','connectionBound',true,
  'immutablePayload',true,'canonicalAuthority','task-version'),
 '{"provider":"google","rawContentInReceipts":false,"rawAddressesInReceipts":false,"accountSwapAllowed":false}'::jsonb,
 '{"maxAttempts":5,"maxBatchSize":500,"minimumDelayMs":250}'::jsonb,
 eligible.created_by_membership_id,eligible.correlation_id,eligible.granted_at
from eligible where not exists(select 1 from public.connector_automation_policies policy
 where policy.workspace_id=eligible.workspace_id and policy.action_type=eligible.action_type);

create or replace function public.bind_google_task_event_lifecycle(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_task_id uuid,
 target_task_version integer,target_event_id text,target_resource_hash text,
 target_etag_or_evidence_hash text,target_provider_updated_at timestamptz,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_task public.tasks%rowtype;
 target_resource connector_private.google_calendar_task_resources%rowtype;
 target_state public.google_calendar_task_states%rowtype; target_receipt public.connector_receipt_events%rowtype;
 target_lifecycle text; no_op boolean:=false;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 target_lifecycle:=case target_job.action_type when 'calendar.complete-omnix-event' then 'completed'
  when 'calendar.cancel-omnix-event' then 'cancelled'
  when 'calendar.delete-omnix-event' then 'deleted' else null end;
 if target_lifecycle is null or target_event_id !~ '^[A-Za-z0-9_-]+$' or length(target_event_id)>1024
  or target_resource_hash !~ '^[0-9a-f]{64}$' or target_etag_or_evidence_hash !~ '^[0-9a-f]{64}$'
  or target_provider_updated_at is null then
  raise exception 'invalid Google task event lifecycle binding' using errcode='22023'; end if;
 select * into target_task from public.tasks where id=target_task_id and workspace_id=target_job.workspace_id for update;
 if not found or target_task.task_version<>target_task_version then
  raise exception 'current Omnix task version required' using errcode='40001'; end if;
 if (target_lifecycle='completed' and target_task.status<>'completed')
  or (target_lifecycle in ('cancelled','deleted') and target_task.status<>'archived') then
  raise exception 'canonical Omnix task state does not authorize remote lifecycle' using errcode='42501'; end if;
 select * into target_resource from connector_private.google_calendar_task_resources
  where connection_id=target_job.connection_id and task_id=target_task.id for update;
 if not found or target_resource.event_external_id<>target_event_id
  or target_resource.resource_key_hash<>target_resource_hash then
  raise exception 'exact Omnix-created Google event binding required' using errcode='42501'; end if;
 if target_lifecycle='completed' and target_resource.lifecycle_state<>'active' then
  raise exception 'only an active Google event can be completed' using errcode='23514'; end if;
 if target_resource.lifecycle_state=target_lifecycle
  and target_resource.lifecycle_evidence_hash=target_etag_or_evidence_hash
  and target_resource.task_version=target_task_version then no_op:=true;
 elsif target_resource.lifecycle_state='deleted' then
  raise exception 'deleted Google event lifecycle is terminal' using errcode='23514';
 else
  update connector_private.google_calendar_task_resources set task_version=target_task_version,
   etag_hash=target_etag_or_evidence_hash,lifecycle_state=target_lifecycle,last_job_id=target_job.id,
   lifecycle_evidence_hash=target_etag_or_evidence_hash,provider_updated_at=target_provider_updated_at,
   completed_at=case when target_lifecycle='completed' then target_occurred_at else completed_at end,
   cancelled_at=case when target_lifecycle='cancelled' then target_occurred_at else cancelled_at end,
   deleted_at=case when target_lifecycle='deleted' then target_occurred_at else deleted_at end,
   updated_at=target_occurred_at where id=target_resource.id returning * into target_resource;
 end if;
 insert into public.google_calendar_task_states(workspace_id,connection_id,task_id,task_version,
  resource_key_hash,state,provider_updated_at,last_error_category,correlation_id,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,target_task.id,target_task_version,target_resource_hash,
  target_lifecycle,target_provider_updated_at,null,target_job.correlation_id,target_occurred_at,target_occurred_at)
 on conflict(connection_id,task_id) do update set task_version=excluded.task_version,
  resource_key_hash=excluded.resource_key_hash,state=excluded.state,provider_updated_at=excluded.provider_updated_at,
  last_error_category=null,correlation_id=excluded.correlation_id,updated_at=excluded.updated_at returning * into target_state;
 select * into target_receipt from public.connector_receipt_events where workspace_id=target_job.workspace_id
  and event_key='google.calendar.task-lifecycle:'||target_job.id::text;
 if not found then
  insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
   intent_version_id,event_type,event_key,correlation_id,attempt_number,fencing_token,
   provider_request_hash,provider_status,reconciliation_result,redacted_metadata,occurred_at)
  values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
   target_job.intent_version_id,'sync.applied','google.calendar.task-lifecycle:'||target_job.id::text,
   target_job.correlation_id,target_job.attempt_count,target_job.fencing_token,target_etag_or_evidence_hash,
   target_lifecycle,'canonical-task-authorized',jsonb_build_object('taskId',target_task.id,
    'taskVersion',target_task_version,'resourceKeyHash',target_resource_hash,'lifecycleState',target_lifecycle),
   target_occurred_at) returning * into target_receipt;
 end if;
 return jsonb_build_object('resource',jsonb_build_object('taskId',target_resource.task_id,
  'taskVersion',target_resource.task_version,'resourceKeyHash',target_resource.resource_key_hash,
  'lifecycleState',target_resource.lifecycle_state,'providerUpdatedAt',target_resource.provider_updated_at),
  'taskState',to_jsonb(target_state),'receipt',to_jsonb(target_receipt),'noOp',no_op);
end;
$$;

create or replace function public.record_google_calendar_task_conflict(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_task_id uuid,
 target_task_version integer,target_resource_key_hash text,target_reason text,
 target_provider_updated_at timestamptz,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_task public.tasks%rowtype;
 target_state public.google_calendar_task_states%rowtype; target_receipt public.connector_receipt_events%rowtype;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type not in ('calendar.sync','calendar.upsert-omnix-event',
  'calendar.complete-omnix-event','calendar.cancel-omnix-event','calendar.delete-omnix-event')
  or target_resource_key_hash !~ '^[0-9a-f]{64}$'
  or target_reason not in ('remote-edited','remote-deleted','task-version-drift','timezone-invalid') then
  raise exception 'invalid Google task conflict' using errcode='22023'; end if;
 select * into target_task from public.tasks where id=target_task_id and workspace_id=target_job.workspace_id;
 if not found then raise exception 'Omnix task not found' using errcode='P0002'; end if;
 insert into public.google_calendar_task_states(workspace_id,connection_id,task_id,task_version,
  resource_key_hash,state,provider_updated_at,last_error_category,correlation_id,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,target_task.id,target_task_version,target_resource_key_hash,
  case when target_reason='remote-deleted' then 'remote-deleted' else 'conflict' end,target_provider_updated_at,
  replace(target_reason,'-','_'),target_job.correlation_id,target_occurred_at,target_occurred_at)
 on conflict(connection_id,task_id) do update set task_version=excluded.task_version,
  resource_key_hash=excluded.resource_key_hash,state=excluded.state,provider_updated_at=excluded.provider_updated_at,
  last_error_category=excluded.last_error_category,correlation_id=excluded.correlation_id,
  updated_at=excluded.updated_at returning * into target_state;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
  intent_version_id,event_type,event_key,correlation_id,fencing_token,provider_request_hash,
  error_category,reconciliation_result,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
  target_job.intent_version_id,'sync.reviewed','google.calendar.task-conflict:'||target_job.id::text||':'||target_task.id::text||':'||target_task_version::text,
  target_job.correlation_id,target_job.fencing_token,target_resource_key_hash,replace(target_reason,'-','_'),
  'review-required',jsonb_build_object('taskId',target_task.id,'taskVersion',target_task_version,
   'reason',target_reason),target_occurred_at) returning * into target_receipt;
 return jsonb_build_object('taskState',to_jsonb(target_state),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

-- Real provider probe authority. The application decrypts the access token,
-- calls OIDC userinfo (and Gmail profile when metadata is authorized), hashes
-- normalized observations, then records only immutable redacted evidence.

create or replace function public.read_google_connection_probe_authority(
 target_connection_id uuid,target_actor_user_id uuid,target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_access connector_private.connector_connection_secrets%rowtype;
 target_refresh connector_private.connector_connection_secrets%rowtype; access_state text;
 target_capabilities jsonb;
begin
 select * into target_connection from public.connector_connections
  where id=target_connection_id and provider='google' and status in ('active','degraded','reauthorization_required');
 if not found then raise exception 'probeable Google connection required' using errcode='P0002'; end if;
 perform 1 from public.workspace_members where id=target_membership_id
  and workspace_id=target_connection.workspace_id and user_id=target_actor_user_id
  and role='owner' and status='active';
 if not found then raise exception 'active owner probe authority required' using errcode='42501'; end if;
 if target_connection.provider_account_key_hash is null
  or not ('openid'=any(target_connection.granted_scopes) and 'email'=any(target_connection.granted_scopes))
  or not exists(select 1 from public.google_connection_capabilities capability
   where capability.connection_id=target_connection.id and capability.state='active'
    and capability.account_key_hash=target_connection.provider_account_key_hash) then
  raise exception 'bound Google identity capability required' using errcode='42501'; end if;
 select * into target_access from connector_private.connector_connection_secrets
  where connection_id=target_connection.id and secret_type='google-access-token' and destroyed_at is null;
 if not found then raise exception 'live Google access token required' using errcode='P0002'; end if;
 select * into target_refresh from connector_private.connector_connection_secrets
  where connection_id=target_connection.id and secret_type='google-refresh-token' and destroyed_at is null
   and (expires_at is null or expires_at>target_now);
 access_state:=case when target_access.expires_at is not null and target_access.expires_at<=target_now
  then 'refresh-required' else 'live' end;
 if access_state='refresh-required' and target_refresh.id is null then
  raise exception 'current Google refresh token required for probe' using errcode='P0002'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('bundle',bundle,'state',state,
  'requiredScopes',required_scopes,'grantedScopes',granted_scopes) order by bundle),'[]'::jsonb)
 into target_capabilities from public.google_connection_capabilities
 where connection_id=target_connection.id and state='active';
 return jsonb_build_object('workspaceId',target_connection.workspace_id,
  'connectionId',target_connection.id,'displayLabel',target_connection.display_label,
  'accountKeyHash',target_connection.provider_account_key_hash,'grantedScopes',target_connection.granted_scopes,
  'capabilities',target_capabilities,'gmailProfileCheckAvailable',exists(select 1
   from public.google_connection_capabilities where connection_id=target_connection.id
    and bundle='gmail-metadata' and state='active'),'accessState',access_state,
  'accessEnvelope',jsonb_build_object('secretId',target_access.id,'secretType',target_access.secret_type,
   'secretVersion',target_access.secret_version,'ciphertext',encode(target_access.ciphertext,'base64'),
   'nonce',encode(target_access.nonce,'base64'),'authTag',encode(target_access.auth_tag,'base64'),
   'wrappedDek',encode(target_access.wrapped_dek,'base64'),'wrapNonce',encode(target_access.wrap_nonce,'base64'),
   'wrapAuthTag',encode(target_access.wrap_auth_tag,'base64'),'kekVersion',target_access.kek_version,
   'aadHash',target_access.aad_hash,'expiresAt',target_access.expires_at),
  'refreshEnvelope',case when target_refresh.id is null then null else jsonb_build_object(
   'secretId',target_refresh.id,'secretType',target_refresh.secret_type,'secretVersion',target_refresh.secret_version,
   'ciphertext',encode(target_refresh.ciphertext,'base64'),'nonce',encode(target_refresh.nonce,'base64'),
   'authTag',encode(target_refresh.auth_tag,'base64'),'wrappedDek',encode(target_refresh.wrapped_dek,'base64'),
   'wrapNonce',encode(target_refresh.wrap_nonce,'base64'),'wrapAuthTag',encode(target_refresh.wrap_auth_tag,'base64'),
   'kekVersion',target_refresh.kek_version,'aadHash',target_refresh.aad_hash,'expiresAt',target_refresh.expires_at) end);
end;
$$;

create or replace function public.refresh_google_connection_probe_access_token(
 target_connection_id uuid,target_actor_user_id uuid,target_membership_id uuid,
 target_expected_access_secret_version integer,target_access_envelope jsonb,
 target_occurred_at timestamptz,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 secret_metadata jsonb; target_receipt public.connector_receipt_events%rowtype;
begin
 select * into target_connection from public.connector_connections where id=target_connection_id
  and provider='google' and status in ('active','degraded','reauthorization_required') for update;
 if not found then raise exception 'probeable Google connection required' using errcode='P0002'; end if;
 perform 1 from public.workspace_members where id=target_membership_id
  and workspace_id=target_connection.workspace_id and user_id=target_actor_user_id
  and role='owner' and status='active';
 if not found then raise exception 'active owner probe refresh authority required' using errcode='42501'; end if;
 if target_connection.provider_account_key_hash is null
  or not ('openid'=any(target_connection.granted_scopes) and 'email'=any(target_connection.granted_scopes))
  or target_expected_access_secret_version is null or target_correlation_id is null then
  raise exception 'bound Google probe refresh request required' using errcode='42501'; end if;
 perform 1 from connector_private.connector_connection_secrets where connection_id=target_connection.id
  and secret_type='google-refresh-token' and destroyed_at is null
  and (expires_at is null or expires_at>target_occurred_at) for update;
 if not found then raise exception 'current Google refresh token required for probe' using errcode='P0002'; end if;
 secret_metadata:=connector_private.upsert_google_secret(target_connection.id,'google-access-token',
  target_expected_access_secret_version,target_access_envelope,target_occurred_at);
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
  correlation_id,provider_request_hash,redacted_metadata,occurred_at)
 values(target_connection.workspace_id,target_connection.id,'google','oauth.token-refreshed',
  'google.probe.token-refreshed:'||target_connection.id::text||':'||(secret_metadata->>'secretVersion'),
  target_correlation_id,target_access_envelope->>'aadHash',jsonb_build_object(
   'actorMembershipId',target_membership_id,'previousSecretVersion',target_expected_access_secret_version,
   'secretVersion',(secret_metadata->>'secretVersion')::integer,'scopesChanged',false,
   'identityChanged',false,'expiresAt',secret_metadata->>'expiresAt'),target_occurred_at)
 returning * into target_receipt;
 return jsonb_build_object('connectionId',target_connection.id,
  'accountKeyHash',target_connection.provider_account_key_hash,'secret',secret_metadata,
  'receipt',to_jsonb(target_receipt));
end;
$$;

create or replace function public.record_google_connection_probe(
 target_connection_id uuid,target_actor_user_id uuid,target_membership_id uuid,target_outcome text,
 target_observed_account_key_hash text,target_observed_email_hash text,target_provider_evidence_hash text,
 target_error_category text,target_occurred_at timestamptz,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; actor public.workspace_members%rowtype;
 target_receipt public.connector_receipt_events%rowtype; target_capabilities jsonb; target_status public.connector_connection_status;
 expected_email_hash text; no_op boolean:=false;
begin
 if target_outcome not in ('healthy','degraded','reauthorization-required')
  or target_provider_evidence_hash !~ '^[0-9a-f]{64}$'
  or target_observed_account_key_hash !~ '^[0-9a-f]{64}$'
  or target_observed_email_hash !~ '^[0-9a-f]{64}$'
  or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$')
  or (target_outcome='healthy' and target_error_category is not null)
  or (target_outcome<>'healthy' and target_error_category is null)
  or target_correlation_id is null or target_occurred_at is null then
  raise exception 'invalid Google provider probe result' using errcode='22023'; end if;
 select * into target_connection from public.connector_connections where id=target_connection_id
  and provider='google' and status in ('active','degraded','reauthorization_required') for update;
 if not found then raise exception 'probeable Google connection required' using errcode='P0002'; end if;
 select * into actor from public.workspace_members where id=target_membership_id
  and workspace_id=target_connection.workspace_id and user_id=target_actor_user_id
  and role='owner' and status='active';
 if not found then raise exception 'active owner probe authority required' using errcode='42501'; end if;
 expected_email_hash:=encode(extensions.digest(pg_catalog.convert_to(lower(trim(target_connection.display_label)),'UTF8'),'sha256'),'hex');
 if target_observed_account_key_hash<>target_connection.provider_account_key_hash
  or target_observed_email_hash<>expected_email_hash then
  raise exception 'Google probe identity mismatch' using errcode='42501'; end if;
 if not ('openid'=any(target_connection.granted_scopes) and 'email'=any(target_connection.granted_scopes))
  or exists(select 1 from public.google_connection_capabilities capability
   where capability.connection_id=target_connection.id and capability.state='active'
    and capability.account_key_hash<>target_observed_account_key_hash) then
  raise exception 'Google probe capability identity drift' using errcode='42501'; end if;
 select * into target_receipt from public.connector_receipt_events where workspace_id=target_connection.workspace_id
  and event_key='google.connection.probed:'||target_connection.id::text||':'||target_correlation_id::text;
 if found then
  if target_receipt.provider_request_hash<>target_provider_evidence_hash
   or target_receipt.provider_status<>target_outcome then
   raise exception 'Google probe replay conflicts' using errcode='23505'; end if;
  no_op:=true;
 else
  target_status:=case target_outcome when 'healthy' then 'active'::public.connector_connection_status
   when 'degraded' then 'degraded'::public.connector_connection_status else 'reauthorization_required'::public.connector_connection_status end;
  update public.connector_connections set status=target_status,last_probe_at=target_occurred_at,
   last_error_category=target_error_category,updated_at=target_occurred_at where id=target_connection.id returning * into target_connection;
  insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,
   correlation_id,provider_request_hash,provider_status,error_category,redacted_metadata,occurred_at)
  values(target_connection.workspace_id,target_connection.id,'google','connection.probed',
   'google.connection.probed:'||target_connection.id::text||':'||target_correlation_id::text,
   target_correlation_id,target_provider_evidence_hash,target_outcome,target_error_category,
   jsonb_build_object('actorMembershipId',actor.id,'outcome',target_outcome,
    'identityMatched',true,'scopesChanged',false),target_occurred_at) returning * into target_receipt;
 end if;
 select coalesce(jsonb_agg(to_jsonb(capability) order by bundle),'[]'::jsonb) into target_capabilities
  from public.google_connection_capabilities capability where capability.connection_id=target_connection.id;
 return jsonb_build_object('connection',to_jsonb(target_connection),'capabilities',target_capabilities,
  'receipt',to_jsonb(target_receipt),'noOp',no_op);
end;
$$;

create or replace function public.prepare_google_disconnect_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.provider='google' and new.status in ('disconnected','disconnected_unconfirmed')
  and old.status is distinct from new.status then
  update public.google_connection_capabilities set state='revoked',revoked_at=new.disconnected_at,
   last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
   updated_at=new.disconnected_at where connection_id=new.id;
  update public.google_sync_health set state='disabled',
   last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
   updated_at=new.disconnected_at where connection_id=new.id;
  update connector_private.google_gmail_watch_resources set revoked_at=new.disconnected_at,
   updated_at=new.disconnected_at where connection_id=new.id and revoked_at is null;
  update connector_private.google_gmail_watch_ingress_authorities set revoked_at=new.disconnected_at,
   updated_at=new.disconnected_at where connection_id=new.id and revoked_at is null;
  update public.google_gmail_history_wakeup_jobs set state='failed',lease_owner=null,lease_expires_at=null,
   last_error_category='connection_disconnected',completed_at=new.disconnected_at,updated_at=new.disconnected_at
   where connection_id=new.id and state in ('queued','leased','executing','retry_wait');
  update public.google_calendar_task_states set state='disconnected',
   last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
   updated_at=new.disconnected_at where connection_id=new.id;
 end if;
 return new;
end;
$$;

-- Harden the generic disconnect seam without changing its public signature.
-- An absent provider endpoint is uncertainty, never confirmed revocation.
alter function public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz)
 rename to transition_connector_revocation_job_pre_0021;

revoke all on function public.transition_connector_revocation_job_pre_0021(
 uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.transition_connector_revocation_job(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_outcome text,
 target_error_category text default null,target_next_attempt_at timestamptz default null,
 target_evidence jsonb default '{}'::jsonb,target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if target_outcome='confirmed'
  and coalesce(target_evidence->>'confirmationKind','')<>'provider-confirmed' then
  raise exception 'confirmed revocation requires provider-confirmed evidence' using errcode='23514';
 end if;
 return public.transition_connector_revocation_job_pre_0021(target_job_id,target_worker_id,
  target_fencing_token,target_outcome,target_error_category,target_next_attempt_at,target_evidence,target_now);
end;
$$;

-- Least privilege ---------------------------------------------------------

revoke all on function public.bind_google_gmail_watch_ingress_authority(uuid,uuid,bigint,integer,text,text,text,text,text,timestamptz,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.register_google_gmail_push_wakeup(text,text,text,text,text,text,text,timestamptz,timestamptz,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.claim_google_gmail_history_wakeup_jobs(uuid,integer,integer,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.start_google_gmail_history_wakeup_attempt(uuid,uuid,bigint,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.schedule_due_google_gmail_watch_renewals(timestamptz,integer,integer)
 from public,anon,authenticated,service_role;
revoke all on function public.renew_google_gmail_watch_from_wakeup(uuid,uuid,bigint,integer,integer,text,text,timestamptz,text,text,text,text,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.read_google_gmail_history_wakeup_authority(uuid,uuid,bigint,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.refresh_google_gmail_history_wakeup_access_token(uuid,uuid,bigint,integer,jsonb,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.bind_google_gmail_wakeup_metadata_resource(uuid,uuid,bigint,text,text,text,text,text,text[],timestamptz,text,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.commit_google_gmail_history_wakeup_checkpoint(uuid,uuid,bigint,integer,jsonb,text,boolean,timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.transition_google_gmail_history_wakeup_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.record_google_gmail_send_ambiguity(uuid,uuid,bigint,text,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.read_google_gmail_send_reconciliation_state(uuid,uuid,bigint,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.record_google_gmail_send_reconciliation_unresolved(uuid,uuid,bigint,text,text,text,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.bind_google_task_event_lifecycle(uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.read_google_connection_probe_authority(uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.refresh_google_connection_probe_access_token(uuid,uuid,uuid,integer,jsonb,timestamptz,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.record_google_connection_probe(uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz)
 from public,anon,authenticated,service_role;

grant execute on function public.bind_google_gmail_watch_ingress_authority(uuid,uuid,bigint,integer,text,text,text,text,text,timestamptz,uuid) to service_role;
grant execute on function public.register_google_gmail_push_wakeup(text,text,text,text,text,text,text,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.claim_google_gmail_history_wakeup_jobs(uuid,integer,integer,timestamptz) to service_role;
grant execute on function public.start_google_gmail_history_wakeup_attempt(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.schedule_due_google_gmail_watch_renewals(timestamptz,integer,integer) to service_role;
grant execute on function public.renew_google_gmail_watch_from_wakeup(uuid,uuid,bigint,integer,integer,text,text,timestamptz,text,text,text,text,timestamptz) to service_role;
grant execute on function public.read_google_gmail_history_wakeup_authority(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.refresh_google_gmail_history_wakeup_access_token(uuid,uuid,bigint,integer,jsonb,timestamptz) to service_role;
grant execute on function public.bind_google_gmail_wakeup_metadata_resource(uuid,uuid,bigint,text,text,text,text,text,text[],timestamptz,text,timestamptz) to service_role;
grant execute on function public.commit_google_gmail_history_wakeup_checkpoint(uuid,uuid,bigint,integer,jsonb,text,boolean,timestamptz,timestamptz) to service_role;
grant execute on function public.transition_google_gmail_history_wakeup_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.record_google_gmail_send_ambiguity(uuid,uuid,bigint,text,timestamptz) to service_role;
grant execute on function public.read_google_gmail_send_reconciliation_state(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.record_google_gmail_send_reconciliation_unresolved(uuid,uuid,bigint,text,text,text,timestamptz) to service_role;
grant execute on function public.bind_google_task_event_lifecycle(uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.read_google_connection_probe_authority(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.refresh_google_connection_probe_access_token(uuid,uuid,uuid,integer,jsonb,timestamptz,uuid) to service_role;
grant execute on function public.record_google_connection_probe(uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid) to service_role;
grant execute on function public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz) to service_role;

revoke all on function connector_private.google_authorized_wakeup_job(uuid,uuid,bigint,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function connector_private.mark_google_gmail_send_reconciliation_matched()
 from public,anon,authenticated,service_role;

do $$
declare target_function text;
begin
 if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
  where namespace.nspname='public' and relation.relname='google_gmail_history_wakeup_jobs'
   and relation.relrowsecurity and relation.relforcerowsecurity) then
  raise exception 'google_gmail_history_wakeup_jobs must force RLS'; end if;
 if has_table_privilege('authenticated','public.google_gmail_history_wakeup_jobs','INSERT')
  or has_table_privilege('authenticated','public.google_gmail_history_wakeup_jobs','UPDATE')
  or has_table_privilege('authenticated','public.google_gmail_history_wakeup_jobs','DELETE')
  or has_table_privilege('authenticated','connector_private.google_gmail_watch_ingress_authorities','SELECT') then
  raise exception 'Google push authority privilege mismatch'; end if;
 foreach target_function in array array[
  'register_google_gmail_push_wakeup(text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)',
  'read_google_gmail_history_wakeup_authority(uuid,uuid,bigint,timestamp with time zone)',
  'read_google_gmail_send_reconciliation_state(uuid,uuid,bigint,timestamp with time zone)',
  'bind_google_task_event_lifecycle(uuid,uuid,bigint,uuid,integer,text,text,text,timestamp with time zone,timestamp with time zone)',
  'read_google_connection_probe_authority(uuid,uuid,uuid,timestamp with time zone)'
 ] loop
  if has_function_privilege('anon','public.'||target_function,'EXECUTE')
   or has_function_privilege('authenticated','public.'||target_function,'EXECUTE')
   or not has_function_privilege('service_role','public.'||target_function,'EXECUTE') then
   raise exception 'Google 0021 RPC privilege mismatch: %',target_function; end if;
 end loop;
end;
$$;

comment on table public.google_gmail_watch_deliveries is
 'Append-only hash-only verified Gmail Pub/Sub wakeup receipts; Gmail history remains authoritative.';
comment on table public.google_gmail_history_wakeup_jobs is
 'Durable coalescing Gmail history wakeup jobs with bounded claim, lease and fencing authority.';
comment on table public.google_gmail_send_reconciliations is
 'Hash-only fail-closed Gmail send ambiguity evidence. Bounded metadata scan never uses Gmail q.';








create or replace function connector_private.ensure_google_action_policies(
  target_workspace_id uuid,target_membership_id uuid,target_granted_scopes text[],
  target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare action_row record; target_policy public.connector_automation_policies%rowtype;
 policies jsonb:='[]'::jsonb; expected_constraints jsonb;
 expected_compliance constant jsonb :=
  '{"provider":"google","rawContentInReceipts":false,"rawAddressesInReceipts":false,"accountSwapAllowed":false}'::jsonb;
 expected_limits constant jsonb :=
  '{"maxAttempts":5,"maxBatchSize":500,"minimumDelayMs":250}'::jsonb;
begin
 if target_correlation_id is null or target_occurred_at is null or not exists(
  select 1 from public.workspace_members membership where membership.id=target_membership_id
   and membership.workspace_id=target_workspace_id and membership.role='owner' and membership.status='active'
 ) then raise exception 'active owner authority required for Google policy bootstrap' using errcode='42501'; end if;
 for action_row in select * from (values
  ('gmail.send','gmail-send','https://www.googleapis.com/auth/gmail.send'),
  ('gmail.sync-metadata','gmail-metadata','https://www.googleapis.com/auth/gmail.metadata'),
  ('calendar.create-omnix-calendar','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.upsert-omnix-event','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.complete-omnix-event','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.cancel-omnix-event','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.delete-omnix-event','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.sync','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created')
 ) as actions(action_type,bundle,required_scope)
 where actions.required_scope=any(target_granted_scopes) order by actions.action_type loop
  expected_constraints:=jsonb_build_object('provider','google','capabilityBundle',action_row.bundle,
   'connectionBound',true,'immutablePayload',true,'canonicalAuthority',
   case when action_row.action_type like 'calendar.%omnix-event' then 'task-version' else 'connector-payload' end);
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':'||action_row.action_type,0));
  select policy.* into target_policy from public.connector_automation_policies policy
   where policy.workspace_id=target_workspace_id and policy.action_type=action_row.action_type
   order by policy.version desc limit 1;
  if found then
   if target_policy.version<>1 or target_policy.approval_mode<>'owner_required'
    or target_policy.allowlisted_actions is distinct from array[action_row.action_type]::text[]
    or target_policy.target_constraints<>expected_constraints
    or target_policy.compliance_requirements<>expected_compliance
    or target_policy.execution_limits<>expected_limits then
    raise exception 'existing % policy conflicts with canonical Google policy',action_row.action_type using errcode='23505';
   end if;
  else
   insert into public.connector_automation_policies(workspace_id,action_type,version,approval_mode,
    allowlisted_actions,target_constraints,compliance_requirements,execution_limits,
    created_by_membership_id,correlation_id,created_at)
   values(target_workspace_id,action_row.action_type,1,'owner_required',array[action_row.action_type]::text[],
    expected_constraints,expected_compliance,expected_limits,target_membership_id,target_correlation_id,target_occurred_at)
   returning * into target_policy;
  end if;
  policies:=policies||jsonb_build_array(to_jsonb(target_policy));
 end loop;
 return policies;
end;
$$;

create or replace function connector_private.google_authorized_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns public.connector_jobs language plpgsql stable security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_bundle text;
begin
 select job.* into target_job from public.connector_jobs job
 join public.connector_connections connection on connection.id=job.connection_id and connection.workspace_id=job.workspace_id
 where job.id=target_job_id and job.provider='google'
  and job.state in ('executing','reconciliation_required')
  and job.lease_owner=target_worker_id and job.fencing_token=target_fencing_token
  and job.lease_expires_at>target_now and connection.provider='google'
  and connection.status in ('active','degraded');
 if not found then raise exception 'active fenced Google job required' using errcode='42501'; end if;
 target_bundle:=connector_private.google_bundle_for_action(target_job.action_type);
 if target_bundle is null or not exists(
  select 1 from public.google_connection_capabilities capability
  join public.connector_connections bound_connection on bound_connection.id=capability.connection_id
   and bound_connection.workspace_id=capability.workspace_id
  where capability.connection_id=target_job.connection_id and capability.workspace_id=target_job.workspace_id
   and capability.bundle=target_bundle and capability.state='active'
   and capability.account_key_hash=bound_connection.provider_account_key_hash
   and capability.required_scopes=connector_private.google_bundle_scopes(target_bundle)
   and not exists(select 1 from unnest(capability.required_scopes) required_scope
    where required_scope<>all(capability.granted_scopes))
   and not exists(select 1 from unnest(capability.required_scopes) required_scope
    where required_scope<>all(bound_connection.granted_scopes))
   and not exists(select 1 from unnest(capability.granted_scopes) granted_scope
    where granted_scope<>all(bound_connection.granted_scopes))
 ) then raise exception 'active Google capability required' using errcode='42501'; end if;
 return target_job;
end;
$$;

commit;
