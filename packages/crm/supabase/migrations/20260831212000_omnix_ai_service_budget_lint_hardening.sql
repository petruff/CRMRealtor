begin;

create or replace function public.reserve_omnix_ai_service_budget(
  target_workspace_id uuid,target_owner_membership_id uuid,target_correlation_id uuid,target_policy_version text,
  target_estimated_microusd integer,target_per_run_limit_microusd integer,target_daily_limit_microusd integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_usage_day date := (now() at time zone 'utc')::date;
  usage_record public.omnix_ai_usage_windows%rowtype; run_id uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or not exists(select 1 from public.workspace_members m
    where m.id=target_owner_membership_id and m.workspace_id=target_workspace_id and m.role='owner' and m.status='active') then
    raise exception 'service and active owner authority required' using errcode='42501'; end if;
  if target_policy_version<>'omnix-ai-policy.v1' or target_per_run_limit_microusd<>10000
    or target_daily_limit_microusd<>1000000 or target_estimated_microusd not between 1 and target_per_run_limit_microusd then
    raise exception 'invalid Omnix AI policy limits' using errcode='22023'; end if;
  insert into public.omnix_ai_usage_windows(workspace_id,usage_day) values(target_workspace_id,v_usage_day)
    on conflict(workspace_id,usage_day) do nothing;
  select * into strict usage_record from public.omnix_ai_usage_windows u
    where u.workspace_id=target_workspace_id and u.usage_day=v_usage_day for update;
  if usage_record.committed_microusd+target_estimated_microusd>target_daily_limit_microusd then
    return jsonb_build_object('allowed',false,'reason','exhausted'); end if;
  insert into public.omnix_ai_runs(workspace_id,membership_id,correlation_id,policy_version,estimated_microusd)
    values(target_workspace_id,target_owner_membership_id,target_correlation_id,target_policy_version,target_estimated_microusd)
    returning id into run_id;
  update public.omnix_ai_usage_windows u set committed_microusd=u.committed_microusd+target_estimated_microusd,
    run_count=u.run_count+1,updated_at=now() where u.workspace_id=target_workspace_id and u.usage_day=v_usage_day;
  return jsonb_build_object('allowed',true,'reservation_id',run_id);
end $$;

create or replace function public.finalize_omnix_ai_service_budget(
  target_workspace_id uuid,target_owner_membership_id uuid,target_reservation_id uuid,target_state text,
  target_input_tokens integer,target_output_tokens integer,target_actual_microusd integer,target_error_category text
) returns void language plpgsql security definer set search_path='' as $$
declare run_record public.omnix_ai_runs%rowtype; v_usage_day date;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or not exists(select 1 from public.workspace_members m
    where m.id=target_owner_membership_id and m.workspace_id=target_workspace_id and m.role='owner' and m.status='active') then
    raise exception 'service and active owner authority required' using errcode='42501'; end if;
  if target_state not in ('succeeded','failed') or target_input_tokens not between 0 and 100000
    or target_output_tokens not between 0 and 600 or target_actual_microusd not between 0 and 10000 then
    raise exception 'invalid Omnix AI completion' using errcode='22023'; end if;
  select * into strict run_record from public.omnix_ai_runs r where r.id=target_reservation_id
    and r.workspace_id=target_workspace_id and r.membership_id=target_owner_membership_id for update;
  if run_record.state<>'reserved' then raise exception 'Omnix AI run already finalized' using errcode='40001'; end if;
  v_usage_day:=(run_record.created_at at time zone 'utc')::date;
  update public.omnix_ai_usage_windows u set committed_microusd=greatest(0::bigint,
    u.committed_microusd-run_record.estimated_microusd+target_actual_microusd),updated_at=now()
    where u.workspace_id=target_workspace_id and u.usage_day=v_usage_day;
  update public.omnix_ai_runs set state=target_state,actual_microusd=target_actual_microusd,
    input_tokens=target_input_tokens,output_tokens=target_output_tokens,error_category=target_error_category,
    completed_at=now() where id=target_reservation_id;
end $$;

revoke all on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer) to service_role;
grant execute on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text) to service_role;

commit;
