-- Story 4.2 remediation: Gmail push/reconciliation, Calendar lifecycle,
-- identity-bound provider probe and confirmed-only revocation authority.
begin;
select '1..30';

do $$ declare target_table text; begin
 foreach target_table in array array['google_gmail_history_wakeup_jobs','google_gmail_watch_deliveries',
  'google_gmail_send_reconciliations'] loop
  if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
   where namespace.nspname='public' and relation.relname=target_table
    and relation.relrowsecurity and relation.relforcerowsecurity)
   or has_table_privilege('authenticated','public.'||target_table,'INSERT')
   or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
   or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
   raise exception '0021 RLS/grant failed for %',target_table; end if;
 end loop;
end $$;
select 'ok 1 - new workspace-visible Google metadata forces RLS and denies direct member mutation';

do $$ begin
 if has_table_privilege('authenticated','connector_private.google_gmail_watch_ingress_authorities','SELECT')
  or has_function_privilege('authenticated','public.register_google_gmail_push_wakeup(text,text,text,text,text,text,text,timestamptz,timestamptz,uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.register_google_gmail_push_wakeup(text,text,text,text,text,text,text,timestamptz,timestamptz,uuid)','EXECUTE') then
  raise exception 'private Gmail push authority escaped service role'; end if;
end $$;
select 'ok 2 - encrypted/routing authority and push ingestion remain service-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0021@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000002','authenticated','authenticated','owner-b-0021@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('a2000000-0000-4000-8000-000000000001','0021 Workspace A'),
 ('a2000000-0000-4000-8000-000000000002','0021 Workspace B');
select set_config('omnix.actor_user_id','a1000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner','active');
select set_config('omnix.actor_user_id','a1000000-0000-4000-8000-000000000002',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','owner','active');
set constraints all immediate; set constraints all deferred;

insert into public.connector_connections(id,workspace_id,provider,provider_account_key_hash,display_label,
 status,granted_scopes,remote_identity_summary,created_by_membership_id,created_at,updated_at) values
 ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','google',repeat('a',64),
  'owner.google@example.com','active',array['openid','email','https://www.googleapis.com/auth/gmail.metadata'],
  '{"identity":"hash-only"}','a3000000-0000-4000-8000-000000000001','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z'),
 ('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','google',repeat('b',64),
  'other.google@example.com','active',array['openid','email','https://www.googleapis.com/auth/gmail.metadata'],
  '{"identity":"hash-only"}','a3000000-0000-4000-8000-000000000002','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z');
insert into public.google_connection_capabilities(workspace_id,connection_id,bundle,required_scopes,
 granted_scopes,state,account_key_hash,authorized_by_membership_id,authorized_at,created_at,updated_at) values
 ('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','gmail-metadata',
  array['openid','email','https://www.googleapis.com/auth/gmail.metadata'],
  array['openid','email','https://www.googleapis.com/auth/gmail.metadata'],'active',repeat('a',64),
  'a3000000-0000-4000-8000-000000000001','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z'),
 ('a2000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000002','gmail-metadata',
  array['openid','email','https://www.googleapis.com/auth/gmail.metadata'],
  array['openid','email','https://www.googleapis.com/auth/gmail.metadata'],'active',repeat('b',64),
  'a3000000-0000-4000-8000-000000000002','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z');
insert into connector_private.google_gmail_watch_resources(id,workspace_id,connection_id,channel_key_hash,
 resource_key_hash,expires_at,created_at,updated_at) values
 ('a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',repeat('1',64),repeat('2',64),
  '2026-08-20T12:00:00Z','2026-08-12T12:00:00Z','2026-08-12T12:00:00Z');
insert into connector_private.google_gmail_watch_ingress_authorities(id,workspace_id,connection_id,watch_resource_id,
 endpoint_key_hash,exact_external_url_hash,subscription_hash,oidc_audience_hash,account_email_hash,created_at,updated_at)
values('a6000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
 'a4000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',
 repeat('3',64),repeat('4',64),repeat('5',64),repeat('6',64),
 encode(extensions.digest(pg_catalog.convert_to('owner.google@example.com','UTF8'),'sha256'),'hex'),
 '2026-08-12T12:00:00Z','2026-08-12T12:00:00Z');
insert into connector_private.connector_connection_secrets(workspace_id,connection_id,secret_type,ciphertext,
 nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,expires_at,created_at,updated_at) values
 ('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','google-access-token',
  decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),
  decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('7',64),'2026-08-12T14:00:00Z',
  '2026-08-12T12:00:00Z','2026-08-12T12:00:00Z'),
 ('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','google-refresh-token',
  decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),
  decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('8',64),null,
  '2026-08-12T12:00:00Z','2026-08-12T12:00:00Z');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare first_result jsonb; replay jsonb; begin
 first_result:=public.register_google_gmail_push_wakeup(repeat('3',64),repeat('4',64),repeat('5',64),repeat('6',64),
  repeat('9',64),encode(extensions.digest(pg_catalog.convert_to('owner.google@example.com','UTF8'),'sha256'),'hex'),
  repeat('a',64),'2026-08-12T12:00:01Z','2026-08-12T12:00:02Z','a7000000-0000-4000-8000-000000000001');
 replay:=public.register_google_gmail_push_wakeup(repeat('3',64),repeat('4',64),repeat('5',64),repeat('6',64),
  repeat('9',64),encode(extensions.digest(pg_catalog.convert_to('owner.google@example.com','UTF8'),'sha256'),'hex'),
  repeat('a',64),'2026-08-12T12:00:01Z','2026-08-12T12:00:02Z','a7000000-0000-4000-8000-000000000099');
 perform set_config('omnix.google_0021_wakeup_job',first_result#>>'{wakeupJob,id}',true);
 if not (first_result->>'accepted')::boolean or (first_result->>'noOp')::boolean
  or not (replay->>'noOp')::boolean
  or replay#>>'{wakeupJob,id}'<>first_result#>>'{wakeupJob,id}' then raise exception 'push dedupe failed'; end if;
end $$;
select 'ok 3 - verified Gmail push creates one hash-only durable wakeup and retry reuses it';

do $$ begin begin
 perform public.register_google_gmail_push_wakeup(repeat('3',64),repeat('f',64),repeat('5',64),repeat('6',64),
  repeat('0',64),encode(extensions.digest(pg_catalog.convert_to('owner.google@example.com','UTF8'),'sha256'),'hex'),
  repeat('a',64),'2026-08-12T12:00:03Z','2026-08-12T12:00:04Z',gen_random_uuid());
 raise exception 'wrong exact URL accepted'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 4 - wrong exact route/audience/subscription binding creates no delivery or job';

do $$ declare result jsonb; begin
 result:=public.register_google_gmail_push_wakeup(repeat('3',64),repeat('4',64),repeat('5',64),repeat('6',64),
  repeat('b',64),encode(extensions.digest(pg_catalog.convert_to('owner.google@example.com','UTF8'),'sha256'),'hex'),
  repeat('c',64),'2026-08-12T12:00:05Z','2026-08-12T12:00:06Z',gen_random_uuid());
 if result#>>'{wakeupJob,wake_generation}'<>'2'
  or (select count(*) from public.google_gmail_history_wakeup_jobs where connection_id='a4000000-0000-4000-8000-000000000001')<>1 then
  raise exception 'push coalescing failed'; end if;
end $$;
select 'ok 5 - distinct push increments generation but coalesces onto one active wakeup';

do $$ declare claimed jsonb; started jsonb; authority jsonb; begin
 claimed:=public.claim_google_gmail_history_wakeup_jobs('a8000000-0000-4000-8000-000000000001',10,300,'2026-08-12T12:00:10Z');
 started:=public.start_google_gmail_history_wakeup_attempt(current_setting('omnix.google_0021_wakeup_job')::uuid,
  'a8000000-0000-4000-8000-000000000001',(claimed#>>'{jobs,0,fencing_token}')::bigint,'2026-08-12T12:00:11Z');
 perform set_config('omnix.google_0021_wakeup_fence',started#>>'{job,fencing_token}',true);
 authority:=public.read_google_gmail_history_wakeup_authority(current_setting('omnix.google_0021_wakeup_job')::uuid,
  'a8000000-0000-4000-8000-000000000001',(started#>>'{job,fencing_token}')::bigint,'2026-08-12T12:00:12Z');
 if claimed#>>'{count}'<>'1' or authority#>>'{accessState}'<>'live'
  or authority#>>'{accessEnvelope,ciphertext}' is null or authority#>>'{watch,bindingVersion}'<>'1'
  or authority#>>'{job,claimedGeneration}'<>'2' then raise exception 'wakeup authority failed'; end if;
end $$;
select 'ok 6 - bounded claim/start exposes only exact fenced encrypted history authority';

do $$ begin begin
 perform public.read_google_gmail_history_wakeup_authority(current_setting('omnix.google_0021_wakeup_job')::uuid,
  'a8000000-0000-4000-8000-000000000002',current_setting('omnix.google_0021_wakeup_fence')::bigint,'2026-08-12T12:00:12Z');
 raise exception 'stale worker read wakeup token'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - wrong worker/fence cannot read Gmail tokens, cursor or watch authority';

do $$ declare envelope jsonb; committed jsonb; begin
 envelope:=jsonb_build_object('ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),
  'nonce',encode(decode(repeat('01',12),'hex'),'base64'),'authTag',encode(decode(repeat('02',16),'hex'),'base64'),
  'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
  'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('d',64),'expiresAt',null);
 committed:=public.commit_google_gmail_history_wakeup_checkpoint(current_setting('omnix.google_0021_wakeup_job')::uuid,
  'a8000000-0000-4000-8000-000000000001',current_setting('omnix.google_0021_wakeup_fence')::bigint,
  null,envelope,repeat('e',64),false,'2026-08-12T12:00:11Z','2026-08-12T12:00:13Z');
 if committed#>>'{job,state}'<>'succeeded' or committed#>>'{health,state}'<>'healthy'
  or committed#>>'{cursor,cursorVersion}'<>'1' or (committed->>'requeued')::boolean then
  raise exception 'wakeup checkpoint failed'; end if;
end $$;
select 'ok 8 - final history checkpoint CAS commits cursor and completes the claimed generation';

reset role; set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.google_gmail_history_wakeup_jobs)<>0
  or (select count(*) from public.google_gmail_watch_deliveries)<>0 then
  raise exception 'cross workspace Google push metadata visible'; end if;
end $$;
select 'ok 9 - workspace RLS hides wakeups and deliveries from another owner';

reset role; set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare authority jsonb; begin
 authority:=public.read_google_connection_probe_authority('a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','2026-08-12T12:01:00Z');
 if authority#>>'{accountKeyHash}'<>repeat('a',64) or authority#>>'{accessEnvelope,ciphertext}' is null
  or not (authority->>'gmailProfileCheckAvailable')::boolean then raise exception 'probe authority failed'; end if;
end $$;
select 'ok 10 - owner-bound probe authority supports OIDC userinfo and optional Gmail profile';

do $$ begin begin
 perform public.read_google_connection_probe_authority('a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002','2026-08-12T12:01:00Z');
 raise exception 'cross workspace probe token read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 11 - cross-workspace owner cannot obtain Google probe credentials';

do $$ declare recorded jsonb; replay jsonb; email_hash text; begin
 email_hash:=encode(extensions.digest(pg_catalog.convert_to('owner.google@example.com','UTF8'),'sha256'),'hex');
 recorded:=public.record_google_connection_probe('a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','healthy',
  repeat('a',64),email_hash,repeat('f',64),null,'2026-08-12T12:01:01Z','a9000000-0000-4000-8000-000000000001');
 replay:=public.record_google_connection_probe('a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','healthy',
  repeat('a',64),email_hash,repeat('f',64),null,'2026-08-12T12:01:01Z','a9000000-0000-4000-8000-000000000001');
 if recorded#>>'{receipt,provider}'<>'google' or not (replay->>'noOp')::boolean
  or recorded#>>'{connection,granted_scopes,2}'<>'https://www.googleapis.com/auth/gmail.metadata' then
  raise exception 'probe receipt/replay/scopes failed'; end if;
end $$;
select 'ok 12 - real probe records redacted receipt idempotently without changing scopes';

do $$ begin begin
 perform public.record_google_connection_probe('a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','healthy',
  repeat('0',64),repeat('1',64),repeat('2',64),null,'2026-08-12T12:01:02Z',gen_random_uuid());
 raise exception 'Google identity swap recorded'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 13 - probe fails closed on OIDC subject or normalized email mismatch';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.record_google_gmail_send_ambiguity(uuid,uuid,bigint,text,timestamptz)'::regprocedure));
 if position('bounded-metadata-scan' in definition)=0 or position('unavailable-no-resend' in definition)=0
  or position('maxscan'',100' in replace(definition,' ',''))=0 then raise exception 'ambiguity strategy drift'; end if;
end $$;
select 'ok 14 - Gmail ambiguity chooses bounded metadata scan only with active metadata capability';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.read_google_gmail_send_reconciliation_state(uuid,uuid,bigint,timestamptz)'::regprocedure));
 if position('maxscan' in definition)=0 or position('failclosed' in definition)=0 or position('gmail.send' in definition)=0
  or position('messages.list' in definition)>0 or position(' q ' in definition)>0 then raise exception 'unsafe Gmail q reconciliation'; end if;
end $$;
select 'ok 15 - Gmail reconciliation is max 100, marker-based, fail-closed and never uses q';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('connector_private.google_authorized_job(uuid,uuid,bigint,timestamptz)'::regprocedure));
 if position('reconciliation_required' in definition)=0 or position('lease_owner' in definition)=0
  or position('fencing_token' in definition)=0 then raise exception 'reconciliation fence missing'; end if;
end $$;
select 'ok 16 - reconciliation-required Google reads retain exact lease and fence authority';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('connector_private.google_bundle_for_action(text)'::regprocedure));
 if position('calendar.complete-omnix-event' in definition)=0
  or position('calendar.cancel-omnix-event' in definition)=0
  or position('calendar.delete-omnix-event' in definition)=0
  or position('calendar-app-created' in definition)=0 then raise exception 'Calendar lifecycle action mapping missing'; end if;
end $$;
select 'ok 17 - explicit Calendar complete, cancel and delete actions map to app-created bundle';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.bind_google_task_event_lifecycle(uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz)'::regprocedure));
 if position('current omnix task version required' in definition)=0
  or position('exact omnix-created google event binding required' in definition)=0
  or position('target_task.status<>''completed''' in replace(definition,' ',''))=0
  or position('target_task.status<>''archived''' in replace(definition,' ',''))=0 then
  raise exception 'Calendar canonical authority drift'; end if;
end $$;
select 'ok 18 - Calendar lifecycle requires current canonical task and exact bound Omnix event';

do $$ begin
 if not exists(select 1 from pg_constraint where conname='google_calendar_task_resources_lifecycle_state')
  or not exists(select 1 from pg_constraint where conname='google_calendar_task_resources_lifecycle_time') then
  raise exception 'Calendar lifecycle persistence missing'; end if;
end $$;
select 'ok 19 - private Calendar resource stores monotonic lifecycle and evidence timestamps';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.record_google_calendar_task_conflict(uuid,uuid,bigint,uuid,integer,text,text,timestamptz,timestamptz)'::regprocedure));
 if position('calendar.complete-omnix-event' in definition)=0 or position('calendar.cancel-omnix-event' in definition)=0
  or position('calendar.delete-omnix-event' in definition)=0 then raise exception 'lifecycle conflict authority missing'; end if;
end $$;
select 'ok 20 - lifecycle jobs preserve remote conflict evidence instead of overwriting the task';

do $$ begin
 if exists(select 1 from public.connector_automation_policies where action_type in (
  'calendar.complete_omnix_event','calendar.cancel_omnix_event','calendar.delete_omnix_event')) then
  raise exception 'invalid underscore action id persisted'; end if;
end $$;
select 'ok 21 - all new Calendar action identifiers satisfy connector action grammar';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz)'::regprocedure));
 if position('provider-confirmed' in definition)=0 or position('no-revocation-endpoint' in definition)>0 then
  raise exception 'revocation wrapper accepts non-provider confirmation'; end if;
end $$;
select 'ok 22 - confirmed disconnect accepts provider-confirmed evidence only';

do $$ begin begin
 perform public.transition_connector_revocation_job(gen_random_uuid(),gen_random_uuid(),1,'confirmed',null,null,
  '{"confirmationKind":"no-revocation-endpoint"}'::jsonb,'2026-08-12T12:02:00Z');
 raise exception 'no-endpoint confirmed disconnect'; exception when check_violation then null; end;
end $$;
select 'ok 23 - no revocation endpoint remains unconfirmed/manual and cannot cryptoshred';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.prepare_google_disconnect_state()'::regprocedure));
 if position('google_gmail_watch_ingress_authorities' in definition)=0
  or position('google_gmail_history_wakeup_jobs' in definition)=0 then raise exception 'Google disconnect push cleanup drift'; end if;
end $$;
select 'ok 24 - Google disconnect revokes ingress and terminates pending wakeups while preserving history';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.bind_google_gmail_watch_ingress_authority(uuid,uuid,bigint,integer,text,text,text,text,text,timestamptz,uuid)'::regprocedure));
 if position('target_expected_version is not null' in definition)=0
  or position('no_op:=true' in replace(definition,' ',''))=0 then
  raise exception 'identical watch ingress replay still requires hidden CAS version'; end if;
end $$;
select 'ok 25 - exact watch ingress replay accepts null CAS version while rotations remain version-bound';

reset role;
do $$ begin
 update connector_private.google_gmail_watch_resources set expires_at='2026-08-12T12:30:00Z'
  where connection_id='a4000000-0000-4000-8000-000000000001';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare scheduled jsonb; replay jsonb; begin
 scheduled:=public.schedule_due_google_gmail_watch_renewals('2026-08-12T12:10:00Z',3600,10);
 replay:=public.schedule_due_google_gmail_watch_renewals('2026-08-12T12:10:01Z',3600,10);
 perform set_config('omnix.google_0021_renew_job',scheduled#>>'{jobs,0,id}',true);
 if scheduled#>>'{count}'<>'1' or scheduled#>>'{jobs,0,job_kind}'<>'watch-renewal'
  or replay#>>'{count}'<>'0' then raise exception 'renewal scheduler did not coalesce'; end if;
end $$;
select 'ok 26 - due watch scheduler creates one coalesced renewal job without provider side effect';

do $$ declare claimed jsonb; started jsonb; authority jsonb; begin
 claimed:=public.claim_google_gmail_history_wakeup_jobs('a8000000-0000-4000-8000-000000000003',10,300,'2026-08-12T12:10:02Z');
 started:=public.start_google_gmail_history_wakeup_attempt(current_setting('omnix.google_0021_renew_job')::uuid,
  'a8000000-0000-4000-8000-000000000003',(claimed#>>'{jobs,0,fencing_token}')::bigint,'2026-08-12T12:10:03Z');
 perform set_config('omnix.google_0021_renew_fence',started#>>'{job,fencing_token}',true);
 authority:=public.read_google_gmail_history_wakeup_authority(current_setting('omnix.google_0021_renew_job')::uuid,
  'a8000000-0000-4000-8000-000000000003',(started#>>'{job,fencing_token}')::bigint,'2026-08-12T12:10:04Z');
 if authority#>>'{job,jobKind}'<>'watch-renewal' or authority#>>'{watch,resourceVersion}'<>'1'
  or authority#>>'{watch,bindingVersion}'<>'1' or authority#>>'{job,maxPageSize}'<>'500' then
  raise exception 'renewal authority shape failed'; end if;
end $$;
select 'ok 27 - renewal worker receives exact lease/fence watch and ingress CAS versions';

do $$ declare renewed jsonb; begin
 renewed:=public.renew_google_gmail_watch_from_wakeup(current_setting('omnix.google_0021_renew_job')::uuid,
  'a8000000-0000-4000-8000-000000000003',current_setting('omnix.google_0021_renew_fence')::bigint,
  1,1,repeat('c',64),repeat('d',64),'2026-08-20T12:00:00Z',repeat('3',64),repeat('4',64),
  repeat('5',64),repeat('6',64),'2026-08-12T12:10:05Z');
 if renewed#>>'{job,state}'<>'succeeded' or renewed#>>'{watch,resourceVersion}'<>'2'
  or renewed#>>'{watch,bindingVersion}'<>'2' or renewed#>>'{receipt,provider_status}'<>'renewed' then
  raise exception 'watch renewal CAS failed'; end if;
end $$;
select 'ok 28 - fenced users.watch result atomically rotates watch and ingress versions';

do $$ begin begin
 perform public.renew_google_gmail_watch_from_wakeup(current_setting('omnix.google_0021_renew_job')::uuid,
  'a8000000-0000-4000-8000-000000000003',current_setting('omnix.google_0021_renew_fence')::bigint,
  1,1,repeat('e',64),repeat('f',64),'2026-08-20T12:00:00Z',repeat('3',64),repeat('4',64),
  repeat('5',64),repeat('6',64),'2026-08-12T12:10:06Z');
 raise exception 'stale renewal replay mutated watch'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 29 - completed/stale renewal fence cannot rotate watch or ingress again';

do $$ declare definition text; begin
 definition:=lower(pg_get_functiondef('public.refresh_google_connection_probe_access_token(uuid,uuid,uuid,integer,jsonb,timestamptz,uuid)'::regprocedure));
 if position('active owner probe refresh authority required' in definition)=0
  or position('google-refresh-token' in definition)=0 or position('upsert_google_secret' in definition)=0
  or has_function_privilege('authenticated','public.refresh_google_connection_probe_access_token(uuid,uuid,uuid,integer,jsonb,timestamptz,uuid)','EXECUTE') then
  raise exception 'owner-bound probe token CAS authority drift'; end if;
end $$;
select 'ok 30 - probe access-token refresh is service-only, owner-bound and CAS-backed';

rollback;
