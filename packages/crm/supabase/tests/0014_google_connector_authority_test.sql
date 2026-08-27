-- Story 4.2 Google OAuth/capability/draft/cursor/resource authority matrix.
begin;
select '1..30';

do $$ declare target_table text; begin
 foreach target_table in array array['google_connection_capabilities','google_oauth_completions',
  'google_sync_health','google_calendar_task_states','google_gmail_metadata_reviews',
  'google_email_drafts','google_email_draft_versions'] loop
  if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
   where namespace.nspname='public' and relation.relname=target_table
    and relation.relrowsecurity and relation.relforcerowsecurity)
   or has_table_privilege('authenticated','public.'||target_table,'INSERT')
   or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
   or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
   raise exception '0014 RLS/grant failed for %',target_table; end if;
 end loop;
 if has_function_privilege('authenticated','public.consume_google_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz)','EXECUTE')
   or has_function_privilege('authenticated','public.read_google_job_authority(uuid,uuid,bigint,timestamptz)','EXECUTE')
   or not has_function_privilege('authenticated','public.create_google_email_draft(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid,timestamptz)','EXECUTE') then
  raise exception '0014 function grant failed'; end if;
end $$;
select 'ok 1 - Google public metadata forces workspace RLS and private workers remain service-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','51000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0014@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','51000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0014@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','51000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0014@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('52000000-0000-4000-8000-000000000001','0014 Workspace A'),
 ('52000000-0000-4000-8000-000000000002','0014 Workspace B');
select set_config('omnix.actor_user_id','51000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','owner','active'),
 ('53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','51000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('53000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate; set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
do $$ begin begin
 perform public.begin_google_oauth('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  'gmail-send',gen_random_uuid(),repeat('1',64),repeat('2',64),'https://omnix.test/api/connectors/google/callback','/connections',
  decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),
  decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('3',64),'2026-08-12T13:10:00Z','2026-08-12T13:00:00Z');
 raise exception 'assistant began Google OAuth'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 2 - assistant cannot connect or broaden Google scopes';

select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
do $$ declare started jsonb; replay jsonb; begin
 started:=public.begin_google_oauth('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  'gmail-send','55000000-0000-4000-8000-000000000001',repeat('1',64),repeat('2',64),
  'https://omnix.test/api/connectors/google/callback','/connections',decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),
  decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
  'v1',repeat('3',64),'2026-08-12T13:10:00Z','2026-08-12T13:00:00Z');
 replay:=public.begin_google_oauth('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  'gmail-send','55000000-0000-4000-8000-000000000001',repeat('1',64),repeat('2',64),
  'https://omnix.test/api/connectors/google/callback','/connections',decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),
  decode(repeat('02',16),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
  'v1',repeat('3',64),'2026-08-12T13:10:00Z','2026-08-12T13:00:00Z');
 perform set_config('omnix.google_tx',started#>>'{transaction,transactionId}',true);
 if started#>>'{connection,status}'<>'authorizing' or started#>>'{transaction,bundle}'<>'gmail-send'
  or started#>>'{transaction,requestedScopes,2}'<>'https://www.googleapis.com/auth/gmail.send'
  or not (replay->>'noOp')::boolean then raise exception 'Google OAuth start/replay failed'; end if;
end $$;
select 'ok 3 - owner starts one atomic PKCE-bound incremental connector transaction';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare consumed jsonb; begin
 consumed:=public.consume_google_oauth_transaction(repeat('1',64),'52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',repeat('2',64),
  'https://omnix.test/api/connectors/google/callback','2026-08-12T13:01:00Z');
 if consumed#>>'{transactionId}'<>current_setting('omnix.google_tx') or consumed#>>'{pkceCiphertext}' is null
  or consumed#>>'{expectedAccessSecretVersion}' is not null or consumed#>>'{expectedRefreshSecretVersion}' is not null then
  raise exception 'consume envelope/CAS failed'; end if;
end $$;
select 'ok 4 - service consumes PKCE once and receives redacted null token CAS versions';

do $$ begin begin
 perform public.consume_google_oauth_transaction(repeat('1',64),'52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',repeat('2',64),
  'https://omnix.test/api/connectors/google/callback','2026-08-12T13:01:01Z');
 raise exception 'OAuth transaction replay consumed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 5 - PKCE transaction is single-use across callback replay';

do $$ declare completed jsonb; env_access jsonb; env_refresh jsonb; begin
 env_access:=jsonb_build_object('ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),'nonce',encode(decode(repeat('01',12),'hex'),'base64'),
  'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),
  'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),
  'kekVersion','v1','aadHash',repeat('4',64),'expiresAt','2026-08-12T13:04:02Z');
 env_refresh:=env_access||jsonb_build_object('aadHash',repeat('5',64),'expiresAt',null);
 completed:=public.finalize_google_oauth(current_setting('omnix.google_tx')::uuid,'52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',repeat('6',64),
  'owner.google@example.com',array['openid','email','https://www.googleapis.com/auth/gmail.send'],null,env_access,null,env_refresh,
  '55000000-0000-4000-8000-000000000002','2026-08-12T13:02:00Z');
 if completed#>>'{connection,status}'<>'active' or completed#>>'{connection,display_label}'<>'owner.google@example.com'
  or completed#>>'{secrets,access,secretVersion}'<>'1' or completed#>>'{secrets,refresh,secretVersion}'<>'1'
  or completed#>>'{receipt,provider}'<>'google' or completed#>>'{policies,0,action_type}'<>'gmail.send'
  or completed#>>'{policies,0,approval_mode}'<>'owner_required'
  or completed::text ~ 'aa==' then raise exception 'finalize failed'; end if;
end $$;
select 'ok 6 - callback binds tokens/scopes and bootstraps the exact owner-required Gmail policy';

do $$ declare replay jsonb; begin
 replay:=public.finalize_google_oauth(current_setting('omnix.google_tx')::uuid,'52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',repeat('6',64),
  'owner.google@example.com',array['email','https://www.googleapis.com/auth/gmail.send','openid'],999,null,999,null,
  gen_random_uuid(),'2026-08-12T13:02:01Z');
 if not (replay->>'noOp')::boolean or replay#>>'{secrets,access,secretVersion}'<>'1' then
  raise exception 'completion replay required envelopes'; end if;
end $$;
select 'ok 7 - OAuth completion replay precedes envelope/CAS requirements';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
do $$ declare state jsonb; begin
 state:=public.read_google_connection_capability_state('54000000-0000-4000-8000-000000000001');
 if state#>>'{connection,displayLabel}'<>'owner.google@example.com'
  or state#>>'{capabilities,2,state}' is null or state::text ~ 'ciphertext' then raise exception 'redacted state failed'; end if;
 perform set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000003',true);
 begin perform public.read_google_connection_capability_state('54000000-0000-4000-8000-000000000001');
  raise exception 'cross workspace state read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 8 - workspace member sees truthful capabilities without token/resource material';

reset role;
select set_config('omnix.actor_user_id','51000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,email,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at) values
 ('56000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  'Unique','Contact','unique.0014@example.com',true,'hot','lead','buyer','website','new','{}',now(),now()),
 ('56000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  'Shared','One','shared.0014@example.com',true,'warm','lead','seller','other','new','{}',now(),now()),
 ('56000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  'Shared','Two','shared.0014@example.com',true,'nurture','lead','unknown','other','new','{}',now(),now());
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
do $$ declare point_id uuid; recipient_hash text; env jsonb; created jsonb; edited jsonb; begin
 select id,encode(extensions.digest(pg_catalog.convert_to(normalized_value,'UTF8'),'sha256'),'hex')
 into point_id,recipient_hash from public.contact_points where contact_id='56000000-0000-4000-8000-000000000001' and type='email';
 env:=jsonb_build_object('ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),'nonce',encode(decode(repeat('01',12),'hex'),'base64'),
  'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),
  'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),
  'kekVersion','v1','aadHash',repeat('7',64));
 created:=public.create_google_email_draft('58000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000001',point_id,repeat('8',64),recipient_hash,repeat('9',64),env,gen_random_uuid(),'2026-08-12T13:03:00Z');
 edited:=public.edit_google_email_draft('58000000-0000-4000-8000-000000000001',1,repeat('a',64),recipient_hash,
  env||jsonb_build_object('aadHash',repeat('b',64)),gen_random_uuid(),'2026-08-12T13:03:01Z');
 if created#>>'{draft,current_version}'<>'1' or edited#>>'{draft,current_version}'<>'2'
  or created::text ~* 'unique.0014|subject|body' then raise exception 'assistant draft failed'; end if;
end $$;
select 'ok 9 - assistant creates and CAS-edits an encrypted contact-bound local draft';

do $$ declare prepared jsonb; begin
 prepared:=public.prepare_google_gmail_send_intent('58000000-0000-4000-8000-000000000001',2,
  'Send one reviewed contact email.',gen_random_uuid(),'2026-08-12T13:03:02Z');
 perform set_config('omnix.google_send_intent',prepared#>>'{intent,id}',true);
 if prepared#>>'{draft,status}'<>'intent-prepared' or prepared#>>'{intent,state}'<>'pending'
  or exists(select 1 from public.connector_jobs where intent_id=(prepared#>>'{intent,id}')::uuid) then
  raise exception 'intent prep self-approved or queued'; end if;
end $$;
select 'ok 10 - exact draft version prepares a generic pending intent but never self-approves';

do $$ begin begin
 perform public.edit_google_email_draft('58000000-0000-4000-8000-000000000001',2,repeat('c',64),repeat('d',64),'{}',gen_random_uuid(),now());
 raise exception 'prepared draft edited'; exception when serialization_failure then null; end;
end $$;
select 'ok 11 - prepared send payload cannot drift after intent binding';

select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
do $$ declare approved jsonb; begin
 approved:=public.approve_and_enqueue_connector_action(current_setting('omnix.google_send_intent')::uuid,1,repeat('a',64),
  'google-send-0014','59000000-0000-4000-8000-000000000001','2026-08-12T13:04:00Z',5);
 perform set_config('omnix.google_send_job',approved#>>'{job,id}',true);
end $$;
select 'ok 12 - owner separately approves and enqueues the exact immutable Gmail payload';

reset role;
-- Activate metadata and Calendar capabilities to exercise their worker authority.
update public.google_connection_capabilities set state='active',granted_scopes=required_scopes,
 authorized_by_membership_id='53000000-0000-4000-8000-000000000001',authorized_at='2026-08-12T13:04:01Z',
 last_error_category=null where connection_id='54000000-0000-4000-8000-000000000001';
update public.connector_connections set granted_scopes=array[
 'email','https://www.googleapis.com/auth/calendar.app.created','https://www.googleapis.com/auth/gmail.metadata',
 'https://www.googleapis.com/auth/gmail.send','openid'] where id='54000000-0000-4000-8000-000000000001';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare claimed public.connector_jobs%rowtype; authority jsonb; begin
 select * into claimed from public.claim_connector_jobs('60000000-0000-4000-8000-000000000001',1,900,'2026-08-12T13:04:01Z');
 perform public.start_connector_job_attempt(claimed.id,'60000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-12T13:04:02Z');
 authority:=public.read_google_job_authority(claimed.id,'60000000-0000-4000-8000-000000000001',claimed.fencing_token,'2026-08-12T13:04:03Z');
 perform set_config('omnix.google_send_fence',claimed.fencing_token::text,true);
 if authority#>>'{payloadEnvelope,canonicalHash}'<>repeat('a',64)
  or authority#>>'{accessEnvelope,ciphertext}' is null or authority#>>'{refreshEnvelope,ciphertext}' is null
  or authority#>>'{bundle}'<>'gmail-send' or authority#>>'{accessState}'<>'refresh-required'
  then raise exception 'job authority missing payload/token/refresh state'; end if;
end $$;
select 'ok 13 - leased job reads immutable payload and exposes expired access with refresh authority';

do $$ begin begin
 perform public.read_google_job_authority(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000002',current_setting('omnix.google_send_fence')::bigint,'2026-08-12T13:04:03Z');
 raise exception 'stale worker read authority'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 14 - wrong worker/fence cannot read Google payload or tokens';

do $$ declare bound jsonb; replay jsonb; begin
 bound:=public.bind_google_gmail_send_resource(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,
  'provider-message-send','provider-thread-send',repeat('9a',32),'2026-08-12T13:04:03.500Z');
 replay:=public.bind_google_gmail_send_resource(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,
  'provider-message-send','provider-thread-send',repeat('9a',32),'2026-08-12T13:04:03.500Z');
 if bound#>>'{draft,status}'<>'sent' or bound#>>'{receipt,event_type}'<>'gmail.send-linked'
  or bound#>>'{activity,type}'<>'email-sent' or not (replay->>'noOp')::boolean
  or bound::text ~ 'provider-message-send|provider-thread-send' then
  raise exception 'Gmail send resource/evidence binding failed'; end if;
end $$;
select 'ok 15 - Gmail send binds provider resource to the approved draft, activity and redacted receipt';

do $$ declare env jsonb; refreshed jsonb; begin
 env:=jsonb_build_object('ciphertext',encode(decode(repeat('ac',32),'hex'),'base64'),
  'nonce',encode(decode(repeat('05',12),'hex'),'base64'),'authTag',encode(decode(repeat('06',16),'hex'),'base64'),
  'wrappedDek',encode(decode(repeat('bd',32),'hex'),'base64'),'wrapNonce',encode(decode(repeat('07',12),'hex'),'base64'),
  'wrapAuthTag',encode(decode(repeat('08',16),'hex'),'base64'),'kekVersion','v1',
  'aadHash',repeat('ab',32),'expiresAt','2026-08-12T14:04:04Z');
 refreshed:=public.refresh_google_job_access_token(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,
  1,env,'2026-08-12T13:04:04Z');
 if refreshed#>>'{secret,secretVersion}'<>'2' or refreshed#>>'{receipt,event_type}'<>'oauth.token-refreshed'
  or refreshed#>>'{accountKeyHash}'<>repeat('6',64) then raise exception 'access refresh failed'; end if;
end $$;
select 'ok 16 - expired access token rotates by CAS under the current job lease and refresh token';

do $$ begin
 begin perform public.refresh_google_job_access_token(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000002',current_setting('omnix.google_send_fence')::bigint,
  2,'{}','2026-08-12T13:04:05Z');
  raise exception 'wrong worker rotated access'; exception when insufficient_privilege then null; end;
 begin perform public.refresh_google_job_access_token(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,
  1,'{}','2026-08-12T13:04:05Z');
  raise exception 'stale access version rotated'; exception when serialization_failure then null; end;
end $$;
reset role;
update public.google_connection_capabilities set account_key_hash=repeat('0',64)
 where connection_id='54000000-0000-4000-8000-000000000001' and bundle='gmail-send';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin begin
 perform public.refresh_google_job_access_token(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,
  2,'{}','2026-08-12T13:04:05Z');
 raise exception 'account drift authorized refresh'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.google_connection_capabilities set account_key_hash=repeat('6',64),
 granted_scopes=array['openid','email']
 where connection_id='54000000-0000-4000-8000-000000000001' and bundle='gmail-send';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin begin
 perform public.refresh_google_job_access_token(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,
  2,'{}','2026-08-12T13:04:05Z');
 raise exception 'capability scope drift authorized refresh'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.google_connection_capabilities set granted_scopes=required_scopes
 where connection_id='54000000-0000-4000-8000-000000000001' and bundle='gmail-send';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
select 'ok 17 - stale worker/fence/version or account-bundle drift cannot rotate a token';

reset role;
update connector_private.connector_connection_secrets set destroyed_at='2026-08-12T13:04:06Z',
 ciphertext=null,nonce=null,auth_tag=null,wrapped_dek=null,wrap_nonce=null,wrap_auth_tag=null
 where connection_id='54000000-0000-4000-8000-000000000001' and secret_type='google-refresh-token';
update connector_private.connector_connection_secrets set expires_at='2026-08-12T13:04:05Z'
 where connection_id='54000000-0000-4000-8000-000000000001' and secret_type='google-access-token';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin begin
 perform public.read_google_job_authority(current_setting('omnix.google_send_job')::uuid,
  '60000000-0000-4000-8000-000000000001',current_setting('omnix.google_send_fence')::bigint,'2026-08-12T13:04:07Z');
 raise exception 'expired access authorized without refresh'; exception when no_data_found then null; end;
end $$;
select 'ok 18 - expired access without a current refresh token fails closed';

reset role;
-- Seed one executing Gmail metadata job through the same generic immutable graph.
insert into connector_private.connector_payload_envelopes(id,workspace_id,connection_id,payload_kind,schema_version,canonical_hash,
 ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at) values
 ('61000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  'gmail.sync-metadata','google-gmail-sync.v1',repeat('c',64),decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
  decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('d',64),now(),now());
insert into public.connector_automation_policies(id,workspace_id,action_type,version,approval_mode,allowlisted_actions,
 target_constraints,compliance_requirements,execution_limits,created_by_membership_id,correlation_id,created_at) values
 ('57000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','gmail.sync-metadata',1,'system_read_only',
  array['gmail.sync-metadata'],'{}','{}','{}','53000000-0000-4000-8000-000000000001',gen_random_uuid(),now());
insert into public.connector_action_intents(id,workspace_id,connection_id,provider,action_type,summary,state,current_version,
 created_by_membership_id,correlation_id,created_at,updated_at) values
 ('62000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  'google','gmail.sync-metadata','Bounded metadata sync.','executing',1,'53000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',now(),now());
insert into public.connector_action_intent_versions(id,workspace_id,intent_id,version,connection_id,action_type,payload_ref,payload_hash,
 policy_id,policy_version,compliance_snapshot,created_by_membership_id,correlation_id,created_at) values
 ('64000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',1,
  '54000000-0000-4000-8000-000000000001','gmail.sync-metadata','61000000-0000-4000-8000-000000000001',repeat('c',64),
  '57000000-0000-4000-8000-000000000002',1,'{}','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',now());
insert into public.connector_jobs(id,workspace_id,connection_id,intent_id,intent_version_id,intent_version,provider,action_type,
 schema_version,payload_ref,payload_hash,policy_id,policy_version,idempotency_key,correlation_id,state,attempt_count,max_attempts,
 scheduled_at,lease_owner,lease_expires_at,fencing_token,created_at,updated_at) values
 ('65000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',1,'google','gmail.sync-metadata',
  'google-gmail-sync.v1','61000000-0000-4000-8000-000000000001',repeat('c',64),'57000000-0000-4000-8000-000000000002',1,
  'google-sync-0014','63000000-0000-4000-8000-000000000001','executing',1,5,now(),
  '60000000-0000-4000-8000-000000000003','2026-08-12T14:00:00Z',1,now(),now());

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare linked jsonb; begin
 linked:=public.bind_google_gmail_metadata_resource('65000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000003',1,'msg-unique','thread-unique','incoming','unique.0014@example.com','single',
  array['INBOX'],'2026-08-12T13:05:00Z',repeat('e',64),'2026-08-12T13:05:01Z');
 if linked#>>'{resource,linkState}'<>'linked' or linked#>>'{resource,contactId}'<>'56000000-0000-4000-8000-000000000001'
  or linked::text ~* 'unique.0014@example.com' then raise exception 'Gmail exact link failed'; end if;
end $$;
select 'ok 19 - Gmail metadata atomically links exactly one active canonical email and activity';

do $$ declare reviewed jsonb; begin
 reviewed:=public.bind_google_gmail_metadata_resource('65000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000003',1,'msg-shared','thread-shared','incoming','shared.0014@example.com','single',
  array['INBOX'],'2026-08-12T13:05:02Z',repeat('f',64),'2026-08-12T13:05:03Z');
 if reviewed#>>'{resource,linkState}'<>'review' or reviewed#>>'{review,reason}'<>'shared-email'
  or reviewed::text ~* 'shared.0014@example.com' then raise exception 'Gmail shared review failed'; end if;
end $$;
select 'ok 20 - shared Gmail identity enters review without contact mutation or raw address persistence';

do $$ declare reviewed jsonb; begin
 reviewed:=public.bind_google_gmail_metadata_resource('65000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000003',1,'msg-self','thread-self','outgoing','owner.google@example.com','self-only',
  array['SENT'],'2026-08-12T13:05:04Z',repeat('a1',32),'2026-08-12T13:05:05Z');
 if reviewed#>>'{review,reason}'<>'self-only' then raise exception 'self-only auto-linked'; end if;
end $$;
select 'ok 21 - self-only metadata is unresolved and never auto-linked';

do $$ declare env jsonb; committed jsonb; expired jsonb; begin
 env:=jsonb_build_object('ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),'nonce',encode(decode(repeat('01',12),'hex'),'base64'),
  'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),
  'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),
  'kekVersion','v1','aadHash',repeat('b1',32),'expiresAt',null);
 committed:=public.commit_google_sync_checkpoint('65000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003',1,
  'google.gmail-history',null,env,repeat('c1',32),false,'2026-08-12T13:05:00Z','2026-08-12T13:06:00Z');
 expired:=public.mark_google_sync_cursor_expired('65000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003',1,
  'google.gmail-history',1,'gmail_history_expired','2026-08-12T13:06:01Z');
 if committed#>>'{health,state}'<>'healthy' or expired#>>'{health,state}'<>'full_resync_required' then raise exception 'cursor lifecycle failed'; end if;
end $$;
select 'ok 22 - encrypted Gmail cursor CAS and explicit expired-history full-resync state are durable';

do $$ declare watch jsonb; begin
 watch:=public.bind_google_gmail_watch_resource('65000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000003',1,repeat('d1',32),repeat('e1',32),
  '2026-08-19T13:00:00Z','2026-08-12T13:06:02Z');
 if watch#>>'{watch,resourceVersion}'<>'1' or watch::text ~ 'd1d1d1' then raise exception 'watch exposure failed'; end if;
end $$;
select 'ok 23 - Gmail watch stores only private hashed wake-up authority';

reset role;
-- Clone generic sync graph into separate valid Calendar create/upsert jobs.
insert into public.connector_automation_policies(id,workspace_id,action_type,version,approval_mode,allowlisted_actions,
 target_constraints,compliance_requirements,execution_limits,created_by_membership_id,correlation_id,created_at) values
 ('57000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000001','calendar.create-omnix-calendar',1,'owner_required',
  array['calendar.create-omnix-calendar'],'{}','{}','{}','53000000-0000-4000-8000-000000000001',gen_random_uuid(),now()),
 ('57000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000001','calendar.upsert-omnix-event',1,'owner_required',
  array['calendar.upsert-omnix-event'],'{}','{}','{}','53000000-0000-4000-8000-000000000001',gen_random_uuid(),now());
insert into public.tasks(id,workspace_id,contact_id,title,due_at,status,creator_membership_id,assignee_membership_id,created_at,updated_at)
 values('66000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001',
 'Follow up','2026-08-14T15:00:00Z','open','53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002',now(),now());
do $$ declare action_name text; suffix text; policy_id uuid; payload_id uuid; intent_id uuid; version_id uuid; job_id uuid; begin
 foreach action_name in array array['calendar.create-omnix-calendar','calendar.upsert-omnix-event'] loop
  if action_name='calendar.create-omnix-calendar' then suffix:='1'; policy_id:='57000000-0000-4000-8000-000000000003';
   payload_id:='61000000-0000-4000-8000-000000000002'; intent_id:='62000000-0000-4000-8000-000000000002';
   version_id:='64000000-0000-4000-8000-000000000002'; job_id:='65000000-0000-4000-8000-000000000002';
  else suffix:='2'; policy_id:='57000000-0000-4000-8000-000000000004';
   payload_id:='61000000-0000-4000-8000-000000000003'; intent_id:='62000000-0000-4000-8000-000000000003';
   version_id:='64000000-0000-4000-8000-000000000003'; job_id:='65000000-0000-4000-8000-000000000003'; end if;
  insert into connector_private.connector_payload_envelopes(id,workspace_id,connection_id,payload_kind,schema_version,canonical_hash,
   ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at)
  values(payload_id,'52000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',action_name,
   'google-calendar-operation.v1',repeat(suffix,64),decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
   decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('f1',32),now(),now());
  insert into public.connector_action_intents(id,workspace_id,connection_id,provider,action_type,summary,state,current_version,
   created_by_membership_id,correlation_id,created_at,updated_at) values(intent_id,'52000000-0000-4000-8000-000000000001',
   '54000000-0000-4000-8000-000000000001','google',action_name,'Calendar operation.','executing',1,
   '53000000-0000-4000-8000-000000000001',gen_random_uuid(),now(),now());
  insert into public.connector_action_intent_versions(id,workspace_id,intent_id,version,connection_id,action_type,payload_ref,payload_hash,
   policy_id,policy_version,compliance_snapshot,created_by_membership_id,correlation_id,created_at)
  select version_id,intent.workspace_id,intent.id,1,intent.connection_id,action_name,payload_id,repeat(suffix,64),policy_id,1,'{}',
   intent.created_by_membership_id,intent.correlation_id,now() from public.connector_action_intents intent where intent.id=intent_id;
  insert into public.connector_jobs(id,workspace_id,connection_id,intent_id,intent_version_id,intent_version,provider,action_type,
   schema_version,payload_ref,payload_hash,policy_id,policy_version,idempotency_key,correlation_id,state,attempt_count,max_attempts,
   scheduled_at,lease_owner,lease_expires_at,fencing_token,created_at,updated_at)
  select job_id,intent.workspace_id,intent.connection_id,intent.id,version_id,1,'google',action_name,'google-calendar-operation.v1',
   payload_id,repeat(suffix,64),policy_id,1,'google-calendar-'||suffix,intent.correlation_id,'executing',1,5,now(),
   '60000000-0000-4000-8000-000000000004','2026-08-12T14:00:00Z',1,now(),now()
   from public.connector_action_intents intent where intent.id=intent_id;
 end loop;
end $$;

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare calendar jsonb; task_result jsonb; begin
 calendar:=public.bind_google_calendar_resource('65000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004',1,
  'omnix-calendar-provider-id',repeat('a2',32),repeat('b2',32),'2026-08-12T13:07:00Z');
 task_result:=public.bind_google_task_event_resource('65000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000004',1,
  '66000000-0000-4000-8000-000000000001',1,'event-provider-id',repeat('c2',32),repeat('d2',32),
  '2026-08-12T13:07:01Z','2026-08-12T13:07:02Z');
 if calendar#>>'{calendar,resourceVersion}'<>'1' or task_result#>>'{taskState,state}'<>'synced'
  or calendar::text ~ 'provider-id' or task_result::text ~ 'provider-id' then raise exception 'calendar bindings exposed ID'; end if;
end $$;
select 'ok 24 - separate Calendar-create action binds one private Omnix secondary calendar';
select 'ok 25 - exact task version binds one stable private event and redacted public state';

reset role; update public.tasks set due_at='2026-08-15T15:00:00Z' where id='66000000-0000-4000-8000-000000000001';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin begin
 perform public.bind_google_task_event_resource('65000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000004',1,
  '66000000-0000-4000-8000-000000000001',1,'event-provider-id',repeat('c2',32),repeat('d2',32),
  '2026-08-12T13:07:03Z','2026-08-12T13:07:04Z');
 raise exception 'stale task version rebound'; exception when serialization_failure then null; end;
end $$;
select 'ok 26 - stale task version cannot overwrite canonical Omnix task state';

do $$ declare conflict jsonb; begin
 conflict:=public.record_google_calendar_task_conflict('65000000-0000-4000-8000-000000000003',
 '60000000-0000-4000-8000-000000000004',1,'66000000-0000-4000-8000-000000000001',2,
  repeat('c2',32),'remote-edited','2026-08-12T13:07:05Z','2026-08-12T13:07:06Z');
 if conflict#>>'{taskState,state}'<>'conflict' then raise exception 'remote edit overwrote task'; end if;
end $$;
select 'ok 27 - remote Calendar edit records conflict without mutating the task';

reset role;
do $$ begin
 if exists(select 1 from public.connector_receipt_events receipt where receipt.provider='google'
   and (receipt.redacted_metadata::text ~* 'example.com|subject|body' or receipt.event_key ~* 'example.com'))
  or exists(select 1 from public.google_gmail_metadata_reviews review where to_jsonb(review)::text ~* 'example.com')
  or exists(select 1 from public.google_email_drafts draft where to_jsonb(draft)::text ~* 'subject|body|example.com') then
  raise exception 'Google public evidence leaked content/address'; end if;
end $$;
select 'ok 28 - public Google drafts/reviews/receipts exclude recipient, subject and body';

do $$ begin
 begin update public.google_email_draft_versions set payload_hash=repeat('0',64)
  where draft_id='58000000-0000-4000-8000-000000000001'; raise exception 'draft evidence updated';
 exception when object_not_in_prerequisite_state then null; end;
 if exists(select 1 from public.google_connection_capabilities capability
   join public.connector_connections connection on connection.id=capability.connection_id
   where capability.workspace_id<>connection.workspace_id) then raise exception 'cross-workspace capability'; end if;
end $$;
select 'ok 29 - version/resource evidence is append-only and workspace-contained';

reset role;
select set_config('omnix.actor_user_id','51000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
do $$ declare started jsonb; begin
 started:=public.begin_google_oauth(
  '54000000-0000-4000-8000-000000000031','52000000-0000-4000-8000-000000000001',
  'workspace-core','55000000-0000-4000-8000-000000000031',repeat('7',64),repeat('8',64),
  'https://omnix.test/api/connectors/google/callback','/connections',
  decode(repeat('aa',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
  decode(repeat('bb',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
  'v1',repeat('3',64),'2026-08-12T14:10:00Z','2026-08-12T14:00:00Z'
 );
 perform set_config('omnix.google_partial_tx',started#>>'{transaction,transactionId}',true);
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare consumed jsonb; completed jsonb; env_access jsonb; env_refresh jsonb; begin
 consumed:=public.consume_google_oauth_transaction(
  repeat('7',64),'52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',
  repeat('8',64),'https://omnix.test/api/connectors/google/callback','2026-08-12T14:01:00Z'
 );
 env_access:=jsonb_build_object(
  'ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),
  'nonce',encode(decode(repeat('01',12),'hex'),'base64'),
  'authTag',encode(decode(repeat('02',16),'hex'),'base64'),
  'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),
  'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
  'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),
  'kekVersion','v1','aadHash',repeat('a',64),'expiresAt','2026-08-12T15:02:00Z'
 );
 env_refresh:=env_access||jsonb_build_object('aadHash',repeat('b',64),'expiresAt',null);
 completed:=public.finalize_google_oauth(
  current_setting('omnix.google_partial_tx')::uuid,
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',repeat('9',64),
  'partial.google@example.com',
  array['openid','email','https://www.googleapis.com/auth/gmail.send'],
  null,env_access,null,env_refresh,
  '55000000-0000-4000-8000-000000000032','2026-08-12T14:02:00Z'
 );
 if completed#>>'{connection,status}'<>'active'
    or (select count(*) from public.google_connection_capabilities
        where connection_id='54000000-0000-4000-8000-000000000031' and state='active')<>1
    or (select count(*) from public.google_connection_capabilities
        where connection_id='54000000-0000-4000-8000-000000000031' and state='missing')<>2 then
  raise exception 'partial workspace consent was not persisted independently';
 end if;
end $$;
select 'ok 30 - workspace consent preserves granted capability and leaves denied capabilities missing';

rollback;
