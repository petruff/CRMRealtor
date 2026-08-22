begin;
select plan(14);

select has_table('public','workspace_ai_configurations','redacted workspace AI state exists');
select has_table('connector_private','workspace_ai_secret_envelopes','private encrypted AI envelope exists');
select ok(not has_table_privilege('authenticated','public.workspace_ai_configurations','INSERT'),'authenticated cannot insert settings directly');
select ok(not has_table_privilege('authenticated','connector_private.workspace_ai_secret_envelopes','SELECT'),'authenticated cannot read encrypted envelopes');
select ok(has_function_privilege('authenticated','public.save_workspace_ai_configuration(uuid,text,boolean,text,integer,jsonb,timestamptz)','EXECUTE'),'owner-facing save RPC is authenticated');
select ok(not has_function_privilege('authenticated','public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)','EXECUTE'),'secret read is not browser callable');
select ok(has_function_privilege('service_role','public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)','EXECUTE'),'secret read is service-only');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','14000000-0000-4000-8000-000000000024','authenticated','authenticated','ai-owner@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','14000000-0000-4000-8000-000000000025','authenticated','authenticated','ai-assistant@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values ('24000000-0000-4000-8000-000000000024','AI Settings');
select set_config('omnix.actor_user_id','14000000-0000-4000-8000-000000000024',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('34000000-0000-4000-8000-000000000024','24000000-0000-4000-8000-000000000024','14000000-0000-4000-8000-000000000024','owner','active');
select set_config('omnix.actor_user_id','14000000-0000-4000-8000-000000000025',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('34000000-0000-4000-8000-000000000025','24000000-0000-4000-8000-000000000024','14000000-0000-4000-8000-000000000025','assistant','active');
set constraints all immediate; set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000024',true);

select lives_ok($$select public.save_workspace_ai_configuration(
  '24000000-0000-4000-8000-000000000024','gemini-3.5-flash-lite',true,'abcdef123456',0,
  '{"schemaVersion":"connector-secret-envelope.v1","algorithm":"AES-256-GCM","kekVersion":"v1","aadHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","encryptedDek":"ZW5jcnlwdGVk","encryptedDekIv":"aXYxMjM0NTY3ODkw","encryptedDekTag":"dGFnMTIzNDU2Nzg5MDEyMzQ1Ng==","ciphertext":"Y2lwaGVydGV4dA==","iv":"aXYxMjM0NTY3ODkw","tag":"dGFnMTIzNDU2Nzg5MDEyMzQ1Ng=="}'::jsonb,
  '2026-08-14T12:00:00Z')$$,'owner saves encrypted Gemini configuration');
select is((select count(*)::integer from public.workspace_ai_configurations where enabled),1,'redacted enabled projection is visible');
select ok(not ((select to_jsonb(configuration) from public.workspace_ai_configurations configuration limit 1)::text like '%ciphertext%'),'public projection contains no envelope');

select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000025',true);
select throws_ok($$select public.set_workspace_ai_enabled('24000000-0000-4000-8000-000000000024',1,false,now())$$,'42501',null,'assistant cannot change AI settings');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is((public.read_workspace_ai_secret_envelope(
  '24000000-0000-4000-8000-000000000024','14000000-0000-4000-8000-000000000025','34000000-0000-4000-8000-000000000025'
)#>>'{secretVersion}')::integer,1,'service read is bound to an active workspace member and current version');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000024',true);
select lives_ok($$select public.remove_workspace_ai_configuration('24000000-0000-4000-8000-000000000024',1,now())$$,'owner cryptoshreds the Gemini key');
reset role;
select is((select count(*)::integer from connector_private.workspace_ai_secret_envelopes),0,'removal deletes the private envelope');

select * from finish();
rollback;
