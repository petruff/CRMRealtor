begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','19230000-0000-4000-8000-0000000000b1','authenticated','authenticated','push-owner@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','19230000-0000-4000-8000-0000000000b2','authenticated','authenticated','push-other@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values('29230000-0000-4000-8000-0000000000b1','Push');
select set_config('omnix.actor_user_id','19230000-0000-4000-8000-0000000000b1',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('39230000-0000-4000-8000-0000000000b1','29230000-0000-4000-8000-0000000000b1','19230000-0000-4000-8000-0000000000b1','owner','active'),
('39230000-0000-4000-8000-0000000000b2','29230000-0000-4000-8000-0000000000b1','19230000-0000-4000-8000-0000000000b2','assistant','active');

select ok(not has_table_privilege('anon','public.push_subscriptions','SELECT'),'anonymous clients cannot read subscriptions');
select ok(not has_column_privilege('authenticated','public.push_subscriptions','endpoint','UPDATE'),'endpoints cannot be rewritten in place');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-0000000000b1',true);
select lives_ok($$insert into public.push_subscriptions(workspace_id,membership_id,endpoint,p256dh,auth_secret)
  values('29230000-0000-4000-8000-0000000000b1','39230000-0000-4000-8000-0000000000b1','https://push.example/abc',repeat('k',87),repeat('a',22))$$,'a member registers their own device');
select throws_ok($$insert into public.push_subscriptions(workspace_id,membership_id,endpoint,p256dh,auth_secret)
  values('29230000-0000-4000-8000-0000000000b1','39230000-0000-4000-8000-0000000000b2','https://push.example/def',repeat('k',87),repeat('a',22))$$,'42501',null,'nobody can register a device for another member');
select throws_ok($$insert into public.push_subscriptions(workspace_id,membership_id,endpoint,p256dh,auth_secret)
  values('29230000-0000-4000-8000-0000000000b1','39230000-0000-4000-8000-0000000000b1','http://insecure.example/x',repeat('k',87),repeat('a',22))$$,'23514',null,'only https push endpoints are accepted');

select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-0000000000b2',true);
select is((select count(*)::integer from public.push_subscriptions),0,'other members cannot see someone else''s devices');
select lives_ok($$delete from public.push_subscriptions$$,'a delete by another member affects nothing (checked below)');

select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-0000000000b1',true);
select is((select count(*)::integer from public.push_subscriptions),1,'the owner still sees their device after another member tried to delete it');
reset role;

select * from finish();
rollback;
