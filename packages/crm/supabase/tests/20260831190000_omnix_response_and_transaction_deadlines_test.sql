begin;
select '1..7';

do $$ begin
  if has_table_privilege('authenticated','public.transaction_milestones','INSERT')
     or has_table_privilege('authenticated','public.omnix_inbound_response_signals','UPDATE')
     or not has_function_privilege('authenticated','public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamp with time zone,text,timestamp with time zone)','EXECUTE')
     or has_function_privilege('authenticated','public.capture_omnix_inbound_response_signal()','EXECUTE')
     or has_function_privilege('authenticated','public.record_omnix_inbound_response_intelligence(uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text[],timestamp with time zone)','EXECUTE')
     or has_function_privilege('authenticated','public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer)','EXECUTE') then
    raise exception 'operational signal grants are unsafe';
  end if;
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.transaction_milestones'::regclass
      and conname='transaction_milestones_id_workspace_unique'
      and contype='u'
  ) then
    raise exception 'transaction milestone workspace identity is not protected';
  end if;
end $$;
select 'ok 1 - operational intelligence writes are RPC-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-81@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000002','authenticated','authenticated','other-81@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('82000000-0000-4000-8000-000000000001','Deadline workspace'),('82000000-0000-4000-8000-000000000002','Other deadline workspace');
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner','active'),
 ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Deal','Contact','referral');
insert into public.real_estate_transactions(id,workspace_id,contact_id,status,side,property_address,source,
 expected_close_date,gross_commission_cents,created_by_membership_id,idempotency_key,created_at,updated_at)
values('85000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',
 'under-contract','buyer','1 Main Street','referral','2026-09-30',1200000,'83000000-0000-4000-8000-000000000001',
 '86000000-0000-4000-8000-000000000001','2026-08-31T12:00:00Z','2026-08-31T12:00:00Z');
do $$ begin if not exists(select 1 from public.transaction_milestones where transaction_id='85000000-0000-4000-8000-000000000001' and kind='closing' and label='Expected closing') then raise exception 'expected close was not materialized'; end if; end $$;
select 'ok 2 - a verified expected close becomes a closing deadline';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ declare receipt jsonb; begin
  receipt:=public.create_transaction_milestone('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000001','inspection','Inspection period','2026-09-05T12:00:00Z',
    'deadline:inspection:81','2026-08-31T12:01:00Z');
  perform set_config('omnix.deadline_id',receipt->>'milestoneId',true);
  if (receipt->>'noOp')::boolean then raise exception 'deadline unexpectedly replayed'; end if;
end $$;
select 'ok 3 - an active member can create a verified deadline';

do $$ declare receipt jsonb; begin
  receipt:=public.create_transaction_milestone('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000001','inspection','Inspection period','2026-09-05T12:00:00Z',
    'deadline:inspection:81','2026-08-31T12:01:00Z');
  if not (receipt->>'noOp')::boolean or receipt->>'milestoneId'<>current_setting('omnix.deadline_id') then raise exception 'deadline replay failed'; end if;
end $$;
select 'ok 4 - deadline creation is idempotent';

select public.transition_transaction_milestone('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
 current_setting('omnix.deadline_id')::uuid,1,'completed','deadline:inspection:81:complete','2026-09-04T12:00:00Z');
do $$ begin if not exists(select 1 from public.transaction_milestones where id=current_setting('omnix.deadline_id')::uuid and state='completed' and current_version=2 and completed_at is not null) then raise exception 'deadline completion failed'; end if; end $$;
select 'ok 5 - deadline transitions are versioned and auditable';

do $$ begin
  begin
    update public.transaction_milestone_events set reason_code='changed' where milestone_id=current_setting('omnix.deadline_id')::uuid;
    raise exception 'deadline events were mutable';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 6 - authenticated members cannot mutate deadline evidence';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
do $$ declare visible integer; begin
  select count(*) into visible from public.transaction_milestones where workspace_id='82000000-0000-4000-8000-000000000001';
  if visible<>0 then raise exception 'deadline RLS leaked another workspace'; end if;
end $$;
select 'ok 7 - operational intelligence is workspace isolated';

rollback;
