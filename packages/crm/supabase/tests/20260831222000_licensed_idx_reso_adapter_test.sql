begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select ok(not has_table_privilege('authenticated','public.listing_provider_authorities','INSERT') and has_function_privilege('service_role','public.claim_listing_sync(uuid,text,text,text,text,timestamp with time zone)','EXECUTE'),'provider persistence is RPC-governed');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','19200000-0000-4000-8000-000000000091','authenticated','authenticated','owner-93@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','19200000-0000-4000-8000-000000000092','authenticated','authenticated','assistant-93@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','19200000-0000-4000-8000-000000000093','authenticated','authenticated','other-93@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('29200000-0000-4000-8000-000000000091','Licensed listing workspace'),('29200000-0000-4000-8000-000000000092','Other listing workspace');
select set_config('omnix.actor_user_id','19200000-0000-4000-8000-000000000091',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('39200000-0000-4000-8000-000000000091','29200000-0000-4000-8000-000000000091','19200000-0000-4000-8000-000000000091','owner','active'),
 ('39200000-0000-4000-8000-000000000092','29200000-0000-4000-8000-000000000091','19200000-0000-4000-8000-000000000092','assistant','active'),
 ('39200000-0000-4000-8000-000000000093','29200000-0000-4000-8000-000000000092','19200000-0000-4000-8000-000000000093','owner','active');

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
select is(public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0000',repeat('a',64),null,'2026-08-31T12:00:00Z')->>'outcome','disabled','unconfigured licensed data performs no work');
reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','19200000-0000-4000-8000-000000000092',true);
select throws_ok($sql$select public.configure_listing_provider_authority('29200000-0000-4000-8000-000000000091','39200000-0000-4000-8000-000000000092','reso-provider','Licensed feed','pending','agreement:MLS-2026-001',null,'2026-08-31T12:00:00Z','2027-08-31T12:00:00Z','Licensed MLS','https://provider.example/attribution',15,24,48,12,false,'2026-08-31T12:00:00Z')$sql$,'42501','owner authority required','assistant cannot configure listing rights');
select set_config('request.jwt.claim.sub','19200000-0000-4000-8000-000000000091',true);
select throws_ok($sql$select public.configure_listing_provider_authority('29200000-0000-4000-8000-000000000091','39200000-0000-4000-8000-000000000091','reso-provider','Licensed feed','active','agreement:MLS-2026-001',null,'2026-08-31T12:00:00Z','2027-08-31T12:00:00Z','Licensed MLS','https://provider.example/attribution',15,24,48,12,false,'2026-08-31T12:00:00Z')$sql$,'22023','invalid listing provider authority','active state requires server credential binding');
select is(public.configure_listing_provider_authority('29200000-0000-4000-8000-000000000091','39200000-0000-4000-8000-000000000091','reso-provider','Licensed feed','pending','agreement:MLS-2026-001',null,'2026-08-31T12:00:00Z','2027-08-31T12:00:00Z','Licensed MLS','https://provider.example/attribution',15,24,48,12,false,'2026-08-31T12:00:00Z')->>'state','pending','owner can record rights without activating the provider');
select is(public.configure_listing_provider_authority('29200000-0000-4000-8000-000000000091','39200000-0000-4000-8000-000000000091','reso-provider','Licensed feed','active','agreement:MLS-2026-001','server-secret:reso-provider','2026-08-31T12:00:00Z','2027-08-31T12:00:00Z','Licensed MLS','https://provider.example/attribution',15,24,48,12,false,'2026-08-31T12:01:00Z')->>'state','active','complete rights and binding can activate the provider');
select is((select credential_binding_reference from public.listing_provider_authorities where provider_key='reso-provider'),'server-secret:reso-provider','database stores only a server binding reference');
select throws_ok($sql$select public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0001',repeat('b',64),null,'2026-08-31T12:02:00Z')$sql$,'42501','permission denied for function claim_listing_sync','browser members cannot claim provider work');

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare receipt jsonb; begin receipt:=public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0001',repeat('b',64),null,'2026-08-31T12:02:00Z');perform set_config('omnix.story93_run',receipt->>'runId',true);perform set_config('omnix.story93_authority',receipt->>'authorityId',true);end $$;
select ok(current_setting('omnix.story93_run',true) is not null,'service worker claims one bounded sync run');
select is(public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0001',repeat('b',64),null,'2026-08-31T12:02:01Z')->>'outcome','processing','concurrent replay does not duplicate a sync');
select is(public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0001',repeat('c',64),null,'2026-08-31T12:02:02Z')->>'outcome','conflict','conflicting replay fails closed');
select ok(not (public.record_listing_sync_change('29200000-0000-4000-8000-000000000091',current_setting('omnix.story93_run')::uuid,'remote-listing-1',null,'upsert',repeat('d',64),'2026-08-31T12:01:30Z','2026-08-31T12:02:03Z')->>'noOp')::boolean,'mapped provider evidence is recorded without raw payload');
select ok((public.record_listing_sync_change('29200000-0000-4000-8000-000000000091',current_setting('omnix.story93_run')::uuid,'remote-listing-1',null,'upsert',repeat('e',64),'2026-08-31T12:01:00Z','2026-08-31T12:02:04Z')->>'noOp')::boolean,'older provider changes cannot overwrite newer evidence');
select is(public.finalize_listing_sync('29200000-0000-4000-8000-000000000091',current_setting('omnix.story93_run')::uuid,'cursor-2',1,1,0,'2026-08-31T12:02:05Z')->>'status','completed','sync finalization records exact counts and cursor');
select ok((public.finalize_listing_sync('29200000-0000-4000-8000-000000000091',current_setting('omnix.story93_run')::uuid,'cursor-2',1,1,0,'2026-08-31T12:02:06Z')->>'noOp')::boolean,'sync finalization replay is idempotent');
select is(public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0001',repeat('b',64),null,'2026-08-31T12:02:07Z')->>'outcome','replay','completed request returns durable replay');
do $$ declare receipt jsonb; begin receipt:=public.claim_listing_sync('29200000-0000-4000-8000-000000000091','reso-provider','listing:run-0002',repeat('f',64),'cursor-2','2026-08-31T12:03:00Z');perform set_config('omnix.story93_run2',receipt->>'runId',true);end $$;
reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','19200000-0000-4000-8000-000000000091',true);
select is(public.revoke_listing_provider_authority('29200000-0000-4000-8000-000000000091','39200000-0000-4000-8000-000000000091',current_setting('omnix.story93_authority')::uuid,'rights-revoked','2026-08-31T12:03:01Z')->>'state','revoked','owner revocation immediately disables provider authority');
select is((select permission_state from public.licensed_listing_records where provider_record_id='remote-listing-1'),'revoked','revocation makes licensed evidence non-displayable');
select is((select status from public.listing_sync_runs where id=current_setting('omnix.story93_run2')::uuid),'cancelled','revocation cancels in-flight synchronization');
select set_config('request.jwt.claim.sub','19200000-0000-4000-8000-000000000093',true);
select is((select count(*)::integer from public.listing_provider_authorities where workspace_id='29200000-0000-4000-8000-000000000091'),0,'RLS hides provider authority from another workspace');

select * from finish();
rollback;
