begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','19230000-0000-4000-8000-0000000000c1','authenticated','authenticated','portal-owner@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','19230000-0000-4000-8000-0000000000c2','authenticated','authenticated','portal-outsider@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('29230000-0000-4000-8000-0000000000c1','Paula Reyes, Realtor'),
('29230000-0000-4000-8000-0000000000c2','Other brokerage');
select set_config('omnix.actor_user_id','19230000-0000-4000-8000-0000000000c1',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('39230000-0000-4000-8000-0000000000c1','29230000-0000-4000-8000-0000000000c1','19230000-0000-4000-8000-0000000000c1','owner','active'),
('39230000-0000-4000-8000-0000000000c2','29230000-0000-4000-8000-0000000000c2','19230000-0000-4000-8000-0000000000c2','owner','active');
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,source,pipeline_stage,created_at,updated_at)
values('49230000-0000-4000-8000-0000000000c1','19230000-0000-4000-8000-0000000000c1','29230000-0000-4000-8000-0000000000c1','Linh','Nguyen','referral','new',now(),now());
insert into public.real_estate_transactions(
  id,workspace_id,contact_id,title,status,side,property_address,source,responsible_membership_id,
  source_snapshot,created_by_membership_id,idempotency_key,created_at,updated_at
) values(
  '59230000-0000-4000-8000-0000000000c1','29230000-0000-4000-8000-0000000000c1','49230000-0000-4000-8000-0000000000c1',
  'Nguyen purchase','under-contract','buyer','1408 Bayshore Dr, Tampa, FL','referral','39230000-0000-4000-8000-0000000000c1',
  '{"authority":"portal-fixture"}','39230000-0000-4000-8000-0000000000c1','69230000-0000-4000-8000-0000000000c1',now(),now());

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-0000000000c1',true);
select lives_ok($$
  insert into public.client_portal_links(workspace_id,transaction_id,token_hash,audience_label,created_by_membership_id,expires_at)
  values('29230000-0000-4000-8000-0000000000c1','59230000-0000-4000-8000-0000000000c1',repeat('a',64),'Linh',
    '39230000-0000-4000-8000-0000000000c1',now()+interval '30 days')
$$, 'an active member can create a portal link for her deal');
select throws_ok($$
  insert into public.client_portal_links(workspace_id,transaction_id,token_hash,audience_label,created_by_membership_id,expires_at)
  values('29230000-0000-4000-8000-0000000000c1','59230000-0000-4000-8000-0000000000c1',repeat('b',64),'Linh',
    '39230000-0000-4000-8000-0000000000c1',now()+interval '365 days')
$$, '23514', null, 'links cannot outlive 180 days');

select set_config('request.jwt.claim.sub','19230000-0000-4000-8000-0000000000c2',true);
select is((select count(*) from public.client_portal_links), 0::bigint, 'members of another workspace cannot see the link');
select throws_ok($$
  insert into public.client_portal_links(workspace_id,transaction_id,token_hash,audience_label,created_by_membership_id,expires_at)
  values('29230000-0000-4000-8000-0000000000c1','59230000-0000-4000-8000-0000000000c1',repeat('c',64),'X',
    '39230000-0000-4000-8000-0000000000c2',now()+interval '30 days')
$$, '42501', null, 'outsiders cannot mint links into another workspace');

reset role;
set local role anon;
select throws_ok($$ select * from public.client_portal_links $$, '42501', null, 'anonymous visitors cannot read link rows');
select is(public.get_client_portal(repeat('a',64))->>'propertyAddress', '1408 Bayshore Dr, Tampa, FL', 'a valid token opens the snapshot');
select ok(not (public.get_client_portal(repeat('a',64)) ? 'grossCommissionCents') and not (public.get_client_portal(repeat('a',64)) ? 'title'),
  'the snapshot never includes commission or internal deal names');
select is(public.get_client_portal(repeat('f',64)), null, 'an unknown token reveals nothing');

reset role;
update public.client_portal_links set revoked_at = now() where token_hash = repeat('a',64);
set local role anon;
select is(public.get_client_portal(repeat('a',64)), null, 'a revoked link stops working');

reset role;
select is((select view_count from public.client_portal_links where token_hash = repeat('a',64)), 3, 'each successful open is counted');

select * from finish();
rollback;
