-- Story 4.1 durable Mailchimp outbound backfill/tag-drift matrix.
-- Prerequisite: migrations 0001..0013 applied to an isolated Supabase DB.

begin;
select '1..27';

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'mailchimp_outbound_backfill_runs','mailchimp_outbound_backfill_approvals',
    'mailchimp_outbound_backfill_pages','mailchimp_outbound_backfill_job_links'
  ] loop
    if not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or has_table_privilege('authenticated','public.'||target_table,'INSERT')
      or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
      or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception '0013 table boundary failed for %',target_table;
    end if;
  end loop;
  if has_function_privilege('authenticated',
      'public.schedule_due_mailchimp_outbound_backfill_runs(timestamptz,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.claim_mailchimp_outbound_backfill_runs(uuid,integer,integer,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.read_mailchimp_outbound_backfill_page(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated',
      'public.preview_mailchimp_outbound_backfill(uuid,text,text,integer,uuid,timestamptz,integer)','EXECUTE')
     or not has_function_privilege('service_role',
      'public.enqueue_mailchimp_outbound_backfill_page(uuid,uuid,bigint,integer,text,jsonb,timestamptz)','EXECUTE') then
    raise exception '0013 function grants failed';
  end if;
end $$;
select 'ok 1 - public evidence forces RLS and mutations/workers are least privilege';

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
 ('00000000-0000-0000-0000-000000000000','31000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0013@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','31000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0013@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','31000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0013@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name) values
 ('32000000-0000-4000-8000-000000000001','0013 Workspace A'),
 ('32000000-0000-4000-8000-000000000002','0013 Workspace B');

select set_config('omnix.actor_user_id','31000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('33000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','owner','active'),
 ('33000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','31000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('33000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.connector_connections(
  id,workspace_id,provider,provider_account_key_hash,display_label,status,
  granted_scopes,remote_identity_summary,created_by_membership_id,created_at,updated_at
) values
 ('34000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','mailchimp',repeat('a',64),'A','active',array['audience.sync'],'{"dataCenter":"us21"}','33000000-0000-4000-8000-000000000001','2026-08-12T11:00:00Z','2026-08-12T11:00:00Z'),
 ('34000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000002','mailchimp',repeat('b',64),'B','active',array['audience.sync'],'{"dataCenter":"us7"}','33000000-0000-4000-8000-000000000003','2026-08-12T11:00:00Z','2026-08-12T11:00:00Z');

insert into public.mailchimp_audience_bindings(
 id,workspace_id,connection_id,account_id_hash,data_center,audience_external_id,
 audience_name,mapping_version,baseline_required,webhook_registration_required,
 selected_by_membership_id,selection_correlation_id,selected_at
) values
 ('35000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-a','Audience A',1,false,false,'33000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','2026-08-12T11:01:00Z'),
 ('35000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000002',repeat('b',64),'us7','audience-b','Audience B',1,false,false,'33000000-0000-4000-8000-000000000003','36000000-0000-4000-8000-000000000002','2026-08-12T11:01:00Z');

insert into public.contacts(
 id,owner_id,workspace_id,first_name,last_name,email,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at
) values
 ('37000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','Hot','Linked','hot.0013@example.com',true,'hot','lead','buyer','website','new','{}','2026-08-12T11:02:00Z','2026-08-12T11:02:00Z'),
 ('37000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','Warm','Unsubscribed','warm.0013@example.com',true,'warm','lead','seller','website','new','{}','2026-08-12T11:02:01Z','2026-08-12T11:02:01Z'),
 ('37000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','Nurture','Unlinked','nurture.0013@example.com',true,'nurture','lead','unknown','other','new','{}','2026-08-12T11:02:02Z','2026-08-12T11:02:02Z'),
 ('37000000-0000-4000-8000-000000000004','31000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000002','B','Linked','b.0013@example.com',true,'warm','lead','buyer','website','new','{}','2026-08-12T11:02:03Z','2026-08-12T11:02:03Z');

insert into public.mailchimp_member_links(
 id,workspace_id,connection_id,binding_id,contact_id,contact_point_id,
 subscriber_hash,member_external_id,created_at,updated_at
)
select '38000000-0000-4000-8000-000000000001'::uuid,point.workspace_id,
 '34000000-0000-4000-8000-000000000001'::uuid,'35000000-0000-4000-8000-000000000001'::uuid,
 point.contact_id,point.id,encode(extensions.digest(pg_catalog.convert_to(point.normalized_value,'UTF8'),'md5'),'hex'),
 'member-hot','2026-08-12T11:03:00Z'::timestamptz,'2026-08-12T11:03:00Z'::timestamptz
from public.contact_points point where point.contact_id='37000000-0000-4000-8000-000000000001' and point.type='email'
union all
select '38000000-0000-4000-8000-000000000002'::uuid,point.workspace_id,
 '34000000-0000-4000-8000-000000000001'::uuid,'35000000-0000-4000-8000-000000000001'::uuid,
 point.contact_id,point.id,encode(extensions.digest(pg_catalog.convert_to(point.normalized_value,'UTF8'),'md5'),'hex'),
 'member-warm','2026-08-12T11:03:01Z','2026-08-12T11:03:01Z'
from public.contact_points point where point.contact_id='37000000-0000-4000-8000-000000000002' and point.type='email'
union all
select '38000000-0000-4000-8000-000000000003'::uuid,point.workspace_id,
 '34000000-0000-4000-8000-000000000002'::uuid,'35000000-0000-4000-8000-000000000002'::uuid,
 point.contact_id,point.id,encode(extensions.digest(pg_catalog.convert_to(point.normalized_value,'UTF8'),'md5'),'hex'),
 'member-b','2026-08-12T11:03:02Z','2026-08-12T11:03:02Z'
from public.contact_points point where point.contact_id='37000000-0000-4000-8000-000000000004' and point.type='email';

insert into public.mailchimp_subscription_authority(
 id,workspace_id,connection_id,binding_id,member_link_id,provider_status,
 provider_unsubscribed_at,resubscribe_requires_consent,last_provider_event_id_hash,last_occurred_at
) values (
 '39000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001',
 '34000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001',
 '38000000-0000-4000-8000-000000000002','unsubscribed','2026-08-12T11:03:03Z',true,
 repeat('9',64),'2026-08-12T11:03:03Z'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin
    perform public.preview_mailchimp_outbound_backfill(
      '34000000-0000-4000-8000-000000000001','backfill',repeat('1',64),1,
      gen_random_uuid(),'2026-08-12T11:04:00Z',3);
    raise exception 'assistant previewed outbound backfill';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 2 - assistant cannot create a count-only preview';

select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
do $$ declare created jsonb; begin
  created:=public.preview_mailchimp_outbound_backfill(
    '34000000-0000-4000-8000-000000000001','backfill',repeat('1',64),1,
    '36000000-0000-4000-8000-000000000003','2026-08-12T11:04:00Z',3);
  perform set_config('omnix.test_backfill_run',created#>>'{preview,runId}',true);
  perform set_config('omnix.test_backfill_snapshot',created#>>'{preview,snapshotHash}',true);
  if (created->>'noOp')::boolean or created#>>'{preview,eligibleCount}'<>'1'
     or created#>>'{preview,skippedUnlinkedCount}'<>'1'
     or created#>>'{preview,skippedUnsubscribedCount}'<>'1'
     or created#>>'{preview,containsRawEmails}'<>'false'
     or created#>>'{receipt,provider}'<>'mailchimp'
     or created::text ~* 'example.com' then
    raise exception 'count-only preview/redaction failed: %',created;
  end if;
end $$;
select 'ok 3 - owner preview computes canonical counts and returns no raw email';

do $$ declare replay jsonb; begin
  replay:=public.preview_mailchimp_outbound_backfill(
    '34000000-0000-4000-8000-000000000001','backfill',repeat('1',64),1,
    gen_random_uuid(),'2026-08-12T11:04:01Z',3);
  if not (replay->>'noOp')::boolean
     or replay#>>'{preview,runId}'<>current_setting('omnix.test_backfill_run')
     or (select count(*) from public.mailchimp_outbound_backfill_runs
         where connection_id='34000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'preview replay duplicated';
  end if;
end $$;
select 'ok 4 - preview request-key replay reuses the durable snapshot';

select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.mailchimp_outbound_backfill_runs)<>1 then
    raise exception 'same-workspace assistant read failed';
  end if;
  perform set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000003',true);
  if exists(select 1 from public.mailchimp_outbound_backfill_runs) then
    raise exception 'cross-workspace run exposed';
  end if;
end $$;
select 'ok 5 - member reads are workspace-scoped by forced RLS';

reset role;
update public.contacts set lead_type='warm' where id='37000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
do $$ begin
  begin
    perform public.approve_mailchimp_outbound_backfill(
      current_setting('omnix.test_backfill_run')::uuid,
      current_setting('omnix.test_backfill_snapshot'),1,
      gen_random_uuid(),'2026-08-12T11:05:00Z');
    raise exception 'changed snapshot approved';
  exception when serialization_failure then null; end;
end $$;
select 'ok 6 - owner approval fails closed when canonical tags drift after preview';

reset role;
update public.contacts set lead_type='hot' where id='37000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
do $$ declare approved jsonb; begin
  approved:=public.approve_mailchimp_outbound_backfill(
    current_setting('omnix.test_backfill_run')::uuid,
    current_setting('omnix.test_backfill_snapshot'),1,
    '36000000-0000-4000-8000-000000000004','2026-08-12T11:05:01Z');
  if (approved->>'noOp')::boolean or approved#>>'{run,state}'<>'approved'
     or approved#>>'{approval,item_count}'<>'1'
     or approved#>>'{receipt,event_type}'<>'intent.approved' then
    raise exception 'exact approval/freeze failed';
  end if;
end $$;
select 'ok 7 - exact owner approval atomically freezes one immutable item snapshot';

do $$ declare replay jsonb; begin
  replay:=public.approve_mailchimp_outbound_backfill(
    current_setting('omnix.test_backfill_run')::uuid,
    current_setting('omnix.test_backfill_snapshot'),1,
    gen_random_uuid(),'2026-08-12T11:05:02Z');
  if not (replay->>'noOp')::boolean
     or (select count(*) from public.mailchimp_outbound_backfill_approvals
         where run_id=current_setting('omnix.test_backfill_run')::uuid)<>1 then
    raise exception 'approval replay duplicated';
  end if;
end $$;
select 'ok 8 - approval replay reuses the exact snapshot authority';

do $$ begin
  begin
    perform 1 from connector_private.mailchimp_outbound_backfill_items;
    raise exception 'authenticated read private snapshot';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 9 - frozen member identity and tag rows remain private';

reset role;
do $$ begin
  if (select count(*) from connector_private.mailchimp_outbound_backfill_items
      where run_id=current_setting('omnix.test_backfill_run')::uuid)<>1 then
    raise exception 'approved snapshot was not frozen';
  end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare scheduled public.mailchimp_outbound_backfill_runs%rowtype; begin
  select * into scheduled from public.schedule_due_mailchimp_outbound_backfill_runs(
    '2026-08-12T12:00:00Z',3600,10)
  where connection_id='34000000-0000-4000-8000-000000000002';
  perform set_config('omnix.test_scheduled_run',scheduled.id::text,true);
  if scheduled.id is null or scheduled.mode<>'tag-reconcile'
     or scheduled.request_origin<>'scheduler' or scheduled.state<>'previewed'
     or scheduled.approved_by_membership_id is not null
     or exists(select 1 from public.connector_jobs job where job.connection_id=scheduled.connection_id)
     or not exists(select 1 from public.connector_receipt_events receipt
       where receipt.event_key='mailchimp.backfill.previewed:'||scheduled.id::text
         and receipt.redacted_metadata->>'approvalRequired'='true') then
    raise exception 'scheduler created implicit approval/write';
  end if;
end $$;
select 'ok 10 - periodic scheduler creates a due tag-drift preview only';

do $$ begin
  if exists(select 1 from public.schedule_due_mailchimp_outbound_backfill_runs(
      '2026-08-12T12:00:01Z',3600,10))
     or (select count(*) from public.mailchimp_outbound_backfill_runs
         where connection_id='34000000-0000-4000-8000-000000000002')<>1 then
    raise exception 'scheduler replay duplicated active preview';
  end if;
end $$;
select 'ok 11 - due scheduler is idempotent while an approval-required preview is active';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin
    perform public.approve_mailchimp_outbound_backfill(
      current_setting('omnix.test_scheduled_run')::uuid,
      (select snapshot_hash from public.mailchimp_outbound_backfill_runs
       where id=current_setting('omnix.test_scheduled_run')::uuid),1,
      gen_random_uuid(),'2026-08-12T12:00:02Z');
    raise exception 'foreign assistant approved scheduler preview';
  exception when no_data_found then null; when insufficient_privilege then null; end;
end $$;
select 'ok 12 - scheduled tag reconciliation still requires an active workspace owner';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare claimed public.mailchimp_outbound_backfill_runs%rowtype; started jsonb; begin
  select * into claimed from public.claim_mailchimp_outbound_backfill_runs(
    '40000000-0000-4000-8000-000000000001',1,900,'2026-08-12T11:06:00Z');
  started:=public.start_mailchimp_outbound_backfill_run(
    claimed.id,'40000000-0000-4000-8000-000000000001',claimed.fencing_token,
    '2026-08-12T11:06:01Z');
  perform set_config('omnix.test_backfill_fence',claimed.fencing_token::text,true);
  if claimed.id<>current_setting('omnix.test_backfill_run')::uuid
     or started#>>'{run,state}'<>'executing' or started#>>'{run,attempt_count}'<>'1' then
    raise exception 'claim/start failed';
  end if;
end $$;
select 'ok 13 - service worker claims and starts one approved run with a fence';

do $$ begin
  begin
    perform public.read_mailchimp_outbound_backfill_page(
      current_setting('omnix.test_backfill_run')::uuid,
      '40000000-0000-4000-8000-000000000002',
      current_setting('omnix.test_backfill_fence')::bigint,'2026-08-12T11:06:02Z');
    raise exception 'wrong worker read page';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 14 - page read rejects a worker without the exact lease and fence';

do $$ declare page jsonb; begin
  page:=public.read_mailchimp_outbound_backfill_page(
    current_setting('omnix.test_backfill_run')::uuid,
    '40000000-0000-4000-8000-000000000001',
    current_setting('omnix.test_backfill_fence')::bigint,'2026-08-12T11:06:02Z');
  perform set_config('omnix.test_backfill_page_hash',page->>'pageHash',true);
  perform set_config('omnix.test_backfill_operation_key',page#>>'{items,0,operation,operationKey}',true);
  if page#>>'{binding,workspaceId}'<>'32000000-0000-4000-8000-000000000001'
     or page#>>'{binding,dataCenter}'<>'us21'
     or page#>>'{items,0,operation,desiredTag}'<>'Omnix: Hot'
     or jsonb_array_length(page->'items')<>1 or page::text ~* 'example.com'
     or not (page->>'finalPage')::boolean then
    raise exception 'redacted frozen page shape failed: %',page;
  end if;
end $$;
select 'ok 15 - worker receives one bounded redacted frozen operation page';

do $$ begin
  begin
    perform public.enqueue_mailchimp_outbound_backfill_page(
      current_setting('omnix.test_backfill_run')::uuid,
      '40000000-0000-4000-8000-000000000001',
      current_setting('omnix.test_backfill_fence')::bigint,0,
      current_setting('omnix.test_backfill_page_hash'),
      jsonb_build_array(jsonb_build_object(
        'itemIndex',0,'operationKey','wrong','ciphertext','YQ==','nonce','Yg==',
        'authTag','Yw==','wrappedDek','ZA==','wrapNonce','ZQ==','wrapAuthTag','Zg==',
        'kekVersion','v1','aadHash',repeat('a',64))),
      '2026-08-12T11:06:03Z');
    raise exception 'unbound envelope accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.connector_jobs
      where correlation_id='36000000-0000-4000-8000-000000000003') then
    raise exception 'invalid page left a partial job';
  end if;
end $$;
select 'ok 16 - invalid encrypted envelope binding rolls back the entire page';

do $$ declare enqueued jsonb; begin
  enqueued:=public.enqueue_mailchimp_outbound_backfill_page(
    current_setting('omnix.test_backfill_run')::uuid,
    '40000000-0000-4000-8000-000000000001',
    current_setting('omnix.test_backfill_fence')::bigint,0,
    current_setting('omnix.test_backfill_page_hash'),
    jsonb_build_array(jsonb_build_object(
      'itemIndex',0,'operationKey',current_setting('omnix.test_backfill_operation_key'),
      'ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),
      'nonce',encode(decode(repeat('01',12),'hex'),'base64'),
      'authTag',encode(decode(repeat('02',16),'hex'),'base64'),
      'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),
      'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
      'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),
      'kekVersion','v1','aadHash',repeat('a',64))),
    '2026-08-12T11:06:04Z');
  perform set_config('omnix.test_backfill_job',enqueued#>>'{jobIds,0}',true);
  if (enqueued->>'noOp')::boolean or enqueued#>>'{run,next_offset}'<>'1'
     or enqueued#>>'{page,item_count}'<>'1' or not (enqueued->>'finalPage')::boolean
     or (select count(*) from public.connector_jobs where id=(enqueued#>>'{jobIds,0}')::uuid)<>1 then
    raise exception 'page enqueue failed: %',enqueued;
  end if;
end $$;
select 'ok 17 - page atomically materializes one normal encrypted per-item job';

do $$ declare replay jsonb; begin
  replay:=public.enqueue_mailchimp_outbound_backfill_page(
    current_setting('omnix.test_backfill_run')::uuid,
    '40000000-0000-4000-8000-000000000001',
    current_setting('omnix.test_backfill_fence')::bigint,0,
    current_setting('omnix.test_backfill_page_hash'),'[]','2026-08-12T11:06:05Z');
  if not (replay->>'noOp')::boolean
     or replay#>>'{jobIds,0}'<>current_setting('omnix.test_backfill_job')
     or (select count(*) from public.mailchimp_outbound_backfill_pages
         where run_id=current_setting('omnix.test_backfill_run')::uuid)<>1 then
    raise exception 'page replay duplicated';
  end if;
end $$;
select 'ok 18 - page replay reuses its original receipt and job without a new envelope';

do $$ begin
  begin
    perform public.enqueue_mailchimp_outbound_backfill_page(
      current_setting('omnix.test_backfill_run')::uuid,
      '40000000-0000-4000-8000-000000000001',
      current_setting('omnix.test_backfill_fence')::bigint,0,
      repeat('f',64),'[]','2026-08-12T11:06:06Z');
    raise exception 'divergent page replay accepted';
  exception when unique_violation then null; end;
end $$;
select 'ok 19 - divergent page replay conflicts without mutating progress';

do $$ begin
  if (select action_type from public.connector_jobs
      where id=current_setting('omnix.test_backfill_job')::uuid)<>'audience.sync'
     or (select idempotency_key from public.connector_jobs
         where id=current_setting('omnix.test_backfill_job')::uuid)
        <>('mc-bf:'||current_setting('omnix.test_backfill_run')||':'||current_setting('omnix.test_backfill_operation_key'))
     or (select count(*) from public.connector_approval_events approval
         join public.mailchimp_outbound_backfill_job_links link
           on link.intent_version_id=approval.intent_version_id
         where link.job_id=current_setting('omnix.test_backfill_job')::uuid)<>1 then
    raise exception 'normal item authority incomplete';
  end if;
end $$;
select 'ok 20 - each item preserves normal intent, owner approval, policy and idempotency authority';

do $$ declare settled jsonb; begin
  settled:=public.settle_mailchimp_outbound_backfill_run(
    current_setting('omnix.test_backfill_run')::uuid,
    '40000000-0000-4000-8000-000000000001',
    current_setting('omnix.test_backfill_fence')::bigint,
    '2026-08-12T11:08:00Z','2026-08-12T11:07:00Z');
  if settled#>>'{run,state}'<>'retry_wait' or settled#>>'{jobCounts,pending}'<>'1'
     or (settled->>'completed')::boolean then raise exception 'pending settlement failed'; end if;
end $$;
select 'ok 21 - run waits durably while its normal item job remains pending';

do $$ declare claimed public.connector_jobs%rowtype; begin
  select * into claimed from public.claim_connector_jobs(
    '40000000-0000-4000-8000-000000000010',1,90,'2026-08-12T11:07:01Z');
  perform public.start_connector_job_attempt(claimed.id,'40000000-0000-4000-8000-000000000010',
    claimed.fencing_token,'2026-08-12T11:07:02Z');
  perform public.transition_connector_job(claimed.id,'40000000-0000-4000-8000-000000000010',
    claimed.fencing_token,'succeeded','provider.accepted','none',repeat('e',64),
    'remote-operation','finished','complete',null,'{"containsPii":false}',
    '2026-08-12T11:07:03Z');
  if claimed.id<>current_setting('omnix.test_backfill_job')::uuid
     or (select count(*) from public.connector_receipt_events receipt
         where receipt.job_id=claimed.id and receipt.event_type in ('provider.accepted','provider.final'))<>2 then
    raise exception 'normal job worker completion failed';
  end if;
end $$;
select 'ok 22 - existing connector worker completes the generated item with accepted/final receipts';

do $$ declare claimed public.mailchimp_outbound_backfill_runs%rowtype; settled jsonb; replay jsonb; begin
  select * into claimed from public.claim_mailchimp_outbound_backfill_runs(
    '40000000-0000-4000-8000-000000000003',1,900,'2026-08-12T11:08:00Z');
  perform public.start_mailchimp_outbound_backfill_run(
    claimed.id,'40000000-0000-4000-8000-000000000003',claimed.fencing_token,
    '2026-08-12T11:08:01Z');
  settled:=public.settle_mailchimp_outbound_backfill_run(
    claimed.id,'40000000-0000-4000-8000-000000000003',claimed.fencing_token,
    null,'2026-08-12T11:08:02Z');
  replay:=public.settle_mailchimp_outbound_backfill_run(
    claimed.id,'40000000-0000-4000-8000-000000000099',999,null,'2026-08-12T11:08:03Z');
  if not (settled->>'completed')::boolean or settled#>>'{run,state}'<>'succeeded'
     or settled#>>'{jobCounts,succeeded}'<>'1' or settled#>>'{receipt,provider}'<>'mailchimp'
     or not (replay->>'noOp')::boolean or replay#>>'{jobCounts,succeeded}'<>'1'
     or replay#>>'{jobCounts,pending}'<>'0' or replay#>>'{jobCounts,review}'<>'0' then
    raise exception 'success settlement/replay counts failed';
  end if;
end $$;
select 'ok 23 - all-success settlement is honest and terminal replay preserves exact job counts';

reset role;
do $$ begin
  begin
    update public.mailchimp_outbound_backfill_pages set item_count=0
    where run_id=current_setting('omnix.test_backfill_run')::uuid;
    raise exception 'page evidence updated';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from public.mailchimp_outbound_backfill_runs
    where id=current_setting('omnix.test_backfill_run')::uuid;
    raise exception 'run deleted';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
select 'ok 24 - frozen pages and durable run authority are append-only';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
do $$ declare created jsonb; begin
  created:=public.preview_mailchimp_outbound_backfill(
    '34000000-0000-4000-8000-000000000001','tag-reconcile',repeat('2',64),25,
    gen_random_uuid(),'2026-08-12T11:09:00Z',3);
  perform set_config('omnix.test_replace_run',created#>>'{preview,runId}',true);
  perform public.select_mailchimp_audience(
    '34000000-0000-4000-8000-000000000001',repeat('a',64),'us21',
    'audience-a2','Replacement',1,gen_random_uuid(),'2026-08-12T11:09:01Z');
  if (select state from public.mailchimp_outbound_backfill_runs
      where id=current_setting('omnix.test_replace_run')::uuid)<>'cancelled'
     or (select last_error_category from public.mailchimp_outbound_backfill_runs
         where id=current_setting('omnix.test_replace_run')::uuid)<>'audience_replaced' then
    raise exception 'audience replace did not invalidate preview';
  end if;
end $$;
select 'ok 25 - replacing the selected audience cancels work bound to the old snapshot';

reset role;
set constraints all immediate;
do $$ begin
  begin
    insert into public.mailchimp_outbound_backfill_runs(
      workspace_id,connection_id,binding_id,mode,mapping_version,snapshot_hash,
      request_key_hash,eligible_count,skipped_unlinked_count,skipped_unsubscribed_count,
      page_size,state,scheduled_at,max_attempts,request_origin,
      requested_by_membership_id,correlation_id,previewed_at
    ) values (
      '32000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',
      '35000000-0000-4000-8000-000000000002','backfill',1,repeat('a',64),repeat('b',64),
      0,0,0,10,'previewed',now(),3,'owner','33000000-0000-4000-8000-000000000001',
      gen_random_uuid(),now());
    raise exception 'cross-workspace binding accepted';
  exception when foreign_key_violation then null; end;
end $$;
select 'ok 26 - composite foreign keys reject cross-workspace run authority';

do $$ begin
  if exists(select 1 from public.mailchimp_outbound_backfill_pages page
      where to_jsonb(page)::text ~* 'example.com')
     or exists(select 1 from public.connector_receipt_events receipt
      where receipt.event_key like 'mailchimp.backfill.%'
        and receipt.redacted_metadata::text ~* 'example.com')
     or exists(select 1 from public.mailchimp_outbound_backfill_job_links link
      where to_jsonb(link)::text ~* 'example.com') then
    raise exception 'outbound evidence leaked raw email';
  end if;
end $$;
select 'ok 27 - public pages, links and receipts contain hashes/counts only';

rollback;
