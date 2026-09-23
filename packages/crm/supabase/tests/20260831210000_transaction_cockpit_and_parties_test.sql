begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,created_at,raw_app_meta_data,raw_user_meta_data,updated_at,last_sign_in_at)
values
('00000000-0000-0000-0000-000000000000','17000000-0000-4000-8000-000000000071','authenticated','authenticated','owner-71@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','17000000-0000-4000-8000-000000000072','authenticated','authenticated','other-71@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('27000000-0000-4000-8000-000000000071','Story 7.1'),
('27000000-0000-4000-8000-000000000072','Other workspace');
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('37000000-0000-4000-8000-000000000071','27000000-0000-4000-8000-000000000071','17000000-0000-4000-8000-000000000071','owner','active'),
('37000000-0000-4000-8000-000000000072','27000000-0000-4000-8000-000000000072','17000000-0000-4000-8000-000000000072','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source,pipeline_stage,created_at,updated_at) values
('47000000-0000-4000-8000-000000000071','17000000-0000-4000-8000-000000000071','27000000-0000-4000-8000-000000000071','Avery','Buyer','referral','new',now(),now()),
('47000000-0000-4000-8000-000000000072','17000000-0000-4000-8000-000000000071','27000000-0000-4000-8000-000000000071','Jamie','Seller','open-house','new',now(),now()),
('47000000-0000-4000-8000-000000000073','17000000-0000-4000-8000-000000000072','27000000-0000-4000-8000-000000000072','Other','Workspace','other','new',now(),now());

select has_column('public','real_estate_transactions','transaction_kind','transaction kind is persisted');
select has_table('public','transaction_parties','transaction parties are persisted separately');
select has_table('public','transaction_events','transaction history is persisted');
select ok(not has_table_privilege('authenticated','public.transaction_events','INSERT'),
  'authenticated callers cannot write transaction history directly');

insert into public.real_estate_transactions(
  id,workspace_id,contact_id,title,status,side,property_address,source,responsible_membership_id,
  source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at
) values(
  '57000000-0000-4000-8000-000000000071','27000000-0000-4000-8000-000000000071',
  '47000000-0000-4000-8000-000000000072','Legacy transaction','under-contract','seller','20 Legacy Lane',
  'open-house','37000000-0000-4000-8000-000000000071','{"authority":"legacy-fixture"}',
  '37000000-0000-4000-8000-000000000071','67000000-0000-4000-8000-000000000071',now(),now());
select is((select transaction_kind::text from public.real_estate_transactions
  where id='57000000-0000-4000-8000-000000000071'),'unclassified',
  'existing legacy transactions remain explicitly unclassified');
select is((select pipeline_stage::text from public.contacts where id='47000000-0000-4000-8000-000000000072'),'new',
  'legacy transaction records do not mutate contact pipeline state');
select ok(not has_function_privilege('authenticated',
  'public.create_real_estate_transaction(uuid,uuid,uuid,public.real_estate_transaction_status,public.real_estate_transaction_side,text,date,date,bigint,bigint,bigint,bigint,bigint,uuid)',
  'EXECUTE'),'authenticated callers cannot create new unclassified legacy transactions');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000071',true);
do $$ declare receipt jsonb; begin
  receipt:=public.create_real_estate_transaction_v2(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    '47000000-0000-4000-8000-000000000071','buyer','Avery Palm City purchase','under-contract','buyer',
    '10 Palm Avenue','2026-10-01',null,50000000,1500000,900000,50000,25000,
    '37000000-0000-4000-8000-000000000071','Confirm inspection','2026-09-03T14:00:00Z',
    '57000000-0000-4000-8000-000000000072');
  perform set_config('omnix.story71_transaction',receipt->>'transactionId',true);
end $$;
reset role;
select results_eq(
  $$select transaction_kind::text,kind_verified,title,current_version from public.real_estate_transactions
    where id=current_setting('omnix.story71_transaction')::uuid$$,
  $$values('buyer'::text,true,'Avery Palm City purchase'::text,1)$$,
  'verified transaction kind title and version are canonical');
select is((select count(*)::integer from public.transaction_events
  where transaction_id=current_setting('omnix.story71_transaction')::uuid and kind='created'),1,
  'verified creation appends one immutable event');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000071',true);
select is((public.create_real_estate_transaction_v2(
  '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
  '47000000-0000-4000-8000-000000000071','buyer','Avery Palm City purchase','under-contract','buyer',
  '10 Palm Avenue','2026-10-01',null,50000000,1500000,900000,50000,25000,
  '37000000-0000-4000-8000-000000000071','Confirm inspection','2026-09-03T14:00:00Z',
  '57000000-0000-4000-8000-000000000072')->>'noOp')::boolean,true,
  'exact transaction creation replay is a no-op');
select throws_ok($$select public.transition_real_estate_transaction(
  '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
  current_setting('omnix.story71_transaction')::uuid,2,'closed','2026-10-02','closing-confirmed',
  'transaction-transition:stale','2026-10-02T16:00:00Z')$$,
  '40001','transaction version is stale','stale transaction transitions fail closed');
select is((public.transition_real_estate_transaction(
  '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
  current_setting('omnix.story71_transaction')::uuid,1,'closed','2026-10-02','closing-confirmed',
  'transaction-transition:close','2026-10-02T16:00:00Z')->>'version')::integer,2,
  'current transaction transition advances version');
reset role;
select is((select pipeline_stage::text from public.contacts where id='47000000-0000-4000-8000-000000000071'),'new',
  'transaction transition remains separate from contact pipeline state');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000071',true);
do $$ declare receipt jsonb; begin
  receipt:=public.add_transaction_party(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    current_setting('omnix.story71_transaction')::uuid,'47000000-0000-4000-8000-000000000072',
    'co-client','Jamie Seller',true,'transaction-party:jamie','2026-09-01T12:00:00Z');
  perform set_config('omnix.story71_party',receipt->>'partyId',true);
end $$;
reset role;
select ok(exists(
  select 1 from public.transaction_parties
  where id=current_setting('omnix.story71_party')::uuid
    and role='co-client'
    and contact_id='47000000-0000-4000-8000-000000000072'::uuid
    and participates_in_communication
), 'transaction party retains explicit role contact link and communication participation');
select is((select count(*)::integer from public.transaction_events
  where party_id=current_setting('omnix.story71_party')::uuid and kind='party-added'),1,
  'party creation appends one event');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000071',true);
do $$
declare v_receipt jsonb;
begin
  v_receipt := public.update_real_estate_transaction(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    current_setting('omnix.story71_transaction')::uuid,2,'listing','Avery listing','seller',
    '11 Palm Avenue','2026-10-03',51000000,1530000,910000,60000,30000,
    'Confirm title','2026-09-04T14:00:00Z','details-corrected','transaction-details:update-1',
    '2026-09-01T12:10:00Z');
  perform set_config('omnix.story71_update_version', v_receipt->>'version', true);
end $$;
select results_eq(
  $$select current_setting('omnix.story71_update_version')::integer,
    (select title from public.real_estate_transactions where id=current_setting('omnix.story71_transaction')::uuid),
    (select status::text from public.real_estate_transactions where id=current_setting('omnix.story71_transaction')::uuid)$$,
  $$values(3,'Avery listing'::text,'closed'::text)$$,
  'detail update advances version and preserves independent transaction status');
select is((public.update_real_estate_transaction(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    current_setting('omnix.story71_transaction')::uuid,2,'listing','Avery listing','seller',
    '11 Palm Avenue','2026-10-03',51000000,1530000,910000,60000,30000,
    'Confirm title','2026-09-04T14:00:00Z','details-corrected','transaction-details:update-1',
    '2026-09-01T12:10:00Z')->>'noOp')::boolean,true,
  'exact detail update replay is a no-op');
select throws_ok($$select public.update_real_estate_transaction(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    current_setting('omnix.story71_transaction')::uuid,2,'buyer','Stale change','buyer',
    '10 Palm Avenue',null,1,1,1,0,0,null,null,'stale','transaction-details:stale',
    '2026-09-01T12:11:00Z')$$,
  '40001','transaction version is stale','stale detail update fails closed');
select is((public.update_transaction_party(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    current_setting('omnix.story71_party')::uuid,1,'seller','Jamie Seller',false,
    'transaction-party:update-jamie','2026-09-01T12:12:00Z')->>'version')::integer,2,
  'party update advances its independent version');
select is((public.archive_transaction_party(
    '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
    current_setting('omnix.story71_party')::uuid,2,'removed-by-realtor',
    'transaction-party:archive-jamie','2026-09-01T12:13:00Z')->>'version')::integer,3,
  'party archive advances its independent version');
reset role;
select ok((select archived_at is not null and participates_in_communication=false
  from public.transaction_parties where id=current_setting('omnix.story71_party')::uuid),
  'archived party remains retained as evidence with its last explicit settings');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000072',true);
select throws_ok($$select public.add_transaction_party(
  '27000000-0000-4000-8000-000000000071','37000000-0000-4000-8000-000000000071',
  current_setting('omnix.story71_transaction')::uuid,null,'other','Cross workspace',false,
  'transaction-party:cross-workspace','2026-09-01T13:00:00Z')$$,
  '42501','active workspace membership is required','cross-workspace party mutation fails closed');
reset role;

select throws_ok($$update public.transaction_events set reason_code='tampered'
  where transaction_id=current_setting('omnix.story71_transaction')::uuid$$,
  '55000','transaction history is append-only','transaction events cannot be changed');
select is((select count(*)::integer from public.transaction_events
  where transaction_id=current_setting('omnix.story71_transaction')::uuid),6,
  'transaction history contains create transition detail and party evidence exactly once');

select * from finish();
rollback;
