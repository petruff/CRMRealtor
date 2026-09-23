begin;
select '1..10';

do $$ begin
  if has_table_privilege('authenticated','public.omnix_nurture_plans','INSERT')
     or has_table_privilege('authenticated','public.omnix_nurture_plan_events','UPDATE')
     or not has_function_privilege('authenticated','public.create_omnix_nurture_plan(uuid,uuid,uuid,integer,integer,timestamp with time zone,uuid,text,timestamp with time zone)','EXECUTE')
     or not has_function_privilege('authenticated','public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamp with time zone,text,uuid,text,timestamp with time zone)','EXECUTE')
     or has_function_privilege('authenticated','public.claim_due_omnix_nurture_plans(uuid,text,timestamp with time zone,integer,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.claim_due_omnix_nurture_plans(uuid,text,timestamp with time zone,integer,integer)','EXECUTE') then
    raise exception 'nurture lifecycle grants are unsafe';
  end if;
end $$;
select 'ok 1 - nurture writes are RPC-only and event evidence is protected';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','71000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-71@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','71000000-0000-4000-8000-000000000002','authenticated','authenticated','other-71@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('72000000-0000-4000-8000-000000000001','Nurture workspace'),
 ('72000000-0000-4000-8000-000000000002','Other nurture workspace');
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','owner','active'),
 ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name) values
 ('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Nurture','Contact'),
 ('74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Scheduled','Contact');
insert into public.omnix_action_proposals(
  id,workspace_id,contact_id,kind,state,origin,approval_mode,priority,priority_score,priority_factors,
  title,rationale,current_version,correlation_id,idempotency_key,expires_at,created_by_kind,
  created_by_membership_id,decided_by_membership_id,decided_at,created_at,updated_at
) values(
  '75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001','nurture-plan','executing','deterministic','owner','p3',120000,
  '{"urgency":30,"leadTemperature":"unknown","daysOverdue":0,"awaitingReply":false,"potentialValueCents":0}',
  'Start nurture','A governed relationship plan was approved.',1,'76000000-0000-4000-8000-000000000001',
  'nurture-proposal:71','2026-09-30T12:00:00Z','member','73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001','2026-08-31T12:00:00Z','2026-08-31T11:00:00Z','2026-08-31T12:00:00Z'
),(
  '75000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002','nurture-plan','executing','deterministic','owner','p3',120000,
  '{"urgency":30,"leadTemperature":"unknown","daysOverdue":0,"awaitingReply":false,"potentialValueCents":0}',
  'Start scheduled nurture','A governed relationship plan was approved.',1,'76000000-0000-4000-8000-000000000002',
  'nurture-proposal:72','2026-09-30T12:00:00Z','member','73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001','2026-08-31T12:00:00Z','2026-08-31T11:00:00Z','2026-08-31T12:00:00Z'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$ declare plan public.omnix_nurture_plans; begin
  plan:=public.create_omnix_nurture_plan(
    '72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',30,12,'2026-09-01T12:00:00Z',
    '73000000-0000-4000-8000-000000000001','nurture-plan:71','2026-08-31T12:01:00Z');
  if plan.state<>'active' or plan.version<>1 then raise exception 'nurture plan creation failed'; end if;
  perform set_config('omnix.nurture_plan_id',plan.id::text,true);
end $$;
select 'ok 2 - exact approved proposal starts one active nurture plan';

do $$ declare plan public.omnix_nurture_plans; begin
  plan:=public.create_omnix_nurture_plan(
    '72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',30,12,'2026-09-01T12:00:00Z',
    '73000000-0000-4000-8000-000000000001','nurture-plan:71','2026-08-31T12:01:00Z');
  if plan.id<>current_setting('omnix.nurture_plan_id')::uuid then raise exception 'nurture replay changed identity'; end if;
end $$;
select 'ok 3 - nurture plan creation is idempotent';

select public.transition_omnix_nurture_plan(
  '72000000-0000-4000-8000-000000000001',current_setting('omnix.nurture_plan_id')::uuid,1,'pause',null,null,
  '73000000-0000-4000-8000-000000000001','nurture:71:pause','2026-08-31T12:02:00Z');
do $$ begin if not exists(select 1 from public.omnix_nurture_plans
  where id=current_setting('omnix.nurture_plan_id')::uuid and state='paused' and version=2)
  then raise exception 'pause failed'; end if; end $$;
select 'ok 4 - an active nurture plan can be paused';

select public.transition_omnix_nurture_plan(
  '72000000-0000-4000-8000-000000000001',current_setting('omnix.nurture_plan_id')::uuid,2,'resume',null,null,
  '73000000-0000-4000-8000-000000000001','nurture:71:resume','2026-08-31T12:03:00Z');
select public.transition_omnix_nurture_plan(
  '72000000-0000-4000-8000-000000000001',current_setting('omnix.nurture_plan_id')::uuid,3,'snooze','2026-09-03T12:00:00Z',null,
  '73000000-0000-4000-8000-000000000001','nurture:71:snooze','2026-08-31T12:04:00Z');
do $$ begin if not exists(select 1 from public.omnix_nurture_plans
  where id=current_setting('omnix.nurture_plan_id')::uuid and state='snoozed' and version=4
    and snoozed_until='2026-09-03T12:00:00Z') then raise exception 'resume or snooze failed'; end if; end $$;
select 'ok 5 - resume and future snooze preserve monotonic versions';

select public.transition_omnix_nurture_plan(
  '72000000-0000-4000-8000-000000000001',current_setting('omnix.nurture_plan_id')::uuid,4,'stop',null,'Client requested no further nurture.',
  '73000000-0000-4000-8000-000000000001','nurture:71:stop','2026-08-31T12:05:00Z');
do $$ begin if not exists(select 1 from public.omnix_nurture_plans
  where id=current_setting('omnix.nurture_plan_id')::uuid and state='stopped' and version=5
    and next_step_at is null) then raise exception 'stop failed'; end if; end $$;
select 'ok 6 - stop is terminal and clears scheduled work';

do $$ begin
  begin
    update public.omnix_nurture_plan_events set action='resume'
      where plan_id=current_setting('omnix.nurture_plan_id')::uuid;
    raise exception 'nurture events were mutable';
  exception when check_violation or insufficient_privilege then null; end;
end $$;
select 'ok 7 - nurture lifecycle evidence is append-only';

do $$ declare plan public.omnix_nurture_plans; begin
  plan:=public.create_omnix_nurture_plan(
    '72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000002',30,2,'2026-08-31T12:10:00Z',
    '73000000-0000-4000-8000-000000000001','nurture-plan:72','2026-08-31T12:10:00Z');
  perform set_config('omnix.scheduled_plan_id',plan.id::text,true);
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare claimed public.omnix_nurture_plans; begin
  select * into claimed from public.claim_due_omnix_nurture_plans(
    '72000000-0000-4000-8000-000000000001','worker-71','2026-08-31T12:11:00Z',90,10)
    where id=current_setting('omnix.scheduled_plan_id')::uuid;
  if claimed.id is null or claimed.fencing_token<1 then raise exception 'due nurture plan was not fenced'; end if;
  perform set_config('omnix.scheduled_fence',claimed.fencing_token::text,true);
end $$;
select 'ok 8 - scheduler claims due plans with a fencing token';

insert into public.omnix_action_proposals(
  id,workspace_id,contact_id,kind,state,origin,approval_mode,priority,priority_score,priority_factors,
  title,rationale,current_version,correlation_id,idempotency_key,expires_at,created_by_kind,created_at,updated_at
) values(
  '75000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002','task-create','pending','deterministic','active-member','p3',240000,
  '{"urgency":60,"leadTemperature":"unknown","daysOverdue":0,"awaitingReply":false,"potentialValueCents":0}',
  'Nurture step','The approved nurture plan is due.',1,'76000000-0000-4000-8000-000000000003',
  'nurture-step:72:1','2026-09-07T12:00:00Z','system','2026-08-31T12:11:00Z','2026-08-31T12:11:00Z'
);
select public.complete_omnix_nurture_step(
  '72000000-0000-4000-8000-000000000001',current_setting('omnix.scheduled_plan_id')::uuid,
  'worker-71',current_setting('omnix.scheduled_fence')::bigint,1,
  '75000000-0000-4000-8000-000000000003','nurture-step:72:1:materialized','2026-08-31T12:11:30Z');
do $$ begin if not exists(select 1 from public.omnix_nurture_plans
  where id=current_setting('omnix.scheduled_plan_id')::uuid and current_step=1 and version=2
    and state='active' and lease_owner is null and next_step_at>'2026-08-31T12:11:30Z')
  then raise exception 'fenced nurture completion failed'; end if; end $$;
select 'ok 9 - scheduler completion requires a pending proposal and advances one step';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ declare visible integer; begin
  select count(*) into visible from public.omnix_nurture_plans
    where workspace_id='72000000-0000-4000-8000-000000000001';
  if visible<>0 then raise exception 'nurture RLS leaked another workspace'; end if;
end $$;
select 'ok 10 - nurture plans are workspace isolated';

rollback;
