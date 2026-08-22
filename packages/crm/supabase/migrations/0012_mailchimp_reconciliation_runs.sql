-- Omnix — resumable Mailchimp baseline/reconciliation runs
-- Story 4.1 AC8: exact owner request, selected-audience-bound durable work,
-- bounded 0..500-item pages, redacted numeric/hash checkpoints, leases/fences,
-- honest review, and baseline completion only after a verified final page.

alter type public.crm_activity_event_type_v2
  add value if not exists 'incomplete-record-received';

begin;

alter table public.activity_events
  drop constraint activity_events_target_shape;

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
    (type::text = 'incomplete-record-received' and contact_id is null
      and task_id is null and incomplete_record_id is not null)
    or
    (type in ('task-created', 'task-completed', 'task-archived')
      and task_id is not null and incomplete_record_id is null)
  );

create table public.mailchimp_reconciliation_runs (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces (id) on delete restrict,
  connection_id               uuid not null,
  binding_id                  uuid not null,
  mode                        text not null,
  snapshot_hash               text not null,
  request_key_hash            text not null,
  page_size                   integer not null,
  state                       text not null default 'queued',
  next_offset                 integer not null default 0,
  provider_total              integer,
  pages_applied               integer not null default 0,
  items_seen                  integer not null default 0,
  items_applied               integer not null default 0,
  items_reviewed              integer not null default 0,
  items_blocked               integer not null default 0,
  last_page_hash              text,
  attempt_count               integer not null default 0,
  max_attempts                integer not null default 5,
  scheduled_at                timestamptz not null,
  lease_owner                 uuid,
  lease_expires_at            timestamptz,
  fencing_token               bigint not null default 0,
  requested_by_membership_id  uuid not null,
  correlation_id              uuid not null,
  last_error_category         text,
  requested_at                timestamptz not null,
  completed_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint mailchimp_reconciliation_runs_id_workspace_unique
    unique (id, workspace_id),
  constraint mailchimp_reconciliation_runs_connection_request_unique
    unique (connection_id, request_key_hash),
  constraint mailchimp_reconciliation_runs_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_reconciliation_runs_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_reconciliation_runs_requester_workspace_fk
    foreign key (requested_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint mailchimp_reconciliation_runs_mode check (
    mode in ('baseline','reconcile')
  ),
  constraint mailchimp_reconciliation_runs_hashes check (
    snapshot_hash ~ '^[0-9a-f]{64}$'
    and request_key_hash ~ '^[0-9a-f]{64}$'
    and (last_page_hash is null or last_page_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint mailchimp_reconciliation_runs_page_size check (
    page_size between 1 and 500
  ),
  constraint mailchimp_reconciliation_runs_state check (
    state in ('queued','leased','executing','retry_wait','succeeded','review','cancelled')
  ),
  constraint mailchimp_reconciliation_runs_progress check (
    next_offset >= 0
    and (provider_total is null or provider_total >= 0)
    and (provider_total is null or next_offset <= provider_total)
    and pages_applied >= 0
    and items_seen >= 0
    and items_applied >= 0
    and items_reviewed >= 0
    and items_blocked >= 0
    and items_applied + items_reviewed <= items_seen
    and items_blocked <= items_reviewed
  ),
  constraint mailchimp_reconciliation_runs_attempts check (
    max_attempts between 1 and 20
    and attempt_count between 0 and max_attempts
    and fencing_token >= 0
  ),
  constraint mailchimp_reconciliation_runs_lease check (
    (
      state in ('leased','executing')
      and lease_owner is not null
      and lease_expires_at is not null
    ) or (
      state not in ('leased','executing')
      and lease_owner is null
      and lease_expires_at is null
    )
  ),
  constraint mailchimp_reconciliation_runs_terminal check (
    (
      state in ('succeeded','review','cancelled')
      and completed_at is not null
    ) or (
      state not in ('succeeded','review','cancelled')
      and completed_at is null
    )
  ),
  constraint mailchimp_reconciliation_runs_error check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create unique index mailchimp_one_active_reconciliation_per_connection_idx
  on public.mailchimp_reconciliation_runs (connection_id)
  where state in ('queued','leased','executing','retry_wait');

create index mailchimp_reconciliation_runs_due_idx
  on public.mailchimp_reconciliation_runs (scheduled_at,requested_at,id)
  where state in ('queued','retry_wait');

create index mailchimp_reconciliation_runs_workspace_state_idx
  on public.mailchimp_reconciliation_runs (workspace_id,state,requested_at desc,id);

create index mailchimp_reconciliation_runs_expired_lease_idx
  on public.mailchimp_reconciliation_runs (lease_expires_at,id)
  where lease_owner is not null;

create table public.mailchimp_reconciliation_pages (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete restrict,
  run_id              uuid not null,
  connection_id       uuid not null,
  binding_id          uuid not null,
  page_index          integer not null,
  offset_start        integer not null,
  item_count          integer not null,
  next_offset         integer not null,
  provider_total      integer not null,
  page_hash           text not null,
  applied_count       integer not null,
  review_count        integer not null,
  blocked_count       integer not null,
  correlation_id      uuid not null,
  applied_at          timestamptz not null,
  created_at          timestamptz not null default now(),

  constraint mailchimp_reconciliation_pages_id_workspace_unique
    unique (id, workspace_id),
  constraint mailchimp_reconciliation_pages_run_index_unique
    unique (run_id, page_index),
  constraint mailchimp_reconciliation_pages_run_offset_unique
    unique (run_id, offset_start),
  constraint mailchimp_reconciliation_pages_run_workspace_fk
    foreign key (run_id, workspace_id)
    references public.mailchimp_reconciliation_runs (id, workspace_id) on delete restrict,
  constraint mailchimp_reconciliation_pages_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_reconciliation_pages_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_reconciliation_pages_bounds check (
    page_index >= 0
    and offset_start >= 0
    and item_count between 0 and 500
    and next_offset >= offset_start
    and next_offset <= provider_total
    and item_count = next_offset - offset_start
  ),
  constraint mailchimp_reconciliation_pages_counts check (
    applied_count >= 0
    and review_count >= 0
    and blocked_count >= 0
    and applied_count + review_count <= item_count
    and blocked_count <= review_count
  ),
  constraint mailchimp_reconciliation_pages_hash check (
    page_hash ~ '^[0-9a-f]{64}$'
  )
);

create index mailchimp_reconciliation_pages_workspace_applied_idx
  on public.mailchimp_reconciliation_pages (workspace_id,applied_at desc,id);

create or replace function public.prepare_mailchimp_reconciliation_run_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id
     or new.binding_id <> old.binding_id
     or new.mode <> old.mode
     or new.snapshot_hash <> old.snapshot_hash
     or new.request_key_hash <> old.request_key_hash
     or new.page_size <> old.page_size
     or new.max_attempts <> old.max_attempts
     or new.requested_by_membership_id <> old.requested_by_membership_id
     or new.correlation_id <> old.correlation_id
     or new.requested_at <> old.requested_at
     or new.created_at <> old.created_at then
    raise exception 'Mailchimp reconciliation run authority is immutable'
      using errcode = '55000';
  end if;

  if new.next_offset < old.next_offset
     or new.pages_applied < old.pages_applied
     or new.items_seen < old.items_seen
     or new.items_applied < old.items_applied
     or new.items_reviewed < old.items_reviewed
     or new.items_blocked < old.items_blocked
     or new.attempt_count < old.attempt_count
     or new.fencing_token < old.fencing_token
     or (old.provider_total is not null
       and new.provider_total is distinct from old.provider_total) then
    raise exception 'Mailchimp reconciliation progress cannot move backward'
      using errcode = '55000';
  end if;

  if new.state <> old.state and not (
    (old.state in ('queued','retry_wait') and new.state in ('leased','review','cancelled'))
    or (old.state = 'leased' and new.state in ('executing','retry_wait','review','cancelled'))
    or (old.state = 'executing' and new.state in ('retry_wait','succeeded','review','cancelled'))
  ) then
    raise exception 'invalid Mailchimp reconciliation transition: % -> %',
      old.state,new.state using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger mailchimp_reconciliation_runs_prepare_update
before update on public.mailchimp_reconciliation_runs
for each row execute function public.prepare_mailchimp_reconciliation_run_update();

create trigger mailchimp_reconciliation_runs_guard_delete
before delete on public.mailchimp_reconciliation_runs
for each row execute function public.guard_connector_append_only();

create trigger mailchimp_reconciliation_pages_guard_mutation
before update or delete on public.mailchimp_reconciliation_pages
for each row execute function public.guard_connector_append_only();

create or replace function public.invalidate_mailchimp_reconciliation_runs_on_audience_replace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.replaced_at is null and new.replaced_at is not null then
    update public.mailchimp_reconciliation_runs
       set state = 'cancelled',
           lease_owner = null,
           lease_expires_at = null,
           completed_at = new.replaced_at,
           last_error_category = 'audience_replaced'
     where binding_id = new.id
       and workspace_id = new.workspace_id
       and state in ('queued','leased','executing','retry_wait');
  end if;
  return new;
end;
$$;

create trigger mailchimp_reconciliation_runs_invalidate_on_audience_replace
after update of replaced_at on public.mailchimp_audience_bindings
for each row execute function public.invalidate_mailchimp_reconciliation_runs_on_audience_replace();

revoke all on function public.prepare_mailchimp_reconciliation_run_update()
  from public,anon,authenticated,service_role;
revoke all on function public.invalidate_mailchimp_reconciliation_runs_on_audience_replace()
  from public,anon,authenticated,service_role;

alter table public.mailchimp_reconciliation_runs enable row level security;
alter table public.mailchimp_reconciliation_runs force row level security;
alter table public.mailchimp_reconciliation_pages enable row level security;
alter table public.mailchimp_reconciliation_pages force row level security;

create policy mailchimp_reconciliation_runs_member_select
on public.mailchimp_reconciliation_runs for select to authenticated
using (public.has_workspace_access(workspace_id));

create policy mailchimp_reconciliation_pages_member_select
on public.mailchimp_reconciliation_pages for select to authenticated
using (public.has_workspace_access(workspace_id));

revoke all on table public.mailchimp_reconciliation_runs
  from anon,authenticated,service_role;
revoke all on table public.mailchimp_reconciliation_pages
  from anon,authenticated,service_role;
grant select on table public.mailchimp_reconciliation_runs
  to authenticated,service_role;
grant select on table public.mailchimp_reconciliation_pages
  to authenticated,service_role;

create or replace function public.request_mailchimp_reconciliation_run(
  target_connection_id uuid,
  target_binding_id uuid,
  target_mode text,
  target_snapshot_hash text,
  target_request_key_hash text,
  target_page_size integer,
  target_correlation_id uuid,
  target_requested_at timestamptz,
  target_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_run public.mailchimp_reconciliation_runs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
begin
  if target_connection_id is null
     or target_binding_id is null
     or target_mode not in ('baseline','reconcile')
     or target_snapshot_hash !~ '^[0-9a-f]{64}$'
     or target_request_key_hash !~ '^[0-9a-f]{64}$'
     or target_page_size not between 1 and 500
     or target_correlation_id is null
     or target_requested_at is null
     or target_max_attempts not between 1 and 20 then
    raise exception 'invalid Mailchimp reconciliation request'
      using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
    and connection.provider = 'mailchimp'
  for update;
  if not found then
    raise exception 'Mailchimp connection not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_connection.workspace_id,true);

  select run.* into target_run
  from public.mailchimp_reconciliation_runs run
  where run.connection_id = target_connection.id
    and run.request_key_hash = target_request_key_hash;

  if found then
    if target_run.binding_id <> target_binding_id
       or target_run.mode <> target_mode
       or target_run.snapshot_hash <> target_snapshot_hash
       or target_run.page_size <> target_page_size
       or target_run.max_attempts <> target_max_attempts then
      raise exception 'Mailchimp reconciliation request replay conflicts'
        using errcode = '23505';
    end if;
    select receipt.* into target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_run.workspace_id
      and receipt.event_key = 'mailchimp.reconciliation.requested:' || target_run.id::text;
    return jsonb_build_object(
      'run',to_jsonb(target_run),
      'receipt',to_jsonb(target_receipt),
      'noOp',true
    );
  end if;

  if target_connection.status not in ('active','degraded') then
    raise exception 'active Mailchimp connection required'
      using errcode = '42501';
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  where binding.id = target_binding_id
    and binding.connection_id = target_connection.id
    and binding.workspace_id = target_connection.workspace_id
    and binding.replaced_at is null
  for update;
  if not found then
    raise exception 'active selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  if target_mode = 'baseline' and not target_binding.baseline_required then
    raise exception 'Mailchimp baseline is already complete'
      using errcode = '23514';
  elsif target_mode = 'reconcile' and target_binding.baseline_required then
    raise exception 'Mailchimp baseline must complete before periodic reconciliation'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.mailchimp_reconciliation_runs run
    where run.connection_id = target_connection.id
      and run.state in ('queued','leased','executing','retry_wait')
  ) then
    raise exception 'another Mailchimp reconciliation run is active'
      using errcode = '23505';
  end if;

  insert into public.mailchimp_reconciliation_runs (
    workspace_id,connection_id,binding_id,mode,snapshot_hash,
    request_key_hash,page_size,max_attempts,scheduled_at,
    requested_by_membership_id,correlation_id,requested_at,
    created_at,updated_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_binding.id,
    target_mode,target_snapshot_hash,target_request_key_hash,target_page_size,
    target_max_attempts,target_requested_at,actor.id,target_correlation_id,
    target_requested_at,target_requested_at,target_requested_at
  ) returning * into target_run;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp','sync.applied',
    'mailchimp.reconciliation.requested:' || target_run.id::text,
    target_run.correlation_id,target_run.snapshot_hash,
    jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,
      'mode',target_run.mode,'pageSize',target_run.page_size
    ),target_run.requested_at
  ) returning * into target_receipt;

  return jsonb_build_object(
    'run',to_jsonb(target_run),
    'receipt',to_jsonb(target_receipt),
    'noOp',false
  );
end;
$$;

create or replace function public.claim_mailchimp_reconciliation_runs(
  target_worker_id uuid,
  target_batch_size integer default 10,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns setof public.mailchimp_reconciliation_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed public.mailchimp_reconciliation_runs%rowtype;
begin
  if target_worker_id is null
     or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900
     or target_now is null then
    raise exception 'invalid Mailchimp reconciliation claim'
      using errcode = '22023';
  end if;

  update public.mailchimp_reconciliation_runs
     set state = 'retry_wait',
         lease_owner = null,
         lease_expires_at = null,
         scheduled_at = target_now,
         last_error_category = 'lease_expired'
   where state in ('leased','executing')
     and lease_expires_at <= target_now
     and attempt_count < max_attempts;

  update public.mailchimp_reconciliation_runs
     set state = 'review',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = target_now,
         last_error_category = 'lease_expired'
   where state in ('leased','executing')
     and lease_expires_at <= target_now
     and attempt_count >= max_attempts;

  for candidate in
    select run.id
    from public.mailchimp_reconciliation_runs run
    join public.connector_connections connection
      on connection.id = run.connection_id
     and connection.workspace_id = run.workspace_id
    join public.mailchimp_audience_bindings binding
      on binding.id = run.binding_id
     and binding.workspace_id = run.workspace_id
    where run.state in ('queued','retry_wait')
      and run.scheduled_at <= target_now
      and run.attempt_count < run.max_attempts
      and connection.provider = 'mailchimp'
      and connection.status in ('active','degraded')
      and binding.replaced_at is null
      and (
        (run.mode = 'baseline' and binding.baseline_required)
        or (run.mode = 'reconcile' and not binding.baseline_required)
      )
    order by run.scheduled_at,run.requested_at,run.id
    for update of run skip locked
    limit target_batch_size
  loop
    update public.mailchimp_reconciliation_runs
       set state = 'leased',
           lease_owner = target_worker_id,
           lease_expires_at = target_now
             + make_interval(secs => target_lease_seconds),
           fencing_token = fencing_token + 1,
           last_error_category = null
     where id = candidate.id
     returning * into claimed;
    return next claimed;
  end loop;
end;
$$;

create or replace function public.start_mailchimp_reconciliation_run(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_reconciliation_runs%rowtype;
begin
  if target_run_id is null or target_worker_id is null
     or target_fencing_token is null or target_started_at is null then
    raise exception 'invalid Mailchimp reconciliation start'
      using errcode = '22023';
  end if;
  update public.mailchimp_reconciliation_runs
     set state = 'executing',
         attempt_count = attempt_count + 1,
         last_error_category = null
   where id = target_run_id
     and state = 'leased'
     and lease_owner = target_worker_id
     and fencing_token = target_fencing_token
     and lease_expires_at > target_started_at
     and attempt_count < max_attempts
  returning * into target_run;
  if not found then
    raise exception 'active Mailchimp reconciliation lease required'
      using errcode = '40001';
  end if;
  return jsonb_build_object('run',to_jsonb(target_run),'noOp',false);
end;
$$;

create or replace function public.apply_mailchimp_reconciliation_page(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_expected_offset integer,
  target_members jsonb,
  target_next_offset integer,
  target_provider_total integer,
  target_page_hash text,
  target_applied_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_reconciliation_runs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_page public.mailchimp_reconciliation_pages%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  member jsonb;
  member_result jsonb;
  member_count integer;
  applied_count integer := 0;
  review_count integer := 0;
  blocked_count integer := 0;
  item_source_hash text;
begin
  if target_run_id is null or target_worker_id is null
     or target_fencing_token is null
     or target_expected_offset is null or target_expected_offset < 0
     or jsonb_typeof(target_members) <> 'array'
     or target_next_offset is null or target_next_offset < 0
     or target_provider_total is null or target_provider_total < 0
     or target_page_hash !~ '^[0-9a-f]{64}$'
     or target_applied_at is null then
    raise exception 'invalid Mailchimp reconciliation page'
      using errcode = '22023';
  end if;

  member_count := jsonb_array_length(target_members);
  if member_count > 500 then
    raise exception 'Mailchimp reconciliation page exceeds 500 items'
      using errcode = '22023';
  end if;

  select run.* into target_run
  from public.mailchimp_reconciliation_runs run
  where run.id = target_run_id
    and run.state = 'executing'
    and run.lease_owner = target_worker_id
    and run.fencing_token = target_fencing_token
    and run.lease_expires_at > target_applied_at
  for update;
  if not found then
    raise exception 'active Mailchimp reconciliation execution lease required'
      using errcode = '40001';
  end if;

  if member_count > target_run.page_size then
    raise exception 'Mailchimp reconciliation page exceeds approved page size'
      using errcode = '22023';
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  join public.connector_connections connection
    on connection.id = binding.connection_id
   and connection.workspace_id = binding.workspace_id
  where binding.id = target_run.binding_id
    and binding.workspace_id = target_run.workspace_id
    and binding.connection_id = target_run.connection_id
    and binding.replaced_at is null
    and connection.provider = 'mailchimp'
    and connection.status in ('active','degraded');
  if not found then
    raise exception 'current selected Mailchimp audience required'
      using errcode = '42501';
  end if;

  select page.* into target_page
  from public.mailchimp_reconciliation_pages page
  where page.run_id = target_run.id
    and page.offset_start = target_expected_offset;
  if found then
    if target_page.page_hash <> target_page_hash
       or target_page.item_count <> member_count
       or target_page.next_offset <> target_next_offset
       or target_page.provider_total <> target_provider_total then
      raise exception 'Mailchimp reconciliation page replay conflicts'
        using errcode = '23505';
    end if;
    select receipt.* into target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_page.workspace_id
      and receipt.event_key = 'mailchimp.reconciliation.page:' || target_page.id::text;
    return jsonb_build_object(
      'run',to_jsonb(target_run),'page',to_jsonb(target_page),
      'receipt',to_jsonb(target_receipt),'finalPage',
      target_page.next_offset = target_page.provider_total,'noOp',true
    );
  end if;

  if target_run.next_offset <> target_expected_offset
     or (target_run.provider_total is not null
       and target_run.provider_total <> target_provider_total)
     or target_next_offset <> target_expected_offset + member_count
     or target_next_offset > target_provider_total
     or (member_count = 0 and not (
       target_expected_offset = 0
       and target_next_offset = 0
       and target_provider_total = 0
     )) then
    raise exception 'Mailchimp reconciliation page checkpoint conflicts'
      using errcode = '40001';
  end if;

  for member in select value from jsonb_array_elements(target_members)
  loop
    if jsonb_typeof(member) <> 'object'
       or member - array[
         'memberId','subscriberHash','normalizedEmail','status','sourceHash'
       ] <> '{}'::jsonb
       or not (member ?& array[
         'memberId','subscriberHash','normalizedEmail','status','sourceHash'
       ]) then
      raise exception 'invalid Mailchimp reconciliation member shape'
        using errcode = '22023';
    end if;

    item_source_hash := encode(
      extensions.digest(
        pg_catalog.convert_to(
          target_run.id::text || ':' || (member ->> 'sourceHash'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    member_result := public.apply_mailchimp_baseline_member(
      target_run.connection_id,
      target_binding.audience_external_id,
      member ->> 'memberId',
      member ->> 'subscriberHash',
      member ->> 'normalizedEmail',
      member ->> 'status',
      item_source_hash,
      target_run.correlation_id,
      target_applied_at
    );

    if member_result ->> 'outcome' in ('applied','no-op') then
      applied_count := applied_count + 1;
    elsif member_result ->> 'outcome' = 'blocked-unsubscribe-authority' then
      review_count := review_count + 1;
      blocked_count := blocked_count + 1;
    else
      review_count := review_count + 1;
    end if;
  end loop;

  insert into public.mailchimp_reconciliation_pages (
    workspace_id,run_id,connection_id,binding_id,page_index,offset_start,
    item_count,next_offset,provider_total,page_hash,applied_count,
    review_count,blocked_count,correlation_id,applied_at
  ) values (
    target_run.workspace_id,target_run.id,target_run.connection_id,
    target_run.binding_id,target_run.pages_applied,target_expected_offset,
    member_count,target_next_offset,target_provider_total,target_page_hash,
    applied_count,review_count,blocked_count,target_run.correlation_id,
    target_applied_at
  ) returning * into target_page;

  update public.mailchimp_reconciliation_runs
     set next_offset = target_next_offset,
         provider_total = target_provider_total,
         pages_applied = pages_applied + 1,
         items_seen = items_seen + member_count,
         items_applied = items_applied + applied_count,
         items_reviewed = items_reviewed + review_count,
         items_blocked = items_blocked + blocked_count,
         last_page_hash = target_page_hash
   where id = target_run.id
  returning * into target_run;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,reconciliation_result,redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp',
    case when review_count > 0 then
      'sync.reviewed'::public.connector_receipt_event_type
    else 'sync.applied'::public.connector_receipt_event_type end,
    'mailchimp.reconciliation.page:' || target_page.id::text,
    target_run.correlation_id,target_page.page_hash,
    case when review_count > 0 then 'page-has-review-items' end,
    jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,
      'mode',target_run.mode,'pageIndex',target_page.page_index,
      'offsetStart',target_page.offset_start,'nextOffset',target_page.next_offset,
      'providerTotal',target_page.provider_total,'itemCount',target_page.item_count,
      'appliedCount',target_page.applied_count,
      'reviewCount',target_page.review_count,
      'blockedCount',target_page.blocked_count
    ),target_page.applied_at
  ) returning * into target_receipt;

  return jsonb_build_object(
    'run',to_jsonb(target_run),'page',to_jsonb(target_page),
    'receipt',to_jsonb(target_receipt),
    'finalPage',target_next_offset = target_provider_total,
    'noOp',false
  );
end;
$$;

create or replace function public.read_mailchimp_reconciliation_access_token(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_reconciliation_runs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  if target_run_id is null or target_worker_id is null
     or target_fencing_token is null or target_now is null then
    raise exception 'invalid Mailchimp reconciliation token read'
      using errcode = '22023';
  end if;

  select run.* into target_run
  from public.mailchimp_reconciliation_runs run
  where run.id = target_run_id
    and run.state = 'executing'
    and run.lease_owner = target_worker_id
    and run.fencing_token = target_fencing_token
    and run.lease_expires_at > target_now;
  if not found then
    raise exception 'active Mailchimp reconciliation execution lease required'
      using errcode = '42501';
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  where binding.id = target_run.binding_id
    and binding.workspace_id = target_run.workspace_id
    and binding.connection_id = target_run.connection_id
    and binding.replaced_at is null;
  if not found then
    raise exception 'current selected Mailchimp audience required'
      using errcode = '42501';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_run.connection_id
    and connection.workspace_id = target_run.workspace_id
    and connection.provider = 'mailchimp'
    and connection.status in ('active','degraded');
  if not found then
    raise exception 'active Mailchimp connection required'
      using errcode = '42501';
  end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection.id
    and secret.workspace_id = target_connection.workspace_id
    and secret.secret_type = 'mailchimp-access-token'
    and secret.destroyed_at is null
    and (secret.expires_at is null or secret.expires_at > target_now);
  if not found then
    raise exception 'active Mailchimp access token not found'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'run',jsonb_build_object(
      'runId',target_run.id,
      'mode',target_run.mode,
      'snapshotHash',target_run.snapshot_hash,
      'pageSize',target_run.page_size,
      'nextOffset',target_run.next_offset,
      'providerTotal',target_run.provider_total,
      'attemptCount',target_run.attempt_count,
      'fencingToken',target_run.fencing_token,
      'leaseExpiresAt',target_run.lease_expires_at
    ),
    'binding',jsonb_build_object(
      'workspaceId',target_binding.workspace_id,
      'connectionId',target_binding.connection_id,
      'bindingId',target_binding.id,
      'dataCenter',target_binding.data_center,
      'audienceId',target_binding.audience_external_id,
      'accountIdHash',target_binding.account_id_hash,
      'mappingVersion',target_binding.mapping_version
    ),
    'secret',jsonb_build_object(
      'secretId',target_secret.id,
      'secretType',target_secret.secret_type,
      'secretVersion',target_secret.secret_version,
      'ciphertext',encode(target_secret.ciphertext,'base64'),
      'nonce',encode(target_secret.nonce,'base64'),
      'authTag',encode(target_secret.auth_tag,'base64'),
      'wrappedDek',encode(target_secret.wrapped_dek,'base64'),
      'wrapNonce',encode(target_secret.wrap_nonce,'base64'),
      'wrapAuthTag',encode(target_secret.wrap_auth_tag,'base64'),
      'kekVersion',target_secret.kek_version,
      'aadHash',target_secret.aad_hash,
      'expiresAt',target_secret.expires_at,
      'refreshedAt',target_secret.refreshed_at
    )
  );
end;
$$;

create or replace function public.complete_mailchimp_reconciliation_run(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_provider_request_hash text,
  target_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_reconciliation_runs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  baseline_confirmation jsonb;
  completed boolean;
begin
  if target_run_id is null or target_worker_id is null
     or target_fencing_token is null
     or target_provider_request_hash !~ '^[0-9a-f]{64}$'
     or target_completed_at is null then
    raise exception 'invalid Mailchimp reconciliation completion'
      using errcode = '22023';
  end if;

  select run.* into target_run
  from public.mailchimp_reconciliation_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'Mailchimp reconciliation run not found'
      using errcode = 'P0002';
  end if;

  if target_run.state in ('succeeded','review') then
    select receipt.* into target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_run.workspace_id
      and receipt.event_key = 'mailchimp.reconciliation.completed:' || target_run.id::text;
    if target_receipt.id is null
       or target_receipt.provider_request_hash <> target_provider_request_hash then
      raise exception 'Mailchimp reconciliation completion replay conflicts'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'run',to_jsonb(target_run),'baselineConfirmation',null,
      'receipt',to_jsonb(target_receipt),
      'completed',target_run.state = 'succeeded','noOp',true
    );
  end if;

  if target_run.state <> 'executing'
     or target_run.lease_owner <> target_worker_id
     or target_run.fencing_token <> target_fencing_token
     or target_run.lease_expires_at <= target_completed_at then
    raise exception 'active Mailchimp reconciliation execution lease required'
      using errcode = '40001';
  end if;

  perform 1
  from public.mailchimp_audience_bindings binding
  where binding.id = target_run.binding_id
    and binding.workspace_id = target_run.workspace_id
    and binding.connection_id = target_run.connection_id
    and binding.replaced_at is null;
  if not found then
    raise exception 'current selected Mailchimp audience required'
      using errcode = '42501';
  end if;

  if target_run.provider_total is null
     or target_run.pages_applied < 1
     or target_run.next_offset <> target_run.provider_total
     or target_run.items_seen <> target_run.provider_total then
    raise exception 'final Mailchimp reconciliation page required'
      using errcode = '23514';
  end if;

  completed := target_run.items_reviewed = 0;

  if completed and target_run.mode = 'baseline' then
    baseline_confirmation := public.complete_mailchimp_audience_baseline(
      target_run.connection_id,target_run.binding_id,
      target_provider_request_hash,target_run.correlation_id,target_completed_at
    );
  end if;

  update public.mailchimp_reconciliation_runs
     set state = case when completed then 'succeeded' else 'review' end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = target_completed_at,
         last_error_category = case when completed then null
           else 'reconciliation_items_require_review' end
   where id = target_run.id
  returning * into target_run;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,error_category,reconciliation_result,
    redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp',
    case when completed then 'sync.applied'::public.connector_receipt_event_type
      else 'sync.reviewed'::public.connector_receipt_event_type end,
    'mailchimp.reconciliation.completed:' || target_run.id::text,
    target_run.correlation_id,target_provider_request_hash,
    target_run.last_error_category,
    case when completed then 'complete' else 'review-required' end,
    jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,
      'mode',target_run.mode,'pagesApplied',target_run.pages_applied,
      'providerTotal',target_run.provider_total,
      'itemsApplied',target_run.items_applied,
      'itemsReviewed',target_run.items_reviewed,
      'itemsBlocked',target_run.items_blocked
    ),target_completed_at
  ) returning * into target_receipt;

  return jsonb_build_object(
    'run',to_jsonb(target_run),
    'baselineConfirmation',baseline_confirmation,
    'receipt',to_jsonb(target_receipt),
    'completed',completed,'noOp',false
  );
end;
$$;

create or replace function public.transition_mailchimp_reconciliation_run(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_outcome text,
  target_error_category text,
  target_retry_at timestamptz,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_reconciliation_runs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  next_state text;
begin
  if target_run_id is null or target_worker_id is null
     or target_fencing_token is null
     or target_outcome not in ('retry','review')
     or target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$'
     or target_occurred_at is null
     or (target_outcome = 'retry' and (
       target_retry_at is null or target_retry_at <= target_occurred_at
     ))
     or (target_outcome = 'review' and target_retry_at is not null) then
    raise exception 'invalid Mailchimp reconciliation transition'
      using errcode = '22023';
  end if;

  select run.* into target_run
  from public.mailchimp_reconciliation_runs run
  where run.id = target_run_id
    and run.state in ('leased','executing')
    and run.lease_owner = target_worker_id
    and run.fencing_token = target_fencing_token
    and run.lease_expires_at > target_occurred_at
  for update;
  if not found then
    raise exception 'active Mailchimp reconciliation lease required'
      using errcode = '40001';
  end if;

  next_state := case
    when target_outcome = 'retry' and target_run.attempt_count < target_run.max_attempts
      then 'retry_wait'
    else 'review'
  end;

  update public.mailchimp_reconciliation_runs
     set state = next_state,
         lease_owner = null,
         lease_expires_at = null,
         scheduled_at = case when next_state = 'retry_wait'
           then target_retry_at else scheduled_at end,
         completed_at = case when next_state = 'review'
           then target_occurred_at end,
         last_error_category = target_error_category
   where id = target_run.id
  returning * into target_run;

  if next_state = 'review' then
    insert into public.connector_receipt_events (
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      error_category,reconciliation_result,redacted_metadata,occurred_at
    ) values (
      target_run.workspace_id,target_run.connection_id,'mailchimp','sync.reviewed',
      'mailchimp.reconciliation.review:' || target_run.id::text,
      target_run.correlation_id,target_error_category,'worker-review',
      jsonb_build_object(
        'runId',target_run.id,'bindingId',target_run.binding_id,
        'mode',target_run.mode,'attemptCount',target_run.attempt_count
      ),target_occurred_at
    )
    on conflict (workspace_id,event_key) do nothing
    returning * into target_receipt;
  end if;

  return jsonb_build_object(
    'run',to_jsonb(target_run),
    'receipt',case when target_receipt.id is null then null
      else to_jsonb(target_receipt) end,
    'noOp',false
  );
end;
$$;

-- Mailchimp identity review quarantine ----------------------------------

alter function public.apply_mailchimp_inbound_subscription_event(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
) rename to apply_mailchimp_inbound_subscription_event_0010;

alter function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) rename to apply_mailchimp_baseline_member_0011;

create or replace function public.quarantine_mailchimp_identity_review(
  target_workspace_id uuid,
  target_connection_id uuid,
  target_binding_id uuid,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_review_reason text,
  target_source_key_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  member_external_id_hash text;
  intake_key text;
  request_hash text;
  candidate jsonb;
  reasons jsonb;
  target_record public.incomplete_records%rowtype;
  target_activity public.activity_events%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  actor_membership_id uuid;
  created_record boolean := false;
begin
  if target_workspace_id is null or target_connection_id is null
     or target_binding_id is null
     or target_member_external_id is null
     or length(btrim(target_member_external_id)) not between 1 and 128
     or target_member_external_id ~ '[[:cntrl:]]'
     or target_subscriber_hash !~ '^[0-9a-f]{32}$'
     or target_review_reason not in (
       'no-canonical-match','ambiguous-email','archived-email'
     )
     or target_source_key_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null
     or target_occurred_at is null then
    raise exception 'invalid Mailchimp identity quarantine request'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.mailchimp_audience_bindings binding
    where binding.id = target_binding_id
      and binding.workspace_id = target_workspace_id
      and binding.connection_id = target_connection_id
      and binding.replaced_at is null
  ) then
    raise exception 'active selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  normalized_email := public.normalize_contact_email(target_normalized_email);
  if normalized_email is null
     or encode(
       extensions.digest(pg_catalog.convert_to(normalized_email,'UTF8'),'md5'),
       'hex'
     ) <> target_subscriber_hash then
    raise exception 'Mailchimp quarantine subscriber identity mismatch'
      using errcode = '23514';
  end if;

  member_external_id_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(btrim(target_member_external_id),'UTF8'),
      'sha256'
    ),
    'hex'
  );
  intake_key := 'mailchimp.identity-review:' || target_source_key_hash;
  candidate := jsonb_build_object(
    'email',normalized_email,
    'source','other',
    'emailSubscribed',false
  );
  reasons := jsonb_build_array(jsonb_build_object(
    'field','email',
    'code','mailchimp-' || target_review_reason,
    'message',case target_review_reason
      when 'no-canonical-match' then
        'Mailchimp email has no canonical CRM contact.'
      when 'ambiguous-email' then
        'Mailchimp email matches multiple active CRM contacts.'
      else 'Mailchimp email belongs to an archived CRM identity.'
    end
  ));
  request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'source','mailchimp-live',
        'externalId','mailchimp-member:' || member_external_id_hash,
        'candidate',candidate,
        'reasons',reasons
      )::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.incomplete_records (
    workspace_id,source,external_id,candidate,validation_reasons,
    intake_idempotency_key,intake_request_hash,created_at,updated_at
  ) values (
    target_workspace_id,'mailchimp-live',
    'mailchimp-member:' || member_external_id_hash,candidate,reasons,
    intake_key,request_hash,target_occurred_at,target_occurred_at
  )
  on conflict (workspace_id,intake_idempotency_key)
    where intake_idempotency_key is not null
  do nothing
  returning * into target_record;
  created_record := found;

  if not created_record then
    select record.* into strict target_record
    from public.incomplete_records record
    where record.workspace_id = target_workspace_id
      and record.intake_idempotency_key = intake_key
    for update;
    if target_record.intake_request_hash <> request_hash then
      raise exception 'Mailchimp identity quarantine replay conflicts'
        using errcode = '23505';
    end if;
  end if;

  select membership.id into actor_membership_id
  from public.workspace_members membership
  where membership.workspace_id = target_workspace_id
    and membership.role = 'owner'
    and membership.status = 'active'
  order by membership.created_at,membership.id
  limit 1;
  if actor_membership_id is null then
    raise exception 'active owner required for Mailchimp quarantine evidence'
      using errcode = '42501';
  end if;

  insert into public.activity_events (
    workspace_id,type,incomplete_record_id,actor_membership_id,
    occurred_at,idempotency_key
  ) values (
    target_workspace_id,
    'incomplete-record-received'::text::public.crm_activity_event_type_v2,
    target_record.id,
    actor_membership_id,target_occurred_at,
    'mailchimp.quarantine:' || target_source_key_hash
  )
  on conflict (workspace_id,idempotency_key) do nothing
  returning * into target_activity;

  if target_activity.id is null then
    select event.* into strict target_activity
    from public.activity_events event
    where event.workspace_id = target_workspace_id
      and event.idempotency_key = 'mailchimp.quarantine:' || target_source_key_hash;
    if target_activity.type::text <> 'incomplete-record-received'
       or target_activity.incomplete_record_id <> target_record.id then
      raise exception 'Mailchimp quarantine activity replay conflicts'
        using errcode = '23505';
    end if;
  end if;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    reconciliation_result,redacted_metadata,occurred_at
  ) values (
    target_workspace_id,target_connection_id,'mailchimp','sync.reviewed',
    'mailchimp.identity.quarantined:' || target_source_key_hash,
    target_correlation_id,target_review_reason,
    jsonb_build_object(
      'bindingId',target_binding_id,
      'incompleteRecordId',target_record.id,
      'subscriberHash',target_subscriber_hash,
      'memberExternalIdHash',member_external_id_hash,
      'reviewReason',target_review_reason
    ),target_occurred_at
  )
  on conflict (workspace_id,event_key) do nothing
  returning * into target_receipt;

  if target_receipt.id is null then
    select receipt.* into strict target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_workspace_id
      and receipt.event_key = 'mailchimp.identity.quarantined:' || target_source_key_hash;
  end if;

  return jsonb_build_object(
    'incompleteRecordId',target_record.id,
    'status',target_record.status,
    'source',target_record.source,
    'memberExternalIdHash',member_external_id_hash,
    'activityId',target_activity.id,
    'receipt',to_jsonb(target_receipt),
    'noOp',not created_record
  );
end;
$$;

create or replace function public.apply_mailchimp_inbound_subscription_event(
  target_connection_id uuid,
  target_audience_external_id text,
  target_delivery_id uuid,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_subscription_status text,
  target_provider_event_id_hash text,
  target_originating_operation_key_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_result jsonb;
  target_quarantine jsonb;
  target_binding public.mailchimp_audience_bindings%rowtype;
  review_reason text;
begin
  target_result := public.apply_mailchimp_inbound_subscription_event_0010(
    target_connection_id,target_audience_external_id,target_delivery_id,
    target_member_external_id,target_subscriber_hash,target_normalized_email,
    target_subscription_status,target_provider_event_id_hash,
    target_originating_operation_key_hash,target_correlation_id,target_occurred_at
  );
  review_reason := target_result #>> '{receipt,reconciliation_result}';

  if target_result ->> 'outcome' = 'review'
     and review_reason in (
       'no-canonical-match','ambiguous-email','archived-email'
     ) then
    select binding.* into strict target_binding
    from public.mailchimp_audience_bindings binding
    where binding.connection_id = target_connection_id
      and binding.replaced_at is null;
    target_quarantine := public.quarantine_mailchimp_identity_review(
      target_binding.workspace_id,target_connection_id,target_binding.id,
      target_member_external_id,target_subscriber_hash,target_normalized_email,
      review_reason,target_provider_event_id_hash,target_correlation_id,
      target_occurred_at
    );
  end if;

  return target_result || jsonb_build_object('quarantine',target_quarantine);
end;
$$;

create or replace function public.apply_mailchimp_baseline_member(
  target_connection_id uuid,
  target_audience_external_id text,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_subscription_status text,
  target_source_key_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_result jsonb;
  target_quarantine jsonb;
  target_binding public.mailchimp_audience_bindings%rowtype;
  review_reason text;
begin
  target_result := public.apply_mailchimp_baseline_member_0011(
    target_connection_id,target_audience_external_id,target_member_external_id,
    target_subscriber_hash,target_normalized_email,target_subscription_status,
    target_source_key_hash,target_correlation_id,target_occurred_at
  );
  review_reason := target_result #>> '{receipt,reconciliation_result}';

  if target_result ->> 'outcome' = 'review'
     and review_reason in (
       'no-canonical-match','ambiguous-email','archived-email'
     ) then
    select binding.* into strict target_binding
    from public.mailchimp_audience_bindings binding
    where binding.connection_id = target_connection_id
      and binding.replaced_at is null;
    target_quarantine := public.quarantine_mailchimp_identity_review(
      target_binding.workspace_id,target_connection_id,target_binding.id,
      target_member_external_id,target_subscriber_hash,target_normalized_email,
      review_reason,target_source_key_hash,target_correlation_id,
      target_occurred_at
    );
  end if;

  return target_result || jsonb_build_object('quarantine',target_quarantine);
end;
$$;

revoke all on function public.quarantine_mailchimp_identity_review(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.apply_mailchimp_inbound_subscription_event_0010(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.apply_mailchimp_baseline_member_0011(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.apply_mailchimp_inbound_subscription_event(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;

grant execute on function public.apply_mailchimp_inbound_subscription_event(
  uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz
) to service_role;
grant execute on function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) to service_role;

revoke all on function public.request_mailchimp_reconciliation_run(
  uuid,uuid,text,text,text,integer,uuid,timestamptz,integer
) from public,anon,authenticated,service_role;
revoke all on function public.claim_mailchimp_reconciliation_runs(
  uuid,integer,integer,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.start_mailchimp_reconciliation_run(
  uuid,uuid,bigint,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.apply_mailchimp_reconciliation_page(
  uuid,uuid,bigint,integer,jsonb,integer,integer,text,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.read_mailchimp_reconciliation_access_token(
  uuid,uuid,bigint,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.complete_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.transition_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
) from public,anon,authenticated,service_role;

grant execute on function public.request_mailchimp_reconciliation_run(
  uuid,uuid,text,text,text,integer,uuid,timestamptz,integer
) to authenticated;
grant execute on function public.claim_mailchimp_reconciliation_runs(
  uuid,integer,integer,timestamptz
) to service_role;
grant execute on function public.start_mailchimp_reconciliation_run(
  uuid,uuid,bigint,timestamptz
) to service_role;
grant execute on function public.apply_mailchimp_reconciliation_page(
  uuid,uuid,bigint,integer,jsonb,integer,integer,text,timestamptz
) to service_role;
grant execute on function public.read_mailchimp_reconciliation_access_token(
  uuid,uuid,bigint,timestamptz
) to service_role;
grant execute on function public.complete_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,timestamptz
) to service_role;
grant execute on function public.transition_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
) to service_role;

-- After 0012, baseline readiness is only reachable through a successfully
-- completed durable baseline run. Keep the 0010 function for rollback and for
-- the 0012 definer composition, but remove direct worker execution.
revoke all on function public.complete_mailchimp_audience_baseline(
  uuid,uuid,text,uuid,timestamptz
) from service_role;

comment on table public.mailchimp_reconciliation_runs is
  'Workspace-visible redacted durable baseline/reconciliation run authority with bounded offset checkpoint, lease and fence.';
comment on table public.mailchimp_reconciliation_pages is
  'Append-only redacted per-page reconciliation checkpoint/evidence; never stores raw email or provider bodies.';
comment on function public.request_mailchimp_reconciliation_run(
  uuid,uuid,text,text,text,integer,uuid,timestamptz,integer
) is 'Owner-only exact baseline/reconcile request; replay-safe by connection and request hash.';
comment on function public.apply_mailchimp_reconciliation_page(
  uuid,uuid,bigint,integer,jsonb,integer,integer,text,timestamptz
) is 'Service-only leased/fenced 0..500-item canonical page application with atomic numeric/hash checkpoint and review counts.';
comment on function public.read_mailchimp_reconciliation_access_token(
  uuid,uuid,bigint,timestamptz
) is 'Service-only active-run lease/fence-bound selected routing plus encrypted Mailchimp access-token envelope.';
comment on function public.complete_mailchimp_reconciliation_run(
  uuid,uuid,bigint,text,timestamptz
) is 'Service-only final-page completion. Baseline readiness changes only after a complete zero-review durable run.';

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'mailchimp_reconciliation_runs','mailchimp_reconciliation_pages'
  ] loop
    if not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = target_table
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception 'Mailchimp reconciliation table % must force RLS',target_table;
    end if;
    if has_table_privilege('authenticated','public.' || target_table,'INSERT')
       or has_table_privilege('authenticated','public.' || target_table,'UPDATE')
       or has_table_privilege('authenticated','public.' || target_table,'DELETE') then
      raise exception 'authenticated has direct Mailchimp reconciliation mutation on %',target_table;
    end if;
  end loop;

  if has_function_privilege(
       'authenticated',
       'public.claim_mailchimp_reconciliation_runs(uuid,integer,integer,timestamptz)',
       'EXECUTE'
     ) or has_function_privilege(
       'service_role',
       'public.complete_mailchimp_audience_baseline(uuid,uuid,text,uuid,timestamptz)',
       'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.request_mailchimp_reconciliation_run(uuid,uuid,text,text,text,integer,uuid,timestamptz,integer)',
       'EXECUTE'
     ) then
    raise exception 'Mailchimp reconciliation RPC grants are unsafe';
  end if;
end;
$$;

commit;
