-- Bind canonical lifecycle replay to its exact original request. Existing immutable event authority is retained.
ALTER TABLE public.omnix_nurture_plan_events ADD COLUMN transition_request jsonb;
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
  if target_action is null or target_expected_version is null or target_idempotency_key is null or target_action not in ('pause','resume','snooze','stop')
     or target_expected_version<1 or target_occurred_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid nurture transition request' using errcode='22023';
  end if;
  select * into replay from public.omnix_nurture_plan_events
    where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then
    if replay.plan_id is distinct from target_plan_id or replay.action is distinct from target_action
      or replay.plan_version is distinct from target_expected_version+1
      or (replay.transition_request is not null and replay.transition_request is distinct from jsonb_build_object('snoozedUntil',target_snoozed_until,'stopReason',nullif(trim(target_stop_reason),'')))
      or (replay.transition_request is null and target_action in ('snooze','stop')) then
      raise exception 'nurture transition replay conflicts with approved request' using errcode='40001';
    end if;
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
    workspace_id,plan_id,from_state,to_state,plan_version,action,actor_kind,actor_membership_id,idempotency_key,occurred_at,transition_request
  ) values(
    target_workspace_id,plan.id,prior_state,next_state,plan.version,target_action,
    'member',target_actor_membership_id,target_idempotency_key,target_occurred_at,jsonb_build_object('snoozedUntil',target_snoozed_until,'stopReason',nullif(trim(target_stop_reason),''))
  );
  return plan;
end $$;
