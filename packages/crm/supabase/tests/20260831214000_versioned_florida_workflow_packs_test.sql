begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select ok(not has_table_privilege('authenticated','public.workflow_pack_definitions','INSERT')
  and not has_table_privilege('authenticated','public.transaction_workflow_steps','UPDATE')
  and has_function_privilege('authenticated','public.start_transaction_workflow_plan(uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone)','EXECUTE'),
  'workflow definitions and plans mutate only through governed authority');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','17400000-0000-4000-8000-000000000071','authenticated','authenticated','owner-714@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','17400000-0000-4000-8000-000000000072','authenticated','authenticated','assistant-714@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','17400000-0000-4000-8000-000000000073','authenticated','authenticated','other-714@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('27400000-0000-4000-8000-000000000071','Workflow workspace'),('27400000-0000-4000-8000-000000000072','Other workflow workspace');
select set_config('omnix.actor_user_id','17400000-0000-4000-8000-000000000071',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('37400000-0000-4000-8000-000000000071','27400000-0000-4000-8000-000000000071','17400000-0000-4000-8000-000000000071','owner','active'),
 ('37400000-0000-4000-8000-000000000072','27400000-0000-4000-8000-000000000071','17400000-0000-4000-8000-000000000072','assistant','active'),
 ('37400000-0000-4000-8000-000000000073','27400000-0000-4000-8000-000000000072','17400000-0000-4000-8000-000000000073','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('47400000-0000-4000-8000-000000000071','17400000-0000-4000-8000-000000000071','27400000-0000-4000-8000-000000000071','Casey','Condo','referral');
insert into public.real_estate_transactions(id,workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,property_address,source,
  responsible_membership_id,source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at)
values('57400000-0000-4000-8000-000000000071','27400000-0000-4000-8000-000000000071','47400000-0000-4000-8000-000000000071',
  'buyer',true,'Casey condo purchase','under-contract','buyer','1 Ocean Drive','referral','37400000-0000-4000-8000-000000000071','{}',
  '37400000-0000-4000-8000-000000000071','67400000-0000-4000-8000-000000000071','2026-08-31T12:00:00Z','2026-08-31T12:00:00Z');
insert into public.workflow_pack_definitions(id,pack_type,name,version,effective_date,source_title,source_url,review_state,review_reference,is_current,legal_boundary,definition_hash,created_at) values
 ('77400000-0000-4000-8000-000000000071','condo-coop','Condo review draft',1,'2026-08-01','Brokerage checklist','https://example.com/draft','draft',null,false,'Operational only.','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-08-01T00:00:00Z'),
 ('77400000-0000-4000-8000-000000000072','condo-coop','Condo review',2,'2026-08-20','Brokerage approved checklist','https://example.com/reviewed','reviewed','Legal review 2026-08-20',true,'Operational tool only; consult brokerage or counsel.','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-08-20T00:00:00Z');
insert into public.workflow_pack_steps(id,pack_definition_id,step_key,title,position,responsible_role,evidence_requirement,acknowledgement_required,legal_boundary) values
 ('87400000-0000-4000-8000-000000000071','77400000-0000-4000-8000-000000000072','review-package','Review approved document package',1,'either','Review record',true,'Do not interpret legal sufficiency.'),
 ('87400000-0000-4000-8000-000000000072','77400000-0000-4000-8000-000000000072','record-follow-up','Record brokerage follow-up',2,'owner','none',false,'Follow brokerage guidance.');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000072',true);
select throws_ok($$select public.start_transaction_workflow_plan('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072',
  '57400000-0000-4000-8000-000000000071','77400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072','workflow:draft','2026-08-31T13:00:00Z')$$,
  '55000','reviewed current workflow pack is required','draft workflow cannot start');
do $$ declare receipt jsonb; begin receipt:=public.start_transaction_workflow_plan('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072',
  '57400000-0000-4000-8000-000000000071','77400000-0000-4000-8000-000000000072','37400000-0000-4000-8000-000000000072','workflow:condo:v2','2026-08-31T13:01:00Z');
  perform set_config('omnix.story74_plan',receipt->>'planId',true); end $$;
select ok(current_setting('omnix.story74_plan',true) is not null,'assistant can start a reviewed current pack');
select is((select count(*)::integer from public.transaction_workflow_steps where plan_id=current_setting('omnix.story74_plan')::uuid),2,'plan copies every version-bound step');
select is((select pack_version from public.transaction_workflow_plans where id=current_setting('omnix.story74_plan')::uuid),2,'plan remains bound to exact pack version');
select ok((select definition_snapshot->>'reviewReference'='Legal review 2026-08-20' from public.transaction_workflow_plans where id=current_setting('omnix.story74_plan')::uuid),'plan snapshot retains review evidence');
select is((public.start_transaction_workflow_plan('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072',
  '57400000-0000-4000-8000-000000000071','77400000-0000-4000-8000-000000000072','37400000-0000-4000-8000-000000000072','workflow:condo:v2','2026-08-31T13:01:00Z')->>'noOp')::boolean,true,'plan start replay is a no-op');
select set_config('omnix.story74_step',(select id::text from public.transaction_workflow_steps where plan_id=current_setting('omnix.story74_plan')::uuid and step_key='review-package'),true);
select throws_ok(format($sql$select public.transition_transaction_workflow_step('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072',%L::uuid,1,'completed',null,false,'done','workflow:step:invalid','2026-08-31T14:00:00Z')$sql$,current_setting('omnix.story74_step')),
  '22023','workflow evidence is required','completion without evidence fails closed');
select throws_ok(format($sql$select public.transition_transaction_workflow_step('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072',%L::uuid,1,'completed','Review record',false,'done','workflow:step:no-ack','2026-08-31T14:00:00Z')$sql$,current_setting('omnix.story74_step')),
  '22023','workflow acknowledgement is required','required acknowledgement cannot be skipped');
select is((public.transition_transaction_workflow_step('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000072',
  current_setting('omnix.story74_step')::uuid,1,'completed','Review record',true,'review-completed','workflow:step:done','2026-08-31T14:05:00Z')->>'version')::integer,2,'sourced acknowledged completion advances version');
select is((select count(*)::integer from public.transaction_workflow_events where plan_id=current_setting('omnix.story74_plan')::uuid),2,'plan and step history append exactly once');
reset role;
update public.workflow_pack_definitions set review_state='withdrawn',is_current=false where id='77400000-0000-4000-8000-000000000072';
select ok((select definition_snapshot->>'reviewState'='reviewed' from public.transaction_workflow_plans where id=current_setting('omnix.story74_plan')::uuid),'withdrawal does not rewrite active plan history');
select throws_ok($$update public.transaction_workflow_events set reason_code='tampered' where plan_id=current_setting('omnix.story74_plan')::uuid$$,
  '55000','transaction workflow history is append-only','workflow history cannot be changed');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','17400000-0000-4000-8000-000000000073',true);
select is((select count(*)::integer from public.transaction_workflow_plans where workspace_id='27400000-0000-4000-8000-000000000071'),0,'workflow plan RLS hides another workspace');
select throws_ok($$select public.start_transaction_workflow_plan('27400000-0000-4000-8000-000000000071','37400000-0000-4000-8000-000000000073',
  '57400000-0000-4000-8000-000000000071','77400000-0000-4000-8000-000000000072','37400000-0000-4000-8000-000000000073','workflow:cross','2026-08-31T15:00:00Z')$$,
  '42501','active actor membership is required','cross-workspace start fails closed');
reset role;
select ok((select definition_snapshot ? 'sourceUrl' and definition_snapshot ? 'legalBoundary' from public.transaction_workflow_plans where id=current_setting('omnix.story74_plan')::uuid),'plan snapshot retains source and legal boundary');

select * from finish(); rollback;
