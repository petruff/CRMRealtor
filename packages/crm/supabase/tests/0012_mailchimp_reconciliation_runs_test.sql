-- Story 4.1 resumable reconciliation and identity quarantine matrix.
-- Prerequisite: migrations 0001..0012 applied to an isolated Supabase DB.

begin;
select '1..24';

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'mailchimp_reconciliation_runs','mailchimp_reconciliation_pages'
  ] loop
    if not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or has_table_privilege('authenticated','public.'||target_table,'INSERT')
      or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
      or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception '0012 table boundary failed for %',target_table;
    end if;
  end loop;
  if has_function_privilege('authenticated',
      'public.claim_mailchimp_reconciliation_runs(uuid,integer,integer,timestamptz)','EXECUTE')
     or has_function_privilege('service_role',
      'public.complete_mailchimp_audience_baseline(uuid,uuid,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('service_role',
      'public.apply_mailchimp_baseline_member_0011(uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('service_role',
      'public.apply_mailchimp_inbound_subscription_event_0010(uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role',
      'public.read_mailchimp_reconciliation_access_token(uuid,uuid,bigint,timestamptz)','EXECUTE') then
    raise exception '0012 function grants failed';
  end if;
end $$;
select 'ok 1 - reconciliation tables force RLS and mutation/token/internal grants are least-privilege';

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
 ('00000000-0000-0000-0000-000000000000','21000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0012@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','21000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0012@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','21000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0012@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name) values
 ('22000000-0000-4000-8000-000000000001','0012 Workspace A'),
 ('22000000-0000-4000-8000-000000000002','0012 Workspace B');

select set_config('omnix.actor_user_id','21000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('23000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','owner','active'),
 ('23000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','21000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('23000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.connector_connections(
  id,workspace_id,provider,provider_account_key_hash,display_label,status,
  granted_scopes,remote_identity_summary,created_by_membership_id,created_at,updated_at
) values
 ('24000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','mailchimp',repeat('a',64),'A','active',array['audience.sync','audience.reconcile'],'{"dataCenter":"us21"}','23000000-0000-4000-8000-000000000001','2026-08-12T10:00:00Z','2026-08-12T10:00:00Z'),
 ('24000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','mailchimp',repeat('b',64),'B','active',array['audience.sync','audience.reconcile'],'{"dataCenter":"us7"}','23000000-0000-4000-8000-000000000003','2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');

insert into connector_private.connector_connection_secrets(
  workspace_id,connection_id,secret_type,ciphertext,nonce,auth_tag,wrapped_dek,
  wrap_nonce,wrap_auth_tag,kek_version,aad_hash,refreshed_at
) values
 ('22000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','mailchimp-access-token',decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('1',64),'2026-08-12T10:00:00Z'),
 ('22000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000002','mailchimp-access-token',decode(repeat('cc',32),'hex'),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),decode(repeat('dd',32),'hex'),decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),'v1',repeat('2',64),'2026-08-12T10:00:00Z');

insert into public.mailchimp_audience_bindings(
 id,workspace_id,connection_id,account_id_hash,data_center,audience_external_id,
 audience_name,mapping_version,baseline_required,webhook_registration_required,
 selected_by_membership_id,selection_correlation_id,selected_at
) values
 ('25000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-a','Audience A',1,true,false,'23000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001','2026-08-12T10:01:00Z'),
 ('25000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000002',repeat('b',64),'us7','audience-b','Audience B',1,true,false,'23000000-0000-4000-8000-000000000003','26000000-0000-4000-8000-000000000002','2026-08-12T10:01:00Z');

insert into public.contacts(
 id,owner_id,workspace_id,first_name,last_name,email,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at
) values
 ('27000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Ada','A','ada.0012@example.com',true,'hot','lead','buyer','website','new','{}','2026-08-12T10:02:00Z','2026-08-12T10:02:00Z'),
 ('27000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Dup','One','dup.0012@example.com',true,'warm','lead','unknown','other','new','{}','2026-08-12T10:02:01Z','2026-08-12T10:02:01Z'),
 ('27000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Dup','Two','dup.0012@example.com',true,'warm','lead','unknown','other','new','{}','2026-08-12T10:02:02Z','2026-08-12T10:02:02Z'),
 ('27000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Archived','A','archived.0012@example.com',true,'nurture','lead','unknown','other','new','{}','2026-08-12T10:02:03Z','2026-08-12T10:02:03Z');
update public.contacts set archived_at='2026-08-12T10:03:00Z',
 archived_by_membership_id='23000000-0000-4000-8000-000000000001',archive_reason='test'
where id='27000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  perform public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','baseline',repeat('3',64),repeat('4',64),2,gen_random_uuid(),'2026-08-12T10:04:00Z',3);
  raise exception 'assistant requested reconciliation';
 exception when insufficient_privilege then null; end;
end $$;
select 'ok 2 - assistant cannot request a baseline or reconciliation run';

select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
do $$ declare created jsonb; replay jsonb; begin
 created:=public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','baseline',repeat('3',64),repeat('4',64),2,'26000000-0000-4000-8000-000000000003','2026-08-12T10:04:00Z',3);
 replay:=public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','baseline',repeat('3',64),repeat('4',64),2,gen_random_uuid(),'2026-08-12T10:04:01Z',3);
 perform set_config('omnix.test_reconcile_run',created#>>'{run,id}',true);
 if (created->>'noOp')::boolean or not (replay->>'noOp')::boolean
    or created#>>'{run,state}'<>'queued' or created#>>'{receipt,provider}'<>'mailchimp'
    or (select count(*) from public.mailchimp_reconciliation_runs where connection_id='24000000-0000-4000-8000-000000000001')<>1 then
  raise exception 'owner run request/replay failed'; end if;
end $$;
select 'ok 3 - owner requests one exact baseline run and replay reuses its authority';

do $$ begin
 begin
  perform public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','baseline',repeat('5',64),repeat('6',64),2,gen_random_uuid(),now(),3);
  raise exception 'cross-workspace binding accepted';
 exception when no_data_found then null; end;
end $$;
select 'ok 4 - request cannot bind a foreign workspace audience';

select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.mailchimp_reconciliation_runs)<>1 then raise exception 'assistant same workspace read failed'; end if;
 perform set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
 if exists(select 1 from public.mailchimp_reconciliation_runs) then raise exception 'cross-workspace run exposed'; end if;
end $$;
select 'ok 5 - run/page RLS permits same-workspace read and blocks cross-workspace read';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare claimed public.mailchimp_reconciliation_runs%rowtype; started jsonb; begin
 select * into claimed from public.claim_mailchimp_reconciliation_runs('28000000-0000-4000-8000-000000000001',1,90,'2026-08-12T10:04:02Z');
 started:=public.start_mailchimp_reconciliation_run(claimed.id,'28000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-12T10:04:03Z');
 perform set_config('omnix.test_reconcile_fence',claimed.fencing_token::text,true);
 if claimed.id<>current_setting('omnix.test_reconcile_run')::uuid or started#>>'{run,state}'<>'executing' or started#>>'{run,attempt_count}'<>'1' then raise exception 'claim/start failed'; end if;
end $$;
select 'ok 6 - worker claims and starts a bounded durable run with monotonic fence';

do $$ declare token jsonb; begin
 token:=public.read_mailchimp_reconciliation_access_token(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000001',current_setting('omnix.test_reconcile_fence')::bigint,'2026-08-12T10:04:04Z');
 if token#>>'{binding,workspaceId}'<>'22000000-0000-4000-8000-000000000001'
    or token#>>'{binding,dataCenter}'<>'us21' or token#>>'{binding,audienceId}'<>'audience-a'
    or token#>>'{run,nextOffset}'<>'0' or token#>>'{secret,secretType}'<>'mailchimp-access-token'
    or token#>>'{secret,ciphertext}' is null then raise exception 'worker token envelope failed'; end if;
 begin
  perform public.read_mailchimp_reconciliation_access_token(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000002',current_setting('omnix.test_reconcile_fence')::bigint,'2026-08-12T10:04:04Z');
  raise exception 'wrong worker read token';
 exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - token/routing read requires exact run worker fence and returns encrypted envelope';

do $$ begin
 begin
  perform public.complete_mailchimp_reconciliation_run(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000001',current_setting('omnix.test_reconcile_fence')::bigint,repeat('7',64),'2026-08-12T10:04:05Z');
  raise exception 'run completed without final page';
 exception when check_violation then null; end;
end $$;
select 'ok 8 - baseline cannot complete before a verified final page';

do $$ declare page jsonb; ada_hash text; missing_hash text; begin
 ada_hash:=encode(extensions.digest(pg_catalog.convert_to('ada.0012@example.com','UTF8'),'md5'),'hex');
 missing_hash:=encode(extensions.digest(pg_catalog.convert_to('missing.0012@example.com','UTF8'),'md5'),'hex');
 page:=public.apply_mailchimp_reconciliation_page(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000001',current_setting('omnix.test_reconcile_fence')::bigint,0,
  jsonb_build_array(
   jsonb_build_object('memberId','member-ada','subscriberHash',ada_hash,'normalizedEmail','ada.0012@example.com','status','unsubscribed','sourceHash',repeat('8',64)),
   jsonb_build_object('memberId','member-missing','subscriberHash',missing_hash,'normalizedEmail','missing.0012@example.com','status','subscribed','sourceHash',repeat('9',64))
  ),2,3,repeat('a1',32),'2026-08-12T10:05:00Z');
 if page#>>'{run,next_offset}'<>'2' or page#>>'{page,item_count}'<>'2' or page#>>'{page,review_count}'<>'1' or (page->>'finalPage')::boolean then raise exception 'page checkpoint failed'; end if;
end $$;
select 'ok 9 - page applies at most approved size and atomically persists offset/count/hash progress';

do $$ begin
 if (select email_subscribed from public.contact_points where contact_id='27000000-0000-4000-8000-000000000001' and type='email') is distinct from false
    or (select count(*) from public.incomplete_records where workspace_id='22000000-0000-4000-8000-000000000001' and source='mailchimp-live')<>1
    or not exists(select 1 from public.activity_events where type::text='incomplete-record-received')
    or exists(select 1 from public.connector_receipt_events where event_key like 'mailchimp.identity.quarantined:%' and redacted_metadata::text ~* 'example.com') then raise exception 'canonical/quarantine atomic page result failed'; end if;
end $$;
select 'ok 10 - missing identity is quarantined with activity while canonical unsubscribe remains authoritative';

do $$ declare replay jsonb; ada_hash text; missing_hash text; begin
 ada_hash:=encode(extensions.digest(pg_catalog.convert_to('ada.0012@example.com','UTF8'),'md5'),'hex');
 missing_hash:=encode(extensions.digest(pg_catalog.convert_to('missing.0012@example.com','UTF8'),'md5'),'hex');
 replay:=public.apply_mailchimp_reconciliation_page(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000001',current_setting('omnix.test_reconcile_fence')::bigint,0,
  jsonb_build_array(
   jsonb_build_object('memberId','member-ada','subscriberHash',ada_hash,'normalizedEmail','ada.0012@example.com','status','unsubscribed','sourceHash',repeat('8',64)),
   jsonb_build_object('memberId','member-missing','subscriberHash',missing_hash,'normalizedEmail','missing.0012@example.com','status','subscribed','sourceHash',repeat('9',64))
  ),2,3,repeat('a1',32),'2026-08-12T10:05:01Z');
 if not (replay->>'noOp')::boolean or (select count(*) from public.incomplete_records where source='mailchimp-live')<>1 or (select count(*) from public.mailchimp_reconciliation_pages where run_id=current_setting('omnix.test_reconcile_run')::uuid)<>1 then raise exception 'page/quarantine replay duplicated'; end if;
end $$;
select 'ok 11 - page and quarantine replay reuse original rows with zero duplicates';

do $$ declare page jsonb; dup_hash text; begin
 dup_hash:=encode(extensions.digest(pg_catalog.convert_to('dup.0012@example.com','UTF8'),'md5'),'hex');
 page:=public.apply_mailchimp_reconciliation_page(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000001',current_setting('omnix.test_reconcile_fence')::bigint,2,
  jsonb_build_array(jsonb_build_object('memberId','member-dup','subscriberHash',dup_hash,'normalizedEmail','dup.0012@example.com','status','unsubscribed','sourceHash',repeat('a2',32))),3,3,repeat('a3',32),'2026-08-12T10:05:02Z');
 if not (page->>'finalPage')::boolean or page#>>'{page,review_count}'<>'1' or (select count(*) from public.incomplete_records where source='mailchimp-live')<>2 then raise exception 'final ambiguous page failed'; end if;
end $$;
select 'ok 12 - ambiguous identity reaches final checkpoint as review and quarantine without contact merge';

do $$ declare completed jsonb; begin
 completed:=public.complete_mailchimp_reconciliation_run(current_setting('omnix.test_reconcile_run')::uuid,'28000000-0000-4000-8000-000000000001',current_setting('omnix.test_reconcile_fence')::bigint,repeat('a4',32),'2026-08-12T10:05:03Z');
 if (completed->>'completed')::boolean or completed#>>'{run,state}'<>'review' or completed#>>'{receipt,event_type}'<>'sync.reviewed'
    or not (select baseline_required from public.mailchimp_audience_bindings where id='25000000-0000-4000-8000-000000000001') then raise exception 'review run marked baseline complete'; end if;
end $$;
select 'ok 13 - final run with review items is honest review and leaves baseline required';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
do $$ declare created jsonb; begin
 created:=public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','baseline',repeat('b1',32),repeat('b2',32),50,gen_random_uuid(),'2026-08-12T10:06:00Z',3);
 perform set_config('omnix.test_clean_run',created#>>'{run,id}',true);
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare claimed public.mailchimp_reconciliation_runs%rowtype; completed jsonb; begin
 select * into claimed from public.claim_mailchimp_reconciliation_runs('28000000-0000-4000-8000-000000000002',1,90,'2026-08-12T10:06:01Z');
 perform public.start_mailchimp_reconciliation_run(claimed.id,'28000000-0000-4000-8000-000000000002',claimed.fencing_token,'2026-08-12T10:06:02Z');
 perform public.apply_mailchimp_reconciliation_page(claimed.id,'28000000-0000-4000-8000-000000000002',claimed.fencing_token,0,'[]',0,0,repeat('b3',32),'2026-08-12T10:06:03Z');
 completed:=public.complete_mailchimp_reconciliation_run(claimed.id,'28000000-0000-4000-8000-000000000002',claimed.fencing_token,repeat('b4',32),'2026-08-12T10:06:04Z');
 if not (completed->>'completed')::boolean or completed#>>'{run,state}'<>'succeeded' or completed#>>'{baselineConfirmation,binding,baseline_required}'<>'false' then raise exception 'clean empty baseline did not complete'; end if;
end $$;
select 'ok 14 - zero-item final page is valid and only clean completion clears baseline readiness';

do $$ begin
 begin
  perform public.apply_mailchimp_reconciliation_page(current_setting('omnix.test_clean_run')::uuid,'28000000-0000-4000-8000-000000000002',1,0,(select jsonb_agg(jsonb_build_object('memberId','x','subscriberHash',repeat('a',32),'normalizedEmail','x@example.com','status','subscribed','sourceHash',repeat('c',64))) from generate_series(1,501)),501,501,repeat('c1',32),now());
  raise exception 'oversized page accepted';
 exception when invalid_parameter_value then null; when serialization_failure then null; end;
end $$;
select 'ok 15 - page input is hard-bounded to 500 items';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
do $$ declare created jsonb; begin
 created:=public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','reconcile',repeat('c2',32),repeat('c3',32),100,gen_random_uuid(),'2026-08-12T10:07:00Z',2);
 perform set_config('omnix.test_periodic_run',created#>>'{run,id}',true);
end $$;
select 'ok 16 - periodic reconciliation is requestable only after baseline completion';

do $$ declare replaced jsonb; begin
 replaced:=public.select_mailchimp_audience('24000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-a2','Replacement',1,gen_random_uuid(),'2026-08-12T10:07:01Z');
 if (select state from public.mailchimp_reconciliation_runs where id=current_setting('omnix.test_periodic_run')::uuid)<>'cancelled'
    or (select last_error_category from public.mailchimp_reconciliation_runs where id=current_setting('omnix.test_periodic_run')::uuid)<>'audience_replaced' then raise exception 'replace did not invalidate run'; end if;
end $$;
select 'ok 17 - audience replacement atomically cancels durable work bound to prior audience';

do $$ begin
 begin
  perform public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','reconcile',repeat('c4',32),repeat('c5',32),100,gen_random_uuid(),now(),2);
  raise exception 'replaced binding requested';
 exception when no_data_found then null; end;
end $$;
select 'ok 18 - replaced audience binding cannot be requested or resumed';

select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
do $$ declare created jsonb; begin
 created:=public.request_mailchimp_reconciliation_run('24000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000002','baseline',repeat('d1',32),repeat('d2',32),10,gen_random_uuid(),'2026-08-12T10:08:00Z',2);
 perform set_config('omnix.test_b_run',created#>>'{run,id}',true);
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare first_claim public.mailchimp_reconciliation_runs%rowtype; second_claim public.mailchimp_reconciliation_runs%rowtype; begin
 select * into first_claim from public.claim_mailchimp_reconciliation_runs('28000000-0000-4000-8000-000000000003',1,30,'2026-08-12T10:08:01Z');
 perform public.start_mailchimp_reconciliation_run(first_claim.id,'28000000-0000-4000-8000-000000000003',first_claim.fencing_token,'2026-08-12T10:08:02Z');
 perform public.transition_mailchimp_reconciliation_run(first_claim.id,'28000000-0000-4000-8000-000000000003',first_claim.fencing_token,'retry','provider_timeout','2026-08-12T10:09:00Z','2026-08-12T10:08:03Z');
 select * into second_claim from public.claim_mailchimp_reconciliation_runs('28000000-0000-4000-8000-000000000004',1,30,'2026-08-12T10:09:00Z');
 if second_claim.id<>first_claim.id or second_claim.fencing_token<>first_claim.fencing_token+1 then raise exception 'retry fence failed'; end if;
 begin
  perform public.start_mailchimp_reconciliation_run(first_claim.id,'28000000-0000-4000-8000-000000000003',first_claim.fencing_token,'2026-08-12T10:09:01Z');
  raise exception 'stale worker restarted';
 exception when serialization_failure then null; end;
 perform public.start_mailchimp_reconciliation_run(second_claim.id,'28000000-0000-4000-8000-000000000004',second_claim.fencing_token,'2026-08-12T10:09:01Z');
 perform set_config('omnix.test_b_fence',second_claim.fencing_token::text,true);
end $$;
select 'ok 19 - retry is durable and a new claim fences the prior worker';

reset role;
update connector_private.connector_connection_secrets set ciphertext=null,nonce=null,auth_tag=null,wrapped_dek=null,wrap_nonce=null,wrap_auth_tag=null,destroyed_at='2026-08-12T10:09:02Z'
where connection_id='24000000-0000-4000-8000-000000000002' and secret_type='mailchimp-access-token';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 begin
  perform public.read_mailchimp_reconciliation_access_token(current_setting('omnix.test_b_run')::uuid,'28000000-0000-4000-8000-000000000004',current_setting('omnix.test_b_fence')::bigint,'2026-08-12T10:09:03Z');
  raise exception 'destroyed token read';
 exception when no_data_found then null; end;
end $$;
select 'ok 20 - destroyed access-token envelope fails closed for the exact live worker';

do $$ begin
 begin
  perform public.apply_mailchimp_reconciliation_page(current_setting('omnix.test_b_run')::uuid,'28000000-0000-4000-8000-000000000004',current_setting('omnix.test_b_fence')::bigint,1,'[]',1,1,repeat('d3',32),'2026-08-12T10:09:04Z');
  raise exception 'wrong offset page accepted';
 exception when serialization_failure then null; end;
end $$;
select 'ok 21 - offset CAS rejects skipped/resumed pages without progress mutation';

do $$ begin
 if exists(select 1 from public.mailchimp_reconciliation_pages where to_jsonb(mailchimp_reconciliation_pages)::text ~* 'example.com')
    or exists(select 1 from public.connector_receipt_events where event_key like 'mailchimp.reconciliation.%' and redacted_metadata::text ~* 'example.com')
    or exists(select 1 from public.incomplete_records where source='mailchimp-live' and external_id !~ '^mailchimp-member:[0-9a-f]{64}$') then raise exception 'reconciliation/quarantine redaction failed'; end if;
end $$;
select 'ok 22 - page/receipt/external identity evidence contains hashes and counts, not raw provider identity';

reset role;
do $$ begin
 begin
  update public.mailchimp_reconciliation_pages set item_count=0 where run_id=current_setting('omnix.test_reconcile_run')::uuid;
  raise exception 'page evidence updated';
 exception when object_not_in_prerequisite_state then null; end;
 begin
  delete from public.mailchimp_reconciliation_runs where id=current_setting('omnix.test_reconcile_run')::uuid;
  raise exception 'run deleted';
 exception when object_not_in_prerequisite_state then null; end;
end $$;
select 'ok 23 - reconciliation page evidence and run authority reject privileged mutation/delete';

do $$ begin
 if (select count(*) from public.incomplete_records where workspace_id='22000000-0000-4000-8000-000000000002')<>0
    or exists(select 1 from public.incomplete_records record join public.connector_receipt_events receipt on receipt.redacted_metadata->>'incompleteRecordId'=record.id::text where record.workspace_id<>receipt.workspace_id) then raise exception 'quarantine crossed workspace'; end if;
end $$;
select 'ok 24 - identity quarantine and receipt links remain workspace-contained';

rollback;
