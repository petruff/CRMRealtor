-- Omnix — Mailchimp durable outbound backfill and tag-drift repair
-- Story 4.1 AC4/AC8: count-only canonical preview, exact owner snapshot
-- approval, bounded resumable page materialization, and normal per-item
-- Story 3.5 intents/jobs/receipts. Provider HTTP remains outside SQL.
--
-- Forward-only and additive. Existing 0010–0012 contracts are unchanged.

begin;

create table public.mailchimp_outbound_backfill_runs (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces (id) on delete restrict,
  connection_id               uuid not null,
  binding_id                  uuid not null,
  mode                        text not null,
  mapping_version             integer not null,
  snapshot_hash               text not null,
  request_key_hash            text not null,
  eligible_count              integer not null,
  skipped_unlinked_count      integer not null,
  skipped_unsubscribed_count  integer not null,
  page_size                   integer not null,
  state                       text not null default 'previewed',
  next_offset                 integer not null default 0,
  pages_enqueued              integer not null default 0,
  jobs_enqueued               integer not null default 0,
  attempt_count               integer not null default 0,
  max_attempts                integer not null default 10,
  scheduled_at                timestamptz not null,
  lease_owner                 uuid,
  lease_expires_at            timestamptz,
  fencing_token               bigint not null default 0,
  policy_id                   uuid,
  policy_version              integer,
  request_origin              text not null default 'owner',
  requested_by_membership_id  uuid,
  approved_by_membership_id   uuid,
  correlation_id              uuid not null,
  last_error_category         text,
  previewed_at                timestamptz not null,
  approved_at                 timestamptz,
  completed_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint mailchimp_outbound_backfill_runs_id_workspace_unique
    unique (id, workspace_id),
  constraint mailchimp_outbound_backfill_runs_connection_request_unique
    unique (connection_id, request_key_hash),
  constraint mailchimp_outbound_backfill_runs_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_runs_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_runs_requester_workspace_fk
    foreign key (requested_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_runs_approver_workspace_fk
    foreign key (approved_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_runs_policy_workspace_fk
    foreign key (policy_id, workspace_id)
    references public.connector_automation_policies (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_runs_mode check (
    mode in ('backfill','tag-reconcile')
  ),
  constraint mailchimp_outbound_backfill_runs_origin check (
    (request_origin='owner' and requested_by_membership_id is not null)
    or (request_origin='scheduler' and requested_by_membership_id is null
      and mode='tag-reconcile')
  ),
  constraint mailchimp_outbound_backfill_runs_hashes check (
    snapshot_hash ~ '^[0-9a-f]{64}$'
    and request_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint mailchimp_outbound_backfill_runs_mapping check (
    mapping_version > 0
  ),
  constraint mailchimp_outbound_backfill_runs_counts check (
    eligible_count >= 0
    and skipped_unlinked_count >= 0
    and skipped_unsubscribed_count >= 0
    and next_offset between 0 and eligible_count
    and pages_enqueued >= 0
    and jobs_enqueued between 0 and eligible_count
    and jobs_enqueued = next_offset
  ),
  constraint mailchimp_outbound_backfill_runs_page_size check (
    page_size between 1 and 500
  ),
  constraint mailchimp_outbound_backfill_runs_state check (
    state in (
      'previewed','approved','leased','executing','retry_wait',
      'succeeded','review','cancelled'
    )
  ),
  constraint mailchimp_outbound_backfill_runs_attempts check (
    attempt_count >= 0 and max_attempts between 1 and 20
    and attempt_count <= max_attempts and fencing_token >= 0
  ),
  constraint mailchimp_outbound_backfill_runs_lease check (
    (state in ('leased','executing')
      and lease_owner is not null and lease_expires_at is not null)
    or (state not in ('leased','executing')
      and lease_owner is null and lease_expires_at is null)
  ),
  constraint mailchimp_outbound_backfill_runs_approval check (
    (state = 'previewed'
      and approved_by_membership_id is null and approved_at is null
      and policy_id is null and policy_version is null)
    or (state <> 'previewed' and state <> 'cancelled'
      and approved_by_membership_id is not null and approved_at is not null
      and policy_id is not null and policy_version is not null
      and policy_version > 0)
    or (state = 'cancelled' and (
      (approved_by_membership_id is null and approved_at is null
        and policy_id is null and policy_version is null)
      or (approved_by_membership_id is not null and approved_at is not null
        and policy_id is not null and policy_version is not null
        and policy_version > 0)
    ))
  ),
  constraint mailchimp_outbound_backfill_runs_terminal check (
    (state in ('succeeded','review','cancelled') and completed_at is not null)
    or (state not in ('succeeded','review','cancelled') and completed_at is null)
  ),
  constraint mailchimp_outbound_backfill_runs_error check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create unique index mailchimp_outbound_backfill_one_active_per_connection_idx
  on public.mailchimp_outbound_backfill_runs (connection_id)
  where state in ('previewed','approved','leased','executing','retry_wait');
create index mailchimp_outbound_backfill_due_idx
  on public.mailchimp_outbound_backfill_runs (scheduled_at,previewed_at,id)
  where state in ('approved','retry_wait');
create index mailchimp_outbound_backfill_workspace_idx
  on public.mailchimp_outbound_backfill_runs (workspace_id,previewed_at desc,id);
create index mailchimp_outbound_backfill_lease_idx
  on public.mailchimp_outbound_backfill_runs (lease_expires_at,id)
  where lease_owner is not null;

create table connector_private.mailchimp_outbound_backfill_items (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete restrict,
  run_id            uuid not null,
  connection_id     uuid not null,
  binding_id        uuid not null,
  item_index        integer not null,
  contact_id        uuid not null,
  contact_point_id  uuid not null,
  member_link_id    uuid not null,
  subscriber_hash   text not null,
  lead_type         text not null,
  desired_tag       text not null,
  mapping_version   integer not null,
  operation_key     text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint mailchimp_outbound_backfill_items_id_workspace_unique
    unique (id, workspace_id),
  constraint mailchimp_outbound_backfill_items_run_index_unique
    unique (run_id, item_index),
  constraint mailchimp_outbound_backfill_items_run_operation_unique
    unique (run_id, operation_key),
  constraint mailchimp_outbound_backfill_items_run_workspace_fk
    foreign key (run_id, workspace_id)
    references public.mailchimp_outbound_backfill_runs (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_items_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_items_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_items_point_workspace_fk
    foreign key (contact_point_id, workspace_id, contact_id)
    references public.contact_points (id, workspace_id, contact_id) on delete restrict,
  constraint mailchimp_outbound_backfill_items_member_workspace_fk
    foreign key (member_link_id, workspace_id)
    references public.mailchimp_member_links (id, workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_items_index check (item_index >= 0),
  constraint mailchimp_outbound_backfill_items_hashes check (
    subscriber_hash ~ '^[0-9a-f]{32}$'
    and operation_key ~ '^[0-9a-f]{64}$'
  ),
  constraint mailchimp_outbound_backfill_items_mapping check (
    mapping_version > 0
    and lead_type in ('hot','warm','nurture')
    and desired_tag in ('Omnix: Hot','Omnix: Warm','Omnix: Nurture')
    and (
      (lead_type = 'hot' and desired_tag = 'Omnix: Hot')
      or (lead_type = 'warm' and desired_tag = 'Omnix: Warm')
      or (lead_type = 'nurture' and desired_tag = 'Omnix: Nurture')
    )
  )
);

create index mailchimp_outbound_backfill_items_page_idx
  on connector_private.mailchimp_outbound_backfill_items (run_id,item_index);

create table public.mailchimp_outbound_backfill_approvals (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces (id) on delete restrict,
  run_id                     uuid not null,
  connection_id              uuid not null,
  binding_id                 uuid not null,
  snapshot_hash              text not null,
  mapping_version            integer not null,
  item_count                 integer not null,
  policy_id                  uuid not null,
  policy_version             integer not null,
  actor_user_id              uuid not null references auth.users (id) on delete restrict,
  actor_membership_id        uuid not null,
  actor_role_snapshot        public.workspace_role not null,
  correlation_id             uuid not null,
  occurred_at                timestamptz not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint mailchimp_outbound_backfill_approvals_run_unique unique (run_id),
  constraint mailchimp_outbound_backfill_approvals_id_workspace_unique unique (id,workspace_id),
  constraint mailchimp_outbound_backfill_approvals_run_workspace_fk
    foreign key (run_id,workspace_id)
    references public.mailchimp_outbound_backfill_runs (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_approvals_connection_workspace_fk
    foreign key (connection_id,workspace_id)
    references public.connector_connections (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_approvals_binding_workspace_fk
    foreign key (binding_id,workspace_id)
    references public.mailchimp_audience_bindings (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_approvals_actor_workspace_fk
    foreign key (actor_membership_id,workspace_id)
    references public.workspace_members (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_approvals_policy_workspace_fk
    foreign key (policy_id,workspace_id)
    references public.connector_automation_policies (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_approvals_snapshot check (
    snapshot_hash ~ '^[0-9a-f]{64}$'
    and mapping_version > 0 and item_count >= 0 and policy_version > 0
    and actor_role_snapshot = 'owner'
  )
);

create table public.mailchimp_outbound_backfill_pages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete restrict,
  run_id          uuid not null,
  connection_id   uuid not null,
  binding_id      uuid not null,
  page_index      integer not null,
  offset_start    integer not null,
  item_count      integer not null,
  next_offset     integer not null,
  page_hash       text not null,
  jobs_created    integer not null,
  correlation_id  uuid not null,
  enqueued_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint mailchimp_outbound_backfill_pages_id_workspace_unique unique (id,workspace_id),
  constraint mailchimp_outbound_backfill_pages_run_page_unique unique (run_id,page_index),
  constraint mailchimp_outbound_backfill_pages_run_offset_unique unique (run_id,offset_start),
  constraint mailchimp_outbound_backfill_pages_run_workspace_fk
    foreign key (run_id,workspace_id)
    references public.mailchimp_outbound_backfill_runs (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_pages_connection_workspace_fk
    foreign key (connection_id,workspace_id)
    references public.connector_connections (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_pages_binding_workspace_fk
    foreign key (binding_id,workspace_id)
    references public.mailchimp_audience_bindings (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_pages_bounds check (
    page_index >= 0 and offset_start >= 0
    and item_count between 1 and 500
    and next_offset = offset_start + item_count
    and jobs_created = item_count
    and page_hash ~ '^[0-9a-f]{64}$'
  )
);

create index mailchimp_outbound_backfill_pages_workspace_idx
  on public.mailchimp_outbound_backfill_pages (workspace_id,enqueued_at desc,id);

create table public.mailchimp_outbound_backfill_job_links (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete restrict,
  run_id             uuid not null,
  item_index         integer not null,
  connection_id      uuid not null,
  intent_id          uuid not null,
  intent_version_id  uuid not null,
  job_id             uuid not null,
  operation_key      text not null,
  correlation_id     uuid not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint mailchimp_outbound_backfill_job_links_id_workspace_unique unique (id,workspace_id),
  constraint mailchimp_outbound_backfill_job_links_run_item_unique unique (run_id,item_index),
  constraint mailchimp_outbound_backfill_job_links_job_unique unique (job_id),
  constraint mailchimp_outbound_backfill_job_links_run_workspace_fk
    foreign key (run_id,workspace_id)
    references public.mailchimp_outbound_backfill_runs (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_job_links_connection_workspace_fk
    foreign key (connection_id,workspace_id)
    references public.connector_connections (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_job_links_intent_workspace_fk
    foreign key (intent_id,workspace_id)
    references public.connector_action_intents (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_job_links_version_workspace_fk
    foreign key (intent_version_id,workspace_id)
    references public.connector_action_intent_versions (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_job_links_job_workspace_fk
    foreign key (job_id,workspace_id)
    references public.connector_jobs (id,workspace_id) on delete restrict,
  constraint mailchimp_outbound_backfill_job_links_values check (
    item_index >= 0 and operation_key ~ '^[0-9a-f]{64}$'
  )
);

create index mailchimp_outbound_backfill_job_links_run_idx
  on public.mailchimp_outbound_backfill_job_links (run_id,item_index);

-- Canonical, private, deterministic current snapshot. The public preview only
-- exposes counts and the aggregate hash; subscriber identity remains private.
create or replace function connector_private.mailchimp_outbound_snapshot_rows(
  target_binding_id uuid
)
returns table (
  contact_id uuid,
  contact_point_id uuid,
  member_link_id uuid,
  subscriber_hash text,
  lead_type text,
  desired_tag text,
  mapping_version integer,
  operation_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    contact.id,
    point.id,
    member.id,
    member.subscriber_hash,
    contact.lead_type::text,
    case contact.lead_type::text
      when 'hot' then 'Omnix: Hot'
      when 'warm' then 'Omnix: Warm'
      else 'Omnix: Nurture'
    end,
    binding.mapping_version,
    encode(extensions.digest(pg_catalog.convert_to(
      '{"audienceId":' || to_jsonb(binding.audience_external_id)::text
      || ',"desiredTag":' || to_jsonb(case contact.lead_type::text
        when 'hot' then 'Omnix: Hot'
        when 'warm' then 'Omnix: Warm'
        else 'Omnix: Nurture' end)::text
      || ',"mappingVersion":' || binding.mapping_version::text
      || ',"subscriberHash":' || to_jsonb(member.subscriber_hash)::text || '}',
      'UTF8'
    ),'sha256'),'hex')
  from public.mailchimp_audience_bindings binding
  join public.mailchimp_member_links member
    on member.binding_id = binding.id
   and member.workspace_id = binding.workspace_id
   and member.connection_id = binding.connection_id
  join public.contacts contact
    on contact.id = member.contact_id
   and contact.workspace_id = member.workspace_id
  join public.contact_points point
    on point.id = member.contact_point_id
   and point.workspace_id = member.workspace_id
   and point.contact_id = member.contact_id
  left join public.mailchimp_subscription_authority authority
    on authority.member_link_id = member.id
   and authority.workspace_id = member.workspace_id
  where binding.id = target_binding_id
    and binding.replaced_at is null
    and contact.archived_at is null
    and point.type = 'email'
    and point.archived_at is null
    and point.email_subscribed is true
    and member.subscriber_hash = encode(extensions.digest(
      pg_catalog.convert_to(point.normalized_value,'UTF8'),'md5'
    ),'hex')
    and coalesce(authority.resubscribe_requires_consent,false) is false
    and coalesce(authority.provider_status,'subscribed') not in ('unsubscribed','cleaned','archived')
  order by member.subscriber_hash,contact.id,point.id;
$$;

create or replace function connector_private.mailchimp_outbound_snapshot_hash(
  target_binding_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(pg_catalog.convert_to(
    coalesce((jsonb_agg(jsonb_build_object(
      'audienceId',binding.audience_external_id,
      'desiredTag',snapshot.desired_tag,
      'mappingVersion',snapshot.mapping_version,
      'operationKey',snapshot.operation_key,
      'subscriberHash',snapshot.subscriber_hash
    ) order by snapshot.subscriber_hash,snapshot.contact_id,snapshot.contact_point_id)
      filter (where snapshot.operation_key is not null))::text,'[]'),
    'UTF8'
  ),'sha256'),'hex')
  from public.mailchimp_audience_bindings binding
  left join connector_private.mailchimp_outbound_snapshot_rows(binding.id) snapshot on true
  where binding.id = target_binding_id
  group by binding.id;
$$;

revoke all on function connector_private.mailchimp_outbound_snapshot_rows(uuid)
  from public,anon,authenticated,service_role;
revoke all on function connector_private.mailchimp_outbound_snapshot_hash(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.prepare_mailchimp_outbound_backfill_run_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id or new.binding_id <> old.binding_id
     or new.mode <> old.mode or new.mapping_version <> old.mapping_version
     or new.snapshot_hash <> old.snapshot_hash or new.request_key_hash <> old.request_key_hash
     or new.eligible_count <> old.eligible_count
     or new.skipped_unlinked_count <> old.skipped_unlinked_count
     or new.skipped_unsubscribed_count <> old.skipped_unsubscribed_count
     or new.page_size <> old.page_size or new.max_attempts <> old.max_attempts
     or new.request_origin <> old.request_origin
     or new.requested_by_membership_id is distinct from old.requested_by_membership_id
     or new.correlation_id <> old.correlation_id or new.previewed_at <> old.previewed_at
     or new.created_at <> old.created_at then
    raise exception 'Mailchimp outbound snapshot authority is immutable'
      using errcode='55000';
  end if;
  if new.next_offset < old.next_offset or new.pages_enqueued < old.pages_enqueued
     or new.jobs_enqueued < old.jobs_enqueued or new.attempt_count < old.attempt_count
     or new.fencing_token < old.fencing_token then
    raise exception 'Mailchimp outbound backfill progress cannot move backward'
      using errcode='55000';
  end if;
  if new.state <> old.state and not (
    (old.state='previewed' and new.state in ('approved','cancelled'))
    or (old.state in ('approved','retry_wait') and new.state in ('leased','review','cancelled'))
    or (old.state='leased' and new.state in ('executing','retry_wait','review','cancelled'))
    or (old.state='executing' and new.state in ('retry_wait','succeeded','review','cancelled'))
  ) then
    raise exception 'invalid Mailchimp outbound backfill transition: % -> %',old.state,new.state
      using errcode='23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger mailchimp_outbound_backfill_runs_prepare_update
before update on public.mailchimp_outbound_backfill_runs
for each row execute function public.prepare_mailchimp_outbound_backfill_run_update();
create trigger mailchimp_outbound_backfill_runs_guard_delete
before delete on public.mailchimp_outbound_backfill_runs
for each row execute function public.guard_connector_append_only();
create trigger mailchimp_outbound_backfill_items_guard_mutation
before update or delete on connector_private.mailchimp_outbound_backfill_items
for each row execute function public.guard_connector_append_only();
create trigger mailchimp_outbound_backfill_approvals_guard_mutation
before update or delete on public.mailchimp_outbound_backfill_approvals
for each row execute function public.guard_connector_append_only();
create trigger mailchimp_outbound_backfill_pages_guard_mutation
before update or delete on public.mailchimp_outbound_backfill_pages
for each row execute function public.guard_connector_append_only();
create trigger mailchimp_outbound_backfill_job_links_guard_mutation
before update or delete on public.mailchimp_outbound_backfill_job_links
for each row execute function public.guard_connector_append_only();

alter table public.mailchimp_outbound_backfill_runs enable row level security;
alter table public.mailchimp_outbound_backfill_runs force row level security;
alter table public.mailchimp_outbound_backfill_approvals enable row level security;
alter table public.mailchimp_outbound_backfill_approvals force row level security;
alter table public.mailchimp_outbound_backfill_pages enable row level security;
alter table public.mailchimp_outbound_backfill_pages force row level security;
alter table public.mailchimp_outbound_backfill_job_links enable row level security;
alter table public.mailchimp_outbound_backfill_job_links force row level security;

create policy mailchimp_outbound_backfill_runs_member_select
on public.mailchimp_outbound_backfill_runs for select to authenticated
using (public.has_workspace_access(workspace_id));
create policy mailchimp_outbound_backfill_approvals_member_select
on public.mailchimp_outbound_backfill_approvals for select to authenticated
using (public.has_workspace_access(workspace_id));
create policy mailchimp_outbound_backfill_pages_member_select
on public.mailchimp_outbound_backfill_pages for select to authenticated
using (public.has_workspace_access(workspace_id));
create policy mailchimp_outbound_backfill_job_links_member_select
on public.mailchimp_outbound_backfill_job_links for select to authenticated
using (public.has_workspace_access(workspace_id));

revoke all on table connector_private.mailchimp_outbound_backfill_items
  from public,anon,authenticated,service_role;
revoke all on table public.mailchimp_outbound_backfill_runs
  from anon,authenticated,service_role;
revoke all on table public.mailchimp_outbound_backfill_approvals
  from anon,authenticated,service_role;
revoke all on table public.mailchimp_outbound_backfill_pages
  from anon,authenticated,service_role;
revoke all on table public.mailchimp_outbound_backfill_job_links
  from anon,authenticated,service_role;
grant select on table public.mailchimp_outbound_backfill_runs
  to authenticated,service_role;
grant select on table public.mailchimp_outbound_backfill_approvals
  to authenticated,service_role;
grant select on table public.mailchimp_outbound_backfill_pages
  to authenticated,service_role;
grant select on table public.mailchimp_outbound_backfill_job_links
  to authenticated,service_role;

create or replace function public.preview_mailchimp_outbound_backfill(
  target_connection_id uuid,
  target_mode text,
  target_request_key_hash text,
  target_page_size integer,
  target_correlation_id uuid,
  target_previewed_at timestamptz,
  target_max_attempts integer default 10
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
  target_run public.mailchimp_outbound_backfill_runs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  current_snapshot_hash text;
  current_eligible integer;
  current_candidate_count integer;
  current_linked integer;
  current_unsubscribed integer;
begin
  if target_connection_id is null or target_mode not in ('backfill','tag-reconcile')
     or target_request_key_hash !~ '^[0-9a-f]{64}$'
     or target_page_size not between 1 and 500
     or target_correlation_id is null or target_previewed_at is null
     or target_max_attempts not between 1 and 20 then
    raise exception 'invalid Mailchimp outbound preview request' using errcode='22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='mailchimp'
  for update;
  if not found then
    raise exception 'Mailchimp connection not found' using errcode='P0002';
  end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  if target_connection.status not in ('active','degraded') then
    raise exception 'active Mailchimp connection required' using errcode='23514';
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_connection.id
    and binding.workspace_id=target_connection.workspace_id
    and binding.replaced_at is null
  for update;
  if not found then
    raise exception 'selected Mailchimp audience required' using errcode='P0002';
  end if;
  if target_binding.baseline_required or target_binding.webhook_registration_required then
    raise exception 'Mailchimp baseline and webhook readiness required' using errcode='23514';
  end if;

  current_snapshot_hash:=connector_private.mailchimp_outbound_snapshot_hash(target_binding.id);
  select count(*)::integer into current_eligible
  from connector_private.mailchimp_outbound_snapshot_rows(target_binding.id);
  select count(*)::integer into current_candidate_count
  from public.contacts contact
  join public.contact_points point
    on point.contact_id=contact.id and point.workspace_id=contact.workspace_id
  where contact.workspace_id=target_binding.workspace_id
    and contact.archived_at is null and point.type='email'
    and point.archived_at is null and point.email_subscribed is true;
  select count(*)::integer into current_linked
  from public.contacts contact
  join public.contact_points point
    on point.contact_id=contact.id and point.workspace_id=contact.workspace_id
  join public.mailchimp_member_links member
    on member.contact_id=contact.id and member.contact_point_id=point.id
   and member.workspace_id=contact.workspace_id and member.binding_id=target_binding.id
  where contact.workspace_id=target_binding.workspace_id
    and contact.archived_at is null and point.type='email'
    and point.archived_at is null and point.email_subscribed is true;
  select count(*)::integer into current_unsubscribed
  from public.mailchimp_member_links member
  join public.contacts contact
    on contact.id=member.contact_id and contact.workspace_id=member.workspace_id
  join public.contact_points point
    on point.id=member.contact_point_id and point.workspace_id=member.workspace_id
   and point.contact_id=member.contact_id
  join public.mailchimp_subscription_authority authority
    on authority.member_link_id=member.id and authority.workspace_id=member.workspace_id
  where member.binding_id=target_binding.id
    and contact.archived_at is null and point.archived_at is null
    and point.type='email' and point.email_subscribed is true
    and (authority.resubscribe_requires_consent
      or authority.provider_status in ('unsubscribed','cleaned','archived'));

  select run.* into target_run
  from public.mailchimp_outbound_backfill_runs run
  where run.connection_id=target_connection.id
    and run.request_key_hash=target_request_key_hash
  for update;
  if found then
    if target_run.binding_id<>target_binding.id or target_run.mode<>target_mode
       or target_run.mapping_version<>target_binding.mapping_version
       or target_run.snapshot_hash<>current_snapshot_hash
       or target_run.eligible_count<>current_eligible
       or target_run.page_size<>target_page_size
       or target_run.max_attempts<>target_max_attempts then
      raise exception 'Mailchimp outbound preview replay conflicts with current snapshot'
        using errcode='23505';
    end if;
    select receipt.* into target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id=target_run.workspace_id
      and receipt.event_key='mailchimp.backfill.previewed:'||target_run.id::text;
    return jsonb_build_object(
      'preview',jsonb_build_object(
        'runId',target_run.id,'workspaceId',target_run.workspace_id,
        'connectionId',target_run.connection_id,'bindingId',target_run.binding_id,
        'mode',target_run.mode,'mappingVersion',target_run.mapping_version,
        'snapshotHash',target_run.snapshot_hash,'eligibleCount',target_run.eligible_count,
        'skippedUnlinkedCount',target_run.skipped_unlinked_count,
        'skippedUnsubscribedCount',target_run.skipped_unsubscribed_count,
        'pageSize',target_run.page_size,'containsRawEmails',false
      ),'run',to_jsonb(target_run),'receipt',to_jsonb(target_receipt),'noOp',true
    );
  end if;

  if exists (
    select 1 from public.mailchimp_outbound_backfill_runs run
    where run.connection_id=target_connection.id
      and run.state in ('previewed','approved','leased','executing','retry_wait')
  ) then
    raise exception 'another Mailchimp outbound backfill is active' using errcode='23505';
  end if;

  insert into public.mailchimp_outbound_backfill_runs (
    workspace_id,connection_id,binding_id,mode,mapping_version,
    snapshot_hash,request_key_hash,eligible_count,skipped_unlinked_count,
    skipped_unsubscribed_count,page_size,state,scheduled_at,max_attempts,
    request_origin,requested_by_membership_id,correlation_id,previewed_at
  ) values (
    target_binding.workspace_id,target_binding.connection_id,target_binding.id,
    target_mode,target_binding.mapping_version,current_snapshot_hash,
    target_request_key_hash,current_eligible,greatest(0,current_candidate_count-current_linked),
    current_unsubscribed,target_page_size,'previewed',target_previewed_at,
    target_max_attempts,'owner',actor.id,target_correlation_id,target_previewed_at
  ) returning * into target_run;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp','sync.applied',
    'mailchimp.backfill.previewed:'||target_run.id::text,target_run.correlation_id,
    target_run.snapshot_hash,jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,'mode',target_run.mode,
      'mappingVersion',target_run.mapping_version,'eligibleCount',target_run.eligible_count,
      'skippedUnlinkedCount',target_run.skipped_unlinked_count,
      'skippedUnsubscribedCount',target_run.skipped_unsubscribed_count,
      'containsRawEmails',false
    ),target_previewed_at
  ) returning * into target_receipt;

  return jsonb_build_object(
    'preview',jsonb_build_object(
      'runId',target_run.id,'workspaceId',target_run.workspace_id,
      'connectionId',target_run.connection_id,'bindingId',target_run.binding_id,
      'mode',target_run.mode,'mappingVersion',target_run.mapping_version,
      'snapshotHash',target_run.snapshot_hash,'eligibleCount',target_run.eligible_count,
      'skippedUnlinkedCount',target_run.skipped_unlinked_count,
      'skippedUnsubscribedCount',target_run.skipped_unsubscribed_count,
      'pageSize',target_run.page_size,'containsRawEmails',false
    ),'run',to_jsonb(target_run),'receipt',to_jsonb(target_receipt),'noOp',false
  );
end;
$$;

create or replace function public.schedule_due_mailchimp_outbound_backfill_runs(
  target_now timestamptz,
  target_interval_seconds integer,
  target_limit integer default 25
)
returns setof public.mailchimp_outbound_backfill_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  scheduled_run public.mailchimp_outbound_backfill_runs%rowtype;
  current_snapshot_hash text;
  current_eligible integer;
  current_candidate_count integer;
  current_linked integer;
  current_unsubscribed integer;
  request_material text;
  request_hash text;
  correlation_uuid uuid;
begin
  if target_now is null or target_interval_seconds not between 3600 and 2678400
     or target_limit not between 1 and 100 then
    raise exception 'invalid Mailchimp tag-reconciliation schedule request' using errcode='22023';
  end if;
  for candidate in
    select binding.*
    from public.mailchimp_audience_bindings binding
    join public.connector_connections connection
      on connection.id=binding.connection_id and connection.workspace_id=binding.workspace_id
    where binding.replaced_at is null and not binding.baseline_required
      and not binding.webhook_registration_required
      and connection.provider='mailchimp' and connection.status in ('active','degraded')
      and not exists (
        select 1 from public.mailchimp_outbound_backfill_runs active_run
        where active_run.connection_id=binding.connection_id
          and active_run.state in ('previewed','approved','leased','executing','retry_wait')
      )
      and coalesce((
        select max(prior.previewed_at)
        from public.mailchimp_outbound_backfill_runs prior
        where prior.connection_id=binding.connection_id and prior.mode='tag-reconcile'
      ),'-infinity'::timestamptz)<=target_now-make_interval(secs=>target_interval_seconds)
    order by binding.selected_at,binding.id
    for update of binding skip locked limit target_limit
  loop
    current_snapshot_hash:=connector_private.mailchimp_outbound_snapshot_hash(candidate.id);
    select count(*)::integer into current_eligible
    from connector_private.mailchimp_outbound_snapshot_rows(candidate.id);
    select count(*)::integer into current_candidate_count
    from public.contacts contact
    join public.contact_points point
      on point.contact_id=contact.id and point.workspace_id=contact.workspace_id
    where contact.workspace_id=candidate.workspace_id and contact.archived_at is null
      and point.type='email' and point.archived_at is null and point.email_subscribed is true;
    select count(*)::integer into current_linked
    from public.contacts contact
    join public.contact_points point
      on point.contact_id=contact.id and point.workspace_id=contact.workspace_id
    join public.mailchimp_member_links member
      on member.contact_id=contact.id and member.contact_point_id=point.id
     and member.workspace_id=contact.workspace_id and member.binding_id=candidate.id
    where contact.workspace_id=candidate.workspace_id and contact.archived_at is null
      and point.type='email' and point.archived_at is null and point.email_subscribed is true;
    select count(*)::integer into current_unsubscribed
    from public.mailchimp_member_links member
    join public.contacts contact
      on contact.id=member.contact_id and contact.workspace_id=member.workspace_id
    join public.contact_points point
      on point.id=member.contact_point_id and point.workspace_id=member.workspace_id
     and point.contact_id=member.contact_id
    join public.mailchimp_subscription_authority authority
      on authority.member_link_id=member.id and authority.workspace_id=member.workspace_id
    where member.binding_id=candidate.id and contact.archived_at is null
      and point.type='email' and point.archived_at is null and point.email_subscribed is true
      and (authority.resubscribe_requires_consent
        or authority.provider_status in ('unsubscribed','cleaned','archived'));
    request_material:='mailchimp.tag-reconcile.schedule|'||candidate.connection_id::text
      ||'|'||candidate.id::text||'|'||current_snapshot_hash||'|'
      ||candidate.mapping_version::text||'|'||extract(epoch from target_now)::bigint::text;
    request_hash:=encode(extensions.digest(pg_catalog.convert_to(request_material,'UTF8'),'sha256'),'hex');
    correlation_uuid:=(substr(md5(request_material),1,8)||'-'||substr(md5(request_material),9,4)
      ||'-4'||substr(md5(request_material),14,3)||'-a'||substr(md5(request_material),18,3)
      ||'-'||substr(md5(request_material),21,12))::uuid;
    insert into public.mailchimp_outbound_backfill_runs (
      workspace_id,connection_id,binding_id,mode,mapping_version,snapshot_hash,
      request_key_hash,eligible_count,skipped_unlinked_count,
      skipped_unsubscribed_count,page_size,state,scheduled_at,max_attempts,
      request_origin,requested_by_membership_id,correlation_id,previewed_at
    ) values (
      candidate.workspace_id,candidate.connection_id,candidate.id,'tag-reconcile',
      candidate.mapping_version,current_snapshot_hash,request_hash,current_eligible,
      greatest(0,current_candidate_count-current_linked),current_unsubscribed,
      100,'previewed',target_now,10,'scheduler',null,correlation_uuid,target_now
    ) returning * into scheduled_run;
    insert into public.connector_receipt_events (
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      provider_request_hash,redacted_metadata,occurred_at
    ) values (
      scheduled_run.workspace_id,scheduled_run.connection_id,'mailchimp','sync.applied',
      'mailchimp.backfill.previewed:'||scheduled_run.id::text,scheduled_run.correlation_id,
      scheduled_run.snapshot_hash,jsonb_build_object(
        'runId',scheduled_run.id,'bindingId',scheduled_run.binding_id,
        'mode','tag-reconcile','requestOrigin','scheduler',
        'mappingVersion',scheduled_run.mapping_version,
        'eligibleCount',scheduled_run.eligible_count,
        'skippedUnlinkedCount',scheduled_run.skipped_unlinked_count,
        'skippedUnsubscribedCount',scheduled_run.skipped_unsubscribed_count,
        'containsRawEmails',false,'approvalRequired',true
      ),target_now
    );
    return next scheduled_run;
  end loop;
  return;
end;
$$;

create or replace function public.approve_mailchimp_outbound_backfill(
  target_run_id uuid,
  target_expected_snapshot_hash text,
  target_expected_mapping_version integer,
  target_correlation_id uuid,
  target_approved_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_run public.mailchimp_outbound_backfill_runs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_policy public.connector_automation_policies%rowtype;
  target_approval public.mailchimp_outbound_backfill_approvals%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  current_snapshot_hash text;
  current_count integer;
begin
  if target_run_id is null or target_expected_snapshot_hash !~ '^[0-9a-f]{64}$'
     or target_expected_mapping_version<1 or target_correlation_id is null
     or target_approved_at is null then
    raise exception 'invalid Mailchimp outbound approval' using errcode='22023';
  end if;
  select run.* into target_run from public.mailchimp_outbound_backfill_runs run
  where run.id=target_run_id for update;
  if not found then raise exception 'Mailchimp outbound preview not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_run.workspace_id,true);

  if target_run.state<>'previewed' then
    select approval.* into target_approval
    from public.mailchimp_outbound_backfill_approvals approval where approval.run_id=target_run.id;
    if target_approval.id is null
       or target_approval.snapshot_hash<>target_expected_snapshot_hash
       or target_approval.mapping_version<>target_expected_mapping_version then
      raise exception 'Mailchimp outbound approval replay conflicts' using errcode='23505';
    end if;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_run.workspace_id
      and receipt.event_key='mailchimp.backfill.approved:'||target_run.id::text;
    return jsonb_build_object('run',to_jsonb(target_run),'approval',to_jsonb(target_approval),
      'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  join public.connector_connections connection
    on connection.id=binding.connection_id and connection.workspace_id=binding.workspace_id
  where binding.id=target_run.binding_id and binding.workspace_id=target_run.workspace_id
    and binding.connection_id=target_run.connection_id and binding.replaced_at is null
    and not binding.baseline_required and not binding.webhook_registration_required
    and connection.provider='mailchimp' and connection.status in ('active','degraded')
  for update of binding;
  if not found then raise exception 'current ready Mailchimp audience required' using errcode='42501'; end if;

  current_snapshot_hash:=connector_private.mailchimp_outbound_snapshot_hash(target_binding.id);
  select count(*)::integer into current_count
  from connector_private.mailchimp_outbound_snapshot_rows(target_binding.id);
  if target_expected_snapshot_hash<>target_run.snapshot_hash
     or target_expected_mapping_version<>target_run.mapping_version
     or current_snapshot_hash<>target_run.snapshot_hash
     or current_count<>target_run.eligible_count
     or target_binding.mapping_version<>target_run.mapping_version then
    raise exception 'Mailchimp outbound snapshot changed; preview again' using errcode='40001';
  end if;

  perform public.ensure_mailchimp_sync_policy(
    target_run.workspace_id,target_correlation_id,target_approved_at
  );
  select policy.* into target_policy
  from public.connector_automation_policies policy
  where policy.workspace_id=target_run.workspace_id
    and policy.action_type='audience.sync' and policy.version=target_run.mapping_version
    and policy.approval_mode='owner_required'
    and policy.allowlisted_actions=array['audience.sync']::text[];
  if not found then raise exception 'canonical Mailchimp sync policy required' using errcode='23503'; end if;

  insert into connector_private.mailchimp_outbound_backfill_items (
    workspace_id,run_id,connection_id,binding_id,item_index,contact_id,
    contact_point_id,member_link_id,subscriber_hash,lead_type,desired_tag,
    mapping_version,operation_key,created_at,updated_at
  )
  select target_run.workspace_id,target_run.id,target_run.connection_id,target_run.binding_id,
    row_number() over(order by snapshot.subscriber_hash,snapshot.contact_id,snapshot.contact_point_id)-1,
    snapshot.contact_id,snapshot.contact_point_id,snapshot.member_link_id,
    snapshot.subscriber_hash,snapshot.lead_type,snapshot.desired_tag,
    snapshot.mapping_version,snapshot.operation_key,target_approved_at,target_approved_at
  from connector_private.mailchimp_outbound_snapshot_rows(target_binding.id) snapshot;

  insert into public.mailchimp_outbound_backfill_approvals (
    workspace_id,run_id,connection_id,binding_id,snapshot_hash,mapping_version,
    item_count,policy_id,policy_version,actor_user_id,actor_membership_id,
    actor_role_snapshot,correlation_id,occurred_at
  ) values (
    target_run.workspace_id,target_run.id,target_run.connection_id,target_run.binding_id,
    target_run.snapshot_hash,target_run.mapping_version,target_run.eligible_count,
    target_policy.id,target_policy.version,actor.user_id,actor.id,actor.role,
    target_correlation_id,target_approved_at
  ) returning * into target_approval;

  update public.mailchimp_outbound_backfill_runs
     set state='approved',policy_id=target_policy.id,policy_version=target_policy.version,
         approved_by_membership_id=actor.id,approved_at=target_approved_at,
         scheduled_at=target_approved_at
   where id=target_run.id returning * into target_run;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp','intent.approved',
    'mailchimp.backfill.approved:'||target_run.id::text,target_correlation_id,
    target_run.snapshot_hash,jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,'mode',target_run.mode,
      'mappingVersion',target_run.mapping_version,'itemCount',target_run.eligible_count,
      'policyId',target_policy.id,'policyVersion',target_policy.version,
      'actorMembershipId',actor.id
    ),target_approved_at
  ) returning * into target_receipt;
  return jsonb_build_object('run',to_jsonb(target_run),'approval',to_jsonb(target_approval),
    'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.claim_mailchimp_outbound_backfill_runs(
  target_worker_id uuid,
  target_batch_size integer default 5,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns setof public.mailchimp_outbound_backfill_runs
language plpgsql
security definer
set search_path = ''
as $$
declare candidate record; claimed public.mailchimp_outbound_backfill_runs%rowtype;
begin
  if target_worker_id is null or target_now is null
     or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid Mailchimp outbound claim' using errcode='22023';
  end if;
  update public.mailchimp_outbound_backfill_runs
     set state=case when attempt_count>=max_attempts then 'review' else 'retry_wait' end,
         scheduled_at=case when attempt_count>=max_attempts then scheduled_at else target_now end,
         lease_owner=null,lease_expires_at=null,
         completed_at=case when attempt_count>=max_attempts then target_now else null end,
         last_error_category=case when attempt_count>=max_attempts
           then 'attempts_exhausted' else 'lease_expired' end
   where state in ('leased','executing') and lease_expires_at<=target_now;
  for candidate in
    select run.id from public.mailchimp_outbound_backfill_runs run
    join public.mailchimp_audience_bindings binding
      on binding.id=run.binding_id and binding.workspace_id=run.workspace_id
     and binding.connection_id=run.connection_id and binding.replaced_at is null
    join public.connector_connections connection
      on connection.id=run.connection_id and connection.workspace_id=run.workspace_id
    where run.state in ('approved','retry_wait') and run.scheduled_at<=target_now
      and run.attempt_count<run.max_attempts and connection.provider='mailchimp'
      and connection.status in ('active','degraded')
    order by run.scheduled_at,run.previewed_at,run.id
    for update of run skip locked limit target_batch_size
  loop
    update public.mailchimp_outbound_backfill_runs
       set state='leased',lease_owner=target_worker_id,
           lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),
           fencing_token=fencing_token+1,last_error_category=null
     where id=candidate.id returning * into claimed;
    return next claimed;
  end loop;
  return;
end;
$$;

create or replace function public.start_mailchimp_outbound_backfill_run(
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
declare target_run public.mailchimp_outbound_backfill_runs%rowtype;
begin
  update public.mailchimp_outbound_backfill_runs
     set state='executing',attempt_count=attempt_count+1
   where id=target_run_id and state='leased' and lease_owner=target_worker_id
     and fencing_token=target_fencing_token and lease_expires_at>target_started_at
     and attempt_count<max_attempts
  returning * into target_run;
  if not found then raise exception 'active Mailchimp outbound lease required' using errcode='40001'; end if;
  return jsonb_build_object('run',to_jsonb(target_run),'noOp',false);
end;
$$;

create or replace function public.read_mailchimp_outbound_backfill_page(
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
  target_run public.mailchimp_outbound_backfill_runs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  page_items jsonb;
  page_hash text;
begin
  select run.* into target_run from public.mailchimp_outbound_backfill_runs run
  where run.id=target_run_id and run.state='executing'
    and run.lease_owner=target_worker_id and run.fencing_token=target_fencing_token
    and run.lease_expires_at>target_now;
  if not found then raise exception 'executing Mailchimp outbound lease required' using errcode='42501'; end if;
  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  join public.connector_connections connection
    on connection.id=binding.connection_id and connection.workspace_id=binding.workspace_id
  where binding.id=target_run.binding_id and binding.replaced_at is null
    and binding.connection_id=target_run.connection_id
    and binding.mapping_version=target_run.mapping_version
    and connection.provider='mailchimp' and connection.status in ('active','degraded');
  if not found then raise exception 'current Mailchimp audience authority required' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemIndex',item.item_index,'operation',jsonb_build_object(
      'audienceId',target_binding.audience_external_id,
      'subscriberHash',item.subscriber_hash,'desiredTag',item.desired_tag,
      'mappingVersion',item.mapping_version,'operationKey',item.operation_key
    )
  ) order by item.item_index),'[]'::jsonb) into page_items
  from connector_private.mailchimp_outbound_backfill_items item
  where item.run_id=target_run.id and item.workspace_id=target_run.workspace_id
    and item.item_index>=target_run.next_offset
    and item.item_index<least(target_run.next_offset+target_run.page_size,target_run.eligible_count);
  if jsonb_array_length(page_items)<>least(target_run.page_size,target_run.eligible_count-target_run.next_offset) then
    raise exception 'Mailchimp outbound frozen page is incomplete' using errcode='23514';
  end if;
  page_hash:=encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object('runId',target_run.id,'offset',target_run.next_offset,
      'items',page_items)::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object(
    'run',jsonb_build_object(
      'runId',target_run.id,'workspaceId',target_run.workspace_id,
      'connectionId',target_run.connection_id,'bindingId',target_run.binding_id,
      'mode',target_run.mode,'snapshotHash',target_run.snapshot_hash,
      'mappingVersion',target_run.mapping_version,'pageSize',target_run.page_size,
      'eligibleCount',target_run.eligible_count,'nextOffset',target_run.next_offset,
      'fencingToken',target_run.fencing_token,'leaseExpiresAt',target_run.lease_expires_at
    ),
    'binding',jsonb_build_object(
      'connectionId',target_binding.connection_id,'workspaceId',target_binding.workspace_id,
      'bindingId',target_binding.id,'dataCenter',target_binding.data_center,
      'audienceId',target_binding.audience_external_id,
      'accountIdHash',target_binding.account_id_hash,
      'mappingVersion',target_binding.mapping_version
    ),
    'offset',target_run.next_offset,'items',page_items,'pageHash',page_hash,
    'finalPage',target_run.next_offset+jsonb_array_length(page_items)=target_run.eligible_count
  );
end;
$$;

create or replace function public.enqueue_mailchimp_outbound_backfill_page(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_expected_offset integer,
  target_page_hash text,
  target_envelopes jsonb,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_outbound_backfill_runs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_approval public.mailchimp_outbound_backfill_approvals%rowtype;
  target_page public.mailchimp_outbound_backfill_pages%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  item connector_private.mailchimp_outbound_backfill_items%rowtype;
  envelope jsonb;
  page_items jsonb;
  computed_page_hash text;
  page_count integer;
  page_position integer := 0;
  payload_row connector_private.connector_payload_envelopes%rowtype;
  intent_row public.connector_action_intents%rowtype;
  version_row public.connector_action_intent_versions%rowtype;
  job_row public.connector_jobs%rowtype;
  job_ids jsonb := '[]'::jsonb;
begin
  if target_run_id is null or target_worker_id is null or target_fencing_token is null
     or target_expected_offset<0 or target_page_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(target_envelopes)<>'array' or target_occurred_at is null then
    raise exception 'invalid Mailchimp outbound page enqueue' using errcode='22023';
  end if;
  select run.* into target_run from public.mailchimp_outbound_backfill_runs run
  where run.id=target_run_id for update;
  if not found then raise exception 'Mailchimp outbound run not found' using errcode='P0002'; end if;
  if target_run.state<>'executing' or target_run.lease_owner<>target_worker_id
     or target_run.fencing_token<>target_fencing_token
     or target_run.lease_expires_at<=target_occurred_at then
    raise exception 'executing Mailchimp outbound lease required' using errcode='40001';
  end if;
  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  join public.connector_connections connection
    on connection.id=binding.connection_id and connection.workspace_id=binding.workspace_id
  where binding.id=target_run.binding_id and binding.workspace_id=target_run.workspace_id
    and binding.connection_id=target_run.connection_id and binding.replaced_at is null
    and binding.mapping_version=target_run.mapping_version
    and connection.provider='mailchimp' and connection.status in ('active','degraded');
  if not found then raise exception 'current Mailchimp audience authority required' using errcode='42501'; end if;
  select approval.* into target_approval
  from public.mailchimp_outbound_backfill_approvals approval
  where approval.run_id=target_run.id and approval.workspace_id=target_run.workspace_id;
  if not found or target_approval.snapshot_hash<>target_run.snapshot_hash
     or target_approval.mapping_version<>target_run.mapping_version
     or target_approval.item_count<>target_run.eligible_count
     or target_approval.policy_id<>target_run.policy_id
     or target_approval.policy_version<>target_run.policy_version then
    raise exception 'exact Mailchimp owner approval required' using errcode='42501';
  end if;

  select page.* into target_page
  from public.mailchimp_outbound_backfill_pages page
  where page.run_id=target_run.id and page.offset_start=target_expected_offset;
  if found then
    if target_page.page_hash<>target_page_hash then
      raise exception 'Mailchimp outbound page replay conflicts' using errcode='23505';
    end if;
    select coalesce(jsonb_agg(link.job_id order by link.item_index),'[]'::jsonb)
      into job_ids
    from public.mailchimp_outbound_backfill_job_links link
    where link.run_id=target_run.id
      and link.item_index between target_page.offset_start and target_page.next_offset-1;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_run.workspace_id
      and receipt.event_key='mailchimp.backfill.page:'||target_page.id::text;
    return jsonb_build_object('run',to_jsonb(target_run),'page',to_jsonb(target_page),
      'receipt',to_jsonb(target_receipt),'jobIds',job_ids,
      'finalPage',target_page.next_offset=target_run.eligible_count,'noOp',true);
  end if;

  if target_run.next_offset<>target_expected_offset or target_run.next_offset>=target_run.eligible_count then
    raise exception 'Mailchimp outbound page offset conflict' using errcode='40001';
  end if;
  page_count:=least(target_run.page_size,target_run.eligible_count-target_run.next_offset);
  if jsonb_array_length(target_envelopes)<>page_count then
    raise exception 'Mailchimp outbound encrypted page must be complete and bounded' using errcode='23514';
  end if;
  select jsonb_agg(jsonb_build_object(
    'itemIndex',frozen.item_index,'operation',jsonb_build_object(
      'audienceId',target_binding.audience_external_id,
      'subscriberHash',frozen.subscriber_hash,'desiredTag',frozen.desired_tag,
      'mappingVersion',frozen.mapping_version,'operationKey',frozen.operation_key
    )
  ) order by frozen.item_index) into page_items
  from connector_private.mailchimp_outbound_backfill_items frozen
  where frozen.run_id=target_run.id and frozen.workspace_id=target_run.workspace_id
    and frozen.item_index>=target_run.next_offset
    and frozen.item_index<target_run.next_offset+page_count;
  computed_page_hash:=encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object('runId',target_run.id,'offset',target_run.next_offset,
      'items',page_items)::text,'UTF8'),'sha256'),'hex');
  if computed_page_hash<>target_page_hash then
    raise exception 'Mailchimp outbound frozen page hash mismatch' using errcode='40001';
  end if;

  for item in
    select frozen.* from connector_private.mailchimp_outbound_backfill_items frozen
    where frozen.run_id=target_run.id and frozen.workspace_id=target_run.workspace_id
      and frozen.item_index>=target_run.next_offset
      and frozen.item_index<target_run.next_offset+page_count
    order by frozen.item_index
  loop
    envelope:=target_envelopes->page_position;
    if jsonb_typeof(envelope)<>'object'
       or not (envelope ?& array['itemIndex','operationKey','ciphertext','nonce','authTag',
         'wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash'])
       or (select count(*) from jsonb_object_keys(envelope))<>10
       or (envelope->>'itemIndex') !~ '^[0-9]+$'
       or (envelope->>'itemIndex')::integer<>item.item_index
       or envelope->>'operationKey'<>item.operation_key
       or envelope->>'aadHash' !~ '^[0-9a-f]{64}$'
       or envelope->>'kekVersion' !~ '^[A-Za-z0-9_.-]{1,64}$' then
      raise exception 'Mailchimp outbound envelope binding is invalid' using errcode='22023';
    end if;

    insert into connector_private.connector_payload_envelopes (
      workspace_id,connection_id,payload_kind,schema_version,canonical_hash,
      ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,
      kek_version,aad_hash,created_at,updated_at
    ) values (
      target_run.workspace_id,target_run.connection_id,'audience.sync',
      'mailchimp-member-operation.v1',item.operation_key,
      decode(envelope->>'ciphertext','base64'),decode(envelope->>'nonce','base64'),
      decode(envelope->>'authTag','base64'),decode(envelope->>'wrappedDek','base64'),
      decode(envelope->>'wrapNonce','base64'),decode(envelope->>'wrapAuthTag','base64'),
      envelope->>'kekVersion',envelope->>'aadHash',target_occurred_at,target_occurred_at
    ) returning * into payload_row;

    insert into public.connector_action_intents (
      workspace_id,connection_id,provider,action_type,summary,state,current_version,
      created_by_membership_id,correlation_id,created_at,updated_at
    ) values (
      target_run.workspace_id,target_run.connection_id,'mailchimp','audience.sync',
      'Synchronize one owner-approved Mailchimp contact tag.','queued',1,
      target_approval.actor_membership_id,target_run.correlation_id,
      target_occurred_at,target_occurred_at
    ) returning * into intent_row;

    insert into public.connector_action_intent_versions (
      workspace_id,intent_id,version,connection_id,action_type,payload_ref,payload_hash,
      policy_id,policy_version,compliance_snapshot,created_by_membership_id,
      correlation_id,created_at
    ) values (
      target_run.workspace_id,intent_row.id,1,target_run.connection_id,'audience.sync',
      payload_row.id,item.operation_key,target_run.policy_id,target_run.policy_version,
      jsonb_build_object(
        'backfillRunId',target_run.id,'snapshotHash',target_run.snapshot_hash,
        'bindingId',target_run.binding_id,'mappingVersion',target_run.mapping_version,
        'itemIndex',item.item_index,'itemCount',target_run.eligible_count,
        'ownerApprovalId',target_approval.id
      ),target_approval.actor_membership_id,target_run.correlation_id,target_occurred_at
    ) returning * into version_row;

    insert into public.connector_approval_events (
      workspace_id,intent_id,intent_version_id,intent_version,connection_id,
      payload_hash,decision,actor_user_id,actor_membership_id,actor_role_snapshot,
      policy_id,policy_version,correlation_id,occurred_at
    ) values (
      target_run.workspace_id,intent_row.id,version_row.id,1,target_run.connection_id,
      item.operation_key,'approved',target_approval.actor_user_id,
      target_approval.actor_membership_id,target_approval.actor_role_snapshot,
      target_run.policy_id,target_run.policy_version,target_run.correlation_id,target_occurred_at
    );

    insert into public.connector_jobs (
      workspace_id,connection_id,intent_id,intent_version_id,intent_version,
      provider,action_type,schema_version,payload_ref,payload_hash,policy_id,
      policy_version,idempotency_key,correlation_id,state,scheduled_at,max_attempts,
      created_at,updated_at
    ) values (
      target_run.workspace_id,target_run.connection_id,intent_row.id,version_row.id,1,
      'mailchimp','audience.sync','mailchimp-member-operation.v1',payload_row.id,
      item.operation_key,target_run.policy_id,target_run.policy_version,
      'mc-bf:'||target_run.id::text||':'||item.operation_key,
      target_run.correlation_id,'queued',target_occurred_at,5,target_occurred_at,target_occurred_at
    ) returning * into job_row;

    insert into public.connector_receipt_events (
      workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,
      event_type,event_key,correlation_id,provider_request_hash,error_category,
      redacted_metadata,occurred_at
    ) values
    (
      target_run.workspace_id,target_run.connection_id,'mailchimp',job_row.id,
      intent_row.id,version_row.id,'intent.approved','intent.approved:'||version_row.id::text,
      target_run.correlation_id,item.operation_key,'none',jsonb_build_object(
        'backfillRunId',target_run.id,'ownerApprovalId',target_approval.id,
        'itemIndex',item.item_index,'actorMembershipId',target_approval.actor_membership_id
      ),target_occurred_at
    ),
    (
      target_run.workspace_id,target_run.connection_id,'mailchimp',job_row.id,
      intent_row.id,version_row.id,'job.queued','job.queued:'||job_row.id::text,
      target_run.correlation_id,item.operation_key,'none',jsonb_build_object(
        'backfillRunId',target_run.id,'itemIndex',item.item_index
      ),target_occurred_at
    );

    insert into public.mailchimp_outbound_backfill_job_links (
      workspace_id,run_id,item_index,connection_id,intent_id,intent_version_id,
      job_id,operation_key,correlation_id,created_at,updated_at
    ) values (
      target_run.workspace_id,target_run.id,item.item_index,target_run.connection_id,
      intent_row.id,version_row.id,job_row.id,item.operation_key,
      target_run.correlation_id,target_occurred_at,target_occurred_at
    );
    job_ids:=job_ids||jsonb_build_array(job_row.id);
    page_position:=page_position+1;
  end loop;

  insert into public.mailchimp_outbound_backfill_pages (
    workspace_id,run_id,connection_id,binding_id,page_index,offset_start,
    item_count,next_offset,page_hash,jobs_created,correlation_id,enqueued_at,
    created_at,updated_at
  ) values (
    target_run.workspace_id,target_run.id,target_run.connection_id,target_run.binding_id,
    target_run.pages_enqueued,target_run.next_offset,page_count,
    target_run.next_offset+page_count,target_page_hash,page_count,
    target_run.correlation_id,target_occurred_at,target_occurred_at,target_occurred_at
  ) returning * into target_page;
  update public.mailchimp_outbound_backfill_runs
     set next_offset=target_page.next_offset,pages_enqueued=pages_enqueued+1,
         jobs_enqueued=jobs_enqueued+page_count
   where id=target_run.id returning * into target_run;
  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp','sync.applied',
    'mailchimp.backfill.page:'||target_page.id::text,target_run.correlation_id,
    target_page_hash,jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,
      'pageIndex',target_page.page_index,'offsetStart',target_page.offset_start,
      'itemCount',target_page.item_count,'nextOffset',target_page.next_offset
    ),target_occurred_at
  ) returning * into target_receipt;
  return jsonb_build_object('run',to_jsonb(target_run),'page',to_jsonb(target_page),
    'receipt',to_jsonb(target_receipt),'jobIds',job_ids,
    'finalPage',target_run.next_offset=target_run.eligible_count,'noOp',false);
end;
$$;

create or replace function public.settle_mailchimp_outbound_backfill_run(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_retry_at timestamptz,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_outbound_backfill_runs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  succeeded_count integer;
  pending_count integer;
  review_count integer;
  completed boolean;
begin
  select run.* into target_run from public.mailchimp_outbound_backfill_runs run
  where run.id=target_run_id for update;
  if not found then raise exception 'Mailchimp outbound run not found' using errcode='P0002'; end if;
  select
    count(*) filter(where job.state='succeeded')::integer,
    count(*) filter(where job.state in ('queued','leased','executing','retry_wait','reconciliation_required'))::integer,
    count(*) filter(where job.state in ('failed','dead_letter','cancelled'))::integer
  into succeeded_count,pending_count,review_count
  from public.mailchimp_outbound_backfill_job_links link
  join public.connector_jobs job on job.id=link.job_id and job.workspace_id=link.workspace_id
  where link.run_id=target_run.id;
  succeeded_count:=coalesce(succeeded_count,0);
  pending_count:=coalesce(pending_count,0);
  review_count:=coalesce(review_count,0);
  if target_run.state in ('succeeded','review','cancelled') then
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_run.workspace_id
      and receipt.event_key='mailchimp.backfill.completed:'||target_run.id::text;
    return jsonb_build_object('run',to_jsonb(target_run),'receipt',to_jsonb(target_receipt),
      'jobCounts',jsonb_build_object('succeeded',succeeded_count,
        'pending',pending_count,'review',review_count),
      'completed',target_run.state='succeeded','noOp',true);
  end if;
  if target_run.state<>'executing' or target_run.lease_owner<>target_worker_id
     or target_run.fencing_token<>target_fencing_token
     or target_run.lease_expires_at<=target_occurred_at then
    raise exception 'executing Mailchimp outbound lease required' using errcode='40001';
  end if;
  if target_run.next_offset<>target_run.eligible_count
     or target_run.jobs_enqueued<>target_run.eligible_count then
    raise exception 'all Mailchimp outbound pages must be enqueued before settlement' using errcode='23514';
  end if;
  if succeeded_count+pending_count+review_count<>target_run.eligible_count then
    raise exception 'Mailchimp outbound job evidence is incomplete' using errcode='23514';
  end if;
  if pending_count>0 then
    if target_retry_at is null or target_retry_at<=target_occurred_at then
      raise exception 'future retry timestamp required while jobs are pending' using errcode='22023';
    end if;
    update public.mailchimp_outbound_backfill_runs
       set state='retry_wait',scheduled_at=target_retry_at,lease_owner=null,
           lease_expires_at=null,last_error_category='jobs_pending'
     where id=target_run.id returning * into target_run;
    return jsonb_build_object('run',to_jsonb(target_run),'receipt',null,
      'jobCounts',jsonb_build_object('succeeded',succeeded_count,
        'pending',pending_count,'review',review_count),
      'completed',false,'noOp',false);
  end if;
  completed:=review_count=0;
  update public.mailchimp_outbound_backfill_runs
     set state=case when completed then 'succeeded' else 'review' end,
         lease_owner=null,lease_expires_at=null,completed_at=target_occurred_at,
         last_error_category=case when completed then null else 'item_jobs_require_review' end
   where id=target_run.id returning * into target_run;
  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,error_category,reconciliation_result,
    redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp',
    case when completed then 'sync.applied'::public.connector_receipt_event_type
      else 'sync.reviewed'::public.connector_receipt_event_type end,
    'mailchimp.backfill.completed:'||target_run.id::text,target_run.correlation_id,
    target_run.snapshot_hash,target_run.last_error_category,
    case when completed then 'complete' else 'review-required' end,
    jsonb_build_object(
      'runId',target_run.id,'bindingId',target_run.binding_id,'mode',target_run.mode,
      'mappingVersion',target_run.mapping_version,'itemCount',target_run.eligible_count,
      'succeededJobs',succeeded_count,'reviewJobs',review_count
    ),target_occurred_at
  ) returning * into target_receipt;
  return jsonb_build_object('run',to_jsonb(target_run),'receipt',to_jsonb(target_receipt),
    'jobCounts',jsonb_build_object('succeeded',succeeded_count,
      'pending',pending_count,'review',review_count),
    'completed',completed,'noOp',false);
end;
$$;

create or replace function public.transition_mailchimp_outbound_backfill_run(
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
declare target_run public.mailchimp_outbound_backfill_runs%rowtype;
target_receipt public.connector_receipt_events%rowtype; next_state text;
begin
  if target_outcome not in ('retry','review') or target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$'
     or target_occurred_at is null
     or (target_outcome='retry' and (target_retry_at is null or target_retry_at<=target_occurred_at))
     or (target_outcome='review' and target_retry_at is not null) then
    raise exception 'invalid Mailchimp outbound transition' using errcode='22023';
  end if;
  select run.* into target_run from public.mailchimp_outbound_backfill_runs run
  where run.id=target_run_id and run.state in ('leased','executing')
    and run.lease_owner=target_worker_id and run.fencing_token=target_fencing_token
    and run.lease_expires_at>target_occurred_at for update;
  if not found then raise exception 'active Mailchimp outbound lease required' using errcode='40001'; end if;
  next_state:=case when target_outcome='review' or target_run.attempt_count>=target_run.max_attempts
    then 'review' else 'retry_wait' end;
  update public.mailchimp_outbound_backfill_runs
     set state=next_state,lease_owner=null,lease_expires_at=null,
         scheduled_at=coalesce(target_retry_at,scheduled_at),
         completed_at=case when next_state='review' then target_occurred_at else null end,
         last_error_category=case when target_run.attempt_count>=target_run.max_attempts
           then 'attempts_exhausted' else target_error_category end
   where id=target_run.id returning * into target_run;
  if next_state='review' then
    insert into public.connector_receipt_events (
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      provider_request_hash,error_category,reconciliation_result,
      redacted_metadata,occurred_at
    ) values (
      target_run.workspace_id,target_run.connection_id,'mailchimp','sync.reviewed',
      'mailchimp.backfill.completed:'||target_run.id::text,target_run.correlation_id,
      target_run.snapshot_hash,target_run.last_error_category,'review-required',
      jsonb_build_object('runId',target_run.id,'bindingId',target_run.binding_id,
        'mode',target_run.mode,'nextOffset',target_run.next_offset,
        'itemCount',target_run.eligible_count),target_occurred_at
    ) on conflict (workspace_id,event_key) do nothing returning * into target_receipt;
  end if;
  return jsonb_build_object('run',to_jsonb(target_run),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.invalidate_mailchimp_outbound_backfills_on_audience_replace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare cancelled_run public.mailchimp_outbound_backfill_runs%rowtype;
begin
  if old.replaced_at is null and new.replaced_at is not null then
    for cancelled_run in
      update public.mailchimp_outbound_backfill_runs
         set state='cancelled',lease_owner=null,lease_expires_at=null,
             completed_at=new.replaced_at,last_error_category='audience_replaced'
       where binding_id=new.id and workspace_id=new.workspace_id
         and state in ('previewed','approved','leased','executing','retry_wait')
      returning *
    loop
      update public.connector_jobs job
         set state='cancelled',lease_owner=null,lease_expires_at=null,
             cancelled_at=new.replaced_at,last_error_category='audience_replaced'
       where job.id in (
         select link.job_id from public.mailchimp_outbound_backfill_job_links link
         where link.run_id=cancelled_run.id and link.workspace_id=cancelled_run.workspace_id
       ) and job.state in ('queued','retry_wait');
      insert into public.connector_receipt_events (
        workspace_id,connection_id,provider,event_type,event_key,correlation_id,
        provider_request_hash,error_category,reconciliation_result,
        redacted_metadata,occurred_at
      ) values (
        cancelled_run.workspace_id,cancelled_run.connection_id,'mailchimp','sync.reviewed',
        'mailchimp.backfill.cancelled:'||cancelled_run.id::text,
        cancelled_run.correlation_id,cancelled_run.snapshot_hash,'audience_replaced',
        'cancelled',jsonb_build_object('runId',cancelled_run.id,
          'bindingId',cancelled_run.binding_id),new.replaced_at
      ) on conflict (workspace_id,event_key) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

create trigger mailchimp_outbound_backfills_invalidate_on_audience_replace
after update of replaced_at on public.mailchimp_audience_bindings
for each row execute function public.invalidate_mailchimp_outbound_backfills_on_audience_replace();

revoke all on function public.prepare_mailchimp_outbound_backfill_run_update()
  from public,anon,authenticated,service_role;
revoke all on function public.invalidate_mailchimp_outbound_backfills_on_audience_replace()
  from public,anon,authenticated,service_role;
revoke all on function public.preview_mailchimp_outbound_backfill(
  uuid,text,text,integer,uuid,timestamptz,integer
) from public,anon,authenticated,service_role;
revoke all on function public.approve_mailchimp_outbound_backfill(
  uuid,text,integer,uuid,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.schedule_due_mailchimp_outbound_backfill_runs(
  timestamptz,integer,integer
) from public,anon,authenticated,service_role;
revoke all on function public.claim_mailchimp_outbound_backfill_runs(
  uuid,integer,integer,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.start_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.read_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,integer,text,jsonb,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.settle_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,timestamptz,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.transition_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
) from public,anon,authenticated,service_role;

grant execute on function public.preview_mailchimp_outbound_backfill(
  uuid,text,text,integer,uuid,timestamptz,integer
) to authenticated;
grant execute on function public.approve_mailchimp_outbound_backfill(
  uuid,text,integer,uuid,timestamptz
) to authenticated;
grant execute on function public.schedule_due_mailchimp_outbound_backfill_runs(
  timestamptz,integer,integer
) to service_role;
grant execute on function public.claim_mailchimp_outbound_backfill_runs(
  uuid,integer,integer,timestamptz
) to service_role;
grant execute on function public.start_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,timestamptz
) to service_role;
grant execute on function public.read_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,timestamptz
) to service_role;
grant execute on function public.enqueue_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,integer,text,jsonb,timestamptz
) to service_role;
grant execute on function public.settle_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,timestamptz,timestamptz
) to service_role;
grant execute on function public.transition_mailchimp_outbound_backfill_run(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
) to service_role;

comment on table public.mailchimp_outbound_backfill_runs is
  'Redacted owner-previewed and exact-snapshot-approved durable Mailchimp outbound backfill/tag-reconciliation authority.';
comment on table connector_private.mailchimp_outbound_backfill_items is
  'Private immutable per-member snapshot for approved Mailchimp outbound batches; never granted to browser or service roles.';
comment on table public.mailchimp_outbound_backfill_approvals is
  'Append-only owner approval binding the exact audience, mapping version, snapshot hash and item count.';
comment on table public.mailchimp_outbound_backfill_pages is
  'Append-only redacted page checkpoint for bounded per-item normal job materialization.';
comment on table public.mailchimp_outbound_backfill_job_links is
  'Redacted link from each frozen batch item to its normal Story 3.5 intent/version/job.';
comment on function public.preview_mailchimp_outbound_backfill(
  uuid,text,text,integer,uuid,timestamptz,integer
) is 'Owner-only count/hash preview computed from current canonical contacts, emailable points, selected audience links and unsubscribe authority.';
comment on function public.enqueue_mailchimp_outbound_backfill_page(
  uuid,uuid,bigint,integer,text,jsonb,timestamptz
) is 'Service-only leased/fenced atomic bounded page materialization into one existing audience.sync intent and job per frozen item.';
comment on function public.schedule_due_mailchimp_outbound_backfill_runs(
  timestamptz,integer,integer
) is 'Service-only idempotent due scheduler. Creates a count/hash-only tag-reconcile preview requiring later exact owner approval; never enqueues external work.';

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'mailchimp_outbound_backfill_runs','mailchimp_outbound_backfill_approvals',
    'mailchimp_outbound_backfill_pages','mailchimp_outbound_backfill_job_links'
  ] loop
    if not exists (
      select 1 from pg_class relation join pg_namespace namespace
        on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then raise exception 'Mailchimp outbound table % must force RLS',target_table; end if;
    if has_table_privilege('authenticated','public.'||target_table,'INSERT')
       or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
       or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception 'authenticated has unsafe Mailchimp outbound mutation on %',target_table;
    end if;
  end loop;
  if has_table_privilege('service_role',
       'connector_private.mailchimp_outbound_backfill_items','SELECT')
     or has_function_privilege('authenticated',
       'public.claim_mailchimp_outbound_backfill_runs(uuid,integer,integer,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated',
       'public.preview_mailchimp_outbound_backfill(uuid,text,text,integer,uuid,timestamptz,integer)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.schedule_due_mailchimp_outbound_backfill_runs(timestamptz,integer,integer)','EXECUTE')
     or not has_function_privilege('service_role',
       'public.enqueue_mailchimp_outbound_backfill_page(uuid,uuid,bigint,integer,text,jsonb,timestamptz)','EXECUTE') then
    raise exception 'Mailchimp outbound backfill grants are unsafe';
  end if;
end;
$$;

commit;
