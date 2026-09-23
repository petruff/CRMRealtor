-- Story 7.2: sourced, timezone-aware and versioned Florida transaction deadlines.

begin;

alter type public.transaction_milestone_kind add value if not exists 'association';
alter type public.transaction_milestone_kind add value if not exists 'flood';
alter type public.attention_subject_type add value if not exists 'transaction';

alter table public.transaction_milestones
  add column timezone text not null default 'America/New_York',
  add column source_type text not null default 'manual-note',
  add column source_reference text not null default 'Legacy milestone record',
  add column source_date date,
  add column verification_state text not null default 'unverified';

update public.transaction_milestones
set source_type=case when source='transaction-expected-close' then 'transaction-record' else 'manual-note' end,
    source_reference=case when source='transaction-expected-close' then 'Transaction expected close date' else 'Legacy milestone record' end,
    source_date=(created_at at time zone 'America/New_York')::date,
    verification_state='unverified';

alter table public.transaction_milestones
  alter column source_date set not null,
  add constraint transaction_milestones_timezone_present check(length(trim(timezone)) between 1 and 80),
  add constraint transaction_milestones_source_type_valid check(source_type in
    ('contract','addendum','transaction-record','lender','title','association','insurance','manual-note')),
  add constraint transaction_milestones_source_reference_valid
    check(length(trim(source_reference)) between 1 and 240 and source_reference !~ '[[:cntrl:]]'),
  add constraint transaction_milestones_verification_valid
    check(verification_state in ('unverified','verified','contradictory'));

alter table public.transaction_milestone_events
  add column event_kind text not null default 'transitioned',
  add column from_snapshot jsonb,
  add column to_snapshot jsonb not null default '{}'::jsonb,
  add constraint transaction_milestone_events_kind_valid
    check(event_kind in ('created','corrected','reassigned','transitioned')),
  add constraint transaction_milestone_events_snapshots_object check(
    (from_snapshot is null or jsonb_typeof(from_snapshot)='object') and jsonb_typeof(to_snapshot)='object'
  );

update public.transaction_milestone_events event
set event_kind=case when event.from_state is null then 'created' else 'transitioned' end,
    to_snapshot=jsonb_build_object('state',event.to_state::text,'version',event.milestone_version);

create or replace function public.create_transaction_milestone_v2(
  target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,
  target_kind public.transaction_milestone_kind,target_label text,target_due_at timestamptz,target_timezone text,
  target_responsible_membership_id uuid,target_source_type text,target_source_reference text,target_source_date date,
  target_verification_state text,target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_transaction public.real_estate_transactions%rowtype;
  existing public.transaction_milestones%rowtype; created public.transaction_milestones%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  perform 1 from public.workspace_members where id=target_responsible_membership_id
    and workspace_id=target_workspace_id and status='active' for share;
  if not found then raise exception 'active responsible member is required' using errcode='P0002'; end if;
  if target_due_at is null or target_source_date is null or target_occurred_at is null
    or length(trim(target_label)) not between 1 and 120 or trim(target_label) ~ '[[:cntrl:]]'
    or length(trim(target_timezone)) not between 1 and 80
    or target_source_type not in ('contract','addendum','transaction-record','lender','title','association','insurance','manual-note')
    or length(trim(target_source_reference)) not between 1 and 240 or trim(target_source_reference) ~ '[[:cntrl:]]'
    or target_verification_state not in ('unverified','verified')
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid sourced transaction deadline request' using errcode='22023';
  end if;
  select * into target_transaction from public.real_estate_transactions where id=target_transaction_id
    and workspace_id=target_workspace_id for share;
  if not found then raise exception 'transaction not found' using errcode='P0002'; end if;
  select * into existing from public.transaction_milestones where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key for update;
  if found then
    if existing.transaction_id<>target_transaction_id or existing.kind<>target_kind or existing.label<>trim(target_label)
      or existing.due_at<>target_due_at or existing.timezone<>trim(target_timezone)
      or existing.responsible_membership_id<>target_responsible_membership_id
      or existing.source_type<>target_source_type or existing.source_reference<>trim(target_source_reference)
      or existing.source_date<>target_source_date or existing.verification_state<>target_verification_state then
      raise exception 'transaction deadline idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('milestoneId',existing.id,'version',existing.current_version,'noOp',true);
  end if;
  insert into public.transaction_milestones(workspace_id,transaction_id,contact_id,kind,label,state,due_at,timezone,
    responsible_membership_id,source,source_type,source_reference,source_date,verification_state,current_version,
    created_by_membership_id,idempotency_key,created_at,updated_at)
  values(target_workspace_id,target_transaction.id,target_transaction.contact_id,target_kind,trim(target_label),'open',
    target_due_at,trim(target_timezone),target_responsible_membership_id,'manual',target_source_type,
    trim(target_source_reference),target_source_date,target_verification_state,1,target_membership_id,
    target_idempotency_key,target_occurred_at,target_occurred_at) returning * into created;
  insert into public.transaction_milestone_events(workspace_id,milestone_id,to_state,milestone_version,actor_kind,
    actor_membership_id,reason_code,idempotency_key,occurred_at,event_kind,to_snapshot)
  values(target_workspace_id,created.id,'open',1,'member',target_membership_id,'deadline-created',
    target_idempotency_key||':created',target_occurred_at,'created',jsonb_build_object(
      'kind',created.kind::text,'label',created.label,'dueAt',created.due_at,'timezone',created.timezone,
      'responsibleMembershipId',created.responsible_membership_id,'sourceType',created.source_type,
      'sourceReference',created.source_reference,'sourceDate',created.source_date,
      'verificationState',created.verification_state,'state','open','version',1));
  return jsonb_build_object('milestoneId',created.id,'version',1,'noOp',false);
end $$;

create or replace function public.update_transaction_milestone(
  target_workspace_id uuid,target_membership_id uuid,target_milestone_id uuid,target_expected_version integer,
  target_kind public.transaction_milestone_kind,target_label text,target_due_at timestamptz,target_timezone text,
  target_responsible_membership_id uuid,target_source_type text,target_source_reference text,target_source_date date,
  target_verification_state text,target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare milestone public.transaction_milestones%rowtype;
  replay public.transaction_milestone_events%rowtype; updated public.transaction_milestones%rowtype;
  next_version integer; event_kind_value text;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.transaction_milestone_events where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('milestoneId',replay.milestone_id,'version',replay.milestone_version,'noOp',true); end if;
  perform 1 from public.workspace_members where id=target_responsible_membership_id
    and workspace_id=target_workspace_id and status='active' for share;
  if not found then raise exception 'active responsible member is required' using errcode='P0002'; end if;
  select * into milestone from public.transaction_milestones where id=target_milestone_id
    and workspace_id=target_workspace_id for update;
  if not found then raise exception 'transaction deadline not found' using errcode='P0002'; end if;
  if milestone.current_version<>target_expected_version or milestone.state<>'open' then
    raise exception 'transaction deadline version conflict' using errcode='40001';
  end if;
  if target_due_at is null or target_source_date is null or length(trim(target_label)) not between 1 and 120
    or length(trim(target_timezone)) not between 1 and 80
    or target_source_type not in ('contract','addendum','transaction-record','lender','title','association','insurance','manual-note')
    or length(trim(target_source_reference)) not between 1 and 240
    or target_verification_state not in ('unverified','verified','contradictory')
    or length(trim(target_reason_code)) not between 1 and 80
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid transaction deadline correction' using errcode='22023';
  end if;
  next_version:=milestone.current_version+1;
  event_kind_value:=case when milestone.responsible_membership_id<>target_responsible_membership_id then 'reassigned' else 'corrected' end;
  update public.transaction_milestones set kind=target_kind,label=trim(target_label),due_at=target_due_at,
    timezone=trim(target_timezone),responsible_membership_id=target_responsible_membership_id,
    source_type=target_source_type,source_reference=trim(target_source_reference),source_date=target_source_date,
    verification_state=target_verification_state,current_version=next_version,updated_at=target_occurred_at
  where id=milestone.id returning * into updated;
  insert into public.transaction_milestone_events(workspace_id,milestone_id,from_state,to_state,milestone_version,
    actor_kind,actor_membership_id,reason_code,idempotency_key,occurred_at,event_kind,from_snapshot,to_snapshot)
  values(target_workspace_id,milestone.id,'open','open',next_version,'member',target_membership_id,
    trim(target_reason_code),target_idempotency_key,target_occurred_at,event_kind_value,
    jsonb_build_object('kind',milestone.kind::text,'label',milestone.label,'dueAt',milestone.due_at,
      'timezone',milestone.timezone,'responsibleMembershipId',milestone.responsible_membership_id,
      'sourceType',milestone.source_type,'sourceReference',milestone.source_reference,
      'sourceDate',milestone.source_date,'verificationState',milestone.verification_state,'version',milestone.current_version),
    jsonb_build_object('kind',updated.kind::text,'label',updated.label,'dueAt',updated.due_at,
      'timezone',updated.timezone,'responsibleMembershipId',updated.responsible_membership_id,
      'sourceType',updated.source_type,'sourceReference',updated.source_reference,
      'sourceDate',updated.source_date,'verificationState',updated.verification_state,'version',updated.current_version));
  return jsonb_build_object('milestoneId',updated.id,'version',updated.current_version,'noOp',false);
end $$;

create or replace function public.transition_transaction_milestone_v2(
  target_workspace_id uuid,target_membership_id uuid,target_milestone_id uuid,target_expected_version integer,
  target_next_state public.transaction_milestone_state,target_reason_code text,target_idempotency_key text,
  target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare milestone public.transaction_milestones%rowtype; replay public.transaction_milestone_events%rowtype;
  updated public.transaction_milestones%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_next_state='open' or length(trim(target_reason_code)) not between 1 and 80
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' or target_occurred_at is null then
    raise exception 'invalid transaction deadline transition' using errcode='22023';
  end if;
  select * into replay from public.transaction_milestone_events where workspace_id=target_workspace_id
    and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('milestoneId',replay.milestone_id,'version',replay.milestone_version,
    'state',replay.to_state,'noOp',true); end if;
  select * into milestone from public.transaction_milestones where id=target_milestone_id
    and workspace_id=target_workspace_id for update;
  if not found then raise exception 'transaction deadline not found' using errcode='P0002'; end if;
  if milestone.current_version<>target_expected_version or milestone.state<>'open' then
    raise exception 'transaction deadline version conflict' using errcode='40001';
  end if;
  update public.transaction_milestones set state=target_next_state,current_version=current_version+1,
    completed_at=case when target_next_state='completed' then target_occurred_at else null end,
    updated_at=target_occurred_at where id=milestone.id returning * into updated;
  insert into public.transaction_milestone_events(workspace_id,milestone_id,from_state,to_state,milestone_version,
    actor_kind,actor_membership_id,reason_code,idempotency_key,occurred_at,event_kind,from_snapshot,to_snapshot)
  values(target_workspace_id,milestone.id,'open',target_next_state,updated.current_version,'member',target_membership_id,
    trim(target_reason_code),target_idempotency_key,target_occurred_at,'transitioned',
    jsonb_build_object('state','open','version',milestone.current_version),
    jsonb_build_object('state',target_next_state::text,'version',updated.current_version));
  return jsonb_build_object('milestoneId',updated.id,'version',updated.current_version,'state',updated.state,'noOp',false);
end $$;

create or replace function public.seed_transaction_closing_milestone()
returns trigger language plpgsql security definer set search_path='' as $$
declare due_time timestamptz; created public.transaction_milestones%rowtype;
begin
  if new.expected_close_date is not null then
    due_time := (new.expected_close_date + time '17:00') at time zone 'America/New_York';
    insert into public.transaction_milestones(workspace_id,transaction_id,contact_id,kind,label,due_at,timezone,
      responsible_membership_id,source,source_type,source_reference,source_date,verification_state,
      created_by_membership_id,idempotency_key,created_at,updated_at)
    values(new.workspace_id,new.id,new.contact_id,'closing','Expected closing',due_time,'America/New_York',
      new.responsible_membership_id,'transaction-expected-close','transaction-record','Transaction expected close date',
      (new.updated_at at time zone 'America/New_York')::date,'unverified',new.created_by_membership_id,
      'transaction-closing:'||new.id::text,new.created_at,new.created_at)
    on conflict(workspace_id,idempotency_key) do nothing returning * into created;
    if created.id is not null then
      insert into public.transaction_milestone_events(workspace_id,milestone_id,to_state,milestone_version,actor_kind,
        actor_membership_id,reason_code,idempotency_key,occurred_at,event_kind,to_snapshot)
      values(new.workspace_id,created.id,'open',1,'member',new.created_by_membership_id,'expected-close-recorded',
        'transaction-closing:'||new.id::text||':created',new.created_at,'created',jsonb_build_object(
          'state','open','version',1,'verificationState','unverified','sourceReference','Transaction expected close date'));
    end if;
  end if;
  return new;
end $$;

revoke all on function public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.create_transaction_milestone_v2(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.update_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone_v2(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.create_transaction_milestone_v2(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.update_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.transition_transaction_milestone_v2(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,text,timestamptz)
  to authenticated,service_role;

comment on table public.transaction_milestones is
  'Canonical sourced transaction deadlines. Unknown dates are absent; unverified dates never become legal recommendations.';
comment on table public.transaction_milestone_events is
  'Append-only sourced deadline history including correction, reassignment and lifecycle snapshots.';

commit;
