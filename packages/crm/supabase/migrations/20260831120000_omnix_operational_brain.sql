-- Story 5.1 / Sprint 1: persistent Omnix proposals and relationship memory.
-- Additive and forward-only. External execution still flows through the
-- connector intent, job, receipt, and reconciliation authority.

begin;

do $$ begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.workspace_members') is null
     or to_regclass('public.contacts') is null
     or to_regclass('public.attention_items') is null
     or to_regclass('public.real_estate_transactions') is null
     or to_regprocedure('public.has_workspace_access(uuid)') is null
     or to_regprocedure('public.is_workspace_owner(uuid)') is null then
    raise exception 'shared workspace authority is required';
  end if;
end $$;

alter table public.real_estate_transactions
  add constraint real_estate_transactions_id_workspace_unique unique(id, workspace_id);

create type public.omnix_proposal_kind as enum (
  'task-create',
  'pipeline-move',
  'google-email-draft',
  'google-calendar-event',
  'mailchimp-campaign-draft',
  'nurture-plan'
);

create type public.omnix_proposal_state as enum (
  'pending',
  'approved',
  'rejected',
  'executing',
  'executed',
  'failed',
  'expired',
  'cancelled'
);

create type public.omnix_proposal_origin as enum ('deterministic', 'gemini');
create type public.omnix_approval_mode as enum ('active-member', 'owner');
create type public.omnix_proposal_actor_kind as enum ('member', 'system');

revoke all on type public.omnix_proposal_kind, public.omnix_proposal_state,
  public.omnix_proposal_origin, public.omnix_approval_mode,
  public.omnix_proposal_actor_kind from public, anon, authenticated, service_role;
grant usage on type public.omnix_proposal_kind, public.omnix_proposal_state,
  public.omnix_proposal_origin, public.omnix_approval_mode,
  public.omnix_proposal_actor_kind to authenticated, service_role;

create or replace function public.valid_omnix_priority_factors(
  factors jsonb,
  expected_score integer
) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare urgency integer;
  temperature text;
  days_overdue integer;
  awaiting_reply boolean;
  potential_value bigint;
  calculated bigint;
begin
  if factors is null or expected_score is null or jsonb_typeof(factors) <> 'object'
     or jsonb_typeof(factors->'urgency') <> 'number'
     or jsonb_typeof(factors->'leadTemperature') <> 'string'
     or jsonb_typeof(factors->'daysOverdue') <> 'number'
     or jsonb_typeof(factors->'awaitingReply') <> 'boolean'
     or jsonb_typeof(factors->'potentialValueCents') <> 'number' then return false; end if;
  urgency := (factors->>'urgency')::integer;
  temperature := factors->>'leadTemperature';
  days_overdue := (factors->>'daysOverdue')::integer;
  awaiting_reply := (factors->>'awaitingReply')::boolean;
  potential_value := (factors->>'potentialValueCents')::bigint;
  if urgency not between 0 and 100
     or temperature not in ('hot','warm','nurture','unknown')
     or days_overdue not between 0 and 3650
     or potential_value not between 0 and 10000000000 then return false; end if;
  calculated := least(1000000::bigint,
    urgency::bigint * 4000
    + case temperature when 'hot' then 180000 when 'warm' then 90000 when 'nurture' then 20000 else 0 end
    + least(days_overdue,60)::bigint * 5000
    + case when awaiting_reply then 70000 else 0 end
    + least(50000::bigint,potential_value / 10000)
  );
  return calculated = expected_score;
exception when others then return false;
end $$;

revoke all on function public.valid_omnix_priority_factors(jsonb,integer)
  from public, anon, authenticated, service_role;

create or replace function public.valid_omnix_proposal_citations(
  citations jsonb
) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
begin
  if citations is null or jsonb_typeof(citations) <> 'array'
     or jsonb_array_length(citations) not between 1 and 20
     or octet_length(citations::text) > 16384 then
    return false;
  end if;
  if exists(
    select 1 from jsonb_array_elements(citations) citation
    where jsonb_typeof(citation) <> 'object'
       or citation->>'entityType' not in ('contact','task','transaction','connection','activity','workspace')
       or coalesce(length(citation->>'recordId'),0) not between 1 and 128
       or jsonb_typeof(citation->'factKeys') <> 'array'
       or jsonb_array_length(citation->'factKeys') not between 1 and 20
       or exists(
         select 1 from jsonb_array_elements(citation->'factKeys') fact
         where jsonb_typeof(fact) <> 'string' or length(fact #>> '{}') not between 1 and 96
       )
       or coalesce(length(citation->>'href'),0) not between 1 and 500
       or citation->>'href' !~ '^/[^/]'
  ) then
    return false;
  end if;
  return true;
exception when others then return false;
end $$;

revoke all on function public.valid_omnix_proposal_citations(jsonb)
  from public, anon, authenticated, service_role;

create table public.omnix_action_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid,
  transaction_id uuid,
  attention_item_id uuid,
  kind public.omnix_proposal_kind not null,
  state public.omnix_proposal_state not null default 'pending',
  origin public.omnix_proposal_origin not null,
  approval_mode public.omnix_approval_mode not null,
  priority public.attention_priority not null default 'p3',
  priority_score integer not null,
  priority_factors jsonb not null,
  title text not null,
  rationale text not null,
  current_version integer not null default 1,
  correlation_id uuid not null,
  idempotency_key text not null,
  due_at timestamptz,
  expires_at timestamptz not null,
  created_by_kind public.omnix_proposal_actor_kind not null,
  created_by_membership_id uuid,
  decided_by_membership_id uuid,
  decided_at timestamptz,
  execution_reference text,
  executed_at timestamptz,
  last_error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint omnix_action_proposals_id_workspace_unique unique(id, workspace_id),
  constraint omnix_action_proposals_workspace_key_unique unique(workspace_id, idempotency_key),
  constraint omnix_action_proposals_contact_workspace_fk foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint omnix_action_proposals_transaction_workspace_fk foreign key(transaction_id, workspace_id)
    references public.real_estate_transactions(id, workspace_id) on delete restrict,
  constraint omnix_action_proposals_attention_workspace_fk foreign key(attention_item_id, workspace_id)
    references public.attention_items(id, workspace_id) on delete restrict,
  constraint omnix_action_proposals_creator_workspace_fk foreign key(created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint omnix_action_proposals_decider_workspace_fk foreign key(decided_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint omnix_action_proposals_title check(length(trim(title)) between 1 and 160 and title !~ '[[:cntrl:]]'),
  constraint omnix_action_proposals_rationale check(length(trim(rationale)) between 1 and 1200 and rationale !~ '[[:cntrl:]]'),
  constraint omnix_action_proposals_version check(current_version > 0),
  constraint omnix_action_proposals_priority_score check(priority_score between 0 and 1000000),
  constraint omnix_action_proposals_priority_factors check(
    jsonb_typeof(priority_factors) = 'object' and octet_length(priority_factors::text) <= 4096
  ),
  constraint omnix_action_proposals_key check(idempotency_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  constraint omnix_action_proposals_expiry check(expires_at > created_at),
  constraint omnix_action_proposals_actor_shape check(
    (created_by_kind = 'system' and created_by_membership_id is null)
    or (created_by_kind = 'member' and created_by_membership_id is not null)
  ),
  constraint omnix_action_proposals_decision_shape check(
    (state = 'pending' and decided_by_membership_id is null and decided_at is null)
    or (state <> 'pending' and state not in ('expired', 'cancelled') and decided_by_membership_id is not null and decided_at is not null)
    or (state in ('expired', 'cancelled'))
  ),
  constraint omnix_action_proposals_execution_shape check(
    (state = 'executed' and executed_at is not null and execution_reference is not null)
    or (state <> 'executed' and executed_at is null)
  ),
  constraint omnix_action_proposals_error check(
    last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create table public.omnix_action_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  proposal_id uuid not null,
  version integer not null,
  payload jsonb not null,
  content_hash text not null,
  citations jsonb not null default '[]'::jsonb,
  created_by_kind public.omnix_proposal_actor_kind not null,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),

  constraint omnix_action_proposal_versions_id_workspace_unique unique(id, workspace_id),
  constraint omnix_action_proposal_versions_proposal_version_unique unique(proposal_id, version),
  constraint omnix_action_proposal_versions_proposal_workspace_fk foreign key(proposal_id, workspace_id)
    references public.omnix_action_proposals(id, workspace_id) on delete restrict,
  constraint omnix_action_proposal_versions_creator_workspace_fk foreign key(created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint omnix_action_proposal_versions_version check(version > 0),
  constraint omnix_action_proposal_versions_payload check(
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768
  ),
  constraint omnix_action_proposal_versions_hash check(content_hash ~ '^[a-f0-9]{64}$'),
  constraint omnix_action_proposal_versions_citations check(
    jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) between 1 and 20
    and octet_length(citations::text) <= 16384
  ),
  constraint omnix_action_proposal_versions_actor_shape check(
    (created_by_kind = 'system' and created_by_membership_id is null)
    or (created_by_kind = 'member' and created_by_membership_id is not null)
  )
);

create table public.omnix_action_proposal_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  proposal_id uuid not null,
  from_state public.omnix_proposal_state,
  to_state public.omnix_proposal_state not null,
  proposal_version integer not null,
  actor_kind public.omnix_proposal_actor_kind not null,
  actor_membership_id uuid,
  reason_code text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint omnix_action_proposal_events_id_workspace_unique unique(id, workspace_id),
  constraint omnix_action_proposal_events_workspace_key_unique unique(workspace_id, idempotency_key),
  constraint omnix_action_proposal_events_proposal_workspace_fk foreign key(proposal_id, workspace_id)
    references public.omnix_action_proposals(id, workspace_id) on delete restrict,
  constraint omnix_action_proposal_events_actor_workspace_fk foreign key(actor_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint omnix_action_proposal_events_version check(proposal_version > 0),
  constraint omnix_action_proposal_events_reason check(length(trim(reason_code)) between 1 and 160),
  constraint omnix_action_proposal_events_key check(idempotency_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  constraint omnix_action_proposal_events_actor_shape check(
    (actor_kind = 'system' and actor_membership_id is null)
    or (actor_kind = 'member' and actor_membership_id is not null)
  )
);

create table public.omnix_relationship_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid not null,
  source_hash text not null,
  deterministic_summary text not null,
  generated_summary text,
  next_best_action text not null,
  citations jsonb not null default '[]'::jsonb,
  model text,
  policy_version text not null,
  refreshed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint omnix_relationship_memories_id_workspace_unique unique(id, workspace_id),
  constraint omnix_relationship_memories_contact_unique unique(workspace_id, contact_id),
  constraint omnix_relationship_memories_contact_workspace_fk foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint omnix_relationship_memories_hash check(source_hash ~ '^[a-f0-9]{64}$'),
  constraint omnix_relationship_memories_deterministic check(length(trim(deterministic_summary)) between 1 and 4000),
  constraint omnix_relationship_memories_generated check(generated_summary is null or length(trim(generated_summary)) between 1 and 4000),
  constraint omnix_relationship_memories_action check(length(trim(next_best_action)) between 1 and 1200),
  constraint omnix_relationship_memories_citations check(
    jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) between 1 and 30
    and octet_length(citations::text) <= 24576
  ),
  constraint omnix_relationship_memories_policy check(policy_version ~ '^[A-Za-z0-9._:-]{1,96}$'),
  constraint omnix_relationship_memories_model check(model is null or model ~ '^[A-Za-z0-9._:/-]{1,120}$')
);

create index omnix_action_proposals_inbox_idx on public.omnix_action_proposals(
  workspace_id, state, priority_score desc, due_at, created_at, id
) where state in ('pending', 'approved', 'failed');
create index omnix_action_proposals_contact_idx on public.omnix_action_proposals(
  workspace_id, contact_id, created_at desc
) where contact_id is not null;
create index omnix_action_proposal_events_timeline_idx on public.omnix_action_proposal_events(
  workspace_id, proposal_id, occurred_at desc, id
);
create index omnix_relationship_memories_refresh_idx on public.omnix_relationship_memories(
  workspace_id, refreshed_at, contact_id
);

create or replace function public.guard_omnix_proposal_event_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Omnix proposal evidence is append-only' using errcode = '23514';
end $$;

create trigger omnix_action_proposal_versions_no_mutation
before update or delete on public.omnix_action_proposal_versions
for each row execute function public.guard_omnix_proposal_event_mutation();
create trigger omnix_action_proposal_events_no_mutation
before update or delete on public.omnix_action_proposal_events
for each row execute function public.guard_omnix_proposal_event_mutation();

create trigger omnix_action_proposals_touch_updated_at
before update on public.omnix_action_proposals
for each row execute function public.touch_updated_at();
create trigger omnix_relationship_memories_touch_updated_at
before update on public.omnix_relationship_memories
for each row execute function public.touch_updated_at();

alter table public.omnix_action_proposals enable row level security;
alter table public.omnix_action_proposals force row level security;
alter table public.omnix_action_proposal_versions enable row level security;
alter table public.omnix_action_proposal_versions force row level security;
alter table public.omnix_action_proposal_events enable row level security;
alter table public.omnix_action_proposal_events force row level security;
alter table public.omnix_relationship_memories enable row level security;
alter table public.omnix_relationship_memories force row level security;

create policy omnix_action_proposals_member_select on public.omnix_action_proposals
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy omnix_action_proposal_versions_member_select on public.omnix_action_proposal_versions
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy omnix_action_proposal_events_member_select on public.omnix_action_proposal_events
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy omnix_relationship_memories_member_select on public.omnix_relationship_memories
for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on public.omnix_action_proposals, public.omnix_action_proposal_versions,
  public.omnix_action_proposal_events, public.omnix_relationship_memories
  from public, anon, authenticated, service_role;
grant select on public.omnix_action_proposals, public.omnix_action_proposal_versions,
  public.omnix_action_proposal_events, public.omnix_relationship_memories
  to authenticated, service_role;
grant all on public.omnix_action_proposals, public.omnix_action_proposal_versions,
  public.omnix_action_proposal_events, public.omnix_relationship_memories
  to service_role;

create or replace function public.create_omnix_action_proposal(
  target_workspace_id uuid,
  target_contact_id uuid,
  target_transaction_id uuid,
  target_attention_item_id uuid,
  target_kind public.omnix_proposal_kind,
  target_origin public.omnix_proposal_origin,
  target_approval_mode public.omnix_approval_mode,
  target_priority public.attention_priority,
  target_priority_score integer,
  target_priority_factors jsonb,
  target_title text,
  target_rationale text,
  target_payload jsonb,
  target_content_hash text,
  target_citations jsonb,
  target_due_at timestamptz,
  target_expires_at timestamptz,
  target_created_by_membership_id uuid,
  target_correlation_id uuid,
  target_idempotency_key text,
  target_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare existing_proposal public.omnix_action_proposals%rowtype;
  created_proposal public.omnix_action_proposals%rowtype;
  actor_kind public.omnix_proposal_actor_kind;
begin
  if target_created_by_membership_id is null then
    if auth.role() <> 'service_role' then raise exception 'system proposal authority is required' using errcode = '42501'; end if;
    actor_kind := 'system';
  else
    perform public.assert_crm_actor_membership(target_created_by_membership_id, target_workspace_id);
    actor_kind := 'member';
  end if;
  if target_created_at is null or target_expires_at <= target_created_at
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,152}$'
     or target_priority_score not between 0 and 1000000
     or not public.valid_omnix_priority_factors(target_priority_factors,target_priority_score)
     or octet_length(target_priority_factors::text) > 4096
     or target_content_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(target_payload) <> 'object' or octet_length(target_payload::text) > 32768
     or not public.valid_omnix_proposal_citations(target_citations) then
    raise exception 'invalid Omnix proposal request' using errcode = '22023';
  end if;
  select * into existing_proposal from public.omnix_action_proposals
    where workspace_id = target_workspace_id and idempotency_key = target_idempotency_key;
  if found then
    if not exists(select 1 from public.omnix_action_proposal_versions
      where proposal_id = existing_proposal.id and version = existing_proposal.current_version and content_hash = target_content_hash) then
      raise exception 'Omnix proposal idempotency conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('proposalId', existing_proposal.id, 'version', existing_proposal.current_version, 'noOp', true);
  end if;
  insert into public.omnix_action_proposals(
    workspace_id, contact_id, transaction_id, attention_item_id, kind, origin,
    approval_mode, priority, priority_score, priority_factors, title, rationale,
    correlation_id, idempotency_key,
    due_at, expires_at, created_by_kind, created_by_membership_id, created_at, updated_at
  ) values(
    target_workspace_id, target_contact_id, target_transaction_id, target_attention_item_id,
    target_kind, target_origin, target_approval_mode, target_priority,
    target_priority_score, target_priority_factors, trim(target_title),
    trim(target_rationale), target_correlation_id, target_idempotency_key, target_due_at,
    target_expires_at, actor_kind, target_created_by_membership_id, target_created_at, target_created_at
  ) returning * into created_proposal;
  insert into public.omnix_action_proposal_versions(
    workspace_id, proposal_id, version, payload, content_hash, citations,
    created_by_kind, created_by_membership_id, created_at
  ) values(
    target_workspace_id, created_proposal.id, 1, target_payload, target_content_hash,
    target_citations, actor_kind, target_created_by_membership_id, target_created_at
  );
  insert into public.omnix_action_proposal_events(
    workspace_id, proposal_id, to_state, proposal_version, actor_kind,
    actor_membership_id, reason_code, idempotency_key, occurred_at
  ) values(
    target_workspace_id, created_proposal.id, 'pending', 1, actor_kind,
    target_created_by_membership_id, 'proposal-created', target_idempotency_key || ':created', target_created_at
  );
  return jsonb_build_object('proposalId', created_proposal.id, 'version', 1, 'noOp', false);
end $$;

create or replace function public.decide_omnix_action_proposal(
  target_workspace_id uuid,
  target_proposal_id uuid,
  target_expected_version integer,
  target_decision text,
  target_actor_membership_id uuid,
  target_idempotency_key text,
  target_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare proposal public.omnix_action_proposals%rowtype;
  replay_event public.omnix_action_proposal_events%rowtype;
  next_state public.omnix_proposal_state;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id, target_workspace_id);
  if target_decision not in ('approve', 'reject') or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid Omnix proposal decision' using errcode = '22023';
  end if;
  select * into replay_event from public.omnix_action_proposal_events
    where workspace_id = target_workspace_id and idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object(
      'proposalId', replay_event.proposal_id,
      'version', replay_event.proposal_version,
      'state', replay_event.to_state,
      'noOp', true
    );
  end if;
  select * into proposal from public.omnix_action_proposals
    where id = target_proposal_id and workspace_id = target_workspace_id for update;
  if not found then raise exception 'Omnix proposal not found' using errcode = 'P0002'; end if;
  if proposal.current_version <> target_expected_version then raise exception 'Omnix proposal version conflict' using errcode = '40001'; end if;
  if proposal.state <> 'pending' then raise exception 'Omnix proposal is no longer pending' using errcode = '23514'; end if;
  if proposal.expires_at <= target_occurred_at then
    update public.omnix_action_proposals set state = 'expired', updated_at = target_occurred_at where id = proposal.id;
    insert into public.omnix_action_proposal_events(
      workspace_id, proposal_id, from_state, to_state, proposal_version, actor_kind,
      actor_membership_id, reason_code, idempotency_key, occurred_at
    ) values(
      target_workspace_id, proposal.id, 'pending', 'expired', proposal.current_version,
      'member', target_actor_membership_id, 'proposal-expired', target_idempotency_key,
      target_occurred_at
    );
    return jsonb_build_object(
      'proposalId', proposal.id,
      'version', proposal.current_version,
      'state', 'expired',
      'noOp', false
    );
  end if;
  if proposal.approval_mode = 'owner' and not public.is_workspace_owner(target_workspace_id) then
    raise exception 'workspace owner approval is required' using errcode = '42501';
  end if;
  next_state := case target_decision when 'approve' then 'approved'::public.omnix_proposal_state else 'rejected'::public.omnix_proposal_state end;
  update public.omnix_action_proposals set state = next_state,
    decided_by_membership_id = target_actor_membership_id, decided_at = target_occurred_at,
    updated_at = target_occurred_at where id = proposal.id returning * into proposal;
  insert into public.omnix_action_proposal_events(
    workspace_id, proposal_id, from_state, to_state, proposal_version, actor_kind,
    actor_membership_id, reason_code, idempotency_key, occurred_at
  ) values(
    target_workspace_id, proposal.id, 'pending', next_state, proposal.current_version,
    'member', target_actor_membership_id, 'member-' || target_decision,
    target_idempotency_key, target_occurred_at
  );
  return jsonb_build_object('proposalId', proposal.id, 'version', proposal.current_version, 'state', proposal.state, 'noOp', false);
end $$;

create or replace function public.transition_omnix_proposal_execution(
  target_workspace_id uuid,
  target_proposal_id uuid,
  target_expected_state public.omnix_proposal_state,
  target_next_state public.omnix_proposal_state,
  target_actor_membership_id uuid,
  target_execution_reference text,
  target_error_category text,
  target_idempotency_key text,
  target_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare proposal public.omnix_action_proposals%rowtype;
  replay_event public.omnix_action_proposal_events%rowtype;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id, target_workspace_id);
  if target_occurred_at is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$'
     or target_next_state not in ('executing', 'executed', 'failed')
     or not (
       (target_expected_state = 'approved' and target_next_state = 'executing')
       or (target_expected_state = 'failed' and target_next_state = 'executing')
       or (target_expected_state = 'executing' and target_next_state in ('executed', 'failed'))
     )
     or (target_next_state = 'executed' and (
       target_execution_reference is null or length(trim(target_execution_reference)) not between 1 and 240
     ))
     or (target_next_state = 'failed' and (
       target_error_category is null or target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$'
     )) then
    raise exception 'invalid Omnix execution transition' using errcode = '22023';
  end if;
  select * into replay_event from public.omnix_action_proposal_events
    where workspace_id = target_workspace_id and idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object('proposalId', replay_event.proposal_id, 'state', replay_event.to_state, 'noOp', true);
  end if;
  select * into proposal from public.omnix_action_proposals
    where id = target_proposal_id and workspace_id = target_workspace_id for update;
  if not found then raise exception 'Omnix proposal not found' using errcode = 'P0002'; end if;
  if proposal.state <> target_expected_state then raise exception 'Omnix proposal execution state conflict' using errcode = '40001'; end if;
  if proposal.approval_mode = 'owner' and proposal.decided_by_membership_id <> target_actor_membership_id then
    raise exception 'the approving owner must execute this proposal' using errcode = '42501';
  end if;
  update public.omnix_action_proposals set
    state = target_next_state,
    execution_reference = case when target_next_state = 'executed' then trim(target_execution_reference) else null end,
    executed_at = case when target_next_state = 'executed' then target_occurred_at else null end,
    last_error_category = case when target_next_state = 'failed' then target_error_category else null end,
    updated_at = target_occurred_at
    where id = proposal.id returning * into proposal;
  insert into public.omnix_action_proposal_events(
    workspace_id, proposal_id, from_state, to_state, proposal_version, actor_kind,
    actor_membership_id, reason_code, idempotency_key, occurred_at
  ) values(
    target_workspace_id, proposal.id, target_expected_state, target_next_state,
    proposal.current_version, 'member', target_actor_membership_id,
    'execution-' || target_next_state::text, target_idempotency_key, target_occurred_at
  );
  return jsonb_build_object('proposalId', proposal.id, 'state', proposal.state, 'noOp', false);
end $$;

revoke all on function public.create_omnix_action_proposal(
  uuid, uuid, uuid, uuid, public.omnix_proposal_kind, public.omnix_proposal_origin,
  public.omnix_approval_mode, public.attention_priority, integer, jsonb, text, text, jsonb, text,
  jsonb, timestamptz, timestamptz, uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.create_omnix_action_proposal(
  uuid, uuid, uuid, uuid, public.omnix_proposal_kind, public.omnix_proposal_origin,
  public.omnix_approval_mode, public.attention_priority, integer, jsonb, text, text, jsonb, text,
  jsonb, timestamptz, timestamptz, uuid, uuid, text, timestamptz
) to authenticated, service_role;

revoke all on function public.decide_omnix_action_proposal(uuid, uuid, integer, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_omnix_action_proposal(uuid, uuid, integer, text, uuid, text, timestamptz)
  to authenticated;

revoke all on function public.transition_omnix_proposal_execution(
  uuid, uuid, public.omnix_proposal_state, public.omnix_proposal_state, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.transition_omnix_proposal_execution(
  uuid, uuid, public.omnix_proposal_state, public.omnix_proposal_state, uuid, text, text, text, timestamptz
) to authenticated;

comment on table public.omnix_action_proposals is
  'Versioned, recoverable Omnix action proposals. Approval does not itself execute an external action.';
comment on table public.omnix_relationship_memories is
  'Workspace-scoped relationship summaries derived from cited canonical CRM facts.';

commit;
