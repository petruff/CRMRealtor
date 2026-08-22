begin;
select plan(16);
select has_table('public','data_mapping_profiles','mapping profiles exist');
select has_table('public','data_import_runs','import evidence exists');
select has_table('public','data_export_receipts','export evidence exists');
select has_table('public','operational_api_keys','api key authority exists');
select has_table('public','generic_webhook_endpoints','generic webhook authority exists');
select has_function('public','authenticate_operational_api_key',array['text','text','timestamp with time zone'],'narrow API auth RPC exists');
select ok(not has_function_privilege('authenticated','public.authenticate_operational_api_key(text,text,timestamptz)','execute'),'authenticated cannot call API authenticator');
select ok(has_function_privilege('service_role','public.authenticate_operational_api_key(text,text,timestamptz)','execute'),'service role may call only narrow authenticator');
select ok(not has_function_privilege('authenticated','public.execute_operational_contacts_api(text,text,text,jsonb,text,uuid,timestamptz)','execute'),'authenticated cannot bypass operational API');
select ok(has_function_privilege('service_role','public.execute_operational_contacts_api(text,text,text,jsonb,text,uuid,timestamptz)','execute'),'service may execute narrow operational contact RPC');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000023','authenticated','authenticated','portability@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values ('21000000-0000-4000-8000-000000000023','Portability');
select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000023',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('31000000-0000-4000-8000-000000000023','21000000-0000-4000-8000-000000000023','11000000-0000-4000-8000-000000000023','owner','active');
set constraints all immediate; set constraints all deferred;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000023',true);

select lives_ok($$select public.create_operational_api_key('21000000-0000-4000-8000-000000000023','Automation','omx_abcdefghijkl','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',array['contacts.read','intake.create'],now()+interval '1 day','31000000-0000-4000-8000-000000000023',now())$$,'owner creates a scoped hashed key');
select lives_ok($$select public.record_data_import_run('21000000-0000-4000-8000-000000000023','31000000-0000-4000-8000-000000000023',null,null,'manual','csv','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','import-replay','succeeded','{"total":1,"created":1}'::jsonb,'[{"rowNumber":1,"outcome":"created"}]'::jsonb,now(),now(),'51000000-0000-4000-8000-000000000023')$$,'first immutable import receipt succeeds');
select lives_ok($$select public.record_data_import_run('21000000-0000-4000-8000-000000000023','31000000-0000-4000-8000-000000000023',null,null,'manual','csv','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','import-replay','succeeded','{"total":1,"created":1}'::jsonb,'[{"rowNumber":1,"outcome":"created"}]'::jsonb,now(),now(),'51000000-0000-4000-8000-000000000023')$$,'exact import replay reads immutable evidence without updating it');
select throws_ok($$select public.record_data_import_run('21000000-0000-4000-8000-000000000023','31000000-0000-4000-8000-000000000023',null,null,'manual','csv','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','import-replay','succeeded','{"total":1,"created":1}'::jsonb,'[{"rowNumber":1,"outcome":"created"}]'::jsonb,now(),now(),'51000000-0000-4000-8000-000000000024')$$,'23505',null,'divergent import replay fails closed');

reset role;
set local role service_role;
select is((public.execute_operational_contacts_api('omx_abcdefghijkl','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','intake.create','{"source":"partner","externalId":"lead-23","candidate":{"firstName":"Ada"}}'::jsonb,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','61000000-0000-4000-8000-000000000023',now())#>>'{meta,noOp}')::boolean,false,'external intake creates a workspace-bound quarantine record');
select is((public.execute_operational_contacts_api('omx_abcdefghijkl','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','intake.create','{"source":"partner","externalId":"lead-23","candidate":{"firstName":"Ada"}}'::jsonb,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','61000000-0000-4000-8000-000000000024',now())#>>'{meta,noOp}')::boolean,true,'external intake exact replay is a no-op');
select * from finish(); rollback;
