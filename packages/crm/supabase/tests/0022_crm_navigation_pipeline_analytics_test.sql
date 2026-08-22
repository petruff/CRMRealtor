-- Story 3.3 atomic pipeline / RLS / stale-version matrix.
begin;
select '1..8';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000091','authenticated','authenticated','pipeline-a@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000092','authenticated','authenticated','pipeline-b@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
('21000000-0000-4000-8000-000000000091','Pipeline A'),('21000000-0000-4000-8000-000000000092','Pipeline B');
select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000091',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('31000000-0000-4000-8000-000000000091','21000000-0000-4000-8000-000000000091','11000000-0000-4000-8000-000000000091','owner','active');
select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000092',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('31000000-0000-4000-8000-000000000092','21000000-0000-4000-8000-000000000092','11000000-0000-4000-8000-000000000092','owner','active');
set constraints all immediate; set constraints all deferred;
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,pipeline_stage,created_at,updated_at) values
('41000000-0000-4000-8000-000000000091','11000000-0000-4000-8000-000000000091','21000000-0000-4000-8000-000000000091','Pipeline','Alpha','new','2026-08-12T10:00:00Z','2026-08-12T10:00:00Z'),
('41000000-0000-4000-8000-000000000092','11000000-0000-4000-8000-000000000092','21000000-0000-4000-8000-000000000092','Pipeline','Beta','new','2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');

do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_events' and column_name='metadata')
 or not exists(select 1 from pg_indexes where schemaname='public' and indexname='activity_events_workspace_pipeline_occurred_idx') then raise exception 'metadata/index missing'; end if;
end $$;
select 'ok 1 - metadata and bounded pipeline index exist';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000091',true);

do $$ declare result jsonb; begin
 result:=public.move_contact_pipeline_stage('21000000-0000-4000-8000-000000000091','41000000-0000-4000-8000-000000000091','new','active','2026-08-12T10:00:00Z','31000000-0000-4000-8000-000000000091','2026-08-12T11:00:00Z','pipeline-move-1');
 if result->>'noOp'<>'false' or result#>>'{contact,pipeline_stage}'<>'active' or result#>>'{event,metadata,fromStage}'<>'new' or result#>>'{event,metadata,toStage}'<>'active' then raise exception 'move receipt invalid'; end if;
end $$;
select 'ok 2 - stage move and exact metadata event are atomic';

do $$ declare result jsonb; begin
 result:=public.move_contact_pipeline_stage('21000000-0000-4000-8000-000000000091','41000000-0000-4000-8000-000000000091','new','active','2026-08-12T10:00:00Z','31000000-0000-4000-8000-000000000091','2026-08-12T11:00:00Z','pipeline-move-1');
 if result->>'noOp'<>'true' or (select count(*) from public.activity_events where idempotency_key='pipeline-move-1')<>1 then raise exception 'replay invalid'; end if;
end $$;
select 'ok 3 - exact replay is idempotent';

do $$ begin
 begin perform public.move_contact_pipeline_stage('21000000-0000-4000-8000-000000000091','41000000-0000-4000-8000-000000000091','active','closed','2026-08-12T11:00:00Z','31000000-0000-4000-8000-000000000091','2026-08-12T12:00:00Z','pipeline-move-1'); raise exception 'divergent replay passed'; exception when unique_violation then null; end;
end $$;
select 'ok 4 - divergent replay fails';

do $$ begin
 begin perform public.move_contact_pipeline_stage('21000000-0000-4000-8000-000000000091','41000000-0000-4000-8000-000000000091','new','closed','2026-08-12T10:00:00Z','31000000-0000-4000-8000-000000000091','2026-08-12T12:00:00Z','pipeline-stale'); raise exception 'stale move passed'; exception when serialization_failure then null; end;
 if (select pipeline_stage from public.contacts where id='41000000-0000-4000-8000-000000000091')<>'active' then raise exception 'stale move mutated'; end if;
end $$;
select 'ok 5 - stale version fails without mutation';

do $$ begin
 begin perform public.move_contact_pipeline_stage('21000000-0000-4000-8000-000000000092','41000000-0000-4000-8000-000000000092','new','active','2026-08-12T10:00:00Z','31000000-0000-4000-8000-000000000091','2026-08-12T12:00:00Z','pipeline-cross'); raise exception 'cross workspace passed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 6 - cross-workspace move fails closed';

reset role;
update public.contacts set archived_at='2026-08-12T12:10:00Z',archived_by_membership_id='31000000-0000-4000-8000-000000000091',archive_reason='test' where id='41000000-0000-4000-8000-000000000091';
set local role authenticated; select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000091',true);
do $$ begin
 begin perform public.move_contact_pipeline_stage('21000000-0000-4000-8000-000000000091','41000000-0000-4000-8000-000000000091','active','closed','2026-08-12T12:10:00Z','31000000-0000-4000-8000-000000000091','2026-08-12T12:11:00Z','pipeline-archived'); raise exception 'archived passed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - archived contacts cannot move';

do $$ begin
 if has_function_privilege('anon','public.move_contact_pipeline_stage(uuid,uuid,pipeline_stage,pipeline_stage,timestamptz,uuid,timestamptz,text)','EXECUTE')
 or not has_function_privilege('authenticated','public.move_contact_pipeline_stage(uuid,uuid,pipeline_stage,pipeline_stage,timestamptz,uuid,timestamptz,text)','EXECUTE') then raise exception 'RPC grants invalid'; end if;
end $$;
select 'ok 8 - only authenticated receives pipeline move execute';
rollback;
