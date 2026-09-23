-- Transactional TAP-style integration tests; run against migrated local Supabase.
begin;
select '1..10';
do $$ begin
  if has_table_privilege('authenticated','public.capture_outcomes','INSERT')
    or has_table_privilege('authenticated','public.capture_outcome_versions','UPDATE')
    or has_function_privilege('anon','public.save_capture_outcome(uuid,uuid,jsonb,integer,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz)','EXECUTE') then raise exception 'Unsafe capture privileges'; end if;
end $$;
select 'ok 1 - capture writes require guarded commands';
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000001','authenticated','authenticated','capture-owner@test.invalid','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000002','authenticated','authenticated','capture-other@test.invalid','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values ('92000000-0000-4000-8000-000000000001','Capture'),('92000000-0000-4000-8000-000000000002','Other');
select set_config('omnix.actor_user_id','91000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','owner','active'),
 ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','owner','active');
insert into public.contacts(id,workspace_id,owner_id,first_name,last_name) values ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Capture','Client');
select set_config('capture.test.document',jsonb_build_object('schemaVersion','capture-outcome.v1','id','95000000-0000-4000-8000-000000000001',
  'workspaceId','92000000-0000-4000-8000-000000000001','contactId','94000000-0000-4000-8000-000000000001','createdByMembershipId','93000000-0000-4000-8000-000000000001',
  'sourceText',' Client will call. ','sourceHash',encode(extensions.digest(convert_to(' Client will call. ','UTF8'),'sha256'),'hex'),'targetHash',repeat('b',64),'contentHash',repeat('a',64),
  'revision',1,'version',1,'status','pending','createdAt','2026-09-07T12:00:00Z','expiresAt','2026-09-14T12:00:00Z',
  'operations',jsonb_build_array(jsonb_build_object('id','96000000-0000-4000-8000-000000000001','type','note-append','state','pending','selected',true,'after',jsonb_build_object('text',' Client will call. '))))::text,true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$ declare a jsonb; b jsonb; begin
  a:=public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',current_setting('capture.test.document')::jsonb,null,'capture-test-key');
  b:=public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',current_setting('capture.test.document')::jsonb,null,'capture-test-key');
  if a<>b or (select count(*) from public.capture_outcome_versions)<>1 then raise exception 'Capture idempotency failed'; end if;
end $$;
select 'ok 2 - same recap and key reuse one parent and immutable version';
do $$ begin
  begin
    perform public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',jsonb_set(current_setting('capture.test.document')::jsonb,'{revision}','3'),2,null);
    raise exception 'Stale revision accepted';
  exception when serialization_failure then null; end;
end $$;
select 'ok 3 - stale revision rejected';
do $$ declare doc jsonb; begin
  doc:=jsonb_set(jsonb_set(jsonb_set(current_setting('capture.test.document')::jsonb,'{revision}','2'),'{status}','"completed"'),'{operations,0,state}','null');
  begin
    perform public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',doc,1,null);
    raise exception 'Null-state forged completion accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select 'ok 4 - null operation state cannot forge completion';
do $$ declare doc jsonb; begin
  doc:=jsonb_set(jsonb_set(jsonb_set(current_setting('capture.test.document')::jsonb,'{revision}','2'),'{status}','"completed"'),'{operations,0,state}','"completed"');
  begin
    perform public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',doc,1,null);
    raise exception 'Forged completion accepted';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 5 - completion requires canonical child receipts';
do $$ begin
  begin
    perform public.append_capture_outcome_note('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001',1,'94000000-0000-4000-8000-000000000001','Unapproved','unapproved',now());
    raise exception 'Ungoverned note accepted';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.notes where contact_id='94000000-0000-4000-8000-000000000001') then raise exception 'Unapproved note mutated CRM'; end if;
end $$;
select 'ok 6 - note append refuses missing canonical approval';
do $$ begin
  begin
    update public.capture_outcome_versions set document='{}'; raise exception 'Versions mutable';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - immutable versions reject browser updates';
do $$ declare doc jsonb; begin
  doc:=jsonb_set(jsonb_set(current_setting('capture.test.document')::jsonb,'{revision}','2'),'{status}','"awaiting-provider"');
  begin
    perform public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',doc,1,null);
    raise exception 'Pending note forged awaiting-provider parent';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 8 - pending items cannot forge awaiting-provider parent';
do $$ declare doc jsonb; begin
  doc:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(current_setting('capture.test.document')::jsonb,'{revision}','2'),'{status}','"awaiting-provider"'),'{operations,0,type}','"google-email-draft"'),'{operations,0,state}','"awaiting-provider"'),'{operations,0,requiredAuthority}','"owner"');
  begin
    perform public.save_capture_outcome('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',doc,1,null);
    raise exception 'Provider preparation without canonical receipt accepted';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 9 - provider items require canonical intent receipts';
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from public.capture_outcomes) or exists(select 1 from public.capture_outcome_versions) then raise exception 'Cross-workspace capture leak'; end if;
end $$;
select 'ok 10 - workspace RLS isolates source and review versions';
rollback;
