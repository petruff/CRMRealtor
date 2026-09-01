begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(not has_table_privilege('authenticated','public.affordability_scenarios','INSERT')
  and has_function_privilege('authenticated','public.upsert_affordability_scenario(uuid,uuid,uuid,integer,text,uuid,uuid,jsonb,text,text,timestamp with time zone)','EXECUTE'),
  'scenario writes require governed RPC authority');

select set_config('omnix.story75_inputs',$json${
  "priceCents":{"value":50000000,"sourceType":"user-entered","sourceReference":"Owner entry","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "downPaymentCents":{"value":10000000,"sourceType":"user-entered","sourceReference":"Owner entry","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "loanTermMonths":{"value":360,"sourceType":"user-entered","sourceReference":"Owner entry","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "annualRateBasisPoints":{"value":600,"sourceType":"estimated","sourceReference":"Planning assumption","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "annualPropertyTaxCents":{"value":600000,"sourceType":"estimated","sourceReference":"County planning estimate","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "annualHomeInsuranceCents":{"value":240000,"sourceType":"estimated","sourceReference":"Planning assumption","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "annualFloodInsuranceCents":{"value":120000,"sourceType":"estimated","sourceReference":"Planning assumption","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "monthlyAssociationCents":{"value":50000,"sourceType":"provider-supplied","sourceReference":"Association disclosure","asOfDate":"2026-08-31","verificationState":"verified","assumption":false},
  "monthlyAssessmentCents":{"value":10000,"sourceType":"provider-supplied","sourceReference":"Association disclosure","asOfDate":"2026-08-31","verificationState":"verified","assumption":false},
  "monthlyMaintenanceCents":{"value":30000,"sourceType":"estimated","sourceReference":"Planning assumption","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true},
  "closingCostsCents":{"value":1500000,"sourceType":"estimated","sourceReference":"Planning assumption","asOfDate":"2026-08-31","verificationState":"unverified","assumption":true}
}$json$,true);
select is((public.calculate_affordability_outputs(current_setting('omnix.story75_inputs')::jsonb)->>'monthlyPrincipalInterestCents')::bigint,239820::bigint,
  'server calculation reproduces principal and interest');
select is((public.calculate_affordability_outputs(current_setting('omnix.story75_inputs')::jsonb)->>'estimatedMonthlyOwnershipCents')::bigint,409820::bigint,
  'server calculation reconciles exact monthly components');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','17500000-0000-4000-8000-000000000071','authenticated','authenticated','owner-715@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','17500000-0000-4000-8000-000000000072','authenticated','authenticated','assistant-715@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','17500000-0000-4000-8000-000000000073','authenticated','authenticated','other-715@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('27500000-0000-4000-8000-000000000071','Scenario workspace'),('27500000-0000-4000-8000-000000000072','Other scenario workspace');
select set_config('omnix.actor_user_id','17500000-0000-4000-8000-000000000071',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('37500000-0000-4000-8000-000000000071','27500000-0000-4000-8000-000000000071','17500000-0000-4000-8000-000000000071','owner','active'),
 ('37500000-0000-4000-8000-000000000072','27500000-0000-4000-8000-000000000071','17500000-0000-4000-8000-000000000072','assistant','active'),
 ('37500000-0000-4000-8000-000000000073','27500000-0000-4000-8000-000000000072','17500000-0000-4000-8000-000000000073','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source) values
 ('47500000-0000-4000-8000-000000000071','17500000-0000-4000-8000-000000000071','27500000-0000-4000-8000-000000000071','Avery','Buyer','referral');
insert into public.real_estate_transactions(id,workspace_id,contact_id,transaction_kind,kind_verified,title,status,side,property_address,source,
  responsible_membership_id,source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at)
values('57500000-0000-4000-8000-000000000071','27500000-0000-4000-8000-000000000071','47500000-0000-4000-8000-000000000071',
  'buyer',true,'Avery purchase','under-contract','buyer','2 Ocean Drive','referral','37500000-0000-4000-8000-000000000071','{}',
  '37500000-0000-4000-8000-000000000071','67500000-0000-4000-8000-000000000071','2026-08-31T12:00:00Z','2026-08-31T12:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17500000-0000-4000-8000-000000000072',true);
do $$ declare receipt jsonb; begin
  receipt:=public.upsert_affordability_scenario('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000072',null,0,
    'Ocean Drive scenario','47500000-0000-4000-8000-000000000071','57500000-0000-4000-8000-000000000071',
    current_setting('omnix.story75_inputs')::jsonb,'created','scenario:ocean:v1','2026-08-31T13:00:00Z');
  perform set_config('omnix.story75_scenario',receipt->>'scenarioId',true);
end $$;
select ok(current_setting('omnix.story75_scenario',true) is not null,'assistant can create a workspace-scoped scenario');
select is((select current_version from public.affordability_scenarios where id=current_setting('omnix.story75_scenario')::uuid),1,'scenario starts at version one');
select is((select count(*)::integer from public.affordability_scenario_revisions where scenario_id=current_setting('omnix.story75_scenario')::uuid),1,'immutable revision is recorded');
select is((public.upsert_affordability_scenario('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000072',null,0,
  'Ocean Drive scenario','47500000-0000-4000-8000-000000000071','57500000-0000-4000-8000-000000000071',current_setting('omnix.story75_inputs')::jsonb,
  'created','scenario:ocean:v1','2026-08-31T13:00:00Z')->>'noOp')::boolean,true,'scenario replay is idempotent');
select throws_ok(format($sql$select public.upsert_affordability_scenario('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000072',%L::uuid,0,
  'Stale','47500000-0000-4000-8000-000000000071',null,%L::jsonb,'changed','scenario:stale','2026-08-31T14:00:00Z')$sql$,
  current_setting('omnix.story75_scenario'),current_setting('omnix.story75_inputs')),'40001','scenario version is stale','stale scenario update fails closed');
select throws_ok(format($sql$select public.create_affordability_share_preview('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000072',%L::uuid,1,
  'Avery','avery@example.com','email',false,'{}','share:no-consent','2026-08-31T14:00:00Z')$sql$,current_setting('omnix.story75_scenario')),
  '22023','invalid affordability sharing preview request','sharing preview requires explicit consent');
select throws_ok(format($sql$select public.create_affordability_share_preview('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000072',%L::uuid,1,
  'Avery','avery@example.com','email',true,'{}','share:tampered','2026-08-31T14:00:30Z')$sql$,current_setting('omnix.story75_scenario')),
  '22023','sharing preview does not match the canonical scenario revision','browser cannot substitute the canonical preview');
do $$ declare receipt jsonb; revision public.affordability_scenario_revisions%rowtype; preview jsonb; begin
  select * into revision from public.affordability_scenario_revisions where scenario_id=current_setting('omnix.story75_scenario')::uuid and version=1;
  preview:=jsonb_build_object('scenarioId',revision.scenario_id,'scenarioVersion',revision.version,'name',revision.name,
    'inputs',revision.inputs,'outputs',revision.outputs,'disclaimer',revision.disclaimer);
  receipt:=public.create_affordability_share_preview('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000072',
    current_setting('omnix.story75_scenario')::uuid,1,'Avery','avery@example.com','email',true,
    preview,'share:preview:v1','2026-08-31T14:01:00Z');
  perform set_config('omnix.story75_share',receipt->>'shareIntentId',true);
end $$;
select is((select status from public.affordability_share_intents where id=current_setting('omnix.story75_share')::uuid),'previewed','sharing authority creates preview only');
select ok((select consent_confirmed and preview_payload ? 'disclaimer' from public.affordability_share_intents where id=current_setting('omnix.story75_share')::uuid),
  'sharing preview preserves consent and exact payload');
reset role;
select throws_ok(format($sql$update public.affordability_scenario_revisions set name='tampered' where scenario_id=%L::uuid$sql$,current_setting('omnix.story75_scenario')),
  '55000','affordability history is append-only','scenario revision cannot be rewritten');
select throws_ok(format($sql$delete from public.affordability_share_intents where id=%L::uuid$sql$,current_setting('omnix.story75_share')),
  '55000','affordability history is append-only','sharing consent evidence cannot be deleted');
select is((select current_version from public.real_estate_transactions where id='57500000-0000-4000-8000-000000000071'),1,'scenario links do not mutate the transaction');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17500000-0000-4000-8000-000000000073',true);
select is((select count(*)::integer from public.affordability_scenarios where workspace_id='27500000-0000-4000-8000-000000000071'),0,'RLS hides scenarios from another workspace');
select throws_ok(format($sql$select public.create_affordability_share_preview('27500000-0000-4000-8000-000000000071','37500000-0000-4000-8000-000000000073',%L::uuid,1,
  'Avery','avery@example.com','email',true,'{}','share:cross','2026-08-31T15:00:00Z')$sql$,current_setting('omnix.story75_scenario')),
  '42501','active actor membership is required','cross-workspace share fails closed');

select * from finish(); rollback;
