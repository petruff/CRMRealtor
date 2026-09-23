begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select ok(not has_table_privilege('authenticated','public.website_intake_submissions','INSERT') and has_function_privilege('service_role','public.claim_website_intake_submission(uuid,text,text,text,text,text,text,timestamp with time zone)','EXECUTE'),'anonymous intake persists only through the service RPC');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','19100000-0000-4000-8000-000000000091','authenticated','authenticated','owner-92@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-8000-000000000000','19100000-0000-4000-8000-000000000092','authenticated','authenticated','assistant-92@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','19100000-0000-4000-8000-000000000093','authenticated','authenticated','other-92@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('29100000-0000-4000-8000-000000000091','Website workspace'),('29100000-0000-4000-8000-000000000092','Other website workspace');
select set_config('omnix.actor_user_id','19100000-0000-4000-8000-000000000091',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('39100000-0000-4000-8000-000000000091','29100000-0000-4000-8000-000000000091','19100000-0000-4000-8000-000000000091','owner','active'),
 ('39100000-0000-4000-8000-000000000092','29100000-0000-4000-8000-000000000091','19100000-0000-4000-8000-000000000092','assistant','active'),
 ('39100000-0000-4000-8000-000000000093','29100000-0000-4000-8000-000000000092','19100000-0000-4000-8000-000000000093','owner','active');

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000092',true);
select throws_ok($sql$select public.configure_website_intake_endpoint('29100000-0000-4000-8000-000000000091','39100000-0000-4000-8000-000000000092','judith-web','Judith website',array['https://judith.example'],1,5,'39100000-0000-4000-8000-000000000091','2026-08-31T12:00:00Z')$sql$,'42501','owner authority required','assistant cannot configure a public endpoint');
select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000091',true);
select ok((public.configure_website_intake_endpoint('29100000-0000-4000-8000-000000000091','39100000-0000-4000-8000-000000000091','judith-web','Judith website',array['https://judith.example'],1,5,'39100000-0000-4000-8000-000000000091','2026-08-31T12:00:00Z')->>'enabled')::boolean,'owner configures a bounded endpoint');
select throws_ok($sql$select public.configure_website_intake_endpoint('29100000-0000-4000-8000-000000000091','39100000-0000-4000-8000-000000000091','unsafe-web','Unsafe',array['http://judith.example'],1,5,'39100000-0000-4000-8000-000000000091','2026-08-31T12:00:00Z')$sql$,'22023','invalid website origin','non-HTTPS origin fails closed');

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare receipt jsonb; begin receipt:=public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','judith-web','website:lead-0001',repeat('a',64),'https://judith.example',repeat('b',64),repeat('c',64),'2026-08-31T12:01:00Z');perform set_config('omnix.story92_submission',receipt->>'submissionId',true);perform set_config('omnix.story92_support',receipt->>'supportReference',true);end $$;
select ok(current_setting('omnix.story92_submission',true) is not null,'valid service claim creates a processing submission');
select is(public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','judith-web','website:lead-0001',repeat('a',64),'https://judith.example',repeat('b',64),repeat('c',64),'2026-08-31T12:01:30Z')->>'outcome','processing','concurrent replay does not duplicate work');
select is(public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','judith-web','website:lead-0001',repeat('d',64),'https://judith.example',repeat('b',64),repeat('c',64),'2026-08-31T12:01:31Z')->>'outcome','conflict','same idempotency key with different body fails closed');
select is(public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','judith-web','website:lead-0002',repeat('d',64),'https://evil.example',repeat('b',64),repeat('c',64),'2026-08-31T12:01:32Z')->>'outcome','origin-denied','unapproved origin is denied and recorded safely');
select is(public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','judith-web','website:lead-0003',repeat('e',64),'https://judith.example',repeat('b',64),repeat('c',64),'2026-08-31T12:01:33Z')->>'outcome','rate-limited','atomic endpoint rate limit rejects excess intake');

reset role;
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values('49100000-0000-4000-8000-000000000091','19100000-0000-4000-8000-000000000091','29100000-0000-4000-8000-000000000091','Avery','Buyer','website');
insert into public.tasks(id,workspace_id,contact_id,title,due_at,creator_membership_id,assignee_membership_id,create_idempotency_key,create_request_hash,created_at,updated_at) values('59100000-0000-4000-8000-000000000091','29100000-0000-4000-8000-000000000091','49100000-0000-4000-8000-000000000091','Respond to Avery Buyer website lead','2026-08-31T12:06:00Z','39100000-0000-4000-8000-000000000091','39100000-0000-4000-8000-000000000091','website:task:0001',repeat('f',64),'2026-08-31T12:01:00Z','2026-08-31T12:01:00Z');
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
select is(public.finalize_website_intake_submission('29100000-0000-4000-8000-000000000091',current_setting('omnix.story92_submission')::uuid,'49100000-0000-4000-8000-000000000091','59100000-0000-4000-8000-000000000091','created','{"source":"instagram","medium":"social","campaign":"waterfront","formId":"property-interest","landingPage":"https://judith.example/listing"}'::jsonb,'{"email":"granted","sms":"unknown","phone":"granted","policyVersion":"privacy-v1"}'::jsonb,'{"policyVersion":"omnix.website-intake.v1","leadType":"hot","qualificationStatus":"qualified","reasons":["showing-requested"]}'::jsonb,'2026-08-31T12:01:05Z')->>'status','completed','finalization records the canonical contact and task');
select is((select count(*)::integer from public.contact_attribution_events where submission_id=current_setting('omnix.story92_submission')::uuid),3,'first, last, and lead-conversion attribution remain append-only');
select is((select count(*)::integer from public.contact_consent_events where submission_id=current_setting('omnix.story92_submission')::uuid),3,'channel consent evidence is explicit');
select is((select due_at from public.website_response_slas where submission_id=current_setting('omnix.story92_submission')::uuid),'2026-08-31T12:06:00Z'::timestamptz,'response SLA uses endpoint policy exactly');
select ok((public.finalize_website_intake_submission('29100000-0000-4000-8000-000000000091',current_setting('omnix.story92_submission')::uuid,'49100000-0000-4000-8000-000000000091','59100000-0000-4000-8000-000000000091','created','{}','{}','{}','2026-08-31T12:02:00Z')->>'noOp')::boolean,'finalization replay is idempotent');
select is(public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','judith-web','website:lead-0001',repeat('a',64),'https://judith.example',repeat('b',64),repeat('c',64),'2026-08-31T12:02:01Z')->>'outcome','replay','terminal request returns durable replay');
reset role;
select throws_ok(format($sql$update public.contact_attribution_events set source='changed' where submission_id=%L::uuid$sql$,current_setting('omnix.story92_submission')),'55000','website intake history is append-only','attribution history cannot be rewritten');

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000091',true);
select ok(not has_function_privilege('authenticated','public.claim_website_intake_submission(uuid,text,text,text,text,text,text,timestamp with time zone)','EXECUTE'),'browser members cannot call the public intake worker RPC');
select is((select count(*)::integer from public.website_intake_submissions where workspace_id='29100000-0000-4000-8000-000000000091'),3,'owner sees the workspace intake ledger');
select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000093',true);
select is((select count(*)::integer from public.website_intake_submissions where workspace_id='29100000-0000-4000-8000-000000000091'),0,'RLS hides intake evidence from another workspace');

reset role;
select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000091',true); set local role authenticated;
select ok((public.configure_website_intake_endpoint('29100000-0000-4000-8000-000000000091','39100000-0000-4000-8000-000000000091','recovery-web','Recovery endpoint',array['https://judith.example'],60,10,'39100000-0000-4000-8000-000000000091','2026-08-31T12:04:00Z')->>'enabled')::boolean,'owner can configure a separate recovery endpoint');
reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare receipt jsonb; begin receipt:=public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','recovery-web','website:recover-1',repeat('4',64),'https://judith.example',repeat('5',64),repeat('6',64),'2026-08-31T12:05:00Z');perform set_config('omnix.story92_recovery',receipt->>'submissionId',true);end $$;
select is(public.fail_website_intake_submission('29100000-0000-4000-8000-000000000091',current_setting('omnix.story92_recovery')::uuid,'downstream-unavailable','2026-08-31T12:05:01Z')->>'status','failed','downstream failure is explicit and recoverable');
select is((public.claim_website_intake_submission('29100000-0000-4000-8000-000000000091','recovery-web','website:recover-1',repeat('4',64),'https://judith.example',repeat('5',64),repeat('6',64),'2026-08-31T12:05:02Z')->>'outcome'),'accepted','exact failed request can resume safely');
select is(public.review_website_intake_submission('29100000-0000-4000-8000-000000000091',current_setting('omnix.story92_recovery')::uuid,'{"source":"website","formId":"qualification","landingPage":"https://judith.example/contact"}'::jsonb,'{"email":"unknown","sms":"unknown","phone":"unknown","policyVersion":"privacy-v1"}'::jsonb,'{"policyVersion":"omnix.website-intake.v1","leadType":"nurture","qualificationStatus":"needs-qualification","reasons":["ambiguous-identity"]}'::jsonb,'ambiguous-identity','2026-08-31T12:05:03Z')->>'status','review','ambiguous canonical identity enters review without a contact or response task');
select ok((public.review_website_intake_submission('29100000-0000-4000-8000-000000000091',current_setting('omnix.story92_recovery')::uuid,'{}','{}','{}','ambiguous-identity','2026-08-31T12:05:04Z')->>'noOp')::boolean,'review replay is idempotent');

select * from finish();
rollback;
