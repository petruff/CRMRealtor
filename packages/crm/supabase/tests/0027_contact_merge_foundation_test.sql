begin;
select plan(33);

-- The focused 0027 suite proves the historical inert boundary even when the
-- full local migration chain includes 0028. Transactional DDL is rolled back
-- with the rest of this test file.
alter table public.contact_merge_workspace_state
  drop constraint if exists contact_merge_activation_v2;
update public.contact_merge_workspace_state
set apply_enabled=false,activation_version=0;
alter table public.contact_merge_workspace_state
  alter column apply_enabled set default false,
  alter column activation_version set default 0;
alter table public.contact_merge_workspace_state
  add constraint contact_merge_foundation_inert check (
    apply_enabled=false and activation_version=0
  );

select has_table('public','contact_merge_plans','merge plans exist');
select has_table('public','contact_merge_plan_members','group members exist');
select has_table('public','contact_merge_aliases','logical aliases exist');
select has_table('public','contact_merge_events','append-only events exist');
select has_table('public','contact_merge_workspace_state','workspace epoch and activation gate exist');
select has_function('public','resolve_canonical_contact_id',array['uuid','uuid'],'canonical resolver exists');
select has_function('public','list_contact_alias_group_ids',array['uuid','uuid'],'group resolver exists');
select has_function('public','assert_contact_outbound_target',array['uuid','uuid','uuid'],'outbound guard exists');
select has_function('public','plan_exact_contact_merge',array['uuid','uuid','text','text','text','text','text[]','timestamp with time zone','timestamp with time zone'],'owner planner exists');
select has_function('public','apply_exact_contact_merge',array['uuid','uuid','text','text','timestamp with time zone'],'apply contract exists');
select has_function('public','reverse_exact_contact_merge',array['uuid','uuid','text','text','timestamp with time zone'],'reverse contract exists');
select ok(has_function_privilege('authenticated','public.resolve_canonical_contact_id(uuid,uuid)','EXECUTE'),'authenticated members may resolve canonical IDs');
select ok(has_function_privilege('authenticated','public.plan_exact_contact_merge(uuid,uuid,text,text,text,text,text[],timestamptz,timestamptz)','EXECUTE'),'authenticated role may reach owner-authorized planner');
select ok(not has_table_privilege('authenticated','public.contact_merge_plans','SELECT'),'plan internals are not directly readable');
select ok(not has_table_privilege('authenticated','public.contact_merge_aliases','INSERT'),'aliases cannot be inserted directly');
select ok(has_table_privilege('authenticated','public.contact_merge_aliases','SELECT'),'active workspace members may read aliases through RLS');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','17000000-0000-4000-8000-000000000027','authenticated','authenticated','merge-owner@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','17000000-0000-4000-8000-000000000028','authenticated','authenticated','merge-assistant@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','17000000-0000-4000-8000-000000000029','authenticated','authenticated','merge-revoked@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','17000000-0000-4000-8000-000000000030','authenticated','authenticated','merge-other@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('27000000-0000-4000-8000-000000000027','Merge A'),
('27000000-0000-4000-8000-000000000028','Merge B');
select set_config('omnix.actor_user_id','17000000-0000-4000-8000-000000000027',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('37000000-0000-4000-8000-000000000027','27000000-0000-4000-8000-000000000027','17000000-0000-4000-8000-000000000027','owner','active');
select set_config('omnix.actor_user_id','17000000-0000-4000-8000-000000000028',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('37000000-0000-4000-8000-000000000028','27000000-0000-4000-8000-000000000027','17000000-0000-4000-8000-000000000028','assistant','active');
select set_config('omnix.actor_user_id','17000000-0000-4000-8000-000000000029',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status,revoked_at) values
('37000000-0000-4000-8000-000000000029','27000000-0000-4000-8000-000000000027','17000000-0000-4000-8000-000000000029','assistant','revoked','2026-08-18T14:00:00Z');
select set_config('omnix.actor_user_id','17000000-0000-4000-8000-000000000030',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('37000000-0000-4000-8000-000000000030','27000000-0000-4000-8000-000000000028','17000000-0000-4000-8000-000000000030','owner','active');

insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,created_at,updated_at) values
('47000000-0000-4000-8000-000000000027','17000000-0000-4000-8000-000000000027','27000000-0000-4000-8000-000000000027','Older','Fixture','2026-01-01','2026-01-01'),
('47000000-0000-4000-8000-000000000028','17000000-0000-4000-8000-000000000027','27000000-0000-4000-8000-000000000027','Linked','Fixture','2026-02-01','2026-02-01'),
('47000000-0000-4000-8000-000000000029','17000000-0000-4000-8000-000000000030','27000000-0000-4000-8000-000000000028','Other','Workspace','2026-01-01','2026-01-01');
insert into public.contact_points(id,workspace_id,contact_id,type,label,display_value,normalized_value,is_primary,email_subscribed,display_order,created_by_membership_id,created_at,updated_at) values
('57000000-0000-4000-8000-000000000027','27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000027','email','primary','same@example.test','same@example.test',true,true,0,'37000000-0000-4000-8000-000000000027','2026-01-01','2026-01-01'),
('57000000-0000-4000-8000-000000000028','27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000028','email','primary','same@example.test','same@example.test',true,true,0,'37000000-0000-4000-8000-000000000027','2026-02-01','2026-02-01');
insert into public.contact_external_links(id,owner_id,workspace_id,contact_id,provider,external_id,created_at)
values('67000000-0000-4000-8000-000000000027','17000000-0000-4000-8000-000000000027','27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000028','fixture','linked-survivor','2026-02-01');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000027',true);

do $$
declare result jsonb;
begin
  result:=public.plan_exact_contact_merge(
    '27000000-0000-4000-8000-000000000027','37000000-0000-4000-8000-000000000027','email',
    encode(extensions.digest(convert_to('email:same@example.test','UTF8'),'sha256'),'hex'),repeat('a',64),
    'merge-plan-fixture-0001','{}','2026-08-18T16:00:00Z','2026-08-18T15:00:00Z');
  perform set_config('omnix.test_merge_plan',result->>'planId',true);
  perform set_config('omnix.test_merge_snapshot',result->>'snapshotHash',true);
  perform set_config('omnix.test_merge_result',result::text,true);
end;
$$;

select is(current_setting('omnix.test_merge_result')::jsonb->>'state','pending','zero-conflict exact group produces a pending dry-run plan');
select is(current_setting('omnix.test_merge_result')::jsonb->>'survivorContactId','47000000-0000-4000-8000-000000000028','database selects externally linked survivor before age');
select ok(current_setting('omnix.test_merge_result') not like '%same@example.test%','plan receipt contains no raw email');
select is((current_setting('omnix.test_merge_result')::jsonb->>'memberCount')::integer,2,'redacted owner receipt exposes only the aggregate member count');
select is((select count(*)::integer from public.contact_merge_events),1,'owner can read the redacted plan event');

select throws_ok(
  format($call$select public.apply_exact_contact_merge(%L::uuid,%L::uuid,%L,%L,'2026-08-18T15:01:00Z')$call$,
    current_setting('omnix.test_merge_plan'),'37000000-0000-4000-8000-000000000027',current_setting('omnix.test_merge_snapshot'),'apply-fixture-0001'),
  '0A000','contact merge apply is activation-gated until migration 0028','0027 cannot productively apply a valid plan');

reset role;
update public.contacts set tags=array['snapshot-changed'] where id='47000000-0000-4000-8000-000000000027';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000027',true);
select throws_ok(
  format($call$select public.apply_exact_contact_merge(%L::uuid,%L::uuid,%L,%L,'2026-08-18T15:02:00Z')$call$,
    current_setting('omnix.test_merge_plan'),'37000000-0000-4000-8000-000000000027',current_setting('omnix.test_merge_snapshot'),'apply-fixture-0002'),
  '40001','stale contact merge plan','changed dependency snapshot fails closed before activation');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000028',true);
select throws_ok(
  $$select public.plan_exact_contact_merge('27000000-0000-4000-8000-000000000027','37000000-0000-4000-8000-000000000028','email',repeat('a',64),repeat('b',64),'assistant-plan-0001','{}',now()+interval '1 hour',now())$$,
  '42501','active rich-contact actor authority is required','assistant cannot create a merge plan');
select is((select count(*)::integer from public.contact_merge_events),0,'assistant cannot read owner-only merge events');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000029',true);
select throws_ok(
  $$select public.resolve_canonical_contact_id('27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000027')$$,
  '42501','active workspace access is required','revoked member cannot resolve aliases');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000030',true);
select throws_ok(
  $$select public.resolve_canonical_contact_id('27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000027')$$,
  '42501','active workspace access is required','another workspace cannot resolve contact aliases');

reset role;
select set_config('omnix.contact_merge_internal_write','on',true);
insert into public.contact_merge_aliases(workspace_id,plan_id,donor_contact_id,survivor_contact_id,alias_epoch,active_from,created_at,updated_at)
values('27000000-0000-4000-8000-000000000027',current_setting('omnix.test_merge_plan')::uuid,
  '47000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000028',1,'2026-08-18T15:03:00Z','2026-08-18T15:03:00Z','2026-08-18T15:03:00Z');
select throws_ok(
  format($sql$insert into public.contact_merge_aliases(workspace_id,plan_id,donor_contact_id,survivor_contact_id,alias_epoch,active_from,created_at,updated_at) values('27000000-0000-4000-8000-000000000027',%L::uuid,'47000000-0000-4000-8000-000000000028','47000000-0000-4000-8000-000000000027',1,now(),now(),now())$sql$,current_setting('omnix.test_merge_plan')),
  '23514','active contact aliases must remain a one-level star','alias cycles are rejected');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000027',true);
select is(public.resolve_canonical_contact_id('27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000027'),
  '47000000-0000-4000-8000-000000000028'::uuid,'donor resolves to the database-selected survivor');
select is((select count(*)::integer from public.list_contact_alias_group_ids('27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000027')),2,'alias group expands to canonical and donor IDs');
select throws_ok(
  $$select public.assert_contact_outbound_target('27000000-0000-4000-8000-000000000027','47000000-0000-4000-8000-000000000027','57000000-0000-4000-8000-000000000027')$$,
  '55000','outbound target is an aliased donor','outbound donor dispatch fails closed');

reset role;
select set_config('omnix.contact_merge_internal_write','on',true);
update public.contact_merge_plans set state='applied',applied_at='2026-08-18T15:03:00Z',
  apply_idempotency_key='test-seed-only',updated_at='2026-08-18T15:03:00Z'
where id=current_setting('omnix.test_merge_plan')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000027',true);
select throws_ok(
  format($call$select public.reverse_exact_contact_merge(%L::uuid,'37000000-0000-4000-8000-000000000027','reverse-fixture-0001','owner-request','2026-08-18T15:04:00Z')$call$,current_setting('omnix.test_merge_plan')),
  '0A000','contact merge reverse is activation-gated until migration 0028','reverse is inert before the forward activation migration');
select is((select count(*)::integer from public.contact_merge_aliases where inactive_at is null),1,'blocked reverse leaves the alias unchanged');

select * from finish();
rollback;
