-- Story 4.3 Twilio consent, approval, callback and reconciliation authority.
begin;
select '1..26';

do $$ declare target_table text; begin
  foreach target_table in array array[
    'twilio_connection_authorities','twilio_compliance_policies','texting_consent_events',
    'texting_consent_states','texting_phone_suppressions','texting_conversations',
    'texting_message_drafts','texting_message_draft_versions','texting_send_approval_snapshots',
    'texting_messages','twilio_callback_events','twilio_message_reconciliation_jobs'
  ] loop
    if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity)
      or has_table_privilege('authenticated','public.'||target_table,'INSERT')
      or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
      or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception '0015 RLS/grant failed for %',target_table; end if;
  end loop;
end $$;
select 'ok 1 - every public Twilio/texting table forces workspace RLS and authenticated writes use RPCs';

do $$ begin
  if has_table_privilege('authenticated','connector_private.twilio_message_resources','SELECT')
     or has_table_privilege('authenticated','connector_private.twilio_callback_authorities','SELECT')
     or has_function_privilege('authenticated','public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.read_twilio_callback_verification_authority(text,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz)','EXECUTE') then
    raise exception '0015 private/service boundary failed'; end if;
end $$;
select 'ok 2 - credentials, raw SID and worker/callback envelope reads remain service-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0015@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0015@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0015@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('62000000-0000-4000-8000-000000000001','0015 Workspace A'),
 ('62000000-0000-4000-8000-000000000002','0015 Workspace B');
select set_config('omnix.actor_user_id','61000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','owner','active'),
 ('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','61000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate; set constraints all deferred;

insert into public.connector_connections(id,workspace_id,provider,display_label,status,created_by_membership_id)
values
 ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','twilio','Workspace A texting','authorizing','63000000-0000-4000-8000-000000000001'),
 ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','twilio','Workspace B texting','authorizing','63000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ begin begin
  perform public.configure_twilio_compliance_policy('64000000-0000-4000-8000-000000000001',
    'realtor.follow-up','disclosure-v1',repeat('1',64),365,'20:00','08:00','block',null,true,
    repeat('2',64),gen_random_uuid(),clock_timestamp());
  raise exception 'assistant configured texting policy'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 3 - assistant cannot configure sender, registration or compliance policy';

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$ declare configured jsonb; ensured jsonb; begin
  configured:=public.configure_twilio_compliance_policy('64000000-0000-4000-8000-000000000001',
    'realtor.follow-up','disclosure-v1',repeat('1',64),365,'20:00','08:00','block',null,true,
    repeat('2',64),'65000000-0000-4000-8000-000000000001',clock_timestamp());
  ensured:=public.ensure_twilio_message_send_policy('62000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002',clock_timestamp());
  perform set_config('omnix.twilio_policy',ensured#>>'{policy,id}',true);
  if configured#>>'{policy,version}'<>'1' or ensured#>>'{policy,approval_mode}'<>'owner_required'
     or ensured#>>'{policy,action_type}'<>'message.send' then raise exception 'policy setup failed'; end if;
end $$;
select 'ok 4 - owner versions the exact compliance policy and installs owner-required message.send';

reset role;
-- Compatibility fixture only: 0015 predates the forward-only 0019 verified
-- evidence trigger, so load its already-activated historical row as replica
-- input. Production paths cannot set this superuser-only switch.
set local session_replication_role=replica;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope jsonb; bound jsonb; t timestamptz:=clock_timestamp(); begin
  envelope:=jsonb_build_object('ciphertext',encode(decode(repeat('aa',32),'hex'),'base64'),
    'nonce',encode(decode(repeat('01',12),'hex'),'base64'),'authTag',encode(decode(repeat('02',16),'hex'),'base64'),
    'wrappedDek',encode(decode(repeat('bb',32),'hex'),'base64'),'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
    'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1',
    'aadHash',repeat('3',64),'expiresAt',null);
  bound:=public.bind_twilio_connection_authority(
    '61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001',repeat('4',64),repeat('5',64),repeat('6',64),
    repeat('7',64),'messaging_service','approved',repeat('8',64),'realtor.follow-up',repeat('9',64),
    t,repeat('a',64),t,true,t,true,repeat('b',64),null,envelope,null,
    envelope||jsonb_build_object('aadHash',repeat('c',64)),null,
    envelope||jsonb_build_object('aadHash',repeat('d',64)),
    '65000000-0000-4000-8000-000000000003',t);
  if to_regprocedure('public.bind_twilio_callback_routes(uuid,uuid,uuid,text,text,text,uuid,timestamptz)') is not null then
    perform public.bind_twilio_callback_routes('64000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',
      repeat('b',64),repeat('9',64),repeat('3d',32),gen_random_uuid(),t);
  end if;
  if bound#>>'{connection,status}'<>'active' or bound#>>'{authority,readiness_state}'<>'active'
     or bound::text ~ 'YWFhYWFh' or bound#>>'{secrets,0,secretVersion}'<>'1' then
    raise exception 'Twilio authority bind failed'; end if;
end $$;
reset role; set local session_replication_role=origin; set local role service_role;
select 'ok 5 - service atomically binds restricted encrypted credentials, sender, callback, registration and UAT evidence';

reset role; set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ declare state jsonb; begin
  state:=public.read_twilio_connection_readiness('64000000-0000-4000-8000-000000000001');
  if state#>>'{authority,readiness_state}'<>'active' or not (state->>'providerBacked')::boolean
     or state::text ~* 'ciphertext|wrappedDek|api.key.secret' then raise exception 'redacted readiness failed'; end if;
  perform set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
  begin perform public.read_twilio_connection_readiness('64000000-0000-4000-8000-000000000001');
    raise exception 'cross-workspace readiness read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 6 - members see truthful redacted readiness while cross-workspace reads fail';

reset role;
select set_config('omnix.actor_user_id','61000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,phone,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at) values
 ('66000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
  'Exact','Phone',null,true,'hot','lead','buyer','website','new','{}',now(),now());
do $$ declare point public.contact_points%rowtype; begin
  point:=public.add_contact_point('66000000-0000-4000-8000-000000000001','phone','mobile',
    '5550001001','5550001001',true,null,0,'63000000-0000-4000-8000-000000000001',clock_timestamp());
  perform set_config('omnix.twilio_point',point.id::text,true);
end $$;

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ declare point_id uuid:=current_setting('omnix.twilio_point')::uuid; consent jsonb; begin
  consent:=public.record_texting_consent('64000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',point_id,'realtor.follow-up','opted_in',
    'documented-web-form','disclosure-v1',repeat('e',64),'America/New_York','verified-address',
    '65000000-0000-4000-8000-000000000004',clock_timestamp());
  if consent#>>'{state,status}'<>'opted_in' or consent#>>'{event,actor_membership_id}'
    <>'63000000-0000-4000-8000-000000000002' then raise exception 'explicit consent failed'; end if;
end $$;
select 'ok 7 - assistant records explicit evidence for one exact canonical active phone without inferring consent';

do $$ begin begin
  perform public.record_texting_consent('64000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',gen_random_uuid(),'realtor.follow-up','opted_in',
    'imported-tag','disclosure-v1',repeat('e',64),null,null,gen_random_uuid(),clock_timestamp());
  raise exception 'noncanonical point granted consent'; exception when no_data_found then null; end;
end $$;
select 'ok 8 - missing/noncanonical phone identity fails closed';

do $$ declare envelope jsonb; created jsonb; revised jsonb; begin
  envelope:=jsonb_build_object('ciphertext',encode(decode(repeat('ac',32),'hex'),'base64'),
    'nonce',encode(decode(repeat('05',12),'hex'),'base64'),'authTag',encode(decode(repeat('06',16),'hex'),'base64'),
    'wrappedDek',encode(decode(repeat('bd',32),'hex'),'base64'),'wrapNonce',encode(decode(repeat('07',12),'hex'),'base64'),
    'wrapAuthTag',encode(decode(repeat('08',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('f',64),'expiresAt',null);
  created:=public.create_twilio_message_draft('64000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001',
    current_setting('omnix.twilio_point')::uuid,'realtor.follow-up',repeat('1a',32),envelope,
    '65000000-0000-4000-8000-000000000005',clock_timestamp());
  revised:=public.revise_twilio_message_draft('67000000-0000-4000-8000-000000000001',1,
    repeat('1b',32),envelope||jsonb_build_object('aadHash',repeat('1c',32)),
    '65000000-0000-4000-8000-000000000006',clock_timestamp());
  if created#>>'{draft,current_version}'<>'1' or revised#>>'{draft,current_version}'<>'2'
     or created::text ~ 'YWFhYWFh|15550001001' then raise exception 'encrypted draft versioning failed'; end if;
end $$;
select 'ok 9 - assistant creates and CAS-edits encrypted local content with redacted public metadata';

do $$ declare prepared jsonb; begin
  prepared:=public.prepare_twilio_message_send_intent('67000000-0000-4000-8000-000000000001',2,
    current_setting('omnix.twilio_policy')::uuid,1,'Send one consented follow-up text.',
    '65000000-0000-4000-8000-000000000007');
  perform set_config('omnix.twilio_intent',prepared#>>'{intent,id}',true);
  if prepared#>>'{intent,state}'<>'pending' or prepared#>>'{draftVersion,version}'<>'2'
     or exists(select 1 from public.connector_jobs where intent_id=(prepared#>>'{intent,id}')::uuid) then
    raise exception 'intent prepared or self-approved incorrectly'; end if;
end $$;
select 'ok 10 - preparation binds exact draft/consent/policy hashes but never self-approves';

do $$ begin begin
  perform public.approve_and_enqueue_twilio_message_send(current_setting('omnix.twilio_intent')::uuid,1,
    repeat('1b',32),'twilio-send-0015','America/New_York','verified-address','send_now',
    clock_timestamp(),clock_timestamp(),gen_random_uuid());
  raise exception 'assistant approved external send'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 11 - assistant cannot self-approve provider-backed texting';

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$ declare approved jsonb; t timestamptz:=clock_timestamp(); begin
  begin
    perform public.approve_and_enqueue_connector_action(current_setting('omnix.twilio_intent')::uuid,1,
      repeat('1b',32),'twilio-generic-bypass',gen_random_uuid(),t,3);
    raise exception 'owner bypassed specialized Twilio approval';
  exception when check_violation then null; end;
  approved:=public.approve_and_enqueue_twilio_message_send(current_setting('omnix.twilio_intent')::uuid,1,
    repeat('1b',32),'twilio-send-0015','America/New_York','verified-address','send_now',t,t,
    '65000000-0000-4000-8000-000000000008');
  perform set_config('omnix.twilio_job',approved#>>'{job,id}',true);
  if approved#>>'{snapshot,consent_status}'<>'opted_in' or approved#>>'{snapshot,body_hash}'<>repeat('1b',32)
     or approved#>>'{snapshot,quiet_hours_decision}'<>'send_now' then raise exception 'approval snapshot failed'; end if;
end $$;
select 'ok 12 - generic owner approval is blocked and specialized approval atomically snapshots consent/policy/timezone before enqueue';

do $$ declare t timestamptz:=clock_timestamp(); begin begin
  perform public.approve_and_enqueue_twilio_message_send(current_setting('omnix.twilio_intent')::uuid,1,
    repeat('1b',32),'different-idempotency','America/New_York','verified-address','send_now',t,t,gen_random_uuid());
  raise exception 'divergent approval replay'; exception when unique_violation then null; end;
end $$;
select 'ok 13 - divergent approval/idempotency replay is rejected';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare claimed public.connector_jobs%rowtype; started jsonb; authority jsonb; t timestamptz:=clock_timestamp(); begin
  select * into claimed from public.claim_connector_jobs('68000000-0000-4000-8000-000000000001',1,900,t);
  started:=public.start_connector_job_attempt(claimed.id,'68000000-0000-4000-8000-000000000001',claimed.fencing_token,t+interval '1 second');
  authority:=public.read_twilio_job_authority(claimed.id,'68000000-0000-4000-8000-000000000001',
    claimed.fencing_token,t+interval '2 seconds');
  perform set_config('omnix.twilio_fence',claimed.fencing_token::text,true);
  if authority#>>'{payloadEnvelope,canonicalHash}'<>repeat('1b',32)
     or authority->>'executionMode'<>'send'
     or authority#>>'{draftVersion,draft_id}'<>'67000000-0000-4000-8000-000000000001'
     or authority#>>'{draftVersion,version}'<>'2'
     or authority#>>'{providerAuthority,ciphertext}' is null or authority#>>'{apiCredential,ciphertext}' is null
     or authority#>>'{approvalSnapshot,consent_status}'<>'opted_in'
     or (select side_effect_started_at from public.texting_messages where job_id=claimed.id) is null
     then raise exception 'worker authority/side-effect boundary failed'; end if;
end $$;
select 'ok 14 - generic job start atomically marks the side-effect boundary before fenced credential/payload access';

do $$ begin begin
  perform public.read_twilio_job_authority(current_setting('omnix.twilio_job')::uuid,
    '68000000-0000-4000-8000-000000000002',current_setting('omnix.twilio_fence')::bigint,clock_timestamp());
  raise exception 'wrong worker read Twilio authority'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 15 - wrong worker or stale fence cannot read recipient payload or credentials';

do $$ declare bound jsonb; replay jsonb; recovered jsonb; begin
  bound:=public.bind_twilio_provider_message(current_setting('omnix.twilio_job')::uuid,
    '68000000-0000-4000-8000-000000000001',current_setting('omnix.twilio_fence')::bigint,
    'SM11111111111111111111111111111111','accepted',repeat('2a',32),clock_timestamp());
  replay:=public.bind_twilio_provider_message(current_setting('omnix.twilio_job')::uuid,
    '68000000-0000-4000-8000-000000000001',current_setting('omnix.twilio_fence')::bigint,
    'SM11111111111111111111111111111111','accepted',repeat('2a',32),clock_timestamp());
  recovered:=public.read_twilio_job_authority(current_setting('omnix.twilio_job')::uuid,
    '68000000-0000-4000-8000-000000000001',current_setting('omnix.twilio_fence')::bigint,
    clock_timestamp());
  perform set_config('omnix.twilio_message',bound#>>'{message,id}',true);
  if bound#>>'{message,status}'<>'accepted' or bound#>>'{receipt,provider}'<>'twilio'
     or not (replay->>'noOp')::boolean or bound::text ~ 'SM11111111111111111111111111111111'
     or recovered#>>'{providerMessageBinding,providerMessageSid}'<>'SM11111111111111111111111111111111'
     or recovered#>>'{providerMessageBinding,providerMessageSidHash}'<>bound->>'providerMessageSidHash'
     or recovered->>'executionMode'<>'lookup-only' or recovered->'payloadEnvelope'<>'null'::jsonb then
    raise exception 'SID binding/replay failed'; end if;
end $$;
select 'ok 16 - accepted SID binds once and a recovered fenced worker receives the private lookup binding, never a resend authority';

do $$ declare scheduled jsonb; claimed jsonb; authority jsonb; transitioned jsonb;
 job_id uuid; fence bigint; t timestamptz:=clock_timestamp()+interval '10 minutes'; begin
  scheduled:=public.schedule_due_twilio_reconciliation_jobs(t,300,25);
  claimed:=public.claim_twilio_reconciliation_jobs('68000000-0000-4000-8000-000000000003',10,900,t);
  job_id:=(claimed#>>'{jobs,0,id}')::uuid; fence:=(claimed#>>'{jobs,0,fencing_token}')::bigint;
  perform public.start_twilio_reconciliation_attempt(job_id,'68000000-0000-4000-8000-000000000003',fence,t+interval '1 second');
  authority:=public.read_twilio_reconciliation_authority(job_id,'68000000-0000-4000-8000-000000000003',fence,t+interval '2 seconds');
  transitioned:=public.transition_twilio_reconciliation_job(job_id,'68000000-0000-4000-8000-000000000003',fence,
    'resolved','delivered',null,null,t+interval '2 seconds',t+interval '3 seconds');
  if scheduled#>>'{count}'<>'1' or authority#>>'{providerMessageSid}'<>'SM11111111111111111111111111111111'
     or transitioned#>>'{statusResult,message,status}'<>'delivered' then raise exception 'bounded reconcile failed'; end if;
end $$;
select 'ok 17 - missing terminal callback enters one bounded resumable reconciliation and resolves by provider lookup';

do $$ declare verified jsonb; status_event jsonb; t timestamptz:=clock_timestamp(); begin
  verified:=public.read_twilio_callback_verification_authority(repeat('b',64),'status',t);
  status_event:=public.register_and_apply_twilio_status_callback(repeat('b',64),repeat('3a',32),repeat('3b',32),
    repeat('3c',32),repeat('3d',32),repeat('4',64),repeat('7',64),'SM11111111111111111111111111111111',
    '5550001001','sent',null,t-interval '1 minute',t,'65000000-0000-4000-8000-000000000009');
  if verified#>>'{secret,ciphertext}' is null or status_event#>>'{statusResult,ignoredOutOfOrder}'<>'true'
     or status_event#>>'{message,status}'<>'delivered' then raise exception 'callback/monotonicity failed'; end if;
end $$;
select 'ok 18 - exact endpoint returns signature material server-only and out-of-order status cannot regress delivered';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ declare envelope jsonb; created jsonb; prepared jsonb; begin
  envelope:=jsonb_build_object('ciphertext',encode(decode(repeat('ce',32),'hex'),'base64'),
    'nonce',encode(decode(repeat('09',12),'hex'),'base64'),'authTag',encode(decode(repeat('0a',16),'hex'),'base64'),
    'wrappedDek',encode(decode(repeat('df',32),'hex'),'base64'),'wrapNonce',encode(decode(repeat('0b',12),'hex'),'base64'),
    'wrapAuthTag',encode(decode(repeat('0c',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('4a',32),'expiresAt',null);
  created:=public.create_twilio_message_draft('64000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000001',
    current_setting('omnix.twilio_point')::uuid,'realtor.follow-up',repeat('4b',32),envelope,
    gen_random_uuid(),clock_timestamp());
  prepared:=public.prepare_twilio_message_send_intent('67000000-0000-4000-8000-000000000002',1,
    current_setting('omnix.twilio_policy')::uuid,1,'Second consented text.',gen_random_uuid());
  perform set_config('omnix.twilio_intent2',prepared#>>'{intent,id}',true);
end $$;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$ declare approved jsonb; t timestamptz:=clock_timestamp(); begin
  approved:=public.approve_and_enqueue_twilio_message_send(current_setting('omnix.twilio_intent2')::uuid,1,
    repeat('4b',32),'twilio-send-0015-second','America/New_York','verified-address','send_now',t,t,gen_random_uuid());
  perform set_config('omnix.twilio_job2',approved#>>'{job,id}',true);
end $$;
select 'ok 19 - a second consented send waits durably without crossing the side-effect boundary';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare stopped jsonb; replay jsonb; t timestamptz:=clock_timestamp(); begin
  stopped:=public.register_and_apply_twilio_callback(repeat('b',64),repeat('5a',32),repeat('5b',32),
    repeat('5c',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM22222222222222222222222222222222',
    'inbound','5550001001','stop',null,null,null,null,t-interval '1 second',t,
    '65000000-0000-4000-8000-000000000010');
  replay:=public.register_and_apply_twilio_callback(repeat('b',64),repeat('5a',32),repeat('5b',32),
    repeat('5c',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM22222222222222222222222222222222',
    'inbound','5550001001','stop',null,null,null,null,t-interval '1 second',t,
    gen_random_uuid());
  if stopped#>>'{consent,state,status}'<>'opted_out' or stopped#>>'{canceledJobs}'<>'1'
     or not (replay->>'noOp')::boolean
     or (select state::text from public.connector_jobs where id=current_setting('omnix.twilio_job2')::uuid)<>'cancelled' then
    raise exception 'STOP-first/cancel/replay failed'; end if;
end $$;
select 'ok 20 - verified STOP suppresses first, appends opt-out and cancels queued work before content processing';

do $$ declare started jsonb; helped jsonb; t timestamptz:=clock_timestamp(); begin
  started:=public.register_and_apply_twilio_callback(repeat('b',64),repeat('6a',32),repeat('6b',32),
    repeat('6c',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM33333333333333333333333333333333',
    'inbound','5550001001','start',null,null,null,null,t,t,gen_random_uuid());
  helped:=public.register_and_apply_twilio_callback(repeat('b',64),repeat('7a',32),repeat('7b',32),
    repeat('7c',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM44444444444444444444444444444444',
    'inbound','5550001001','help',null,null,null,null,t,t,gen_random_uuid());
  if started#>>'{consent,state,status}'<>'opted_in' or helped#>>'{callback,state}'<>'applied'
     or exists(select 1 from public.texting_phone_suppressions where connection_id='64000000-0000-4000-8000-000000000001'
       and released_at is null) then raise exception 'START/HELP evidence failed'; end if;
end $$;
select 'ok 21 - fresh verified START is new re-opt-in evidence and HELP records without mutating consent';

reset role;
select set_config('omnix.actor_user_id','61000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,phone,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at) values
 ('66000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
  'Shared','One',null,true,'warm','lead','seller','other','new','{}',now(),now()),
 ('66000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
  'Shared','Two',null,true,'nurture','lead','unknown','other','new','{}',now(),now());
select public.add_contact_point('66000000-0000-4000-8000-000000000002','phone','mobile',
  '5550002002','5550002002',true,null,0,'63000000-0000-4000-8000-000000000001',clock_timestamp());
select public.add_contact_point('66000000-0000-4000-8000-000000000003','phone','mobile',
  '5550002002','5550002002',true,null,0,'63000000-0000-4000-8000-000000000001',clock_timestamp());
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare reviewed jsonb; envelope jsonb; t timestamptz:=clock_timestamp(); begin
  envelope:=jsonb_build_object('ciphertext',encode(decode(repeat('ee',32),'hex'),'base64'),
    'nonce',encode(decode(repeat('0d',12),'hex'),'base64'),'authTag',encode(decode(repeat('0e',16),'hex'),'base64'),
    'wrappedDek',encode(decode(repeat('ff',32),'hex'),'base64'),'wrapNonce',encode(decode(repeat('0f',12),'hex'),'base64'),
    'wrapAuthTag',encode(decode(repeat('10',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('8a',32),'expiresAt',null);
  reviewed:=public.register_and_apply_twilio_callback(repeat('b',64),repeat('8b',32),repeat('8c',32),
    repeat('8d',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM55555555555555555555555555555555',
    'inbound','5550002002','unsupported',null,null,repeat('8e',32),envelope,t,t,gen_random_uuid());
  if reviewed#>>'{callback,state}'<>'review' or reviewed#>>'{callback,review_reason}'<>'shared_phone'
     or reviewed#>>'{reviewRecord,status}'<>'pending' then raise exception 'shared phone review failed'; end if;
end $$;
select 'ok 22 - shared/ambiguous inbound phone fails closed into hash-only human review';

reset role;
do $$ begin begin
  update public.texting_consent_events set status='unknown'
  where id=(select id from public.texting_consent_events limit 1);
  raise exception 'consent history mutated'; exception when object_not_in_prerequisite_state then null; end;
end $$;
select 'ok 23 - consent evidence remains append-only across opt-out and re-opt-in';

do $$ begin
  if exists(select 1 from public.connector_receipt_events where redacted_metadata::text ~ '555000|YWFhYWFh')
     or exists(select 1 from public.twilio_callback_events where to_jsonb(twilio_callback_events)::text ~ '555000')
     or exists(select 1 from public.texting_messages where to_jsonb(texting_messages)::text ~ '555000') then
    raise exception 'raw phone/body leaked to operational tables'; end if;
end $$;
select 'ok 24 - receipts, callback metadata and public messages contain no raw phone or body';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.texting_messages)=0 then raise exception 'assistant lost workspace history'; end if;
  perform set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
  if (select count(*) from public.texting_messages)<>0 then raise exception 'cross workspace history visible'; end if;
end $$;
select 'ok 25 - conversation, consent, job and callback metadata stay workspace-isolated';

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$ declare disabled jsonb; begin
  disabled:=public.disable_twilio_connection('64000000-0000-4000-8000-000000000001',true,
    '65000000-0000-4000-8000-000000000011',clock_timestamp());
  if disabled#>>'{authority,readiness_state}'<>'configured_disabled'
     or (disabled#>>'{destroyedSecrets}')::integer<>2
     or (select count(*) from public.texting_consent_events)=0
     or (select count(*) from public.texting_messages)=0 then raise exception 'disable preservation failed'; end if;
end $$;
reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare callback_authority jsonb; begin
  callback_authority:=public.read_twilio_callback_verification_authority(repeat('b',64),'inbound',clock_timestamp());
  if callback_authority#>>'{secret,secretType}'<>'twilio-webhook-auth-token' then
    raise exception 'disable removed late callback verification'; end if;
end $$;
select 'ok 26 - disable cancels only pre-side-effect work, cryptoshreds send credentials and preserves consent/history/late callbacks';

rollback;
