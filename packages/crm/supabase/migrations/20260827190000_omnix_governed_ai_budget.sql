-- Story 5.1: durable, membership-bound model budget reservations and redacted run receipts.
begin;

create table public.omnix_ai_usage_windows (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  usage_day date not null,
  committed_microusd bigint not null default 0,
  run_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(workspace_id,usage_day),
  constraint omnix_ai_usage_windows_values check(committed_microusd>=0 and run_count>=0)
);

create table public.omnix_ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  membership_id uuid not null,
  correlation_id uuid not null,
  policy_version text not null,
  state text not null default 'reserved',
  estimated_microusd integer not null,
  actual_microusd integer,
  input_tokens integer,
  output_tokens integer,
  error_category text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint omnix_ai_runs_workspace_membership_fk foreign key(membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint omnix_ai_runs_correlation_unique unique(workspace_id,correlation_id),
  constraint omnix_ai_runs_policy check(policy_version='omnix-ai-policy.v1'),
  constraint omnix_ai_runs_state check(state in ('reserved','succeeded','failed')),
  constraint omnix_ai_runs_estimate check(estimated_microusd between 1 and 10000),
  constraint omnix_ai_runs_actual check(actual_microusd is null or actual_microusd between 0 and 10000),
  constraint omnix_ai_runs_tokens check(
    (input_tokens is null or input_tokens between 0 and 100000)
    and (output_tokens is null or output_tokens between 0 and 600)),
  constraint omnix_ai_runs_error check(error_category is null or error_category ~ '^[a-z][a-z0-9.-]{1,79}$'),
  constraint omnix_ai_runs_terminal check(
    (state='reserved' and completed_at is null and actual_microusd is null)
    or (state in ('succeeded','failed') and completed_at is not null and actual_microusd is not null))
);

create index omnix_ai_runs_workspace_created_idx on public.omnix_ai_runs(workspace_id,created_at desc,id);

alter table public.omnix_ai_usage_windows enable row level security;
alter table public.omnix_ai_usage_windows force row level security;
alter table public.omnix_ai_runs enable row level security;
alter table public.omnix_ai_runs force row level security;

create policy omnix_ai_usage_windows_member_select on public.omnix_ai_usage_windows
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy omnix_ai_runs_member_select on public.omnix_ai_runs
  for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on table public.omnix_ai_usage_windows,public.omnix_ai_runs from public,anon,authenticated;
grant select on table public.omnix_ai_usage_windows,public.omnix_ai_runs to authenticated;

create or replace function public.read_workspace_ai_runtime_envelope(
  target_workspace_id uuid,
  target_authenticated_user_id uuid,
  target_membership_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  if not exists(select 1 from public.workspace_members m where m.id=target_membership_id
    and m.workspace_id=target_workspace_id and m.user_id=target_authenticated_user_id and m.status='active') then
    raise exception 'active workspace member identity required' using errcode='42501';
  end if;
  select pg_catalog.jsonb_build_object(
    'workspaceId',configuration.workspace_id,'provider',configuration.provider,'model',configuration.model,
    'enabled',configuration.enabled,'dataPolicy',configuration.data_policy,'secretVersion',configuration.secret_version,
    'envelope',secret.envelope)
  into result
  from public.workspace_ai_configurations configuration
  join connector_private.workspace_ai_secret_envelopes secret using(workspace_id)
  where configuration.workspace_id=target_workspace_id and configuration.enabled=true
    and configuration.data_policy='paid-private' and configuration.secret_version=secret.secret_version;
  return result;
end; $$;

create or replace function public.reserve_omnix_ai_budget(
  target_workspace_id uuid,
  target_membership_id uuid,
  target_correlation_id uuid,
  target_policy_version text,
  target_estimated_microusd integer,
  target_per_run_limit_microusd integer,
  target_daily_limit_microusd integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_usage_day date := (pg_catalog.now() at time zone 'utc')::date;
  usage_record public.omnix_ai_usage_windows%rowtype;
  run_id uuid;
begin
  if auth.uid() is null or not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace membership required' using errcode='42501';
  end if;
  if not exists(select 1 from public.workspace_members m where m.id=target_membership_id
    and m.workspace_id=target_workspace_id and m.user_id=auth.uid() and m.status='active') then
    raise exception 'active actor membership required' using errcode='42501';
  end if;
  if target_policy_version<>'omnix-ai-policy.v1'
     or target_per_run_limit_microusd<>10000
     or target_daily_limit_microusd<>1000000
     or target_estimated_microusd not between 1 and target_per_run_limit_microusd then
    raise exception 'invalid Omnix AI policy limits' using errcode='22023';
  end if;

  insert into public.omnix_ai_usage_windows(workspace_id,usage_day)
  values(target_workspace_id,target_usage_day)
  on conflict(workspace_id,usage_day) do nothing;
  select * into strict usage_record from public.omnix_ai_usage_windows
    where workspace_id=target_workspace_id and omnix_ai_usage_windows.usage_day=target_usage_day
    for update;
  if usage_record.committed_microusd + target_estimated_microusd > target_daily_limit_microusd then
    return pg_catalog.jsonb_build_object('allowed',false,'reason','exhausted');
  end if;

  insert into public.omnix_ai_runs(workspace_id,membership_id,correlation_id,policy_version,estimated_microusd)
  values(target_workspace_id,target_membership_id,target_correlation_id,target_policy_version,target_estimated_microusd)
  returning id into run_id;
  update public.omnix_ai_usage_windows set
    committed_microusd=committed_microusd+target_estimated_microusd,
    run_count=run_count+1,
    updated_at=pg_catalog.now()
  where workspace_id=target_workspace_id and omnix_ai_usage_windows.usage_day=target_usage_day;
  return pg_catalog.jsonb_build_object('allowed',true,'reservation_id',run_id);
end; $$;

create or replace function public.finalize_omnix_ai_budget(
  target_workspace_id uuid,
  target_membership_id uuid,
  target_reservation_id uuid,
  target_state text,
  target_input_tokens integer,
  target_output_tokens integer,
  target_actual_microusd integer,
  target_error_category text
) returns void language plpgsql security definer set search_path='' as $$
declare
  run_record public.omnix_ai_runs%rowtype;
  target_usage_day date;
begin
  if auth.uid() is null or not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace membership required' using errcode='42501';
  end if;
  if not exists(select 1 from public.workspace_members m where m.id=target_membership_id
    and m.workspace_id=target_workspace_id and m.user_id=auth.uid() and m.status='active') then
    raise exception 'active actor membership required' using errcode='42501';
  end if;
  if target_state not in ('succeeded','failed') or target_input_tokens not between 0 and 100000
     or target_output_tokens not between 0 and 600 or target_actual_microusd not between 0 and 10000 then
    raise exception 'invalid Omnix AI completion' using errcode='22023';
  end if;
  select * into strict run_record from public.omnix_ai_runs where id=target_reservation_id
    and workspace_id=target_workspace_id and membership_id=target_membership_id for update;
  if run_record.state<>'reserved' then raise exception 'Omnix AI run already finalized' using errcode='40001'; end if;
  target_usage_day := (run_record.created_at at time zone 'utc')::date;
  update public.omnix_ai_usage_windows set
    committed_microusd=greatest(0::bigint,committed_microusd-run_record.estimated_microusd+target_actual_microusd),
    updated_at=pg_catalog.now()
  where workspace_id=target_workspace_id and omnix_ai_usage_windows.usage_day=target_usage_day;
  update public.omnix_ai_runs set state=target_state,actual_microusd=target_actual_microusd,
    input_tokens=target_input_tokens,output_tokens=target_output_tokens,error_category=target_error_category,
    completed_at=pg_catalog.now() where id=target_reservation_id;
end; $$;

revoke all on function public.reserve_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer) from public;
revoke all on function public.finalize_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer,text) from public;
revoke all on function public.read_workspace_ai_runtime_envelope(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer) to authenticated;
grant execute on function public.finalize_omnix_ai_budget(uuid,uuid,uuid,text,integer,integer,integer,text) to authenticated;
grant execute on function public.read_workspace_ai_runtime_envelope(uuid,uuid,uuid) to service_role;

comment on table public.omnix_ai_runs is 'Redacted Omnix model budget and terminal receipts; prompts and responses are never stored.';
comment on table public.omnix_ai_usage_windows is 'Durable UTC-day workspace spend ceiling for governed Omnix model calls.';

commit;
