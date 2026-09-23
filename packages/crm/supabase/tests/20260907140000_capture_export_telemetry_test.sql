begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','10100000-0000-4000-8000-000000000001','authenticated','authenticated','brief-owner@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','10100000-0000-4000-8000-000000000002','authenticated','authenticated','brief-assistant@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','10100000-0000-4000-8000-000000000003','authenticated','authenticated','brief-other@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('20100000-0000-4000-8000-000000000001','Brief workspace'),('20100000-0000-4000-8000-000000000002','Other brief workspace');
select set_config('omnix.actor_user_id','10100000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('30100000-0000-4000-8000-000000000001','20100000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000001','owner','active'),
 ('30100000-0000-4000-8000-000000000002','20100000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000002','assistant','active'),
 ('30100000-0000-4000-8000-000000000003','20100000-0000-4000-8000-000000000002','10100000-0000-4000-8000-000000000003','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('40100000-0000-4000-8000-000000000001','10100000-0000-4000-8000-000000000001','20100000-0000-4000-8000-000000000001','Avery','Buyer','referral');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000002',true);
select lives_ok($$insert into public.capture_run_telemetry(correlation_id,workspace_id,actor_membership_id,contact_id,source_hash,state,reason,policy_version,duration_ms,estimated_input_tokens,reserved_output_tokens,charged_upper_bound_microusd,accounting) values('60100000-0000-4000-8000-000000000001','20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002','40100000-0000-4000-8000-000000000001',repeat('a',64),'unconfigured','not-configured','capture-extraction-policy.v1',0,0,0,0,'not-reserved')$$,'assistant can append scoped redacted telemetry');
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.capture_run_telemetry),1::bigint,'owner reads workspace telemetry');
select throws_ok($$insert into public.capture_run_telemetry(correlation_id,workspace_id,actor_membership_id,contact_id,source_hash,state,reason,policy_version,duration_ms,estimated_input_tokens,reserved_output_tokens,charged_upper_bound_microusd,accounting) values('60100000-0000-4000-8000-000000000002','20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002','40100000-0000-4000-8000-000000000001',repeat('a',64),'unconfigured','not-configured','capture-extraction-policy.v1',0,0,0,0,'not-reserved')$$,'42501',null,'actor cannot borrow assistant identity');
select throws_ok($$update public.capture_run_telemetry set state='available'$$,'42501',null,'telemetry cannot be rewritten');
select throws_ok($$delete from public.capture_run_telemetry$$,'42501',null,'telemetry cannot be deleted');
select lives_ok($$select public.record_data_export_receipt('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000001','capture-outcomes','json','{"captureId":"test-current-review","includeSource":true}',repeat('a',64),1,'succeeded','60100000-0000-4000-8000-000000000004',now())$$,'owner can record bounded JSON review export');
select is((select count(*) from public.data_export_receipts where entity_type='capture-outcomes' and format='json'),1::bigint,'JSON receipt is persisted');
select set_config('request.jwt.claim.sub','10100000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.capture_run_telemetry),0::bigint,'other workspace sees no metadata');
select throws_ok($$select public.record_data_export_receipt('20100000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002','capture-outcomes','json','{}',repeat('a',64),1,'succeeded','60100000-0000-4000-8000-000000000003',now())$$,'42501',null,'cross-workspace export receipt is rejected');
select * from finish();
rollback;
