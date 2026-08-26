begin; -- migration 20260825124000
create extension if not exists pgtap with schema extensions;
select plan(40);

select has_function('public','assert_canonical_workspace_owner_identity',array['uuid','uuid','uuid'],
  'explicit canonical-owner identity assertion exists');
select has_function('public','resolve_workspace_support_grant_id',array['uuid'],
  'support-grant identity RPC exists');
select has_function('public','list_canonical_contact_page',
  array['uuid','text','text','text','text','uuid','boolean','integer','integer'],
  'alias-aware canonical contact page RPC exists');
select ok(not has_function_privilege('authenticated',
  'public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)','execute'),
  'AI secret read remains unavailable to authenticated callers');
select ok(has_function_privilege('service_role',
  'public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)','execute'),
  'AI secret read remains service-role-only');
select ok(has_function_privilege('authenticated',
  'public.resolve_workspace_support_grant_id(uuid)','execute'),
  'authenticated callers can resolve only their own support-grant identity');
select ok(has_function_privilege('authenticated',
  'public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)','execute'),
  'authenticated callers can use the workspace-authorized page RPC');
select is(
  (select provolatile from pg_proc
    where oid='public.is_iso_date_value(jsonb)'::regprocedure),
  's'::"char",'ISO date validation has safe STABLE volatility'
);
select is(
  (select provolatile from pg_proc
    where oid='public.is_valid_smart_list_definition(jsonb)'::regprocedure),
  's'::"char",'Smart List validation has safe STABLE volatility'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      'public.is_valid_incomplete_candidate(jsonb)'::regprocedure,
      'public.is_valid_contact_conversion_payload(jsonb,boolean)'::regprocedure,
      'public.incomplete_candidate_contact_patch(jsonb,public.contacts)'::regprocedure,
      'public.is_valid_incomplete_conversion_plan(jsonb)'::regprocedure
    ]) target(oid)
    join pg_proc procedure on procedure.oid=target.oid
    where procedure.provolatile <> 's'
  ),
  'incomplete-record validators using stable date parsing have safe volatility'
);
select ok(
  (select prosrc from pg_proc
    where oid='public.reconcile_attention_items(uuid,jsonb,timestamptz,text)'::regprocedure)
    like '%occurrence_keys text[] := ''{}''::text[]%',
  'attention reconciliation initializes its occurrence accumulator as text[]'
);
select ok(has_function_privilege('service_role',
  'public.reconcile_attention_items(uuid,jsonb,timestamptz,text)','execute'),
  'attention lint repair preserves its service-role-only workflow grant');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-page@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000002','authenticated','authenticated','support-page@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000003','authenticated','authenticated','assistant-page@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000004','authenticated','authenticated','other-owner-page@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name) values
('2a000000-0000-4000-8000-000000000001','Canonical page workspace'),
('2a000000-0000-4000-8000-000000000002','Other page workspace');
select set_config('omnix.actor_user_id','1a000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','owner','active'),
('3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','assistant','active'),
('3a000000-0000-4000-8000-000000000003','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000003','assistant','active'),
('3a000000-0000-4000-8000-000000000004','2a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000004','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into private.workspace_admin_grants(
  id,workspace_id,user_id,granted_by_user_id,reason
) values (
  '4a000000-0000-4000-8000-000000000001',
  '2a000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000002',
  '1a000000-0000-4000-8000-000000000001',
  'Exact support identity fixture'
);

insert into public.workspace_ai_configurations(
  workspace_id,provider,model,enabled,data_policy,secret_version,key_fingerprint,
  configured_at,updated_at,updated_by_membership_id
) values (
  '2a000000-0000-4000-8000-000000000001','google-gemini','gemini-3.5-flash-lite',true,
  'paid-private',1,'abcdef123456','2026-08-25T12:30:00Z','2026-08-25T12:30:00Z',
  '3a000000-0000-4000-8000-000000000001'
);
insert into connector_private.workspace_ai_secret_envelopes(
  workspace_id,secret_version,envelope,created_at,updated_at
) values (
  '2a000000-0000-4000-8000-000000000001',1,
  jsonb_build_object(
    'schemaVersion','connector-secret-envelope.v1','algorithm','AES-256-GCM',
    'kekVersion','test-kek','aadHash',repeat('a',64),'ciphertext','dGVzdA=='
  ),'2026-08-25T12:30:00Z','2026-08-25T12:30:00Z'
);

insert into public.contacts(
  id,owner_id,workspace_id,first_name,last_name,preferred_name,phone,email,city,
  lead_type,relationship,source,next_touch_at,qualification_status,archived_at,
  archived_by_membership_id,archive_reason,created_at
) values
('5a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Jose','Alvarez','José','+1 416 555 0101','jose@example.test','Toronto','hot','lead','referral',null,'qualified',null,null,null,'2026-08-25T10:00:00Z'),
('5a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Amy','Sphere',null,null,'amy@example.test','Toronto','hot','sphere','website','2026-08-26','qualified',null,null,null,'2026-08-25T10:01:00Z'),
('5a000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Will','Client',null,null,'will@example.test','Ottawa','warm','active-client','referral','2026-08-27','qualified',null,null,null,'2026-08-25T10:02:00Z'),
('5a000000-0000-4000-8000-000000000004','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Nora','Past',null,null,'nora@example.test','Montreal','nurture','past-client','other','2026-08-28','needs-qualification',null,null,null,'2026-08-25T10:03:00Z'),
('5a000000-0000-4000-8000-000000000005','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Alias','Donor',null,null,'donor@example.test','Toronto','warm','lead','referral','2026-08-29','qualified',null,null,null,'2026-08-25T10:04:00Z'),
('5a000000-0000-4000-8000-000000000006','1a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Real','Archive',null,null,'archive@example.test','Toronto','nurture','past-client','other','2026-08-30','qualified',null,null,null,'2026-08-25T10:05:00Z'),
('5a000000-0000-4000-8000-000000000007','1a000000-0000-4000-8000-000000000004','2a000000-0000-4000-8000-000000000002','Other','Workspace',null,null,'other@example.test','Toronto','hot','lead','referral',null,'qualified',null,null,null,'2026-08-25T10:06:00Z');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$ begin
  perform public.add_contact_point(
    '5a000000-0000-4000-8000-000000000001','phone','Mobile','+1 416 555 0101',
    '4165550101',true,false,0,'3a000000-0000-4000-8000-000000000001',
    '2026-08-25T11:58:00Z'
  );
  perform public.archive_contact(
    '5a000000-0000-4000-8000-000000000005','3a000000-0000-4000-8000-000000000001',
    'Merged exact duplicate','2026-08-25T12:00:00Z'
  );
  perform public.archive_contact(
    '5a000000-0000-4000-8000-000000000006','3a000000-0000-4000-8000-000000000001',
    'Archived fixture','2026-08-25T12:01:00Z'
  );
end $$;
reset role;

select set_config('omnix.contact_merge_internal_write','on',true);
insert into public.contact_merge_workspace_state(
  id,workspace_id,alias_epoch,apply_enabled,activation_version,created_at,updated_at
) values (
  '6a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',1,true,2,
  '2026-08-25T12:00:00Z','2026-08-25T12:00:00Z'
);
insert into public.contact_merge_plans(
  id,workspace_id,actor_membership_id,survivor_contact_id,evidence_kind,group_hash,
  snapshot_hash,alias_epoch,state,request_hash,idempotency_key,expires_at,applied_at,
  created_at,updated_at
) values (
  '7a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',
  'email',repeat('a',64),repeat('b',64),1,'applied',repeat('c',64),'page-alias-0001',
  '2026-08-26T12:00:00Z','2026-08-25T12:00:00Z','2026-08-25T11:59:00Z','2026-08-25T12:00:00Z'
);
insert into public.contact_merge_aliases(
  id,workspace_id,plan_id,donor_contact_id,survivor_contact_id,alias_epoch,
  active_from,created_at,updated_at
) values (
  '8a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000005',
  '5a000000-0000-4000-8000-000000000001',1,'2026-08-25T12:00:00Z',
  '2026-08-25T12:00:00Z','2026-08-25T12:00:00Z'
);
select set_config('omnix.contact_merge_internal_write','',true);

insert into public.smart_lists(
  id,workspace_id,name,definition,status,created_by_membership_id,created_at,updated_at
) values (
  '9a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',
  'Warm and nurture',jsonb_build_object(
    'schemaVersion','smart-list-filter.v1',
    'criteria',jsonb_build_array(jsonb_build_object(
      'field','leadType','operator','in','value',jsonb_build_array('warm','nurture')
    )),
    'sort',jsonb_build_object('field','name','direction','desc')
  ),'active','3a000000-0000-4000-8000-000000000001',
  '2026-08-25T12:00:00Z','2026-08-25T12:00:00Z'
);

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(
  public.read_workspace_ai_secret_envelope(
    '2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001'
  )#>>'{secretVersion}',
  '1','service read accepts the supplied unique active canonical owner tuple'
);
select throws_ok(
  $$select public.read_workspace_ai_secret_envelope(
    '2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000002',
    '3a000000-0000-4000-8000-000000000002')$$,
  '42501',null,'service read rejects a support assistant tuple'
);
select throws_ok(
  $$select public.read_workspace_ai_secret_envelope(
    '2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000002',
    '3a000000-0000-4000-8000-000000000001')$$,
  '42501',null,'service read rejects a forged actor and owner-membership pairing'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000002',true);
select is(public.resolve_workspace_support_grant_id('2a000000-0000-4000-8000-000000000001'),
  '4a000000-0000-4000-8000-000000000001'::uuid,
  'support identity returns the exact active grant ID');
select ok(public.has_workspace_support_grant('2a000000-0000-4000-8000-000000000001'),
  'boolean support compatibility derives from the exact grant identity');
select is(public.resolve_workspace_support_grant_id('2a000000-0000-4000-8000-000000000002'),null::uuid,
  'support identity cannot cross workspace scope');

select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000003',true);
select is(public.resolve_workspace_support_grant_id('2a000000-0000-4000-8000-000000000001'),null::uuid,
  'ordinary assistant has no synthesized support-grant identity');
select ok(not public.has_workspace_support_grant('2a000000-0000-4000-8000-000000000001'),
  'ordinary assistant support check remains false without losing membership scope');

do $$
declare page jsonb;
begin
  page := public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,null,false,0,50
  );
  perform set_config('omnix.page_all',page::text,true);
end;
$$;
select is((current_setting('omnix.page_all')::jsonb->>'total')::integer,4,
  'active page total excludes the aliased physical donor');
select is((current_setting('omnix.page_all')::jsonb->>'activeTotal')::integer,4,
  'active canonical total is exact');
select is(jsonb_array_length(current_setting('omnix.page_all')::jsonb->'items'),4,
  'one bounded RPC returns only the requested canonical page');
select is(current_setting('omnix.page_all')::jsonb#>>'{items,0,id}',
  '5a000000-0000-4000-8000-000000000001',
  'contact ordering remains hot first with null next-touch first and UUID tie-break');
select is((current_setting('omnix.page_all')::jsonb#>>'{scopeCounts,leads}')::integer,2,
  'scope facet count uses the same canonical filtered relation');
select is((current_setting('omnix.page_all')::jsonb#>>'{scopeCounts,clients}')::integer,2,
  'client scope facet count is exact');
select is((current_setting('omnix.page_all')::jsonb#>>'{scopeCounts,needs-review}')::integer,1,
  'needs-review scope facet count is exact');
select is((current_setting('omnix.page_all')::jsonb#>>'{leadTypeCounts,hot}')::integer,2,
  'lead-type facet count is exact for the selected scope');

select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','jose',null,null,null,false,0,50
  )->>'total')::integer,1,
  'search preserves accent-insensitive contact matching without exhaustive loading'
);
select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','5550101',null,null,null,false,0,50
  )->>'total')::integer,1,
  'search preserves normalized digit matching'
);
select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,'referral',null,false,0,50
  )->>'total')::integer,2,
  'source filtering is exact and alias-aware'
);
select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,
    '9a000000-0000-4000-8000-000000000001',false,0,50
  )->>'total')::integer,2,
  'Smart List criteria are evaluated server-side over canonical contacts'
);
select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,null,true,0,50
  )->>'total')::integer,1,
  'archived page excludes active alias donors while retaining genuine archives'
);
select is(
  jsonb_array_length(public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,null,false,1,2
  )->'items'),2,
  'offset pagination returns the requested bounded window'
);

reset role;
insert into public.contacts(
  id,owner_id,workspace_id,first_name,last_name,lead_type,relationship,source,
  qualification_status,created_at
)
select
  gen_random_uuid(),
  '1a000000-0000-4000-8000-000000000001',
  '2a000000-0000-4000-8000-000000000001',
  'Bulk',
  'Smart ' || lpad(series::text,4,'0'),
  'warm','lead','other','qualified',
  '2026-08-25T13:00:00Z'::timestamptz + (series || ' seconds')::interval
from generate_series(1,505) series;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000003',true);

select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,
    '9a000000-0000-4000-8000-000000000001',false,500,10
  )->>'total')::integer,
  507,
  'Smart List total remains exact beyond the historical 500-row boundary'
);
select is(
  jsonb_array_length(public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,
    '9a000000-0000-4000-8000-000000000001',false,500,10
  )->'items'),
  7,
  'Smart List returns the exact bounded tail page beyond row 500'
);
select is(
  (public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,
    '9a000000-0000-4000-8000-000000000001',false,500,3
  )#>>'{scopeCounts,leads}')::integer,
  505,
  'Smart List scope facets are exact while the returned page remains bounded'
);

select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000004',true);
select throws_ok(
  $$select public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,null,false,0,50)$$,
  '42501',null,'canonical page rejects cross-workspace access'
);

reset role;
update public.workspace_members set status='revoked',revoked_at=now()
where id='3a000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000003',true);
select throws_ok(
  $$select public.list_canonical_contact_page(
    '2a000000-0000-4000-8000-000000000001','all','',null,null,null,false,0,50)$$,
  '42501',null,'canonical page rejects a revoked assistant');

reset role;
update private.workspace_admin_grants set revoked_at=now()
where id='4a000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000002',true);
select is(public.resolve_workspace_support_grant_id('2a000000-0000-4000-8000-000000000001'),null::uuid,
  'revoked support grant loses its identity immediately');

select * from finish();
rollback;
