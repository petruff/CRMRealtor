begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select ok(not has_table_privilege('authenticated','public.transaction_financial_authorities','INSERT')
  and not has_table_privilege('authenticated','public.transaction_financial_events','UPDATE')
  and has_function_privilege('authenticated','public.upsert_transaction_financial_authority(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text,date,text,text,text,timestamp with time zone)','EXECUTE'),
  'financial authority is read-only outside the governed RPC');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','17300000-0000-4000-8000-000000000071','authenticated','authenticated','owner-713@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','17300000-0000-4000-8000-000000000072','authenticated','authenticated','assistant-713@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','17300000-0000-4000-8000-000000000073','authenticated','authenticated','other-713@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('27300000-0000-4000-8000-000000000071','Finance workspace'),('27300000-0000-4000-8000-000000000072','Other finance workspace');
select set_config('omnix.actor_user_id','17300000-0000-4000-8000-000000000071',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('37300000-0000-4000-8000-000000000071','27300000-0000-4000-8000-000000000071','17300000-0000-4000-8000-000000000071','owner','active'),
 ('37300000-0000-4000-8000-000000000072','27300000-0000-4000-8000-000000000071','17300000-0000-4000-8000-000000000072','assistant','active'),
 ('37300000-0000-4000-8000-000000000073','27300000-0000-4000-8000-000000000072','17300000-0000-4000-8000-000000000073','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('47300000-0000-4000-8000-000000000071','17300000-0000-4000-8000-000000000071','27300000-0000-4000-8000-000000000071','Avery','Buyer','referral');
insert into public.real_estate_transactions(id,workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,
  property_address,source,expected_close_date,closed_at,responsible_membership_id,source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at)
values('57300000-0000-4000-8000-000000000071','27300000-0000-4000-8000-000000000071',
  '47300000-0000-4000-8000-000000000071','buyer',true,'Avery purchase','closed','buyer','1 Main Street','referral',
  '2026-08-30','2026-08-30','37300000-0000-4000-8000-000000000071','{}','37300000-0000-4000-8000-000000000071',
  '67300000-0000-4000-8000-000000000071','2026-08-31T12:00:00Z','2026-08-31T12:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17300000-0000-4000-8000-000000000072',true);
do $$ declare receipt jsonb; begin
  receipt:=public.upsert_transaction_financial_authority(
    '27300000-0000-4000-8000-000000000071','37300000-0000-4000-8000-000000000072',
    '57300000-0000-4000-8000-000000000071',0,50000000,50000000,1500000,500000,100000,900000,50000,25000,
    'closing-statement','Closing statement page 2','2026-08-30','verified','closing-reviewed','finance:avery:v1','2026-08-31T13:00:00Z');
  perform set_config('omnix.story73_financial',receipt->>'financialAuthorityId',true);
end $$;
select ok(current_setting('omnix.story73_financial',true) is not null,'assistant can create sourced financial authority');
select ok(exists(select 1 from public.transaction_financial_authorities
  where id=current_setting('omnix.story73_financial')::uuid and current_version=1 and verification_state='verified'
    and gross_commission_cents=1500000 and brokerage_split_cents=500000 and referral_fee_cents=100000
    and net_commission_cents=900000), 'verified commission components remain independently attributable');
select is((select count(*)::integer from public.transaction_financial_events
  where financial_authority_id=current_setting('omnix.story73_financial')::uuid),1,'creation appends exactly one snapshot');
select is((public.upsert_transaction_financial_authority(
    '27300000-0000-4000-8000-000000000071','37300000-0000-4000-8000-000000000072',
    '57300000-0000-4000-8000-000000000071',0,50000000,50000000,1500000,500000,100000,900000,50000,25000,
    'closing-statement','Closing statement page 2','2026-08-30','verified','closing-reviewed','finance:avery:v1','2026-08-31T13:00:00Z')->>'noOp')::boolean,true,
  'exact financial replay is a no-op');
select throws_ok($$select public.upsert_transaction_financial_authority(
    '27300000-0000-4000-8000-000000000071','37300000-0000-4000-8000-000000000072',
    '57300000-0000-4000-8000-000000000071',0,1,1,1,1,1,1,1,1,
    'manual-record','Stale edit','2026-08-31','verified','stale','finance:avery:stale','2026-08-31T14:00:00Z')$$,
  '40001','financial version is stale','stale financial edit fails closed');
select throws_ok($$select public.upsert_transaction_financial_authority(
    '27300000-0000-4000-8000-000000000071','37300000-0000-4000-8000-000000000072',
    '57300000-0000-4000-8000-000000000071',1,-1,null,null,null,null,null,null,null,
    'manual-record','Negative value','2026-08-31','verified','negative','finance:avery:negative','2026-08-31T14:00:00Z')$$,
  '22023','invalid transaction financial authority request','negative money fails closed');
select is((public.upsert_transaction_financial_authority(
    '27300000-0000-4000-8000-000000000071','37300000-0000-4000-8000-000000000072',
    '57300000-0000-4000-8000-000000000071',1,51000000,51000000,1530000,510000,100000,920000,60000,30000,
    'brokerage-statement','August commission statement','2026-08-31','verified','statement-reconciled','finance:avery:v2','2026-08-31T15:00:00Z')->>'version')::integer,2,
  'correction advances the independent financial version');
select is((select count(*)::integer from public.transaction_financial_events
  where financial_authority_id=current_setting('omnix.story73_financial')::uuid),2,'correction appends one additional snapshot');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17300000-0000-4000-8000-000000000073',true);
select is((select count(*)::integer from public.transaction_financial_authorities
  where workspace_id='27300000-0000-4000-8000-000000000071'),0,'financial RLS hides another workspace');
select throws_ok($$select public.upsert_transaction_financial_authority(
    '27300000-0000-4000-8000-000000000071','37300000-0000-4000-8000-000000000073',
    '57300000-0000-4000-8000-000000000071',2,null,null,null,null,null,null,null,null,
    'manual-record','Cross workspace','2026-08-31','unverified','cross-workspace','finance:cross','2026-08-31T16:00:00Z')$$,
  '42501','active actor membership is required','cross-workspace mutation fails closed');
reset role;

select throws_ok($$update public.transaction_financial_events set reason_code='tampered'
  where financial_authority_id=current_setting('omnix.story73_financial')::uuid$$,
  '55000','transaction financial history is append-only','financial history cannot be changed');
select ok((select from_snapshot is null and jsonb_typeof(to_snapshot)='object' from public.transaction_financial_events
  where financial_authority_id=current_setting('omnix.story73_financial')::uuid order by to_version limit 1),
  'creation retains an immutable next snapshot');
select ok((select jsonb_typeof(from_snapshot)='object' and jsonb_typeof(to_snapshot)='object' from public.transaction_financial_events
  where financial_authority_id=current_setting('omnix.story73_financial')::uuid order by to_version desc limit 1),
  'correction retains immutable before and after snapshots');
select is((select count(*)::integer from public.transaction_financial_authorities
  where transaction_id='57300000-0000-4000-8000-000000000071'),1,'one canonical financial authority exists per transaction');

select * from finish();
rollback;
