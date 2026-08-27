-- Story 6.1: persistent, workspace-scoped attention operations.
-- Additive and forward-only. See the matching rollback/forward-repair guide.

begin;

do $$ begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.workspace_members') is null
     or to_regprocedure('public.has_workspace_access(uuid)') is null then
    raise exception 'shared workspace authority is required';
  end if;
end $$;

create type public.attention_priority as enum ('p0','p1','p2','p3','p4');
create type public.attention_state as enum ('open','acknowledged','snoozed','completed','dismissed','escalated');
create type public.attention_subject_type as enum ('contact','task','connection','workspace');
create type public.attention_actor_kind as enum ('member','system');
create type public.attention_run_state as enum ('running','completed','failed','review');

revoke all on type public.attention_priority,public.attention_state,public.attention_subject_type,
  public.attention_actor_kind,public.attention_run_state from public,anon,authenticated,service_role;
grant usage on type public.attention_priority,public.attention_state,public.attention_subject_type,
  public.attention_actor_kind,public.attention_run_state to authenticated,service_role;

create table public.attention_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  rule text not null,
  category text not null,
  subject_type public.attention_subject_type not null,
  subject_id uuid,
  occurrence_key text not null,
  source_fingerprint text not null,
  reason text not null,
  href text not null,
  priority public.attention_priority not null,
  due_at timestamptz,
  enqueue_sequence bigint generated always as identity,
  enqueued_at timestamptz not null,
  last_seen_at timestamptz not null,
  assignee_membership_id uuid,
  state public.attention_state not null default 'open',
  item_version integer not null default 1,
  dismiss_allowed boolean not null default false,
  snoozed_until timestamptz,
  state_changed_at timestamptz not null,
  state_changed_by_membership_id uuid,
  state_change_reason text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attention_items_id_workspace_unique unique(id,workspace_id),
  constraint attention_items_occurrence_unique unique(workspace_id,occurrence_key),
  constraint attention_items_assignee_workspace_fk foreign key(assignee_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint attention_items_state_actor_workspace_fk foreign key(state_changed_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint attention_items_rule check(length(trim(rule)) between 1 and 80 and rule !~ '[[:cntrl:]]'),
  constraint attention_items_category check(length(trim(category)) between 1 and 80 and category !~ '[[:cntrl:]]'),
  constraint attention_items_occurrence_key check(occurrence_key ~ '^[A-Za-z0-9._:-]{1,200}$'),
  constraint attention_items_source_fingerprint check(source_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint attention_items_reason check(length(trim(reason)) between 1 and 500 and reason !~ '[[:cntrl:]]'),
  constraint attention_items_href check(length(href) between 1 and 500 and href ~ '^/[^/]'),
  constraint attention_items_version check(item_version >= 1),
  constraint attention_items_reason_length check(state_change_reason is null or length(trim(state_change_reason)) between 1 and 500),
  constraint attention_items_evidence check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)<=20),
  constraint attention_items_snooze check(
    (state='snoozed' and snoozed_until is not null)
    or (state<>'snoozed' and snoozed_until is null)
  ),
  constraint attention_items_subject check(
    (subject_type='workspace' and subject_id is null)
    or (subject_type<>'workspace' and subject_id is not null)
  )
);

create table public.attention_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  attention_item_id uuid not null,
  from_state public.attention_state,
  to_state public.attention_state not null,
  actor_kind public.attention_actor_kind not null,
  actor_membership_id uuid,
  reason_code text not null,
  source_fingerprint text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint attention_lifecycle_events_item_workspace_fk foreign key(attention_item_id,workspace_id)
    references public.attention_items(id,workspace_id) on delete restrict,
  constraint attention_lifecycle_events_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint attention_lifecycle_events_workspace_key_unique unique(workspace_id,idempotency_key),
  constraint attention_lifecycle_events_id_workspace_unique unique(id,workspace_id),
  constraint attention_lifecycle_events_actor_shape check(
    (actor_kind='system' and actor_membership_id is null)
    or (actor_kind='member' and actor_membership_id is not null)
  ),
  constraint attention_lifecycle_events_reason check(length(trim(reason_code)) between 1 and 500 and reason_code !~ '[[:cntrl:]]'),
  constraint attention_lifecycle_events_fingerprint check(source_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint attention_lifecycle_events_key check(idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$')
);

create table public.attention_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  idempotency_key text not null,
  state public.attention_run_state not null default 'running',
  source_count integer not null default 0,
  materialized_count integer not null default 0,
  refreshed_count integer not null default 0,
  reopened_count integer not null default 0,
  resolved_count integer not null default 0,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attention_reconciliation_runs_workspace_key_unique unique(workspace_id,idempotency_key),
  constraint attention_reconciliation_runs_id_workspace_unique unique(id,workspace_id),
  constraint attention_reconciliation_runs_key check(idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  constraint attention_reconciliation_runs_counts check(
    source_count>=0 and source_count<=500 and materialized_count>=0 and refreshed_count>=0
    and reopened_count>=0 and resolved_count>=0
  ),
  constraint attention_reconciliation_runs_state check(
    (state='running' and completed_at is null and error_code is null)
    or (state='completed' and completed_at is not null and error_code is null)
    or (state in ('failed','review') and completed_at is not null and error_code is not null)
  )
);

create index attention_items_active_order_idx on public.attention_items(
  workspace_id,priority,due_at,enqueue_sequence,id
) where state in ('open','acknowledged','snoozed','escalated');
create index attention_items_assignee_active_idx on public.attention_items(
  workspace_id,assignee_membership_id,priority,due_at,enqueue_sequence
) where state in ('open','acknowledged','snoozed','escalated');
create index attention_lifecycle_events_item_time_idx on public.attention_lifecycle_events(
  workspace_id,attention_item_id,occurred_at desc,id
);
create index attention_reconciliation_runs_workspace_time_idx on public.attention_reconciliation_runs(
  workspace_id,started_at desc,id
);

create or replace function public.guard_attention_event_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception 'attention lifecycle evidence is append-only' using errcode='23514';
end $$;

create trigger attention_lifecycle_events_no_mutation before update or delete on public.attention_lifecycle_events
for each row execute function public.guard_attention_event_mutation();

create or replace function public.guard_attention_identity()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id
     or new.occurrence_key<>old.occurrence_key or new.enqueue_sequence<>old.enqueue_sequence
     or new.enqueued_at<>old.enqueued_at or new.created_at<>old.created_at then
    raise exception 'attention identity is immutable' using errcode='23514';
  end if;
  new.updated_at:=now();
  return new;
end $$;

create trigger attention_items_guard_identity before update on public.attention_items
for each row execute function public.guard_attention_identity();

alter table public.attention_items enable row level security;
alter table public.attention_items force row level security;
alter table public.attention_lifecycle_events enable row level security;
alter table public.attention_lifecycle_events force row level security;
alter table public.attention_reconciliation_runs enable row level security;
alter table public.attention_reconciliation_runs force row level security;

create policy attention_items_member_select on public.attention_items for select to authenticated
using(public.has_workspace_access(workspace_id));
create policy attention_events_member_select on public.attention_lifecycle_events for select to authenticated
using(public.has_workspace_access(workspace_id));
create policy attention_runs_member_select on public.attention_reconciliation_runs for select to authenticated
using(public.has_workspace_access(workspace_id));

revoke all on public.attention_items,public.attention_lifecycle_events,public.attention_reconciliation_runs
  from public,anon,authenticated,service_role;
grant select on public.attention_items,public.attention_lifecycle_events,public.attention_reconciliation_runs
  to authenticated,service_role;

create or replace function public.transition_attention_item(
  target_workspace_id uuid,target_item_id uuid,target_expected_version integer,
  target_transition text,target_actor_membership_id uuid,target_occurred_at timestamptz,
  target_idempotency_key text,target_snoozed_until timestamptz default null,
  target_reason text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_item public.attention_items%rowtype; replay_event public.attention_lifecycle_events%rowtype;
  next_state public.attention_state; previous_state public.attention_state; created_event public.attention_lifecycle_events%rowtype;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);
  if target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' or target_occurred_at is null then raise exception 'invalid attention transition request' using errcode='22023'; end if;
  select * into replay_event from public.attention_lifecycle_events where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then select * into current_item from public.attention_items where id=replay_event.attention_item_id and workspace_id=target_workspace_id;
    return jsonb_build_object('item',to_jsonb(current_item),'event',to_jsonb(replay_event),'noOp',true); end if;
  select * into current_item from public.attention_items where id=target_item_id and workspace_id=target_workspace_id for update;
  if not found then raise exception 'attention item not found' using errcode='P0002'; end if;
  if current_item.item_version<>target_expected_version then raise exception 'attention item version conflict' using errcode='40001'; end if;
  previous_state:=current_item.state;
  next_state:=case target_transition when 'acknowledge' then 'acknowledged'::public.attention_state when 'snooze' then 'snoozed'::public.attention_state
    when 'complete' then 'completed'::public.attention_state when 'dismiss' then 'dismissed'::public.attention_state
    when 'escalate' then 'escalated'::public.attention_state when 'reopen' then 'open'::public.attention_state else null end;
  if next_state is null then raise exception 'invalid attention transition' using errcode='22023'; end if;
  if target_transition='dismiss' and not current_item.dismiss_allowed then raise exception 'attention dismissal is not allowed' using errcode='42501'; end if;
  if target_transition='dismiss' and coalesce(length(trim(target_reason)),0)=0 then raise exception 'attention dismissal reason is required' using errcode='22023'; end if;
  if target_transition='snooze' and (target_snoozed_until is null or target_snoozed_until<=target_occurred_at) then raise exception 'future snooze time is required' using errcode='22023'; end if;
  if target_transition='reopen' and previous_state not in ('completed','dismissed') then raise exception 'only closed attention can reopen' using errcode='23514'; end if;
  if target_transition<>'reopen' and previous_state in ('completed','dismissed') then raise exception 'closed attention must reopen first' using errcode='23514'; end if;
  if next_state=previous_state and target_transition<>'snooze' then return jsonb_build_object('item',to_jsonb(current_item),'event',null,'noOp',true); end if;
  update public.attention_items set state=next_state,item_version=item_version+1,state_changed_at=target_occurred_at,
    state_changed_by_membership_id=target_actor_membership_id,state_change_reason=coalesce(nullif(trim(target_reason),''),'member-'||target_transition),
    snoozed_until=case when next_state='snoozed' then target_snoozed_until else null end where id=current_item.id returning * into current_item;
  insert into public.attention_lifecycle_events(workspace_id,attention_item_id,from_state,to_state,actor_kind,actor_membership_id,
    reason_code,source_fingerprint,idempotency_key,occurred_at) values(target_workspace_id,current_item.id,previous_state,next_state,'member',
    target_actor_membership_id,coalesce(nullif(trim(target_reason),''),'member-'||target_transition),current_item.source_fingerprint,
    target_idempotency_key,target_occurred_at) returning * into created_event;
  return jsonb_build_object('item',to_jsonb(current_item),'event',to_jsonb(created_event),'noOp',false);
end $$;

create or replace function public.reconcile_attention_items(
  target_workspace_id uuid,target_materializations jsonb,target_observed_at timestamptz,target_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare run_row public.attention_reconciliation_runs%rowtype; entry jsonb; current_item public.attention_items%rowtype;
  occurrence_keys text[]:='{}'; source_count integer; materialized integer:=0; refreshed integer:=0; reopened integer:=0; resolved integer:=0;
  previous_state public.attention_state; should_reopen boolean; subject_uuid uuid;
begin
  if not exists(select 1 from public.workspaces where id=target_workspace_id) then raise exception 'workspace not found' using errcode='P0002'; end if;
  if target_observed_at is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' or jsonb_typeof(target_materializations)<>'array' then
    raise exception 'invalid attention reconciliation request' using errcode='22023'; end if;
  source_count:=jsonb_array_length(target_materializations);
  if source_count>500 then raise exception 'attention reconciliation exceeds 500 items' using errcode='22023'; end if;
  select * into run_row from public.attention_reconciliation_runs where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found and run_row.state='completed' then return jsonb_build_object('runId',run_row.id,'noOp',true,'materialized',run_row.materialized_count,
    'refreshed',run_row.refreshed_count,'reopened',run_row.reopened_count,'resolved',run_row.resolved_count); end if;
  insert into public.attention_reconciliation_runs(workspace_id,idempotency_key,state,source_count,started_at)
    values(target_workspace_id,target_idempotency_key,'running',source_count,target_observed_at)
    on conflict(workspace_id,idempotency_key) do update set updated_at=now() returning * into run_row;
  for entry in select value from jsonb_array_elements(target_materializations) loop
    if not (entry ?& array['rule','category','subjectType','occurrenceKey','sourceFingerprint','reason','href','priority','dismissAllowed','evidence'])
       or entry->>'occurrenceKey' !~ '^[A-Za-z0-9._:-]{1,200}$' or entry->>'sourceFingerprint' !~ '^[a-f0-9]{64}$'
       or entry->>'priority' not in ('p0','p1','p2','p3','p4') or entry->>'subjectType' not in ('contact','task','connection','workspace')
       or jsonb_typeof(entry->'evidence')<>'array' or jsonb_array_length(entry->'evidence')>20 then
      raise exception 'invalid attention materialization' using errcode='22023'; end if;
    if entry->>'occurrenceKey'=any(occurrence_keys) then raise exception 'duplicate attention occurrence' using errcode='22023'; end if;
    occurrence_keys:=array_append(occurrence_keys,entry->>'occurrenceKey');
    subject_uuid:=case when entry->>'subjectType'='workspace' then null else (entry->>'subjectId')::uuid end;
    if entry->>'subjectType'='contact' and not exists(select 1 from public.contacts where id=subject_uuid and workspace_id=target_workspace_id) then raise exception 'attention contact scope mismatch' using errcode='42501'; end if;
    if entry->>'subjectType'='task' and not exists(select 1 from public.tasks where id=subject_uuid and workspace_id=target_workspace_id) then raise exception 'attention task scope mismatch' using errcode='42501'; end if;
    if entry->>'subjectType'='connection' and not exists(select 1 from public.connector_connections where id=subject_uuid and workspace_id=target_workspace_id) then raise exception 'attention connection scope mismatch' using errcode='42501'; end if;
    select * into current_item from public.attention_items where workspace_id=target_workspace_id and occurrence_key=entry->>'occurrenceKey' for update;
    if not found then
      insert into public.attention_items(workspace_id,rule,category,subject_type,subject_id,occurrence_key,source_fingerprint,reason,href,priority,
        due_at,enqueued_at,last_seen_at,assignee_membership_id,state,item_version,dismiss_allowed,state_changed_at,evidence)
      values(target_workspace_id,entry->>'rule',entry->>'category',(entry->>'subjectType')::public.attention_subject_type,subject_uuid,
        entry->>'occurrenceKey',entry->>'sourceFingerprint',entry->>'reason',entry->>'href',(entry->>'priority')::public.attention_priority,
        nullif(entry->>'dueAt','')::timestamptz,target_observed_at,target_observed_at,nullif(entry->>'assigneeMembershipId','')::uuid,
        'open',1,(entry->>'dismissAllowed')::boolean,target_observed_at,entry->'evidence') returning * into current_item;
      insert into public.attention_lifecycle_events(workspace_id,attention_item_id,to_state,actor_kind,reason_code,source_fingerprint,idempotency_key,occurred_at)
      values(target_workspace_id,current_item.id,'open','system','source-materialized',current_item.source_fingerprint,
        left(target_idempotency_key,80)||':m:'||md5(current_item.occurrence_key),target_observed_at);
      materialized:=materialized+1;
    else
      previous_state:=current_item.state;
      should_reopen:=current_item.source_fingerprint<>(entry->>'sourceFingerprint')
        or (current_item.state='snoozed' and current_item.snoozed_until<=target_observed_at);
      update public.attention_items set rule=entry->>'rule',category=entry->>'category',subject_type=(entry->>'subjectType')::public.attention_subject_type,
        subject_id=subject_uuid,source_fingerprint=entry->>'sourceFingerprint',reason=entry->>'reason',href=entry->>'href',priority=(entry->>'priority')::public.attention_priority,
        due_at=nullif(entry->>'dueAt','')::timestamptz,last_seen_at=target_observed_at,assignee_membership_id=nullif(entry->>'assigneeMembershipId','')::uuid,
        dismiss_allowed=(entry->>'dismissAllowed')::boolean,evidence=entry->'evidence',state=case when should_reopen then 'open' else state end,
        item_version=item_version+case when should_reopen then 1 else 0 end,state_changed_at=case when should_reopen then target_observed_at else state_changed_at end,
        state_changed_by_membership_id=case when should_reopen then null else state_changed_by_membership_id end,
        state_change_reason=case when should_reopen then case when current_item.source_fingerprint<>(entry->>'sourceFingerprint') then 'source-changed' else 'snooze-ended' end else state_change_reason end,
        snoozed_until=case when should_reopen then null else snoozed_until end where id=current_item.id returning * into current_item;
      if should_reopen then
        insert into public.attention_lifecycle_events(workspace_id,attention_item_id,from_state,to_state,actor_kind,reason_code,source_fingerprint,idempotency_key,occurred_at)
        values(target_workspace_id,current_item.id,previous_state,'open','system',current_item.state_change_reason,current_item.source_fingerprint,
          left(target_idempotency_key,80)||':o:'||md5(current_item.occurrence_key),target_observed_at); reopened:=reopened+1;
      else refreshed:=refreshed+1; end if;
    end if;
  end loop;
  for current_item in select * from public.attention_items where workspace_id=target_workspace_id
    and state in ('open','acknowledged','snoozed','escalated') and not(occurrence_key=any(occurrence_keys)) for update loop
    previous_state:=current_item.state;
    update public.attention_items set state='completed',item_version=item_version+1,state_changed_at=target_observed_at,
      state_changed_by_membership_id=null,state_change_reason='source-cleared',snoozed_until=null where id=current_item.id returning * into current_item;
    insert into public.attention_lifecycle_events(workspace_id,attention_item_id,from_state,to_state,actor_kind,reason_code,source_fingerprint,idempotency_key,occurred_at)
    values(target_workspace_id,current_item.id,previous_state,'completed','system','source-cleared',current_item.source_fingerprint,
      left(target_idempotency_key,80)||':c:'||md5(current_item.occurrence_key),target_observed_at); resolved:=resolved+1;
  end loop;
  update public.attention_reconciliation_runs set state='completed',materialized_count=materialized,refreshed_count=refreshed,reopened_count=reopened,
    resolved_count=resolved,completed_at=target_observed_at,updated_at=now() where id=run_row.id returning * into run_row;
  return jsonb_build_object('runId',run_row.id,'noOp',materialized=0 and reopened=0 and resolved=0,'materialized',materialized,
    'refreshed',refreshed,'reopened',reopened,'resolved',resolved);
end $$;

revoke all on function public.transition_attention_item(uuid,uuid,integer,text,uuid,timestamptz,text,timestamptz,text)
  from public,anon,authenticated,service_role;
grant execute on function public.transition_attention_item(uuid,uuid,integer,text,uuid,timestamptz,text,timestamptz,text)
  to authenticated;
revoke all on function public.reconcile_attention_items(uuid,jsonb,timestamptz,text)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_attention_items(uuid,jsonb,timestamptz,text)
  to service_role;

comment on table public.attention_items is 'Current workspace attention occurrence projection; tasks remain the explicit human commitment source.';
comment on table public.attention_lifecycle_events is 'Append-only evidence for member and system attention state transitions.';
comment on function public.reconcile_attention_items(uuid,jsonb,timestamptz,text) is 'Service-only bounded reconciliation of canonical Omnix alerts into stable attention occurrences.';

commit;
