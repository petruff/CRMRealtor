begin;
select plan(18);

select has_table('public','contact_import_source_facts','typed import provenance table exists');
select has_column('public','contact_import_source_facts','value_type','source facts expose explicit type');
select has_column('public','contact_import_source_facts','value_json','source facts retain typed scalar value');
select ok(has_table_privilege('authenticated','public.contact_import_source_facts','SELECT'),'authenticated members receive read-only table grant');
select ok(not has_table_privilege('authenticated','public.contact_import_source_facts','INSERT'),'authenticated callers cannot bypass atomic importer');
select ok(not has_table_privilege('authenticated','public.contact_import_source_facts','UPDATE'),'source facts cannot be updated directly');
select ok(not has_table_privilege('authenticated','public.contact_import_source_facts','DELETE'),'source facts cannot be deleted directly');
select ok(has_function_privilege('authenticated','public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz)','EXECUTE'),'atomic importer remains authenticated');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','16000000-0000-4000-8000-000000000026','authenticated','authenticated','source-facts-a@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','16000000-0000-4000-8000-000000000027','authenticated','authenticated','source-facts-b@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','16000000-0000-4000-8000-000000000028','authenticated','authenticated','source-facts-revoked@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('26000000-0000-4000-8000-000000000026','Source facts A'),
('26000000-0000-4000-8000-000000000027','Source facts B');
select set_config('omnix.actor_user_id','16000000-0000-4000-8000-000000000026',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status,revoked_at) values
('36000000-0000-4000-8000-000000000026','26000000-0000-4000-8000-000000000026','16000000-0000-4000-8000-000000000026','owner','active',null);
select set_config('omnix.actor_user_id','16000000-0000-4000-8000-000000000027',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status,revoked_at) values
('36000000-0000-4000-8000-000000000027','26000000-0000-4000-8000-000000000027','16000000-0000-4000-8000-000000000027','owner','active',null);
select set_config('omnix.actor_user_id','16000000-0000-4000-8000-000000000028',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status,revoked_at) values
('36000000-0000-4000-8000-000000000028','26000000-0000-4000-8000-000000000026','16000000-0000-4000-8000-000000000028','assistant','revoked','2026-08-18T13:59:00Z');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000026',true);

do $$
declare result jsonb;
begin
  result := public.apply_contact_import_group(
    '26000000-0000-4000-8000-000000000026','36000000-0000-4000-8000-000000000026',
    'source-facts-success-0001',repeat('a',64),
    jsonb_build_object(
      'action','create',
      'contact',jsonb_build_object(
        'firstName','Sanitized','lastName','Fixture','leadType','warm',
        'relationship','lead','intent','unknown','source','other',
        'pipelineStage','new','tags','[]'::jsonb
      ),
      'activityIdempotencyKey','import:source-facts-success-0001',
      'sourceProfile',jsonb_build_object(
        'provider','first-class-real-estate','schemaVersion','first-class-contact.v1',
        'facts',jsonb_build_array(
          jsonb_build_object('key','assigned-agent-id','label','Assigned Agent ID',
            'category','ownership','valueType','text','value','synthetic-agent','sourceRowNumber',2),
          jsonb_build_object('key','email-optin','label','Email Optin',
            'category','consent','valueType','boolean','value',true,'sourceRowNumber',2)
        )
      )
    ),'2026-08-18T14:00:00Z'
  );
  if result->>'action' <> 'create' then raise exception 'source-fact fixture was not created'; end if;
  perform set_config('omnix.test_source_fact_contact',result->>'contactId',true);
end;
$$;

select is((select count(*)::integer from public.contact_import_source_facts),2,'all non-empty typed facts persist atomically');
select is((select value_json from public.contact_import_source_facts where source_key='email-optin'),'true'::jsonb,'boolean consent evidence remains typed');
select is((select category from public.contact_import_source_facts where source_key='email-optin'),'consent','consent evidence is classified without authorization escalation');
select is((select count(*)::integer from public.contact_import_source_facts where length(value_hash)=64),2,'facts retain deterministic integrity hashes');

do $$
declare replay jsonb;
begin
  replay := public.apply_contact_import_group(
    '26000000-0000-4000-8000-000000000026','36000000-0000-4000-8000-000000000026',
    'source-facts-success-0001',repeat('a',64),'{}'::jsonb,'2026-08-18T14:00:01Z');
  if not (replay->>'noOp')::boolean then raise exception 'exact group replay was not a no-op'; end if;
end;
$$;
select is((select count(*)::integer from public.contact_import_source_facts),2,'exact replay does not duplicate source facts');

do $$
begin
  begin
    perform public.apply_contact_import_group(
      '26000000-0000-4000-8000-000000000026','36000000-0000-4000-8000-000000000026',
      'source-facts-success-0001',repeat('b',64),'{}'::jsonb,'2026-08-18T14:00:02Z');
    raise exception 'divergent replay succeeded';
  exception when unique_violation then null; end;
end;
$$;
select is((select count(*)::integer from public.contact_import_source_facts),2,'divergent replay fails before mutation');

do $$
begin
  begin
    perform public.apply_contact_import_group(
      '26000000-0000-4000-8000-000000000026','36000000-0000-4000-8000-000000000026',
      'source-facts-invalid-0001',repeat('c',64),
      jsonb_build_object(
        'action','create','contact',jsonb_build_object(
          'firstName','Rollback','lastName','Fixture','leadType','warm',
          'relationship','lead','intent','unknown','source','other',
          'pipelineStage','new','tags','[]'::jsonb),
        'activityIdempotencyKey','import:source-facts-invalid-0001',
        'sourceProfile',jsonb_build_object(
          'provider','first-class-real-estate','schemaVersion','first-class-contact.v1',
          'facts',jsonb_build_array(jsonb_build_object(
            'key','bad-fact','label','Bad Fact','category','consent',
            'valueType','boolean','value','not-a-boolean','sourceRowNumber',3)))),'2026-08-18T14:01:00Z');
    raise exception 'invalid typed fact succeeded';
  exception when check_violation then null; end;
end;
$$;
reset role;
select ok(
  not exists(select 1 from public.contacts where first_name='Rollback' and last_name='Fixture')
  and not exists(select 1 from public.contact_intake_receipts where idempotency_key='source-facts-invalid-0001')
  and not exists(select 1 from public.contact_import_source_facts where group_idempotency_key='source-facts-invalid-0001'),
  'invalid typed fact rolls back contact, receipt and provenance together'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000027',true);
select is((select count(*)::integer from public.contact_import_source_facts),0,'another workspace cannot read imported provenance');
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000028',true);
select is((select count(*)::integer from public.contact_import_source_facts),0,'revoked membership cannot read imported provenance');

reset role;
select throws_ok(
  $$update public.contact_import_source_facts set source_label='Changed' where source_key='email-optin'$$,
  '23514','contact import source facts are immutable','source facts reject updates even through privileged SQL'
);

select * from finish();
rollback;
