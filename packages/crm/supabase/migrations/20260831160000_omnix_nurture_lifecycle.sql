-- Story 5.2 / Sprint 2: governed nurture-plan lifecycle.
-- Scheduler execution is introduced separately after this persistence contract is proven.

begin;

do $$ begin
  if to_regclass('public.omnix_action_proposals') is null
     or to_regprocedure('public.assert_crm_actor_membership(uuid,uuid)') is null then
    raise exception 'Omnix operational proposal authority is required';
  end if;
end $$;

create type public.omnix_nurture_plan_state as enum (
  'active', 'paused', 'snoozed', 'stopped', 'completed'
);

revoke all on type public.omnix_nurture_plan_state from public, anon, authenticated, service_role;
grant usage on type public.omnix_nurture_plan_state to authenticated, service_role;

create table public.omnix_nurture_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid not null,
  source_proposal_id uuid not null,
  state public.omnix_nurture_plan_state not null default 'active',
  version integer not null default 1,
  cadence_days integer not null,
  current_step integer not null default 0,
  maximum_steps integer not null,
  next_step_at timestamptz,
  snoozed_until timestamptz,
  stop_reason text,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0,
  last_materialized_at timestamptz,
  idempotency_key text not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  constraint omnix_nurture_plans_id_workspace_unique unique(id,workspace_id),
  constraint omnix_nurture_plans_source_unique unique(source_proposal_id),
  constraint omnix_nurture_plans_workspace_key_unique unique(workspace_id,idempotency_key),
  constraint omnix_nurture_plans_contact_workspace_fk foreign key(contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint omnix_nurture_plans_proposal_workspace_fk foreign key(source_proposal_id,workspace_id)
    references public.omnix_action_proposals(id,workspace_id) on delete restrict,
  constraint omnix_nurture_plans_creator_workspace_fk foreign key(created_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint omnix_nurture_plans_version check(version > 0),
  constraint omnix_nurture_plans_cadence check(cadence_days between 1 and 365),
  constraint omnix_nurture_plans_steps check(maximum_steps between 1 and 120 and current_step between 0 and maximum_steps),
  constraint omnix_nurture_plans_key check(idempotency_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  constraint omnix_nurture_plans_lease check(
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner ~ '^[A-Za-z0-9._:-]{1,120}$' and lease_expires_at is not null)
  ),
  constraint omnix_nurture_plans_reason check(
    stop_reason is null or (length(trim(stop_reason)) between 1 and 240 and stop_reason !~ '[[:cntrl:]]')
  ),
  constraint omnix_nurture_plans_state_shape check(
    (state in ('active','paused') and next_step_at is not null and snoozed_until is null and stop_reason is null)
    or (state = 'snoozed' and next_step_at is not null and snoozed_until is not null and stop_reason is null)
    or (state = 'stopped' and next_step_at is null and snoozed_until is null and stop_reason is not null)
    or (state = 'completed' and next_step_at is null and snoozed_until is null)
  )
);

create unique index omnix_nurture_plans_one_current_contact_idx
  on public.omnix_nurture_plans(workspace_id,contact_id)
  where state in ('active','paused','snoozed');
create index omnix_nurture_plans_due_idx
  on public.omnix_nurture_plans(workspace_id,state,next_step_at,created_at,id)
  where state in ('active','snoozed');

create table public.omnix_nurture_plan_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  plan_id uuid not null,
  from_state public.omnix_nurture_plan_state,
  to_state public.omnix_nurture_plan_state not null,
  plan_version integer not null,
  action text not null,
  actor_kind public.omnix_proposal_actor_kind not null,
  actor_membership_id uuid,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint omnix_nurture_plan_events_id_workspace_unique unique(id,workspace_id),
  constraint omnix_nurture_plan_events_workspace_key_unique unique(workspace_id,idempotency_key),
  constraint omnix_nurture_plan_events_plan_workspace_fk foreign key(plan_id,workspace_id)
    references public.omnix_nurture_plans(id,workspace_id) on delete restrict,
  constraint omnix_nurture_plan_events_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint omnix_nurture_plan_events_version check(plan_version > 0),
  constraint omnix_nurture_plan_events_action check(action in ('start','pause','resume','snooze','stop','step','complete')),
  constraint omnix_nurture_plan_events_key check(idempotency_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  constraint omnix_nurture_plan_events_actor_shape check(
    (actor_kind='system' and actor_membership_id is null)
    or (actor_kind='member' and actor_membership_id is not null)
  )
);

create index omnix_nurture_plan_events_timeline_idx
  on public.omnix_nurture_plan_events(workspace_id,plan_id,occurred_at,id);

create trigger omnix_nurture_plan_events_no_mutation
before update or delete on public.omnix_nurture_plan_events
for each row execute function public.guard_omnix_proposal_event_mutation();
create trigger omnix_nurture_plans_touch_updated_at
before update on public.omnix_nurture_plans
for each row execute function public.touch_updated_at();

alter table public.omnix_nurture_plans enable row level security;
alter table public.omnix_nurture_plans force row level security;
alter table public.omnix_nurture_plan_events enable row level security;
alter table public.omnix_nurture_plan_events force row level security;

create policy omnix_nurture_plans_member_select on public.omnix_nurture_plans
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy omnix_nurture_plan_events_member_select on public.omnix_nurture_plan_events
for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on public.omnix_nurture_plans,public.omnix_nurture_plan_events
  from public,anon,authenticated,service_role;
grant select on public.omnix_nurture_plans,public.omnix_nurture_plan_events to authenticated,service_role;
grant all on public.omnix_nurture_plans,public.omnix_nurture_plan_events to service_role;

create or replace function public.create_omnix_nurture_plan(
  target_workspace_id uuid,
  target_contact_id uuid,
  target_source_proposal_id uuid,
  target_cadence_days integer,
  target_maximum_steps integer,
  target_start_at timestamptz,
  target_actor_membership_id uuid,
  target_idempotency_key text,
  target_occurred_at timestamptz
) returns public.omnix_nurture_plans
language plpgsql security definer set search_path = pg_catalog,public as $$
declare proposal public.omnix_action_proposals%rowtype;
  existing_plan public.omnix_nurture_plans%rowtype;
  created_plan public.omnix_nurture_plans%rowtype;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);
  if target_cadence_days not between 1 and 365
     or target_maximum_steps not between 1 and 120
     or target_start_at is null or target_start_at < target_occurred_at
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$'
     or target_occurred_at is null then
    raise exception 'invalid nurture plan request' using errcode='22023';
  end if;
  select * into existing_plan from public.omnix_nurture_plans
    where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return existing_plan; end if;
  select * into proposal from public.omnix_action_proposals
    where id=target_source_proposal_id and workspace_id=target_workspace_id for update;
  if not found or proposal.kind<>'nurture-plan' or proposal.state<>'executing'
     or proposal.contact_id is distinct from target_contact_id
     or proposal.decided_by_membership_id<>target_actor_membership_id then
    raise exception 'approved nurture proposal is required' using errcode='42501';
  end if;
  insert into public.omnix_nurture_plans(
    workspace_id,contact_id,source_proposal_id,cadence_days,maximum_steps,next_step_at,
    idempotency_key,created_by_membership_id,created_at,updated_at
  ) values(
    target_workspace_id,target_contact_id,target_source_proposal_id,target_cadence_days,
    target_maximum_steps,target_start_at,target_idempotency_key,target_actor_membership_id,
    target_occurred_at,target_occurred_at
  ) returning * into created_plan;
  insert into public.omnix_nurture_plan_events(
    workspace_id,plan_id,to_state,plan_version,action,actor_kind,actor_membership_id,idempotency_key,occurred_at
  ) values(
    target_workspace_id,created_plan.id,'active',1,'start','member',target_actor_membership_id,
    target_idempotency_key||':start',target_occurred_at
  );
  return created_plan;
exception when unique_violation then
  if exists(select 1 from public.omnix_nurture_plans where workspace_id=target_workspace_id
    and contact_id=target_contact_id and state in ('active','paused','snoozed')) then
    raise exception 'contact already has a current nurture plan' using errcode='23505';
  end if;
  raise;
end $$;

create or replace function public.transition_omnix_nurture_plan(
  target_workspace_id uuid,
  target_plan_id uuid,
  target_expected_version integer,
  target_action text,
  target_snoozed_until timestamptz,
  target_stop_reason text,
  target_actor_membership_id uuid,
  target_idempotency_key text,
  target_occurred_at timestamptz
) returns public.omnix_nurture_plans
language plpgsql security definer set search_path = pg_catalog,public as $$
declare plan public.omnix_nurture_plans%rowtype;
  replay public.omnix_nurture_plan_events%rowtype;
  next_state public.omnix_nurture_plan_state;
  prior_state public.omnix_nurture_plan_state;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);
  if target_action not in ('pause','resume','snooze','stop')
     or target_expected_version<1 or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid nurture transition request' using errcode='22023';
  end if;
  select * into replay from public.omnix_nurture_plan_events
    where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then
    select * into plan from public.omnix_nurture_plans where id=replay.plan_id and workspace_id=target_workspace_id;
    return plan;
  end if;
  select * into plan from public.omnix_nurture_plans
    where id=target_plan_id and workspace_id=target_workspace_id for update;
  if not found then raise exception 'nurture plan not found' using errcode='P0002'; end if;
  if plan.version<>target_expected_version then raise exception 'nurture plan version conflict' using errcode='40001'; end if;
  if target_action='pause' and plan.state not in ('active','snoozed') then raise exception 'nurture plan cannot be paused' using errcode='23514'; end if;
  if target_action='resume' and plan.state not in ('paused','snoozed') then raise exception 'nurture plan cannot be resumed' using errcode='23514'; end if;
  if target_action='snooze' and (plan.state<>'active' or target_snoozed_until is null
    or target_snoozed_until<=target_occurred_at) then raise exception 'nurture plan cannot be snoozed' using errcode='23514'; end if;
  if target_action='stop' and (plan.state not in ('active','paused','snoozed')
    or coalesce(length(trim(target_stop_reason)),0) not between 1 and 240
    or target_stop_reason~'[[:cntrl:]]') then raise exception 'nurture plan cannot be stopped' using errcode='23514'; end if;
  next_state:=case target_action when 'pause' then 'paused'::public.omnix_nurture_plan_state
    when 'resume' then 'active'::public.omnix_nurture_plan_state
    when 'snooze' then 'snoozed'::public.omnix_nurture_plan_state
    else 'stopped'::public.omnix_nurture_plan_state end;
  prior_state:=plan.state;
  update public.omnix_nurture_plans set
    state=next_state,version=version+1,
    next_step_at=case when target_action='stop' then null
      when target_action='resume' then greatest(next_step_at,target_occurred_at) else next_step_at end,
    snoozed_until=case when target_action='snooze' then target_snoozed_until else null end,
    stop_reason=case when target_action='stop' then trim(target_stop_reason) else null end,
    lease_owner=null,lease_expires_at=null,fencing_token=fencing_token+1,
    updated_at=target_occurred_at
    where id=plan.id returning * into plan;
  insert into public.omnix_nurture_plan_events(
    workspace_id,plan_id,from_state,to_state,plan_version,action,actor_kind,actor_membership_id,idempotency_key,occurred_at
  ) values(
    target_workspace_id,plan.id,prior_state,next_state,plan.version,target_action,
    'member',target_actor_membership_id,target_idempotency_key,target_occurred_at
  );
  return plan;
end $$;

create or replace function public.claim_due_omnix_nurture_plans(
  target_workspace_id uuid,
  target_worker_id text,
  target_now timestamptz,
  target_lease_seconds integer,
  target_limit integer
) returns setof public.omnix_nurture_plans
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'nurture scheduler authority is required' using errcode='42501'; end if;
  if target_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' or target_now is null
     or target_lease_seconds not between 15 and 300 or target_limit not between 1 and 100 then
    raise exception 'invalid nurture claim request' using errcode='22023';
  end if;
  update public.omnix_nurture_plans set lease_owner=null,lease_expires_at=null,updated_at=target_now
    where workspace_id=target_workspace_id and lease_expires_at<=target_now;
  return query
  with due as (
    select plan.id from public.omnix_nurture_plans plan
    where plan.workspace_id=target_workspace_id
      and plan.lease_owner is null
      and ((plan.state='active' and plan.next_step_at<=target_now)
        or (plan.state='snoozed' and plan.snoozed_until<=target_now))
    order by case when plan.state='snoozed' then plan.snoozed_until else plan.next_step_at end,
      plan.created_at,plan.id
    for update skip locked limit target_limit
  )
  update public.omnix_nurture_plans plan set
    lease_owner=target_worker_id,lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),
    fencing_token=plan.fencing_token+1,updated_at=target_now
    from due where plan.id=due.id returning plan.*;
end $$;

create or replace function public.complete_omnix_nurture_step(
  target_workspace_id uuid,
  target_plan_id uuid,
  target_worker_id text,
  target_fencing_token bigint,
  target_expected_version integer,
  target_proposal_id uuid,
  target_idempotency_key text,
  target_occurred_at timestamptz
) returns public.omnix_nurture_plans
language plpgsql security definer set search_path = pg_catalog,public as $$
declare plan public.omnix_nurture_plans%rowtype;
  replay public.omnix_nurture_plan_events%rowtype;
  next_state public.omnix_nurture_plan_state;
  prior_state public.omnix_nurture_plan_state;
  next_step integer;
begin
  if auth.role()<>'service_role' then raise exception 'nurture scheduler authority is required' using errcode='42501'; end if;
  if target_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' or target_fencing_token<1
     or target_expected_version<1 or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid nurture completion request' using errcode='22023';
  end if;
  select * into replay from public.omnix_nurture_plan_events
    where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then
    select * into plan from public.omnix_nurture_plans where id=replay.plan_id and workspace_id=target_workspace_id;
    return plan;
  end if;
  select * into plan from public.omnix_nurture_plans
    where id=target_plan_id and workspace_id=target_workspace_id for update;
  if not found then raise exception 'nurture plan not found' using errcode='P0002'; end if;
  if plan.lease_owner<>target_worker_id or plan.fencing_token<>target_fencing_token
     or plan.lease_expires_at<=target_occurred_at or plan.version<>target_expected_version then
    raise exception 'nurture lease or version conflict' using errcode='40001';
  end if;
  if plan.state not in ('active','snoozed') then raise exception 'nurture plan is not due' using errcode='23514'; end if;
  if not exists(select 1 from public.omnix_action_proposals proposal
    where proposal.id=target_proposal_id and proposal.workspace_id=target_workspace_id
      and proposal.contact_id=plan.contact_id and proposal.kind='task-create'
      and proposal.state='pending') then
    raise exception 'pending nurture step proposal is required' using errcode='23503';
  end if;
  next_step:=plan.current_step+1;
  next_state:=case when next_step>=plan.maximum_steps then 'completed'::public.omnix_nurture_plan_state
    else 'active'::public.omnix_nurture_plan_state end;
  prior_state:=plan.state;
  update public.omnix_nurture_plans set
    state=next_state,version=version+1,current_step=next_step,
    next_step_at=case when next_state='completed' then null
      else target_occurred_at+make_interval(days=>cadence_days) end,
    snoozed_until=null,lease_owner=null,lease_expires_at=null,last_materialized_at=target_occurred_at,
    updated_at=target_occurred_at
    where id=plan.id returning * into plan;
  insert into public.omnix_nurture_plan_events(
    workspace_id,plan_id,from_state,to_state,plan_version,action,actor_kind,actor_membership_id,idempotency_key,occurred_at
  ) values(
    target_workspace_id,plan.id,prior_state,next_state,plan.version,
    case when next_state='completed' then 'complete' else 'step' end,
    'system',null,target_idempotency_key,target_occurred_at
  );
  return plan;
end $$;

revoke all on function public.create_omnix_nurture_plan(uuid,uuid,uuid,integer,integer,timestamptz,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.create_omnix_nurture_plan(uuid,uuid,uuid,integer,integer,timestamptz,uuid,text,timestamptz)
  to authenticated;
revoke all on function public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz)
  to authenticated;
revoke all on function public.claim_due_omnix_nurture_plans(uuid,text,timestamptz,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_due_omnix_nurture_plans(uuid,text,timestamptz,integer,integer)
  to service_role;
revoke all on function public.complete_omnix_nurture_step(uuid,uuid,text,bigint,integer,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.complete_omnix_nurture_step(uuid,uuid,text,bigint,integer,uuid,text,timestamptz)
  to service_role;

comment on table public.omnix_nurture_plans is
  'Governed contact nurture lifecycle. Scheduler steps remain pending proposals and never auto-approve.';

commit;
