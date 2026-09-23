-- Story 7.4: version-bound operational checklists with explicit legal/content review gates.
begin;

create type public.workflow_pack_type as enum('buyer','seller','condo-coop','flood','association','closing');
create type public.workflow_pack_review_state as enum('draft','reviewed','withdrawn');
create type public.workflow_plan_status as enum('active','completed','cancelled');
create type public.workflow_step_state as enum('proposed','in-progress','completed','skipped','blocked');

create table public.workflow_pack_definitions(
  id uuid primary key default gen_random_uuid(),pack_type public.workflow_pack_type not null,name text not null,
  version integer not null,effective_date date not null,source_title text not null,source_url text not null,
  review_state public.workflow_pack_review_state not null default 'draft',review_reference text,is_current boolean not null default false,
  legal_boundary text not null,definition_hash text not null,created_at timestamptz not null,
  constraint workflow_pack_definition_version_unique unique(pack_type,version),
  constraint workflow_pack_definition_name_present check(length(trim(name)) between 1 and 120),
  constraint workflow_pack_definition_source_present check(length(trim(source_title)) between 1 and 160 and source_url ~ '^https://'),
  constraint workflow_pack_definition_review_gate check(not is_current or (review_state='reviewed' and length(trim(review_reference)) between 1 and 240)),
  constraint workflow_pack_definition_legal_boundary check(length(trim(legal_boundary)) between 1 and 500),
  constraint workflow_pack_definition_hash check(definition_hash ~ '^[a-f0-9]{64}$')
);
create unique index workflow_pack_one_current_per_type on public.workflow_pack_definitions(pack_type) where is_current;

create table public.workflow_pack_steps(
  id uuid primary key default gen_random_uuid(),pack_definition_id uuid not null references public.workflow_pack_definitions(id) on delete restrict,
  step_key text not null,title text not null,position integer not null,responsible_role text not null,evidence_requirement text not null,
  acknowledgement_required boolean not null default false,legal_boundary text not null,
  constraint workflow_pack_step_key_unique unique(pack_definition_id,step_key),
  constraint workflow_pack_step_key_bounded check(step_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  constraint workflow_pack_step_title_present check(length(trim(title)) between 1 and 160),
  constraint workflow_pack_step_position_positive check(position>0),
  constraint workflow_pack_step_responsibility check(responsible_role in ('owner','assistant','either')),
  constraint workflow_pack_step_evidence_present check(length(trim(evidence_requirement)) between 1 and 240),
  constraint workflow_pack_step_legal_boundary check(length(trim(legal_boundary)) between 1 and 320)
);

create table public.transaction_workflow_plans(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete restrict,
  transaction_id uuid not null,pack_definition_id uuid not null references public.workflow_pack_definitions(id) on delete restrict,
  pack_type public.workflow_pack_type not null,pack_name text not null,pack_version integer not null,definition_snapshot jsonb not null,
  status public.workflow_plan_status not null default 'active',current_version integer not null default 1,
  started_by_membership_id uuid not null,responsible_membership_id uuid not null,idempotency_key text not null,
  created_at timestamptz not null,updated_at timestamptz not null,
  constraint transaction_workflow_plan_transaction_workspace_fk foreign key(transaction_id,workspace_id) references public.real_estate_transactions(id,workspace_id) on delete restrict,
  constraint transaction_workflow_plan_starter_workspace_fk foreign key(started_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_workflow_plan_responsible_workspace_fk foreign key(responsible_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_workflow_plan_id_workspace_unique unique(id,workspace_id),
  constraint transaction_workflow_plan_idempotency_unique unique(workspace_id,idempotency_key),
  constraint transaction_workflow_plan_snapshot_object check(jsonb_typeof(definition_snapshot)='object'),
  constraint transaction_workflow_plan_version_positive check(current_version>0)
);

create table public.transaction_workflow_steps(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete restrict,
  plan_id uuid not null,step_key text not null,title text not null,position integer not null,state public.workflow_step_state not null default 'proposed',
  responsible_membership_id uuid not null,evidence_requirement text not null,evidence_reference text,
  acknowledgement_required boolean not null default false,acknowledged_at timestamptz,legal_boundary text not null,
  current_version integer not null default 1,updated_at timestamptz not null,
  constraint transaction_workflow_step_plan_workspace_fk foreign key(plan_id,workspace_id) references public.transaction_workflow_plans(id,workspace_id) on delete restrict,
  constraint transaction_workflow_step_member_workspace_fk foreign key(responsible_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_workflow_step_identity_unique unique(plan_id,step_key),
  constraint transaction_workflow_step_id_workspace_unique unique(id,workspace_id),
  constraint transaction_workflow_step_evidence_bounded check(evidence_reference is null or length(trim(evidence_reference)) between 1 and 240),
  constraint transaction_workflow_step_ack_consistent check(acknowledged_at is null or acknowledgement_required),
  constraint transaction_workflow_step_version_positive check(current_version>0)
);

create table public.transaction_workflow_events(
  id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id) on delete restrict,
  plan_id uuid not null,step_id uuid,actor_membership_id uuid not null,event_kind text not null,from_version integer,to_version integer not null,
  reason_code text not null,from_snapshot jsonb,to_snapshot jsonb not null,idempotency_key text not null,occurred_at timestamptz not null,created_at timestamptz not null,
  constraint transaction_workflow_event_plan_workspace_fk foreign key(plan_id,workspace_id) references public.transaction_workflow_plans(id,workspace_id) on delete restrict,
  constraint transaction_workflow_event_step_workspace_fk foreign key(step_id,workspace_id) references public.transaction_workflow_steps(id,workspace_id) on delete restrict,
  constraint transaction_workflow_event_actor_workspace_fk foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_workflow_event_idempotency_unique unique(workspace_id,idempotency_key),
  constraint transaction_workflow_event_kind check(event_kind in ('plan-started','step-transitioned')),
  constraint transaction_workflow_event_snapshots check((from_snapshot is null or jsonb_typeof(from_snapshot)='object') and jsonb_typeof(to_snapshot)='object')
);

create or replace function public.reject_transaction_workflow_event_mutation() returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'transaction workflow history is append-only' using errcode='55000'; end $$;
create trigger transaction_workflow_events_no_mutation before update or delete on public.transaction_workflow_events
for each row execute function public.reject_transaction_workflow_event_mutation();

alter table public.workflow_pack_definitions enable row level security; alter table public.workflow_pack_definitions force row level security;
alter table public.workflow_pack_steps enable row level security; alter table public.workflow_pack_steps force row level security;
alter table public.transaction_workflow_plans enable row level security; alter table public.transaction_workflow_plans force row level security;
alter table public.transaction_workflow_steps enable row level security; alter table public.transaction_workflow_steps force row level security;
alter table public.transaction_workflow_events enable row level security; alter table public.transaction_workflow_events force row level security;
create policy workflow_pack_definitions_member_select on public.workflow_pack_definitions for select to authenticated using(true);
create policy workflow_pack_steps_member_select on public.workflow_pack_steps for select to authenticated using(true);
create policy transaction_workflow_plans_member_select on public.transaction_workflow_plans for select to authenticated using(public.has_workspace_access(workspace_id));
create policy transaction_workflow_steps_member_select on public.transaction_workflow_steps for select to authenticated using(public.has_workspace_access(workspace_id));
create policy transaction_workflow_events_member_select on public.transaction_workflow_events for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on table public.workflow_pack_definitions,public.workflow_pack_steps,public.transaction_workflow_plans,public.transaction_workflow_steps,public.transaction_workflow_events from public,anon,authenticated;
grant select on table public.workflow_pack_definitions,public.workflow_pack_steps,public.transaction_workflow_plans,public.transaction_workflow_steps,public.transaction_workflow_events to authenticated;
grant all on table public.workflow_pack_definitions,public.workflow_pack_steps,public.transaction_workflow_plans,public.transaction_workflow_steps,public.transaction_workflow_events to service_role;
revoke all on sequence public.transaction_workflow_events_id_seq from public,anon,authenticated; grant all on sequence public.transaction_workflow_events_id_seq to service_role;

create or replace function public.start_transaction_workflow_plan(target_workspace_id uuid,target_membership_id uuid,target_transaction_id uuid,
  target_pack_definition_id uuid,target_responsible_membership_id uuid,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pack public.workflow_pack_definitions%rowtype; target_plan public.transaction_workflow_plans%rowtype; replay public.transaction_workflow_plans%rowtype;
  definition jsonb;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  perform 1 from public.workspace_members where id=target_responsible_membership_id and workspace_id=target_workspace_id and status='active';
  if not found then raise exception 'active responsible member is required' using errcode='P0002'; end if;
  perform 1 from public.real_estate_transactions where id=target_transaction_id and workspace_id=target_workspace_id;
  if not found then raise exception 'transaction not found' using errcode='P0002'; end if;
  if target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' or target_occurred_at is null then raise exception 'invalid workflow start request' using errcode='22023'; end if;
  select * into replay from public.transaction_workflow_plans where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('planId',replay.id,'version',replay.current_version,'noOp',true); end if;
  select * into pack from public.workflow_pack_definitions where id=target_pack_definition_id and review_state='reviewed' and is_current;
  if not found then raise exception 'reviewed current workflow pack is required' using errcode='55000'; end if;
  select jsonb_build_object('id',pack.id,'packType',pack.pack_type,'name',pack.name,'version',pack.version,'effectiveDate',pack.effective_date,
    'sourceTitle',pack.source_title,'sourceUrl',pack.source_url,'reviewState',pack.review_state,'reviewReference',pack.review_reference,
    'legalBoundary',pack.legal_boundary,'definitionHash',pack.definition_hash,'steps',coalesce(jsonb_agg(jsonb_build_object(
      'key',s.step_key,'title',s.title,'position',s.position,'responsibleRole',s.responsible_role,'evidenceRequirement',s.evidence_requirement,
      'acknowledgementRequired',s.acknowledgement_required,'legalBoundary',s.legal_boundary) order by s.position),'[]'::jsonb))
    into definition from public.workflow_pack_steps s where s.pack_definition_id=pack.id;
  if jsonb_array_length(definition->'steps')=0 then raise exception 'workflow pack has no steps' using errcode='55000'; end if;
  insert into public.transaction_workflow_plans(workspace_id,transaction_id,pack_definition_id,pack_type,pack_name,pack_version,
    definition_snapshot,started_by_membership_id,responsible_membership_id,idempotency_key,created_at,updated_at)
  values(target_workspace_id,target_transaction_id,pack.id,pack.pack_type,pack.name,pack.version,definition,target_membership_id,
    target_responsible_membership_id,target_idempotency_key,target_occurred_at,target_occurred_at) returning * into target_plan;
  insert into public.transaction_workflow_steps(workspace_id,plan_id,step_key,title,position,responsible_membership_id,evidence_requirement,
    acknowledgement_required,legal_boundary,updated_at)
  select target_workspace_id,target_plan.id,s.step_key,s.title,s.position,target_responsible_membership_id,s.evidence_requirement,
    s.acknowledgement_required,s.legal_boundary,target_occurred_at from public.workflow_pack_steps s where s.pack_definition_id=pack.id;
  insert into public.transaction_workflow_events(workspace_id,plan_id,actor_membership_id,event_kind,to_version,reason_code,to_snapshot,
    idempotency_key,occurred_at,created_at) values(target_workspace_id,target_plan.id,target_membership_id,'plan-started',1,'pack-started',
    to_jsonb(target_plan),target_idempotency_key||':event',target_occurred_at,target_occurred_at);
  return jsonb_build_object('planId',target_plan.id,'version',1,'noOp',false);
end $$;

create or replace function public.transition_transaction_workflow_step(target_workspace_id uuid,target_membership_id uuid,target_step_id uuid,
  target_expected_version integer,target_state public.workflow_step_state,target_evidence_reference text,target_acknowledged boolean,
  target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare step public.transaction_workflow_steps%rowtype; replay public.transaction_workflow_events%rowtype; updated public.transaction_workflow_steps%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_state='proposed' or target_expected_version<1 or length(trim(target_reason_code)) not between 1 and 80
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' or target_occurred_at is null then raise exception 'invalid workflow step transition' using errcode='22023'; end if;
  select * into replay from public.transaction_workflow_events where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('stepId',replay.step_id,'version',replay.to_version,'noOp',true); end if;
  select * into step from public.transaction_workflow_steps where id=target_step_id and workspace_id=target_workspace_id for update;
  if not found then raise exception 'workflow step not found' using errcode='P0002'; end if;
  if step.current_version<>target_expected_version then raise exception 'workflow step version is stale' using errcode='40001'; end if;
  if target_state='completed' and step.evidence_requirement<>'none' and nullif(trim(target_evidence_reference),'') is null then
    raise exception 'workflow evidence is required' using errcode='22023'; end if;
  if target_state='completed' and step.acknowledgement_required and not target_acknowledged then
    raise exception 'workflow acknowledgement is required' using errcode='22023'; end if;
  update public.transaction_workflow_steps set state=target_state,evidence_reference=nullif(trim(target_evidence_reference),''),
    acknowledged_at=case when target_acknowledged then target_occurred_at else null end,current_version=current_version+1,updated_at=target_occurred_at
    where id=step.id returning * into updated;
  insert into public.transaction_workflow_events(workspace_id,plan_id,step_id,actor_membership_id,event_kind,from_version,to_version,
    reason_code,from_snapshot,to_snapshot,idempotency_key,occurred_at,created_at)
  values(target_workspace_id,step.plan_id,step.id,target_membership_id,'step-transitioned',step.current_version,updated.current_version,
    trim(target_reason_code),to_jsonb(step),to_jsonb(updated),target_idempotency_key,target_occurred_at,target_occurred_at);
  return jsonb_build_object('stepId',updated.id,'version',updated.current_version,'noOp',false);
end $$;

revoke all on function public.start_transaction_workflow_plan(uuid,uuid,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_workflow_step(uuid,uuid,uuid,integer,public.workflow_step_state,text,boolean,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.start_transaction_workflow_plan(uuid,uuid,uuid,uuid,uuid,text,timestamptz) to authenticated,service_role;
grant execute on function public.transition_transaction_workflow_step(uuid,uuid,uuid,integer,public.workflow_step_state,text,boolean,text,text,timestamptz) to authenticated,service_role;

commit;
