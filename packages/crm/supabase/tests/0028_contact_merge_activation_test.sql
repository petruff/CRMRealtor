begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,created_at,raw_app_meta_data,raw_user_meta_data,updated_at,last_sign_in_at)
values('00000000-0000-0000-0000-000000000000','18000000-0000-4000-8000-000000000028','authenticated','authenticated',
  'merge-activation@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name)
values('28000000-0000-4000-8000-000000000028','Merge activation');
select set_config('omnix.actor_user_id','18000000-0000-4000-8000-000000000028',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status)
values('38000000-0000-4000-8000-000000000028','28000000-0000-4000-8000-000000000028',
  '18000000-0000-4000-8000-000000000028','owner','active');

insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,created_at,updated_at)
values
('48000000-0000-4000-8000-000000000028','18000000-0000-4000-8000-000000000028',
 '28000000-0000-4000-8000-000000000028','Survivor','Fixture','2026-01-01','2026-01-01'),
('48000000-0000-4000-8000-000000000029','18000000-0000-4000-8000-000000000028',
 '28000000-0000-4000-8000-000000000028','Donor','Active','2026-02-01','2026-02-01'),
('48000000-0000-4000-8000-000000000030','18000000-0000-4000-8000-000000000028',
 '28000000-0000-4000-8000-000000000028','Donor','Archived','2026-03-01','2026-03-01');
insert into public.contact_points(id,workspace_id,contact_id,type,label,display_value,normalized_value,
  is_primary,email_subscribed,display_order,created_by_membership_id,created_at,updated_at)
select gen_random_uuid(),'28000000-0000-4000-8000-000000000028'::uuid,id,'email','primary',
  'whole-plan@example.test','whole-plan@example.test',true,true,0,
  '38000000-0000-4000-8000-000000000028'::uuid,created_at,created_at
from public.contacts where workspace_id='28000000-0000-4000-8000-000000000028';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000028',true);

do $$ begin
  perform public.archive_contact('48000000-0000-4000-8000-000000000030',
    '38000000-0000-4000-8000-000000000028','duplicate-review','2025-12-01');
end $$;

reset role;
select is((select apply_enabled from public.contact_merge_workspace_state
  where workspace_id='28000000-0000-4000-8000-000000000028'),null,
  'workspace activation row is created lazily by planning');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000028',true);
do $$
declare result jsonb;
begin
  result:=public.plan_exact_contact_merge(
    '28000000-0000-4000-8000-000000000028','38000000-0000-4000-8000-000000000028','email',
    encode(extensions.digest(convert_to('email:whole-plan@example.test','UTF8'),'sha256'),'hex'),repeat('8',64),
    'activation-plan-0001','{}','2026-08-20T17:00:00Z','2026-08-20T16:00:00Z');
  perform set_config('omnix.activation_plan_id',result->>'planId',true);
  perform set_config('omnix.activation_snapshot',result->>'snapshotHash',true);
end;
$$;

reset role;
select is((select apply_enabled from public.contact_merge_workspace_state where workspace_id='28000000-0000-4000-8000-000000000028'),true,
  'new workspace state inherits the activated default');
select is((select activation_version from public.contact_merge_workspace_state where workspace_id='28000000-0000-4000-8000-000000000028'),2,
  'new workspace state records activation version 2');
select is((select state::text from public.contact_merge_plans where id=current_setting('omnix.activation_plan_id')::uuid),'pending','plan is applicable');
select is((select count(*)::integer from public.contact_merge_plan_members where plan_id=current_setting('omnix.activation_plan_id')::uuid),3,'whole plan persists all members');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000028',true);
select is((public.apply_exact_contact_merge(current_setting('omnix.activation_plan_id')::uuid,
  '38000000-0000-4000-8000-000000000028',current_setting('omnix.activation_snapshot'),
  'activation-apply-0001','2026-08-20T16:05:00Z')->>'state'),'applied','whole-plan apply succeeds');
reset role;
select is((select state::text from public.contact_merge_plans where id=current_setting('omnix.activation_plan_id')::uuid),'applied','plan state is applied');
select is((select count(*)::integer from public.contact_merge_aliases where plan_id=current_setting('omnix.activation_plan_id')::uuid and inactive_at is null),2,'all donors become active aliases');
select is((select count(*)::integer from public.contacts where id in ('48000000-0000-4000-8000-000000000029','48000000-0000-4000-8000-000000000030') and archive_reason='merged:'||current_setting('omnix.activation_plan_id')),2,'all donor archive projections are applied');
select is((select alias_epoch::integer from public.contact_merge_workspace_state where workspace_id='28000000-0000-4000-8000-000000000028'),1,'apply advances alias epoch once');
select is((select count(*)::integer from public.contact_merge_events where plan_id=current_setting('omnix.activation_plan_id')::uuid and kind='applied'),1,'apply appends one event');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000028',true);
select is((public.apply_exact_contact_merge(current_setting('omnix.activation_plan_id')::uuid,
  '38000000-0000-4000-8000-000000000028',current_setting('omnix.activation_snapshot'),
  'activation-apply-0001','2026-08-20T16:06:00Z')->>'noOp')::boolean,true,'exact apply replay is a no-op');
reset role;
select is((select count(*)::integer from public.contact_merge_events where plan_id=current_setting('omnix.activation_plan_id')::uuid and kind='applied'),1,'apply replay appends no event');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000028',true);
select is(public.resolve_canonical_contact_id('28000000-0000-4000-8000-000000000028','48000000-0000-4000-8000-000000000029'),
  '48000000-0000-4000-8000-000000000028'::uuid,'active donor resolves to survivor');
select is((select count(*)::integer from public.list_contact_alias_group_ids('28000000-0000-4000-8000-000000000028','48000000-0000-4000-8000-000000000029')),3,'active alias group expands as a whole plan');
select throws_ok($$select public.assert_contact_outbound_target('28000000-0000-4000-8000-000000000028','48000000-0000-4000-8000-000000000029',null)$$,
  '42501','outbound contact target is unavailable','archived active donor outbound fails closed');

select is((public.reverse_exact_contact_merge(current_setting('omnix.activation_plan_id')::uuid,
  '38000000-0000-4000-8000-000000000028','activation-reverse-0001','owner-request',
  '2026-08-20T16:10:00Z')->>'state'),'reversed','whole-plan reverse succeeds');
reset role;
select is((select state::text from public.contact_merge_plans where id=current_setting('omnix.activation_plan_id')::uuid),'reversed','plan state is reversed');
select is((select count(*)::integer from public.contact_merge_aliases where plan_id=current_setting('omnix.activation_plan_id')::uuid and inactive_at is null),0,'reverse deactivates every alias');
select is((select archived_at from public.contacts where id='48000000-0000-4000-8000-000000000029'),null,'reverse restores originally active donor');
select is((select archived_at from public.contacts where id='48000000-0000-4000-8000-000000000030'),'2025-12-01 00:00:00+00'::timestamptz,'reverse restores original archived timestamp');
select is((select archive_reason from public.contacts where id='48000000-0000-4000-8000-000000000030'),'duplicate-review','reverse restores original archive reason');
select is((select alias_epoch::integer from public.contact_merge_workspace_state where workspace_id='28000000-0000-4000-8000-000000000028'),2,'reverse advances alias epoch once');
select is((select count(*)::integer from public.contact_merge_events where plan_id=current_setting('omnix.activation_plan_id')::uuid and kind='reversed'),1,'reverse appends one event');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000028',true);
select is((public.reverse_exact_contact_merge(current_setting('omnix.activation_plan_id')::uuid,
  '38000000-0000-4000-8000-000000000028','activation-reverse-0001','owner-request',
  '2026-08-20T16:11:00Z')->>'noOp')::boolean,true,'exact reverse replay is a no-op');
select is(public.resolve_canonical_contact_id('28000000-0000-4000-8000-000000000028','48000000-0000-4000-8000-000000000029'),
  '48000000-0000-4000-8000-000000000029'::uuid,'reversed donor resolves to itself');
reset role;
select is((select count(*)::integer from public.contact_merge_events where plan_id=current_setting('omnix.activation_plan_id')::uuid),3,'event ledger contains planned, applied and reversed evidence');

select * from finish();
rollback;
