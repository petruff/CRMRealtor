-- Story 5.2 / Sprint 2: minimized inbound-response signals and verified transaction deadlines.

begin;

-- Gmail content intelligence is a separate, restricted-scope owner opt-in.
-- It never broadens the default workspace bundle.
alter table public.google_oauth_completions drop constraint google_oauth_completions_bundle;
alter table public.google_oauth_completions add constraint google_oauth_completions_bundle check (
  bundle in ('workspace-core','gmail-send','gmail-metadata','gmail-insights','calendar-app-created')
);
alter table public.google_connection_capabilities drop constraint google_connection_capabilities_bundle;
alter table public.google_connection_capabilities add constraint google_connection_capabilities_bundle check (
  bundle in ('gmail-send','gmail-metadata','gmail-insights','calendar-app-created')
);

create or replace function connector_private.google_bundle_scopes(target_bundle text)
returns text[] language sql immutable security definer set search_path='' as $$
  select case target_bundle
    when 'workspace-core' then array['openid','email','https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.metadata','https://www.googleapis.com/auth/calendar.app.created']::text[]
    when 'gmail-send' then array['openid','email','https://www.googleapis.com/auth/gmail.send']::text[]
    when 'gmail-metadata' then array['openid','email','https://www.googleapis.com/auth/gmail.metadata']::text[]
    when 'gmail-insights' then array['openid','email','https://www.googleapis.com/auth/gmail.readonly']::text[]
    when 'calendar-app-created' then array['openid','email','https://www.googleapis.com/auth/calendar.app.created']::text[]
    else null::text[] end;
$$;

create or replace function public.capture_google_insights_capability()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.bundle='gmail-insights' then
    insert into public.google_connection_capabilities(workspace_id,connection_id,bundle,required_scopes,
      granted_scopes,state,account_key_hash,authorized_by_membership_id,authorized_at,created_at,updated_at)
    values(new.workspace_id,new.connection_id,'gmail-insights',
      connector_private.google_bundle_scopes('gmail-insights'),new.granted_scopes,
      case when 'https://www.googleapis.com/auth/gmail.readonly'=any(new.granted_scopes) then 'active' else 'missing' end,
      new.account_key_hash,new.actor_membership_id,
      case when 'https://www.googleapis.com/auth/gmail.readonly'=any(new.granted_scopes) then new.occurred_at else null end,
      new.occurred_at,new.occurred_at)
    on conflict(connection_id,bundle) do update set granted_scopes=excluded.granted_scopes,state=excluded.state,
      account_key_hash=excluded.account_key_hash,authorized_by_membership_id=excluded.authorized_by_membership_id,
      authorized_at=excluded.authorized_at,revoked_at=null,last_error_category=null,updated_at=excluded.updated_at;
  end if;
  return new;
end $$;

create trigger google_oauth_completion_capture_insights
after insert on public.google_oauth_completions for each row execute function public.capture_google_insights_capability();

do $$ begin
  if to_regclass('connector_private.google_gmail_resources') is null
     or to_regclass('public.real_estate_transactions') is null
     or to_regclass('public.omnix_action_proposals') is null then
    raise exception 'Gmail metadata, transaction intelligence and Omnix operational brain are required';
  end if;
end $$;

create type public.transaction_milestone_kind as enum (
  'inspection','financing','appraisal','title','contingency','closing','custom'
);
create type public.transaction_milestone_state as enum ('open','completed','waived','cancelled');

create table public.omnix_inbound_response_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  contact_id uuid not null,
  activity_event_id uuid not null,
  resource_hash text not null,
  received_at timestamptz not null,
  intelligence_state text not null default 'pending',
  content_hash text,
  intent text,
  sentiment text,
  urgency text,
  summary text,
  unknowns text[] not null default '{}',
  model text,
  policy_version text,
  analyzed_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by_membership_id uuid,
  created_at timestamptz not null default now(),
  constraint omnix_inbound_response_signals_contact_fk foreign key(contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint omnix_inbound_response_signals_activity_fk foreign key(activity_event_id,workspace_id)
    references public.activity_events(id,workspace_id) on delete restrict,
  constraint omnix_inbound_response_signals_member_fk foreign key(acknowledged_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint omnix_inbound_response_signals_resource_unique unique(workspace_id,resource_hash),
  constraint omnix_inbound_response_signals_hash check(resource_hash ~ '^[a-f0-9]{64}$'),
  constraint omnix_inbound_response_signals_intelligence check(
    intelligence_state in ('pending','classified','guard-refused','budget-unavailable','provider-failed','invalid-response')
    and cardinality(unknowns)<=4
    and (summary is null or (length(trim(summary)) between 1 and 320 and summary !~ '[[:cntrl:]]'))
    and (model is null or (length(model) between 1 and 120 and model !~ '[[:cntrl:]]'))
    and ((intelligence_state='pending' and content_hash is null and intent is null and sentiment is null
      and urgency is null and summary is null and model is null and policy_version is null and analyzed_at is null)
      or (intelligence_state<>'pending' and content_hash ~ '^[a-f0-9]{64}$'
        and intent in ('interested','scheduling','question','objection','not-interested','unsubscribe','out-of-office','other','unknown')
        and sentiment in ('positive','neutral','negative','mixed','unknown')
        and urgency in ('low','normal','high','immediate','unknown')
        and policy_version='gmail-response-intelligence.v1' and analyzed_at is not null))
  ),
  constraint omnix_inbound_response_signals_ack check(
    (acknowledged_at is null and acknowledged_by_membership_id is null)
    or (acknowledged_at is not null and acknowledged_by_membership_id is not null)
  )
);

create index omnix_inbound_response_signals_queue_idx
  on public.omnix_inbound_response_signals(workspace_id,received_at,id)
  where acknowledged_at is null;

create table public.transaction_milestones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  transaction_id uuid not null,
  contact_id uuid not null,
  kind public.transaction_milestone_kind not null,
  label text not null,
  state public.transaction_milestone_state not null default 'open',
  due_at timestamptz not null,
  responsible_membership_id uuid not null,
  source text not null,
  current_version integer not null default 1,
  completed_at timestamptz,
  created_by_membership_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint transaction_milestones_id_workspace_unique unique(id,workspace_id),
  constraint transaction_milestones_transaction_fk foreign key(transaction_id,workspace_id)
    references public.real_estate_transactions(id,workspace_id) on delete restrict,
  constraint transaction_milestones_contact_fk foreign key(contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint transaction_milestones_creator_fk foreign key(created_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_milestones_responsible_fk foreign key(responsible_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_milestones_idempotency_unique unique(workspace_id,idempotency_key),
  constraint transaction_milestones_label check(length(trim(label)) between 1 and 120 and label !~ '[[:cntrl:]]'),
  constraint transaction_milestones_version check(current_version > 0),
  constraint transaction_milestones_source check(source in ('manual','transaction-expected-close')),
  constraint transaction_milestones_completion check(
    (state='completed' and completed_at is not null) or (state<>'completed' and completed_at is null)
  )
);

create index transaction_milestones_due_idx
  on public.transaction_milestones(workspace_id,due_at,created_at,id) where state='open';

create table public.transaction_milestone_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  milestone_id uuid not null,
  from_state public.transaction_milestone_state,
  to_state public.transaction_milestone_state not null,
  milestone_version integer not null,
  actor_kind public.omnix_proposal_actor_kind not null,
  actor_membership_id uuid,
  reason_code text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  constraint transaction_milestone_events_milestone_fk foreign key(milestone_id,workspace_id)
    references public.transaction_milestones(id,workspace_id) on delete restrict,
  constraint transaction_milestone_events_actor_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_milestone_events_unique unique(workspace_id,idempotency_key),
  constraint transaction_milestone_events_actor check(
    (actor_kind='system' and actor_membership_id is null) or (actor_kind='member' and actor_membership_id is not null)
  ),
  constraint transaction_milestone_events_reason check(reason_code ~ '^[a-z0-9-]{1,80}$'),
  constraint transaction_milestone_events_version check(milestone_version > 0)
);

create trigger transaction_milestone_events_no_mutation
before update or delete on public.transaction_milestone_events
for each row execute function public.guard_omnix_proposal_event_mutation();

alter table public.omnix_inbound_response_signals enable row level security;
alter table public.omnix_inbound_response_signals force row level security;
alter table public.transaction_milestones enable row level security;
alter table public.transaction_milestones force row level security;
alter table public.transaction_milestone_events enable row level security;
alter table public.transaction_milestone_events force row level security;

create policy omnix_inbound_response_signals_member_select on public.omnix_inbound_response_signals
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy transaction_milestones_member_select on public.transaction_milestones
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy transaction_milestone_events_member_select on public.transaction_milestone_events
  for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on public.omnix_inbound_response_signals, public.transaction_milestones,
  public.transaction_milestone_events from public,anon,authenticated,service_role;
grant select on public.omnix_inbound_response_signals, public.transaction_milestones,
  public.transaction_milestone_events to authenticated,service_role;
grant all on public.omnix_inbound_response_signals, public.transaction_milestones,
  public.transaction_milestone_events to service_role;

create or replace function public.capture_omnix_inbound_response_signal()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,connector_private as $$
begin
  if new.direction='incoming' and new.contact_id is not null then
    insert into public.omnix_inbound_response_signals(workspace_id,contact_id,activity_event_id,resource_hash,received_at,created_at)
    values(new.workspace_id,new.contact_id,new.activity_event_id,new.resource_hash,new.provider_occurred_at,new.created_at)
    on conflict(workspace_id,resource_hash) do nothing;
  end if;
  return new;
end $$;

create trigger google_gmail_resource_capture_omnix_response
after insert on connector_private.google_gmail_resources for each row
execute function public.capture_omnix_inbound_response_signal();

insert into public.omnix_inbound_response_signals(workspace_id,contact_id,activity_event_id,resource_hash,received_at,created_at)
select resource.workspace_id,resource.contact_id,resource.activity_event_id,resource.resource_hash,
  resource.provider_occurred_at,resource.created_at
from connector_private.google_gmail_resources resource
where resource.direction='incoming' and resource.contact_id is not null and resource.activity_event_id is not null
on conflict(workspace_id,resource_hash) do nothing;

create or replace function public.record_omnix_inbound_response_intelligence(
  target_wakeup_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_resource_hash text,
  target_state text,target_policy_version text,target_content_hash text,target_model text,target_intent text,
  target_sentiment text,target_urgency text,target_summary text,target_unknowns text[],target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.google_gmail_history_wakeup_jobs%rowtype;
  target_signal public.omnix_inbound_response_signals%rowtype;
begin
  target_job:=connector_private.google_authorized_wakeup_job(target_wakeup_job_id,target_worker_id,target_fencing_token,target_occurred_at);
  if target_resource_hash !~ '^[a-f0-9]{64}$' or target_content_hash !~ '^[a-f0-9]{64}$'
    or target_state not in ('classified','guard-refused','budget-unavailable','provider-failed','invalid-response')
    or target_policy_version<>'gmail-response-intelligence.v1'
    or target_intent not in ('interested','scheduling','question','objection','not-interested','unsubscribe','out-of-office','other','unknown')
    or target_sentiment not in ('positive','neutral','negative','mixed','unknown')
    or target_urgency not in ('low','normal','high','immediate','unknown')
    or cardinality(target_unknowns)>4 or exists(select 1 from unnest(target_unknowns) item
      where length(trim(item)) not between 1 and 160 or item ~ '[[:cntrl:]]')
    or (target_summary is not null and (length(trim(target_summary)) not between 1 and 320 or target_summary ~ '[[:cntrl:]]'))
    or (target_model is not null and (length(target_model) not between 1 and 120 or target_model ~ '[[:cntrl:]]')) then
    raise exception 'invalid Gmail response intelligence' using errcode='22023';
  end if;
  perform 1 from connector_private.google_gmail_resources
    where workspace_id=target_job.workspace_id and connection_id=target_job.connection_id
      and resource_hash=target_resource_hash and direction='incoming' and contact_id is not null;
  if not found then
    raise exception 'authorized Gmail resource was not found' using errcode='P0002';
  end if;
  select * into strict target_signal from public.omnix_inbound_response_signals
    where workspace_id=target_job.workspace_id and resource_hash=target_resource_hash for update;
  if target_signal.intelligence_state<>'pending' then
    if target_signal.content_hash<>target_content_hash or target_signal.policy_version<>target_policy_version then
      raise exception 'Gmail response intelligence replay conflicts' using errcode='23505';
    end if;
    return jsonb_build_object('signalId',target_signal.id,'noOp',true);
  end if;
  update public.omnix_inbound_response_signals set intelligence_state=target_state,content_hash=target_content_hash,
    intent=target_intent,sentiment=target_sentiment,urgency=target_urgency,summary=target_summary,
    unknowns=target_unknowns,model=target_model,policy_version=target_policy_version,analyzed_at=target_occurred_at
    where id=target_signal.id returning * into target_signal;
  return jsonb_build_object('signalId',target_signal.id,'noOp',false);
end $$;

create or replace function public.reserve_omnix_ai_service_budget(
  target_workspace_id uuid,target_owner_membership_id uuid,target_correlation_id uuid,target_policy_version text,
  target_estimated_microusd integer,target_per_run_limit_microusd integer,target_daily_limit_microusd integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare usage_day date := (now() at time zone 'utc')::date; usage_record public.omnix_ai_usage_windows%rowtype; run_id uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or not exists(select 1 from public.workspace_members m
    where m.id=target_owner_membership_id and m.workspace_id=target_workspace_id and m.role='owner' and m.status='active') then
    raise exception 'service and active owner authority required' using errcode='42501'; end if;
  if target_policy_version<>'omnix-ai-policy.v1' or target_per_run_limit_microusd<>10000
    or target_daily_limit_microusd<>1000000 or target_estimated_microusd not between 1 and target_per_run_limit_microusd then
    raise exception 'invalid Omnix AI policy limits' using errcode='22023'; end if;
  insert into public.omnix_ai_usage_windows(workspace_id,usage_day) values(target_workspace_id,usage_day)
    on conflict(workspace_id,usage_day) do nothing;
  select * into strict usage_record from public.omnix_ai_usage_windows
    where workspace_id=target_workspace_id and omnix_ai_usage_windows.usage_day=usage_day for update;
  if usage_record.committed_microusd+target_estimated_microusd>target_daily_limit_microusd then
    return jsonb_build_object('allowed',false,'reason','exhausted'); end if;
  insert into public.omnix_ai_runs(workspace_id,membership_id,correlation_id,policy_version,estimated_microusd)
    values(target_workspace_id,target_owner_membership_id,target_correlation_id,target_policy_version,target_estimated_microusd)
    returning id into run_id;
  update public.omnix_ai_usage_windows set committed_microusd=committed_microusd+target_estimated_microusd,
    run_count=run_count+1,updated_at=now() where workspace_id=target_workspace_id and omnix_ai_usage_windows.usage_day=usage_day;
  return jsonb_build_object('allowed',true,'reservation_id',run_id);
end $$;

create or replace function public.finalize_omnix_ai_service_budget(
  target_workspace_id uuid,target_owner_membership_id uuid,target_reservation_id uuid,target_state text,
  target_input_tokens integer,target_output_tokens integer,target_actual_microusd integer,target_error_category text
) returns void language plpgsql security definer set search_path='' as $$
declare run_record public.omnix_ai_runs%rowtype; usage_day date;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or not exists(select 1 from public.workspace_members m
    where m.id=target_owner_membership_id and m.workspace_id=target_workspace_id and m.role='owner' and m.status='active') then
    raise exception 'service and active owner authority required' using errcode='42501'; end if;
  if target_state not in ('succeeded','failed') or target_input_tokens not between 0 and 100000
    or target_output_tokens not between 0 and 600 or target_actual_microusd not between 0 and 10000 then
    raise exception 'invalid Omnix AI completion' using errcode='22023'; end if;
  select * into strict run_record from public.omnix_ai_runs where id=target_reservation_id
    and workspace_id=target_workspace_id and membership_id=target_owner_membership_id for update;
  if run_record.state<>'reserved' then raise exception 'Omnix AI run already finalized' using errcode='40001'; end if;
  usage_day:=(run_record.created_at at time zone 'utc')::date;
  update public.omnix_ai_usage_windows set committed_microusd=greatest(0::bigint,
    committed_microusd-run_record.estimated_microusd+target_actual_microusd),updated_at=now()
    where workspace_id=target_workspace_id and omnix_ai_usage_windows.usage_day=usage_day;
  update public.omnix_ai_runs set state=target_state,actual_microusd=target_actual_microusd,
    input_tokens=target_input_tokens,output_tokens=target_output_tokens,error_category=target_error_category,
    completed_at=now() where id=target_reservation_id;
end $$;

revoke all on function public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz) from public,anon,authenticated;
revoke all on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamptz) to service_role;
grant execute on function public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer) to service_role;
grant execute on function public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text) to service_role;

create or replace function public.create_transaction_milestone(
  target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,
  target_kind public.transaction_milestone_kind,target_label text,target_due_at timestamptz,
  target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_transaction public.real_estate_transactions%rowtype;
  existing public.transaction_milestones%rowtype; created public.transaction_milestones%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_due_at is null or target_occurred_at is null or length(trim(target_label)) not between 1 and 120
     or trim(target_label) ~ '[[:cntrl:]]' or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid transaction deadline request' using errcode='22023';
  end if;
  select * into target_transaction from public.real_estate_transactions
    where id=target_transaction_id and workspace_id=target_workspace_id;
  if not found then raise exception 'transaction not found' using errcode='P0002'; end if;
  select * into existing from public.transaction_milestones
    where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then
    if existing.transaction_id<>target_transaction_id or existing.kind<>target_kind
       or existing.label<>trim(target_label) or existing.due_at<>target_due_at then
      raise exception 'transaction deadline idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('milestoneId',existing.id,'version',existing.current_version,'noOp',true);
  end if;
  insert into public.transaction_milestones(workspace_id,transaction_id,contact_id,kind,label,due_at,
    responsible_membership_id,source,created_by_membership_id,idempotency_key,created_at,updated_at)
  values(target_workspace_id,target_transaction.id,target_transaction.contact_id,target_kind,trim(target_label),target_due_at,
    target_membership_id,'manual',target_membership_id,target_idempotency_key,target_occurred_at,target_occurred_at) returning * into created;
  insert into public.transaction_milestone_events(workspace_id,milestone_id,to_state,milestone_version,
    actor_kind,actor_membership_id,reason_code,idempotency_key,occurred_at)
  values(target_workspace_id,created.id,'open',1,'member',target_membership_id,'deadline-created',
    target_idempotency_key||':created',target_occurred_at);
  return jsonb_build_object('milestoneId',created.id,'version',1,'noOp',false);
end $$;

create or replace function public.transition_transaction_milestone(
  target_workspace_id uuid,target_membership_id uuid,target_milestone_id uuid,target_expected_version integer,
  target_next_state public.transaction_milestone_state,target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare milestone public.transaction_milestones%rowtype; replay public.transaction_milestone_events%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_next_state='open' or target_occurred_at is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid transaction deadline transition' using errcode='22023';
  end if;
  select * into replay from public.transaction_milestone_events
    where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('milestoneId',replay.milestone_id,'version',replay.milestone_version,'state',replay.to_state,'noOp',true); end if;
  select * into milestone from public.transaction_milestones
    where id=target_milestone_id and workspace_id=target_workspace_id for update;
  if not found then raise exception 'transaction deadline not found' using errcode='P0002'; end if;
  if milestone.current_version<>target_expected_version or milestone.state<>'open' then
    raise exception 'transaction deadline version conflict' using errcode='40001';
  end if;
  update public.transaction_milestones set state=target_next_state,current_version=current_version+1,
    completed_at=case when target_next_state='completed' then target_occurred_at else null end,updated_at=target_occurred_at
    where id=milestone.id returning * into milestone;
  insert into public.transaction_milestone_events(workspace_id,milestone_id,from_state,to_state,milestone_version,
    actor_kind,actor_membership_id,reason_code,idempotency_key,occurred_at)
  values(target_workspace_id,milestone.id,'open',target_next_state,milestone.current_version,'member',target_membership_id,
    'deadline-'||target_next_state::text,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('milestoneId',milestone.id,'version',milestone.current_version,'state',milestone.state,'noOp',false);
end $$;

create or replace function public.acknowledge_omnix_inbound_response(
  target_workspace_id uuid,target_membership_id uuid,target_signal_id uuid,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare signal public.omnix_inbound_response_signals%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  update public.omnix_inbound_response_signals set acknowledged_at=coalesce(acknowledged_at,target_occurred_at),
    acknowledged_by_membership_id=coalesce(acknowledged_by_membership_id,target_membership_id)
    where id=target_signal_id and workspace_id=target_workspace_id returning * into signal;
  if not found then raise exception 'inbound response signal not found' using errcode='P0002'; end if;
  return jsonb_build_object('signalId',signal.id,'acknowledgedAt',signal.acknowledged_at);
end $$;

create or replace function public.seed_transaction_closing_milestone()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare due_time timestamptz;
begin
  if new.expected_close_date is not null then
    due_time := (new.expected_close_date + time '17:00') at time zone 'America/New_York';
    insert into public.transaction_milestones(workspace_id,transaction_id,contact_id,kind,label,due_at,
      responsible_membership_id,source,created_by_membership_id,idempotency_key,created_at,updated_at)
    values(new.workspace_id,new.id,new.contact_id,'closing','Expected closing',due_time,new.created_by_membership_id,
      'transaction-expected-close',new.created_by_membership_id,'transaction-closing:'||new.id::text,new.created_at,new.created_at) on conflict(workspace_id,idempotency_key) do nothing;
    insert into public.transaction_milestone_events(workspace_id,milestone_id,to_state,milestone_version,actor_kind,
      actor_membership_id,reason_code,idempotency_key,occurred_at)
    select new.workspace_id,m.id,'open',1,'member',new.created_by_membership_id,'expected-close-recorded',
      'transaction-closing:'||new.id::text||':created',new.created_at from public.transaction_milestones m
      where m.workspace_id=new.workspace_id and m.idempotency_key='transaction-closing:'||new.id::text
    on conflict(workspace_id,idempotency_key) do nothing;
  end if;
  return new;
end $$;

create trigger real_estate_transaction_seed_closing_milestone
after insert on public.real_estate_transactions for each row execute function public.seed_transaction_closing_milestone();

insert into public.transaction_milestones(workspace_id,transaction_id,contact_id,kind,label,due_at,
  responsible_membership_id,source,created_by_membership_id,idempotency_key,created_at,updated_at)
select deal.workspace_id,deal.id,deal.contact_id,'closing','Expected closing',
  (deal.expected_close_date + time '17:00') at time zone 'America/New_York',
  deal.created_by_membership_id,'transaction-expected-close',deal.created_by_membership_id,'transaction-closing:'||deal.id::text,deal.created_at,deal.created_at
from public.real_estate_transactions deal where deal.expected_close_date is not null
on conflict(workspace_id,idempotency_key) do nothing;

insert into public.transaction_milestone_events(workspace_id,milestone_id,to_state,milestone_version,actor_kind,
  actor_membership_id,reason_code,idempotency_key,occurred_at)
select milestone.workspace_id,milestone.id,'open',1,'member',milestone.created_by_membership_id,
  'expected-close-backfill',milestone.idempotency_key||':created',milestone.created_at
from public.transaction_milestones milestone where milestone.idempotency_key like 'transaction-closing:%'
on conflict(workspace_id,idempotency_key) do nothing;

revoke all on function public.capture_omnix_inbound_response_signal() from public,anon,authenticated,service_role;
revoke all on function public.seed_transaction_closing_milestone() from public,anon,authenticated,service_role;
revoke all on function public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.acknowledge_omnix_inbound_response(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz) to authenticated,service_role;
grant execute on function public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz) to authenticated,service_role;
grant execute on function public.acknowledge_omnix_inbound_response(uuid,uuid,uuid,timestamptz) to authenticated,service_role;

commit;
