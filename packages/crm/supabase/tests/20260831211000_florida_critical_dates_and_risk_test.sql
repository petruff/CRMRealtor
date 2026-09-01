begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,created_at,raw_app_meta_data,raw_user_meta_data,updated_at,last_sign_in_at)
values
('00000000-0000-0000-0000-000000000000','17100000-0000-4000-8000-000000000071','authenticated','authenticated','owner-72@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','17100000-0000-4000-8000-000000000072','authenticated','authenticated','other-72@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('27100000-0000-4000-8000-000000000071','Story 7.2'),
('27100000-0000-4000-8000-000000000072','Other Story 7.2');
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('37100000-0000-4000-8000-000000000071','27100000-0000-4000-8000-000000000071','17100000-0000-4000-8000-000000000071','owner','active'),
('37100000-0000-4000-8000-000000000072','27100000-0000-4000-8000-000000000072','17100000-0000-4000-8000-000000000072','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source,pipeline_stage,created_at,updated_at)
values('47100000-0000-4000-8000-000000000071','17100000-0000-4000-8000-000000000071',
  '27100000-0000-4000-8000-000000000071','Avery','Buyer','referral','new',now(),now());
insert into public.real_estate_transactions(id,workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,
  property_address,source,responsible_membership_id,source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at)
values('57100000-0000-4000-8000-000000000071','27100000-0000-4000-8000-000000000071',
  '47100000-0000-4000-8000-000000000071','buyer',true,'Avery purchase','under-contract','buyer',
  '1 Main Street','referral','37100000-0000-4000-8000-000000000071','{}',
  '37100000-0000-4000-8000-000000000071','67100000-0000-4000-8000-000000000071',now(),now());

select has_column('public','transaction_milestones','source_reference','deadline source reference is canonical');
select has_column('public','transaction_milestones','verification_state','deadline verification state is canonical');
select enum_has_labels('public','transaction_milestone_kind',
  array['inspection','financing','appraisal','title','contingency','closing','custom','association','flood'],
  'Florida deadline catalog includes association and flood');
select enum_has_labels('public','attention_subject_type',array['contact','task','connection','workspace','transaction'],
  'attention can point to the canonical transaction');
select ok(not has_function_privilege('authenticated',
  'public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamp with time zone,text,timestamp with time zone)','EXECUTE'),
  'legacy unsourced deadline creation is unavailable');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000071',true);
do $$ declare receipt jsonb; begin
  receipt:=public.create_transaction_milestone_v2(
    '27100000-0000-4000-8000-000000000071','37100000-0000-4000-8000-000000000071',
    '57100000-0000-4000-8000-000000000071','association','Association approval','2026-11-02T22:00:00Z',
    'America/New_York','37100000-0000-4000-8000-000000000071','association','Condo application receipt',
    '2026-10-15','verified','77100000-0000-4000-8000-000000000071','2026-10-15T16:00:00Z');
  perform set_config('omnix.story72_milestone',receipt->>'milestoneId',true);
end $$;
reset role;
select results_eq(
  $$select kind::text,timezone,source_type,source_reference,source_date::text,verification_state,current_version
    from public.transaction_milestones where id=current_setting('omnix.story72_milestone')::uuid$$,
  $$values('association'::text,'America/New_York'::text,'association'::text,'Condo application receipt'::text,
    '2026-10-15'::text,'verified'::text,1)$$,
  'sourced timezone-aware deadline is retained exactly');
select is((select count(*)::integer from public.transaction_milestone_events
  where milestone_id=current_setting('omnix.story72_milestone')::uuid and event_kind='created'),1,
  'deadline creation appends one sourced snapshot');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000071',true);
select is((public.create_transaction_milestone_v2(
    '27100000-0000-4000-8000-000000000071','37100000-0000-4000-8000-000000000071',
    '57100000-0000-4000-8000-000000000071','association','Association approval','2026-11-02T22:00:00Z',
    'America/New_York','37100000-0000-4000-8000-000000000071','association','Condo application receipt',
    '2026-10-15','verified','77100000-0000-4000-8000-000000000071','2026-10-15T16:00:00Z')->>'noOp')::boolean,true,
  'exact sourced deadline replay is a no-op');
select throws_ok($$select public.update_transaction_milestone(
    '27100000-0000-4000-8000-000000000071','37100000-0000-4000-8000-000000000071',
    current_setting('omnix.story72_milestone')::uuid,2,'association','Stale','2026-11-03T22:00:00Z',
    'America/New_York','37100000-0000-4000-8000-000000000071','addendum','Stale addendum','2026-10-16',
    'verified','stale-update','deadline:stale','2026-10-16T16:00:00Z')$$,
  '40001','transaction deadline version conflict','stale deadline correction fails closed');
select is((public.update_transaction_milestone(
    '27100000-0000-4000-8000-000000000071','37100000-0000-4000-8000-000000000071',
    current_setting('omnix.story72_milestone')::uuid,1,'association','Association approval','2026-11-03T22:00:00Z',
    'America/New_York','37100000-0000-4000-8000-000000000071','addendum','Association addendum 1','2026-10-16',
    'verified','addendum-received','deadline:corrected','2026-10-16T16:00:00Z')->>'version')::integer,2,
  'current correction advances deadline version');
reset role;
select ok((select from_snapshot->>'sourceReference'='Condo application receipt'
  and to_snapshot->>'sourceReference'='Association addendum 1'
  from public.transaction_milestone_events where milestone_id=current_setting('omnix.story72_milestone')::uuid
    and event_kind='corrected'),'correction event retains prior and next source evidence');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000071',true);
select is((public.transition_transaction_milestone_v2(
    '27100000-0000-4000-8000-000000000071','37100000-0000-4000-8000-000000000071',
    current_setting('omnix.story72_milestone')::uuid,2,'completed','association-approved',
    'deadline:completed','2026-10-20T16:00:00Z')->>'version')::integer,3,
  'sourced deadline outcome advances version');
reset role;
select is((select state::text from public.transaction_milestones where id=current_setting('omnix.story72_milestone')::uuid),
  'completed','deadline outcome is canonical');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17100000-0000-4000-8000-000000000072',true);
select throws_ok($$select public.update_transaction_milestone(
    '27100000-0000-4000-8000-000000000071','37100000-0000-4000-8000-000000000071',
    current_setting('omnix.story72_milestone')::uuid,3,'association','Cross workspace','2026-11-03T22:00:00Z',
    'America/New_York','37100000-0000-4000-8000-000000000071','addendum','Cross workspace','2026-10-16',
    'verified','cross-workspace','deadline:cross','2026-10-16T16:00:00Z')$$,
  '42501','active actor membership is required','cross-workspace correction fails closed');
reset role;

select throws_ok($$update public.transaction_milestone_events set reason_code='tampered'
  where milestone_id=current_setting('omnix.story72_milestone')::uuid$$,
  '23514','Omnix proposal evidence is append-only','deadline history remains append-only');
select ok(not has_table_privilege('authenticated','public.transaction_milestones','UPDATE'),
  'authenticated callers cannot bypass deadline RPCs');
select is((select count(*)::integer from public.transaction_milestone_events
  where milestone_id=current_setting('omnix.story72_milestone')::uuid),3,
  'deadline history contains create correction and transition exactly once');
select ok((select jsonb_typeof(to_snapshot)='object' from public.transaction_milestone_events
  where milestone_id=current_setting('omnix.story72_milestone')::uuid order by occurred_at desc limit 1),
  'latest transition keeps an immutable next snapshot');
select ok((select completed_at='2026-10-20T16:00:00Z'::timestamptz from public.transaction_milestones
  where id=current_setting('omnix.story72_milestone')::uuid),
  'completion timestamp is retained without fabricated countdown data');

select * from finish();
rollback;
