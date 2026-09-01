begin;
select plan(5);

select ok(
  has_function_privilege('service_role','public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer)','EXECUTE')
  and has_function_privilege('service_role','public.finalize_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.reserve_omnix_ai_service_budget(uuid,uuid,uuid,text,integer,integer,integer)','EXECUTE'),
  'AI service budget authority remains service-only');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','17200000-0000-4000-8000-000000000071','authenticated','authenticated',
  'owner-712@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('27200000-0000-4000-8000-000000000071','AI lint workspace');
insert into public.workspace_members(id,workspace_id,user_id,role,status)
values('37200000-0000-4000-8000-000000000071','27200000-0000-4000-8000-000000000071',
  '17200000-0000-4000-8000-000000000071','owner','active');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare receipt jsonb; begin
  receipt:=public.reserve_omnix_ai_service_budget(
    '27200000-0000-4000-8000-000000000071','37200000-0000-4000-8000-000000000071',
    '47200000-0000-4000-8000-000000000071','omnix-ai-policy.v1',2000,10000,1000000);
  perform set_config('omnix.story712_reservation',receipt->>'reservation_id',true);
end $$;
select ok(current_setting('omnix.story712_reservation',true) is not null,'service budget reservation succeeds');
select is((select count(*)::integer from public.omnix_ai_usage_windows
  where workspace_id='27200000-0000-4000-8000-000000000071'),1,'one daily usage window is created');

select public.finalize_omnix_ai_service_budget(
  '27200000-0000-4000-8000-000000000071','37200000-0000-4000-8000-000000000071',
  current_setting('omnix.story712_reservation')::uuid,'succeeded',200,40,350,null);
select is((select committed_microusd::integer from public.omnix_ai_usage_windows
  where workspace_id='27200000-0000-4000-8000-000000000071'),350,'finalization reconciles estimated and actual cost');
select throws_ok(format($sql$select public.finalize_omnix_ai_service_budget(
  '27200000-0000-4000-8000-000000000071','37200000-0000-4000-8000-000000000071',
  %L::uuid,'failed',200,0,100,'provider-failed')$sql$,current_setting('omnix.story712_reservation')),
  '40001','Omnix AI run already finalized','one reservation can be finalized only once');

select * from finish();
rollback;
