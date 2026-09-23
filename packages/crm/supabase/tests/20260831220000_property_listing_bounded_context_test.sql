begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(not has_table_privilege('authenticated','public.properties','INSERT')
  and has_function_privilege('authenticated','public.create_manual_property(uuid,uuid,text,text,text,text,text,text,text,text,timestamp with time zone)','EXECUTE'),
  'property writes require governed RPC authority');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','19000000-0000-4000-8000-000000000091','authenticated','authenticated','owner-91@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','19000000-0000-4000-8000-000000000092','authenticated','authenticated','assistant-91@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','19000000-0000-4000-8000-000000000093','authenticated','authenticated','other-91@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('29000000-0000-4000-8000-000000000091','Property workspace'),('29000000-0000-4000-8000-000000000092','Other property workspace');
select set_config('omnix.actor_user_id','19000000-0000-4000-8000-000000000091',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('39000000-0000-4000-8000-000000000091','29000000-0000-4000-8000-000000000091','19000000-0000-4000-8000-000000000091','owner','active'),
 ('39000000-0000-4000-8000-000000000092','29000000-0000-4000-8000-000000000091','19000000-0000-4000-8000-000000000092','assistant','active'),
 ('39000000-0000-4000-8000-000000000093','29000000-0000-4000-8000-000000000092','19000000-0000-4000-8000-000000000093','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('49000000-0000-4000-8000-000000000091','19000000-0000-4000-8000-000000000091','29000000-0000-4000-8000-000000000091','Avery','Buyer','website');
insert into public.real_estate_transactions(id,workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,property_address,source,responsible_membership_id,source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at)
values('59000000-0000-4000-8000-000000000091','29000000-0000-4000-8000-000000000091','49000000-0000-4000-8000-000000000091','buyer',true,'Avery purchase','under-contract','buyer','123 Main Street','website','39000000-0000-4000-8000-000000000091','{}','39000000-0000-4000-8000-000000000091','69000000-0000-4000-8000-000000000091','2026-08-31T12:00:00Z','2026-08-31T12:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000092',true);
do $$ declare receipt jsonb; begin
  receipt:=public.create_manual_property('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092','123 Main Street',null,'Palm Beach','FL','33480','condo','off-market','property:create:91','2026-08-31T13:00:00Z');
  perform set_config('omnix.story91_property',receipt->>'propertyId',true);
end $$;
select ok(current_setting('omnix.story91_property',true) is not null,'assistant creates a workspace property through governed authority');
select is((select current_version from public.properties where id=current_setting('omnix.story91_property')::uuid),1,'property identity begins at version one');
select is((select count(*)::integer from public.property_identity_revisions where property_id=current_setting('omnix.story91_property')::uuid),1,'property identity revision is preserved');
select is((public.create_manual_property('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092','123 Main Street',null,'Palm Beach','FL','33480','condo','off-market','property:create:91','2026-08-31T13:00:00Z')->>'noOp')::boolean,true,'property creation replay is idempotent');

do $$ declare receipt jsonb; begin
  receipt:=public.upsert_property_fact('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',current_setting('omnix.story91_property')::uuid,'flood-zone','"AE"'::jsonb,'manual',null,null,'Owner disclosure','2026-08-31T13:00:00Z','allowed',null,null,0,'property:fact:manual:91','2026-08-31T13:01:00Z');
  perform set_config('omnix.story91_fact',receipt->>'factId',true);
end $$;
select is((select current_version from public.property_facts where id=current_setting('omnix.story91_fact')::uuid),1,'manual property fact is versioned');
select throws_ok(format($sql$select public.upsert_property_fact('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',%L::uuid,'list-price-cents','45000000','licensed-provider',null,null,'Feed row','2026-08-31T13:00:00Z','unknown',null,null,0,'property:fact:bad-license','2026-08-31T13:02:00Z')$sql$,current_setting('omnix.story91_property')),
  '22023','licensed property fact lacks authority','licensed facts require provider identity and explicit permission');
select throws_ok(format($sql$select public.upsert_property_fact('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',%L::uuid,'bedrooms','"three"'::jsonb,'manual',null,null,'Owner record','2026-08-31T13:00:00Z','allowed',null,null,0,'property:fact:bad-type','2026-08-31T13:02:30Z')$sql$,current_setting('omnix.story91_property')),
  '22023','integer property fact is invalid','RPC enforces the same field type as the domain');
select throws_ok(format($sql$select public.upsert_property_fact('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',%L::uuid,'flood-zone','"X"'::jsonb,'manual',null,null,'Owner disclosure','2026-08-31T13:00:00Z','allowed',null,null,0,'property:fact:stale','2026-08-31T13:03:00Z')$sql$,current_setting('omnix.story91_property')),
  '40001','stale property fact version','stale property fact update fails closed');

do $$ declare receipt jsonb; begin
  receipt:=public.link_property_interest('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',current_setting('omnix.story91_property')::uuid,'49000000-0000-4000-8000-000000000091','showing-intent','manual','Phone conversation','2026-08-31T13:04:00Z','property:interest:91','2026-08-31T13:04:00Z');
  perform set_config('omnix.story91_interest',receipt->>'interestId',true);
end $$;
select is((select interest_type from public.property_interests where id=current_setting('omnix.story91_interest')::uuid),'showing-intent','contact interest remains an explicit sourced relation');
select is((public.archive_property_interest('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',current_setting('omnix.story91_interest')::uuid,1,'client-not-interested','property:interest:archive:91','2026-08-31T13:05:00Z')->>'version')::integer,2,'interest archive uses optimistic versioning');
select is((select count(*)::integer from public.property_interest_events where property_interest_id=current_setting('omnix.story91_interest')::uuid),2,'interest lifecycle keeps append-only events');

do $$ declare receipt jsonb; begin
  receipt:=public.link_transaction_property('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',current_setting('omnix.story91_property')::uuid,'59000000-0000-4000-8000-000000000091','subject','property:transaction:91','2026-08-31T13:06:00Z');
  perform set_config('omnix.story91_link',receipt->>'linkId',true);
end $$;
select ok(current_setting('omnix.story91_link',true) is not null,'transaction link is recorded independently');
select is((select current_version from public.real_estate_transactions where id='59000000-0000-4000-8000-000000000091'),1,'property link does not mutate transaction state');
select is((public.link_transaction_property('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000092',current_setting('omnix.story91_property')::uuid,'59000000-0000-4000-8000-000000000091','subject','property:transaction:replay:91','2026-08-31T13:07:00Z')->>'noOp')::boolean,true,'equivalent transaction link is idempotent');

reset role;
select throws_ok(format($sql$update public.property_fact_revisions set snapshot='{}' where property_fact_id=%L::uuid$sql$,current_setting('omnix.story91_fact')),
  '55000','property history is append-only','property fact history cannot be rewritten');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000093',true);
select is((select count(*)::integer from public.properties where workspace_id='29000000-0000-4000-8000-000000000091'),0,'RLS hides properties from another workspace');
select throws_ok(format($sql$select public.link_property_interest('29000000-0000-4000-8000-000000000091','39000000-0000-4000-8000-000000000093',%L::uuid,'49000000-0000-4000-8000-000000000091','saved','manual','Cross workspace','2026-08-31T14:00:00Z','property:cross:91','2026-08-31T14:00:00Z')$sql$,current_setting('omnix.story91_property')),
  '42501','active actor membership is required','cross-workspace property action fails closed');

select * from finish();
rollback;
