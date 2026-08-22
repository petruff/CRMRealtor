-- Story 4.3 HIGH remediation: controlled UAT, exact callback routes and setup CAS.
begin;
select '1..18';

do $$ begin
  if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname='twilio_real_number_uat_jobs'
        and relation.relrowsecurity and relation.relforcerowsecurity)
     or has_table_privilege('authenticated','public.twilio_real_number_uat_jobs','INSERT')
     or has_table_privilege('authenticated','connector_private.twilio_real_number_uat_resources','SELECT') then
    raise exception '0017 RLS/grant boundary failed'; end if;
end $$;
select 'ok 1 - UAT metadata is workspace-RLS scoped and exact provider SID remains private';

do $$ begin
  if has_function_privilege('authenticated','public.read_twilio_setup_state(uuid,uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.read_twilio_callback_verification_authority(text,twilio_callback_kind,timestamptz)','EXECUTE')
     or has_function_privilege('service_role','public.read_twilio_callback_verification_authority(text,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_twilio_setup_state(uuid,uuid,uuid)','EXECUTE') then
    raise exception '0017 service boundary failed'; end if;
end $$;
select 'ok 2 - setup versions and kind-bound verification material are service-only; legacy ambiguous read is disabled';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0017@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0017@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0017@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('82000000-0000-4000-8000-000000000001','0017 Workspace A'),
 ('82000000-0000-4000-8000-000000000002','0017 Workspace B');
select set_config('omnix.actor_user_id','81000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner','active'),
 ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','81000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('83000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate; set constraints all deferred;
insert into public.connector_connections(id,workspace_id,provider,display_label,status,created_by_membership_id)
values ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','twilio',
 'Workspace A pre-UAT','authorizing','83000000-0000-4000-8000-000000000001');

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ declare configured jsonb; begin
 configured:=public.configure_twilio_compliance_policy('84000000-0000-4000-8000-000000000001',
  'realtor.follow-up','disclosure-v17',repeat('1',64),365,'20:00','08:00','block',null,true,
  repeat('2',64),gen_random_uuid(),clock_timestamp());
 if configured#>>'{policy,disclosure_version}'<>'disclosure-v17' then raise exception 'policy configuration failed'; end if;
end $$;

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope jsonb; bound jsonb; state jsonb; t timestamptz:=clock_timestamp(); begin
 envelope:=jsonb_build_object('ciphertext','YWFh','nonce',encode(decode(repeat('01',12),'hex'),'base64'),
  'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek','YmJi',
  'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),
  'kekVersion','v1','aadHash',repeat('3',64),'expiresAt',null);
 bound:=public.bind_twilio_connection_authority('81000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',repeat('4',64),
  repeat('5',64),repeat('6',64),repeat('7',64),'messaging_service','approved',repeat('8',64),
  'realtor.follow-up',repeat('9',64),null,null,null,true,t,true,repeat('a',64),null,envelope,null,
  envelope||jsonb_build_object('aadHash',repeat('b',64)),null,envelope||jsonb_build_object('aadHash',repeat('c',64)),
  gen_random_uuid(),t);
 state:=public.read_twilio_setup_state('84000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
 if bound#>>'{connection,status}'<>'authorizing' or bound#>>'{authority,readiness_state}'<>'approval_blocked'
  or state#>>'{providerAuthoritySecretVersion}'<>'1' or state#>>'{apiCredentialSecretVersion}'<>'1'
  or state#>>'{webhookSecretVersion}'<>'1' or state#>>'{disclosureVersion}'<>'disclosure-v17'
  or not (state->>'realNumberUatRequired')::boolean then raise exception 'pre-UAT setup state failed'; end if;
end $$;
select 'ok 3 - first bind remains authorizing and setup read returns exact redacted CAS versions plus disclosure';

do $$ declare routes jsonb; begin
 begin perform public.bind_twilio_callback_routes('84000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
  repeat('a',64),repeat('9',64),repeat('9',64),gen_random_uuid(),clock_timestamp());
  raise exception 'same callback hash accepted'; exception when invalid_parameter_value then null; end;
 routes:=public.bind_twilio_callback_routes('84000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
  repeat('a',64),repeat('9',64),repeat('d',64),gen_random_uuid(),clock_timestamp());
 if routes#>>'{callbackKinds,0}'<>'inbound' or routes#>>'{callbackKinds,1}'<>'status' then
  raise exception 'exact callback routes failed'; end if;
end $$;
select 'ok 4 - setup binds two distinct exact /inbound and /status URL hashes under one opaque endpoint';

do $$ declare inbound jsonb; status_route jsonb; begin
 inbound:=public.read_twilio_callback_verification_authority(repeat('a',64),'inbound',clock_timestamp());
 status_route:=public.read_twilio_callback_verification_authority(repeat('a',64),'status',clock_timestamp());
 if inbound#>>'{callbackKind}'<>'inbound' or inbound#>>'{exactExternalUrlHash}'<>repeat('9',64)
  or status_route#>>'{callbackKind}'<>'status' or status_route#>>'{exactExternalUrlHash}'<>repeat('d',64)
  or inbound#>>'{secret,ciphertext}' is null then raise exception 'kind callback authority failed'; end if;
end $$;
select 'ok 5 - verification material returns only the exact URL hash for the requested callback kind';

reset role;
select set_config('omnix.callback_before',(select count(*)::text from public.twilio_callback_events),true);
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 begin perform public.register_and_apply_twilio_status_callback(repeat('a',64),repeat('1a',32),repeat('1b',32),
  repeat('1c',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM11111111111111111111111111111111',
  '5550001001','sent',null,clock_timestamp(),clock_timestamp(),gen_random_uuid());
  raise exception 'status accepted inbound URL'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.twilio_callback_events)<>current_setting('omnix.callback_before')::integer then
  raise exception 'wrong route mutated callback'; end if;
end $$;
select 'ok 6 - wrong callback-kind exact URL fails before durable delivery/event mutation';

reset role;
select set_config('omnix.actor_user_id','81000000-0000-4000-8000-000000000001',true);
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at) values
 ('86000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001','UAT','Recipient',true,'warm','lead','buyer','other','new','{}',now(),now());
do $$ declare point public.contact_points%rowtype; begin
 point:=public.add_contact_point('86000000-0000-4000-8000-000000000001','phone','mobile','5550001001',
  '5550001001',true,null,0,'83000000-0000-4000-8000-000000000001',clock_timestamp());
 perform set_config('omnix.uat_point',point.id::text,true);
end $$;

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select public.record_texting_consent('84000000-0000-4000-8000-000000000001',
 '86000000-0000-4000-8000-000000000001',current_setting('omnix.uat_point')::uuid,'realtor.follow-up',
 'opted_in','documented-web-form','disclosure-v17',repeat('e',64),'America/New_York','verified-address',
 gen_random_uuid(),clock_timestamp());
do $$ declare envelope jsonb:=jsonb_build_object('ciphertext','Y2Nj','nonce',encode(decode(repeat('05',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('06',16),'hex'),'base64'),'wrappedDek','ZGRk','wrapNonce',encode(decode(repeat('07',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('08',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('f',64),'expiresAt',null); begin
 begin perform public.request_twilio_real_number_uat('84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',current_setting('omnix.uat_point')::uuid,repeat('1d',32),envelope,
  'America/New_York','verified-address','send_now',clock_timestamp(),clock_timestamp(),'twilio-uat-0017',gen_random_uuid());
  raise exception 'assistant requested real-number UAT'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - assistant cannot authorize the real-number UAT side effect';

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ declare envelope jsonb:=jsonb_build_object('ciphertext','Y2Nj','nonce',encode(decode(repeat('05',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('06',16),'hex'),'base64'),'wrappedDek','ZGRk','wrapNonce',encode(decode(repeat('07',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('08',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('f',64),'expiresAt',null);
 requested jsonb; replay jsonb; t timestamptz:=clock_timestamp(); begin
 requested:=public.request_twilio_real_number_uat('84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',current_setting('omnix.uat_point')::uuid,repeat('1d',32),envelope,
  'America/New_York','verified-address','send_now',t,t,'twilio-uat-0017','85000000-0000-4000-8000-000000000001');
 replay:=public.request_twilio_real_number_uat('84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',current_setting('omnix.uat_point')::uuid,repeat('1d',32),envelope,
  'America/New_York','verified-address','send_now',t,t,'twilio-uat-0017',gen_random_uuid());
 perform set_config('omnix.uat_job',requested#>>'{job,id}',true);
 if requested#>>'{job,state}'<>'queued' or requested#>>'{job,disclosure_version}'<>'disclosure-v17'
  or not (replay->>'noOp')::boolean then raise exception 'owner UAT request/replay failed'; end if;
end $$;
select 'ok 8 - owner creates one idempotent UAT job with immutable consent/policy/timezone snapshot';

do $$ begin
 begin perform public.create_twilio_message_draft('84000000-0000-4000-8000-000000000001',gen_random_uuid(),
  '86000000-0000-4000-8000-000000000001',current_setting('omnix.uat_point')::uuid,'realtor.follow-up',repeat('1e',32),
  jsonb_build_object('ciphertext','YQ==','nonce',encode(decode(repeat('01',12),'hex'),'base64'),
   'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek','Yg==','wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
   'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('1',64),'expiresAt',null),
  gen_random_uuid(),clock_timestamp());
  raise exception 'ordinary draft allowed before UAT'; exception when no_data_found then null; end;
 if exists(select 1 from public.connector_action_intents where connection_id='84000000-0000-4000-8000-000000000001') then
  raise exception 'ordinary message intent exists before UAT'; end if;
end $$;
select 'ok 9 - normal message.send remains unavailable before delivered UAT evidence';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare claimed jsonb; job_id uuid; fence bigint; started jsonb; authority jsonb; begin
 claimed:=public.claim_twilio_real_number_uat_jobs('87000000-0000-4000-8000-000000000001',5,900,clock_timestamp());
 job_id:=(claimed#>>'{jobs,0,id}')::uuid; fence:=(claimed#>>'{jobs,0,fencing_token}')::bigint;
 started:=public.start_twilio_real_number_uat_attempt(job_id,'87000000-0000-4000-8000-000000000001',fence,clock_timestamp());
 authority:=public.read_twilio_real_number_uat_authority(job_id,'87000000-0000-4000-8000-000000000001',fence,clock_timestamp());
 perform set_config('omnix.uat_fence',fence::text,true);
 if authority#>>'{executionMode}'<>'send' or authority#>>'{payloadEnvelope,canonicalHash}'<>repeat('1d',32)
  or authority#>>'{providerAuthority,ciphertext}' is null or authority#>>'{apiCredential,ciphertext}' is null
  or authority#>>'{job,side_effect_started_at}' is null then raise exception 'UAT worker authority failed'; end if;
end $$;
select 'ok 10 - bounded lease/fence exposes credentials and encrypted payload only after side-effect boundary';

do $$ begin begin perform public.read_twilio_real_number_uat_authority(current_setting('omnix.uat_job')::uuid,
 '87000000-0000-4000-8000-000000000002',current_setting('omnix.uat_fence')::bigint,clock_timestamp());
 raise exception 'wrong UAT worker read authority'; exception when insufficient_privilege then null; end; end $$;
select 'ok 11 - wrong worker or stale fence cannot read UAT recipient content or credentials';

do $$ declare bound jsonb; recovered jsonb; begin
 bound:=public.bind_twilio_real_number_uat_provider_message(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,
  'SM22222222222222222222222222222222',repeat('2a',32),clock_timestamp());
 recovered:=public.read_twilio_real_number_uat_authority(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,clock_timestamp());
 if bound->>'providerMessageSidHash' is null or recovered#>>'{executionMode}'<>'lookup-only'
  or recovered#>>'{providerMessageBinding,providerMessageSid}'<>'SM22222222222222222222222222222222'
  or recovered->'payloadEnvelope'<>'null'::jsonb then raise exception 'UAT crash recovery failed'; end if;
end $$;
select 'ok 12 - provider SID binds once and crash recovery switches to lookup-only without resend authority';

do $$ begin begin
 perform public.transition_twilio_real_number_uat_job(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,
  'delivered','sent',repeat('2b',32),null,null,clock_timestamp());
 raise exception 'non-delivered UAT activated'; exception when check_violation then null; end;
 if (select status::text from public.connector_connections where id='84000000-0000-4000-8000-000000000001')<>'authorizing'
  or (select real_number_uat_at from public.twilio_connection_authorities where connection_id='84000000-0000-4000-8000-000000000001') is not null then
  raise exception 'failed UAT produced activation evidence'; end if;
end $$;
select 'ok 13 - accepted/sent is not enough: only delivered/read can satisfy real-number UAT';

reset role;
update public.twilio_real_number_uat_jobs set attempt_count=max_attempts
 where id=current_setting('omnix.uat_job')::uuid;
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);

do $$ declare callback_result jsonb; claimed jsonb; recovered jsonb; transitioned jsonb;
 fence bigint; t timestamptz; cycle integer; step_time timestamptz; begin
 t:=clock_timestamp();
 callback_result:=public.register_and_apply_twilio_status_callback(repeat('a',64),repeat('40',32),repeat('41',32),
  repeat('42',32),repeat('d',64),repeat('4',64),repeat('7',64),'SM22222222222222222222222222222222',
  '5550001001','delivered',null,t,t,gen_random_uuid());
 for cycle in 1..4 loop
  step_time:=t+(cycle*3)*interval '1 second';
  transitioned:=public.transition_twilio_real_number_uat_job(current_setting('omnix.uat_job')::uuid,
   '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,
   'retry','delivered',repeat('2b',32),'uat_sequence_pending',step_time+interval '1 second',step_time);
  if transitioned#>>'{job,state}'<>'retry_wait'
     or (transitioned#>>'{job,attempt_count}')::integer<>(transitioned#>>'{job,max_attempts}')::integer-1
     or not (transitioned->>'sequencePending')::boolean then
    raise exception 'human wait consumed provider attempt budget'; end if;
  claimed:=public.claim_twilio_real_number_uat_jobs('87000000-0000-4000-8000-000000000001',1,900,step_time+interval '2 seconds');
  fence:=(claimed#>>'{jobs,0,fencing_token}')::bigint;
  perform public.start_twilio_real_number_uat_attempt(current_setting('omnix.uat_job')::uuid,
   '87000000-0000-4000-8000-000000000001',fence,step_time+interval '2 seconds');
  recovered:=public.read_twilio_real_number_uat_authority(current_setting('omnix.uat_job')::uuid,
   '87000000-0000-4000-8000-000000000001',fence,step_time+interval '2 seconds');
  perform set_config('omnix.uat_fence',fence::text,true);
  if (recovered->>'evidenceComplete')::boolean or recovered#>>'{executionMode}'<>'lookup-only'
     or recovered->'payloadEnvelope'<>'null'::jsonb then raise exception 'delivery retry authority failed'; end if;
 end loop;
end $$;
select 'ok 14 - delivered polling beyond maxAttempts remains retryable without budget use and recovery is lookup-only';

do $$ declare callback_result jsonb; claimed jsonb; fence bigint; t timestamptz; begin
 t:=clock_timestamp();
 begin
  perform public.transition_twilio_real_number_uat_job(current_setting('omnix.uat_job')::uuid,
   '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,
   'delivered','delivered',repeat('2b',32),null,null,t);
  raise exception 'delivery-only UAT activated'; exception when check_violation then null;
 end;
 callback_result:=public.register_and_apply_twilio_callback(repeat('a',64),repeat('43',32),repeat('44',32),
  repeat('45',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM44444444444444444444444444444444',
  'inbound','5550001001','help',null,null,null,null,clock_timestamp(),clock_timestamp(),gen_random_uuid());
 callback_result:=public.register_and_apply_twilio_callback(repeat('a',64),repeat('47',32),repeat('48',32),
  repeat('49',32),repeat('9',64),repeat('4',64),repeat('7',64),'SM55555555555555555555555555555555',
  'inbound','5550001001','stop',null,null,null,null,clock_timestamp(),clock_timestamp(),gen_random_uuid());
 perform public.transition_twilio_real_number_uat_job(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,
  'retry','delivered',repeat('2b',32),'uat_finalize_pending',clock_timestamp()+interval '1 second',clock_timestamp());
 claimed:=public.claim_twilio_real_number_uat_jobs('87000000-0000-4000-8000-000000000001',1,900,clock_timestamp()+interval '2 seconds');
 fence:=(claimed#>>'{jobs,0,fencing_token}')::bigint;
 if fence is null or (claimed#>>'{jobs,0,attempt_count}')::integer<>(claimed#>>'{jobs,0,max_attempts}')::integer-1 then
  raise exception 'complete-sequence recovery was exhausted at max attempts'; end if;
 perform set_config('omnix.uat_fence',fence::text,true);
end $$;
reset role;
create temp table saved_0017_uat_evidence on commit drop as
 select * from public.twilio_real_number_uat_evidence_state
 where uat_job_id=current_setting('omnix.uat_job')::uuid;
delete from public.twilio_real_number_uat_evidence_state
 where uat_job_id=current_setting('omnix.uat_job')::uuid;
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 begin
  perform public.start_twilio_real_number_uat_attempt(current_setting('omnix.uat_job')::uuid,
   '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,clock_timestamp());
  raise exception 'opt-out without sequence restarted'; exception when insufficient_privilege then null;
 end;
end $$;
reset role;
insert into public.twilio_real_number_uat_evidence_state select * from saved_0017_uat_evidence;
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
select 'ok 15 - opt-out without the same-job complete sequence cannot restart fenced UAT recovery';

do $$ declare completed jsonb; recovered jsonb; begin
 perform public.start_twilio_real_number_uat_attempt(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,clock_timestamp());
 recovered:=public.read_twilio_real_number_uat_authority(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,clock_timestamp());
 completed:=public.transition_twilio_real_number_uat_job(current_setting('omnix.uat_job')::uuid,
  '87000000-0000-4000-8000-000000000001',current_setting('omnix.uat_fence')::bigint,
  'delivered','delivered',repeat('2b',32),null,null,clock_timestamp());
 if completed#>>'{job,state}'<>'succeeded' or completed#>>'{connection,status}'<>'active'
  or completed#>>'{evidence,evidence_count}'<>'4' or not (recovered->>'evidenceComplete')::boolean
  or recovered#>>'{executionMode}'<>'lookup-only' or recovered->'payloadEnvelope'<>'null'::jsonb
  then raise exception 'post-STOP lookup completion failed'; end if;
end $$;
select 'ok 16 - complete signed sequence permits only lookup recovery and then activates UAT';

do $$ declare status_event jsonb; begin
 status_event:=public.register_and_apply_twilio_status_callback(repeat('a',64),repeat('3a',32),repeat('3b',32),
  repeat('3c',32),repeat('d',64),repeat('4',64),repeat('7',64),'SM33333333333333333333333333333333',
  '5550001001','delivered',null,clock_timestamp(),clock_timestamp(),gen_random_uuid());
 if status_event#>>'{callback,callback_kind}'<>'status' or status_event#>>'{callback,exact_external_url_hash}'<>repeat('d',64)
  or status_event#>>'{callback,state}'<>'review' then raise exception 'valid status route ingress failed'; end if;
end $$;
select 'ok 17 - valid exact /status callback is durably accepted and unknown SID is reviewed, not guessed';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ declare state jsonb; begin
 state:=public.read_twilio_connection_readiness('84000000-0000-4000-8000-000000000001');
 if state#>>'{disclosureVersion}'<>'disclosure-v17' or (state->>'realNumberUatRequired')::boolean
  or not (state->>'providerBacked')::boolean then raise exception 'post-UAT readiness truth failed'; end if;
 perform set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
 if (select count(*) from public.twilio_real_number_uat_jobs)<>0 then raise exception 'cross-workspace UAT visible'; end if;
end $$;
select 'ok 18 - readiness exposes disclosure/UAT truth and UAT history remains workspace-isolated';

rollback;
