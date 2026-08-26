begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_function('public','has_workspace_support_grant',array['uuid'],
  'separate support-grant predicate exists');
select has_function('public','assert_canonical_workspace_owner',array['uuid','uuid'],
  'transactional canonical-owner assertion exists');
select has_trigger('connector_private','connector_oauth_transactions',
  'connector_oauth_canonical_owner_binding','OAuth transactions enforce canonical owner binding');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('00000000-0000-0000-0000-000000000000','19000000-0000-4000-8000-000000000069','authenticated','authenticated','owner-69@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','19000000-0000-4000-8000-000000000169','authenticated','authenticated','support-69@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','19000000-0000-4000-8000-000000000269','authenticated','authenticated','other-69@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name) values
('29000000-0000-4000-8000-000000000069','Canonical authority'),
('29000000-0000-4000-8000-000000000169','Other workspace');
select set_config('omnix.actor_user_id','19000000-0000-4000-8000-000000000069',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('39000000-0000-4000-8000-000000000069','29000000-0000-4000-8000-000000000069','19000000-0000-4000-8000-000000000069','owner','active'),
('39000000-0000-4000-8000-000000000169','29000000-0000-4000-8000-000000000069','19000000-0000-4000-8000-000000000169','assistant','active'),
('39000000-0000-4000-8000-000000000269','29000000-0000-4000-8000-000000000169','19000000-0000-4000-8000-000000000269','owner','active');
insert into private.workspace_admin_grants(
  id,workspace_id,user_id,granted_by_user_id,reason
) values (
  '49000000-0000-4000-8000-000000000069',
  '29000000-0000-4000-8000-000000000069',
  '19000000-0000-4000-8000-000000000169',
  '19000000-0000-4000-8000-000000000069',
  'Bounded support fixture'
);
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000069',true);
select ok(public.is_workspace_owner('29000000-0000-4000-8000-000000000069'),
  'canonical owner remains owner');
select ok(not public.has_workspace_support_grant('29000000-0000-4000-8000-000000000069'),
  'owner identity is not synthesized from a support grant');
select ok(
  pg_get_functiondef('public.connector_current_membership(uuid,boolean)'::regprocedure)
    ilike '%assert_canonical_workspace_owner%',
  'owner-only connector path delegates to the canonical owner assertion'
);

select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000169',true);
select ok(not public.is_workspace_owner('29000000-0000-4000-8000-000000000069'),
  'support administrator remains non-owner');
select ok(public.has_workspace_support_grant('29000000-0000-4000-8000-000000000069'),
  'active assistant support grant is reported separately');
select throws_ok(
  $$select public.create_connector_connection(
    '29000000-0000-4000-8000-000000000069','contract-test','Support attempt',
    '59000000-0000-4000-8000-000000000069')$$,
  '42501',null,'support administrator cannot enter owner-only connector RPCs'
);
select ok(
  pg_get_functiondef('public.assert_rich_contact_actor(uuid,uuid,boolean)'::regprocedure)
    ilike '%assert_canonical_workspace_owner%',
  'owner-only rich-contact path delegates to the canonical owner assertion'
);
select throws_ok(
  $$select public.set_workspace_ai_enabled(
    '29000000-0000-4000-8000-000000000069',1,false,now())$$,
  '42501',null,'support administrator cannot mutate workspace AI settings'
);
select ok(not public.has_workspace_support_grant('29000000-0000-4000-8000-000000000169'),
  'support grant cannot be forged across workspace scope');

reset role;
update private.workspace_admin_grants
set revoked_at=now()
where id='49000000-0000-4000-8000-000000000069';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000169',true);
select ok(not public.has_workspace_support_grant('29000000-0000-4000-8000-000000000069'),
  'revoked support grant fails closed');

reset role;
select throws_ok(
  $$insert into public.workspace_members(id,workspace_id,user_id,role,status)
    values('39000000-0000-4000-8000-000000000369',
      '29000000-0000-4000-8000-000000000069',
      '19000000-0000-4000-8000-000000000269','owner','active')$$,
  '23505',null,'a second active owner is rejected'
);
select is(
  (select role::text from public.workspace_members
    where id='39000000-0000-4000-8000-000000000169'),
  'assistant','support membership is never rewritten to owner'
);
select ok(not has_function_privilege(
  'authenticated','public.assert_canonical_workspace_owner(uuid,uuid)','execute'),
  'the internal owner assertion is not directly browser callable'
);
select ok(
  pg_get_functiondef('public.is_workspace_owner(uuid)'::regprocedure)
    not ilike '%workspace_admin_grants%',
  'canonical owner predicate contains no support-grant path'
);

select * from finish();
rollback;
