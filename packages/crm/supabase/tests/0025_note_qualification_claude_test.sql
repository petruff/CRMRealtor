begin;
select plan(16);

select has_column('public','contacts','qualification_status','contacts expose orthogonal qualification');
select has_column('public','notes','archived_at','notes expose reversible archive projection');
select has_table('public','note_lifecycle_events','note lifecycle evidence exists');
select ok(has_function_privilege('authenticated','public.archive_contact_note(uuid,text,uuid,timestamptz)','EXECUTE'),'archive is authenticated');
select ok(not has_table_privilege('authenticated','connector_private.workspace_ai_secret_envelopes','SELECT'),'AI envelope stays private');
select ok(has_function_privilege('authenticated','public.save_workspace_ai_configuration_v2(uuid,text,text,boolean,text,integer,jsonb,timestamptz)','EXECUTE'),'provider-aware save is authenticated');
select ok(has_table_privilege('authenticated','public.notes','SELECT'),'active members can read notes through RLS');
select ok(not has_table_privilege('authenticated','public.notes','UPDATE'),'note lifecycle metadata is RPC-only');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','15000000-0000-4000-8000-000000000025','authenticated','authenticated','story-325@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('25000000-0000-4000-8000-000000000025','Story 3.19');
select set_config('omnix.actor_user_id','15000000-0000-4000-8000-000000000025',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('35000000-0000-4000-8000-000000000025','25000000-0000-4000-8000-000000000025','15000000-0000-4000-8000-000000000025','owner','active');
insert into public.contacts(id,workspace_id,owner_id,first_name,last_name,lead_type,relationship,intent,source,pipeline_stage,tags)
values('45000000-0000-4000-8000-000000000025','25000000-0000-4000-8000-000000000025','15000000-0000-4000-8000-000000000025','Judith','Contact','hot','lead','unknown','other','new','{}');
insert into public.notes(id,contact_id,workspace_id,owner_id,body) values
('55000000-0000-4000-8000-000000000025','45000000-0000-4000-8000-000000000025','25000000-0000-4000-8000-000000000025','15000000-0000-4000-8000-000000000025','Original immutable note');

select is((select qualification_status::text from public.contacts where id='45000000-0000-4000-8000-000000000025'),'qualified','existing contacts default qualified');
update public.contacts set qualification_status='needs-qualification' where id='45000000-0000-4000-8000-000000000025';
select is((select lead_type::text||':'||qualification_status::text from public.contacts where id='45000000-0000-4000-8000-000000000025'),'hot:needs-qualification','Figure out does not change lead temperature');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000025',true);
select lives_ok($$select public.archive_contact_note('55000000-0000-4000-8000-000000000025','Outdated context','65000000-0000-4000-8000-000000000025','2026-08-17T14:00:00Z')$$,'owner archives note');
reset role;
select is((select body from public.notes where id='55000000-0000-4000-8000-000000000025'),'Original immutable note','archive preserves original body');
select is((select count(*)::integer from public.note_lifecycle_events where event_type='archived'),1,'archive appends evidence');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000025',true);
select lives_ok($$select public.restore_contact_note('55000000-0000-4000-8000-000000000025','75000000-0000-4000-8000-000000000025','2026-08-17T14:05:00Z')$$,'owner restores note');
reset role;
select ok((select archived_at is null from public.notes where id='55000000-0000-4000-8000-000000000025'),'restore returns note to active timeline');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000025',true);
select lives_ok($$select public.save_workspace_ai_configuration_v2(
 '25000000-0000-4000-8000-000000000025','anthropic-claude','claude-sonnet-4-20250514',true,'abcdef123456',0,
 '{"schemaVersion":"connector-secret-envelope.v1","algorithm":"AES-256-GCM","kekVersion":"v1","aadHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","encryptedDek":"ZW5jcnlwdGVk","encryptedDekIv":"aXYxMjM0NTY3ODkw","encryptedDekTag":"dGFnMTIzNDU2Nzg5MDEyMzQ1Ng==","ciphertext":"Y2lwaGVydGV4dA==","iv":"aXYxMjM0NTY3ODkw","tag":"dGFnMTIzNDU2Nzg5MDEyMzQ1Ng=="}'::jsonb,'2026-08-17T14:10:00Z')$$,'owner stores Claude through the existing encrypted authority');

select * from finish();
rollback;
