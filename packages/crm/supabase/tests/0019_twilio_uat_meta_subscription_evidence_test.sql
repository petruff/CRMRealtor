-- Story 4.3/4.4 HIGH remediation: verified UAT evidence, retry-safe Meta
-- subscriptions, fenced revocation and reviewer-bound encrypted content.
begin;
select '1..21';

do $$ begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='twilio_real_number_uat_evidence_events'
        and c.relrowsecurity and c.relforcerowsecurity)
     or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='meta_asset_subscription_states'
        and c.relrowsecurity and c.relforcerowsecurity)
     or has_table_privilege('authenticated','public.meta_asset_subscription_states','INSERT')
     or has_table_privilege('service_role','connector_private.meta_page_access_token_bindings','SELECT') then
    raise exception '0019 RLS/table grant boundary failed'; end if;
end $$;
select 'ok 1 - Twilio evidence and Meta subscription projections are forced-RLS and browser read-only';

do $$ begin
  if has_function_privilege('authenticated','public.record_meta_asset_subscription_result(uuid,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.read_meta_revocation_authority(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.read_meta_enquiry_review_authority(uuid,uuid,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.read_meta_asset_subscription_retry_authority(uuid,uuid,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.record_meta_asset_subscription_result(uuid,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_meta_revocation_authority(uuid,uuid,bigint,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_meta_asset_subscription_retry_authority(uuid,uuid,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_meta_enquiry_review_authority(uuid,uuid,uuid,timestamptz)','EXECUTE') then
    raise exception '0019 RPC grant boundary failed'; end if;
end $$;
select 'ok 2 - subscription mutation, revocation credentials and review content are service-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0019@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0019@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0019@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('92000000-0000-4000-8000-000000000001','0019 Workspace A'),
 ('92000000-0000-4000-8000-000000000002','0019 Workspace B');
select set_config('omnix.actor_user_id','91000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','owner','active'),
 ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','91000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('93000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate; set constraints all deferred;

insert into public.connector_connections(id,workspace_id,provider,provider_account_key_hash,display_label,status,
 granted_scopes,remote_identity_summary,created_by_membership_id,created_at,updated_at) values
 ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','meta',repeat('1',64),
  'Meta Page','active',array['pages_manage_metadata','pages_messaging','pages_show_list'],'{}',
  '93000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());
insert into public.meta_connection_authorities(connection_id,workspace_id,login_mode,graph_version,
 version_source_url,version_source_hash,version_reviewed_at,version_approved_by_membership_id,
 requested_scopes,granted_scopes,account_key_hash,business_verified,business_verification_hash,
 app_review_approved,app_review_evidence_hash,readiness_state,enabled,created_by_membership_id,created_at,updated_at) values
 ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','facebook-page','v99.0',
  'https://developers.facebook.com/docs/graph-api/changelog/',repeat('2',64),clock_timestamp(),
  '93000000-0000-4000-8000-000000000001',array['pages_manage_metadata','pages_messaging','pages_show_list'],
  array['pages_manage_metadata','pages_messaging','pages_show_list'],repeat('1',64),true,repeat('3',64),true,repeat('4',64),
  'asset_selection_required',true,'93000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());
insert into public.meta_asset_bindings(id,workspace_id,connection_id,channel,asset_id_hash,display_label,
 eligibility_snapshot_hash,state,created_at,updated_at) values
 ('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','facebook',repeat('5',64),'Page 0019',repeat('6',64),
  'eligible',clock_timestamp(),clock_timestamp());
insert into connector_private.meta_asset_identities(asset_binding_id,workspace_id,connection_id,asset_id,created_at,updated_at)
values ('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000001','page-019',clock_timestamp(),clock_timestamp());
insert into connector_private.connector_payload_envelopes(id,workspace_id,connection_id,payload_kind,schema_version,
 canonical_hash,ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at)
values ('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000001','meta-page-access-token','meta-page-access-token.v1',repeat('7',64),
 decode('YWFh','base64'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode('YmJi','base64'),
 decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('8',64),clock_timestamp(),clock_timestamp());
insert into connector_private.meta_page_access_token_bindings(asset_binding_id,workspace_id,connection_id,
 token_payload_ref,token_version,token_hash,bound_at,updated_at) values
 ('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',1,repeat('7',64),
 clock_timestamp(),clock_timestamp());
insert into connector_private.connector_connection_secrets(id,workspace_id,connection_id,secret_type,secret_version,
 ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at)
values ('96000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000001','meta-access-token',1,decode('Y2Nj','base64'),
 decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),decode('ZGRk','base64'),
 decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),'v1',repeat('9',64),clock_timestamp(),clock_timestamp());

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
 result:=public.select_meta_assets('94000000-0000-4000-8000-000000000001',repeat('6',64),array[repeat('5',64)],
  90,repeat('a',64),gen_random_uuid(),clock_timestamp());
 if result#>>'{selectedAssets,0,state}'<>'selected' then raise exception 'selection failed'; end if;
end $$;
reset role;
do $$ begin
 if (select status::text from public.meta_asset_subscription_states
      where asset_binding_id='95000000-0000-4000-8000-000000000001')<>'pending'
    or (select attempt_count from public.meta_asset_subscription_states
      where asset_binding_id='95000000-0000-4000-8000-000000000001')<>1 then
  raise exception 'selected asset did not initialize pending'; end if;
end $$;
select 'ok 3 - local asset selection creates pending provider-subscription state without claiming success';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
 result:=public.record_meta_asset_subscription_result('94000000-0000-4000-8000-000000000001',repeat('5',64),
  'failed',repeat('b',64),null,'provider.timeout',gen_random_uuid(),clock_timestamp());
 if result#>>'{state,status}'<>'failed' or result#>>'{state,last_error_category}'<>'provider.timeout'
   or (result->>'noOp')::boolean then raise exception 'failed result not durable'; end if;
end $$;
select 'ok 4 - a remote setup failure becomes explicit durable retryable state';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$ declare replay jsonb; begin
 replay:=public.select_meta_assets('94000000-0000-4000-8000-000000000001',repeat('6',64),array[repeat('5',64)],
  90,repeat('a',64),gen_random_uuid(),clock_timestamp());
 if not (replay->>'noOp')::boolean
   or (select status::text from public.meta_asset_subscription_states
      where asset_binding_id='95000000-0000-4000-8000-000000000001')<>'failed' then
  raise exception 'exact selected replay reset remote state'; end if;
end $$;
select 'ok 5 - exact owner selection replay is a no-op and preserves failed provider state for retry';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare authority jsonb; begin
 authority:=public.read_meta_asset_subscription_retry_authority('94000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',clock_timestamp());
 if authority#>>'{loginMode}'<>'facebook-page' or authority#>>'{selectedAssets,0,assetId}'<>'page-019'
   or not (authority#>>'{selectedAssets,0,retryAllowed}')::boolean
   or authority#>>'{selectedAssets,0,pageAccessToken,ciphertext}'<>'YWFh'
   or authority#>>'{connectionAccessToken,ciphertext}'<>'Y2Nj' then raise exception 'Page retry authority failed'; end if;
end $$;
select 'ok 6 - service retry authority returns selected Facebook Page identity and Page token after failure';

reset role;
insert into public.connector_connections(id,workspace_id,provider,provider_account_key_hash,display_label,status,
 granted_scopes,remote_identity_summary,created_by_membership_id,created_at,updated_at) values
 ('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','meta',repeat('21',32),
  'Instagram Login','active',array['instagram_business_basic','instagram_business_manage_messages'],'{}',
  '93000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());
insert into public.meta_connection_authorities(connection_id,workspace_id,login_mode,graph_version,
 version_source_url,version_source_hash,version_reviewed_at,version_approved_by_membership_id,
 requested_scopes,granted_scopes,account_key_hash,business_verified,business_verification_hash,
 app_review_approved,app_review_evidence_hash,eligibility_snapshot_hash,selected_asset_snapshot_hash,
 retention_days,retention_policy_hash,selected_by_membership_id,selected_at,readiness_state,enabled,
 created_by_membership_id,created_at,updated_at) values
 ('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','instagram-login','v99.0',
  'https://developers.facebook.com/docs/graph-api/changelog/',repeat('22',32),clock_timestamp(),
  '93000000-0000-4000-8000-000000000001',array['instagram_business_basic','instagram_business_manage_messages'],
  array['instagram_business_basic','instagram_business_manage_messages'],repeat('21',32),true,repeat('23',32),true,repeat('24',32),
  repeat('25',32),repeat('25',32),90,repeat('26',32),'93000000-0000-4000-8000-000000000001',clock_timestamp(),
  'webhook_setup_required',true,'93000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());
insert into public.meta_asset_bindings(id,workspace_id,connection_id,channel,asset_id_hash,display_label,
 eligibility_snapshot_hash,state,selected_at,created_at,updated_at) values
 ('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000002','instagram',repeat('27',32),'Instagram 0019',repeat('25',32),
  'selected',clock_timestamp(),clock_timestamp(),clock_timestamp());
insert into connector_private.meta_asset_identities(asset_binding_id,workspace_id,connection_id,asset_id,created_at,updated_at)
values ('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000002','ig-019',clock_timestamp(),clock_timestamp());
insert into connector_private.connector_connection_secrets(id,workspace_id,connection_id,secret_type,secret_version,
 ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at)
values ('96000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000002','meta-access-token',1,decode('aWlp','base64'),
 decode(repeat('15',12),'hex'),decode(repeat('16',16),'hex'),decode('ampq','base64'),
 decode(repeat('17',12),'hex'),decode(repeat('18',16),'hex'),'v1',repeat('28',32),clock_timestamp(),clock_timestamp());
insert into public.meta_asset_subscription_events(id,workspace_id,connection_id,asset_binding_id,event_type,
 operation_key_hash,correlation_id,occurred_at,created_at) values
 ('96000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000002','attempted',
 repeat('29',32),gen_random_uuid(),clock_timestamp(),clock_timestamp());
insert into public.meta_asset_subscription_states(asset_binding_id,workspace_id,connection_id,status,attempt_count,
 last_event_id,last_operation_key_hash,last_attempt_at,updated_at) values
 ('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000002','pending',1,'96000000-0000-4000-8000-000000000004',
 repeat('29',32),clock_timestamp(),clock_timestamp());
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare authority jsonb; begin
 authority:=public.read_meta_asset_subscription_retry_authority('94000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',clock_timestamp());
 if authority#>>'{loginMode}'<>'instagram-login' or authority#>>'{selectedAssets,0,assetId}'<>'ig-019'
   or authority#>'{selectedAssets,0,pageAccessToken}'<>'null'::jsonb
   or authority#>>'{connectionAccessToken,ciphertext}'<>'aWlp' then raise exception 'Instagram retry authority failed'; end if;
end $$;
select 'ok 7 - the same retry authority supports Instagram Login with connection token and no Page-token claim';

do $$ declare first_result jsonb; replay jsonb; begin
 first_result:=public.record_meta_asset_subscription_result('94000000-0000-4000-8000-000000000001',repeat('5',64),
  'attempted',repeat('c',64),null,null,'97000000-0000-4000-8000-000000000001',clock_timestamp());
 replay:=public.record_meta_asset_subscription_result('94000000-0000-4000-8000-000000000001',repeat('5',64),
  'attempted',repeat('c',64),null,null,gen_random_uuid(),clock_timestamp());
 if first_result#>>'{state,status}'<>'pending' or not (replay->>'noOp')::boolean
   or (select count(*) from public.meta_asset_subscription_events where operation_key_hash=repeat('c',64))<>1 then
  raise exception 'attempt replay failed'; end if;
end $$;
select 'ok 8 - retry attempt is idempotent even when the provider retry has a new correlation ID';

do $$ begin
 begin perform public.record_meta_asset_subscription_result('94000000-0000-4000-8000-000000000001',repeat('5',64),
  'subscribed',repeat('c',64),repeat('d',64),null,gen_random_uuid(),clock_timestamp());
  raise exception 'divergent subscription replay accepted'; exception when unique_violation then null; end;
end $$;
select 'ok 9 - divergent operation replay is rejected without mutating subscription state';

do $$ declare result jsonb; begin
 result:=public.record_meta_asset_subscription_result('94000000-0000-4000-8000-000000000001',repeat('5',64),
  'subscribed',repeat('e',64),repeat('f',64),null,gen_random_uuid(),clock_timestamp());
 if result#>>'{state,status}'<>'subscribed' or result#>>'{state,last_provider_evidence_hash}'<>repeat('f',64)
  then raise exception 'subscription success failed'; end if;
end $$;
select 'ok 10 - provider success records hash-only evidence and subscribed projection';

do $$ declare authority jsonb; begin
 authority:=public.read_meta_page_subscription_authority('94000000-0000-4000-8000-000000000001',repeat('5',64),
  '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',clock_timestamp());
 if authority#>>'{subscriptionState,status}'<>'subscribed' or (authority->>'retryAllowed')::boolean
   or authority#>>'{asset,assetId}'<>'page-019' or authority#>>'{pageAccessToken,ciphertext}'<>'YWFh' then
  raise exception 'subscription authority state failed'; end if;
end $$;
select 'ok 11 - selected Page authority returns exact asset/token only to service and disables retry after success';

do $$ begin
 begin perform public.read_meta_page_subscription_authority('94000000-0000-4000-8000-000000000001',repeat('5',64),
  '91000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003',clock_timestamp());
  raise exception 'cross-workspace subscription authority read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 12 - cross-workspace owner binding cannot read exact selected Page subscription authority';

reset role;
do $$ begin
 begin update public.meta_asset_subscription_events set error_category='tamper'
  where connection_id='94000000-0000-4000-8000-000000000001';
  raise exception 'subscription evidence updated'; exception when object_not_in_prerequisite_state then null; end;
end $$;
select 'ok 13 - Meta subscription evidence is append-only';

insert into public.incomplete_records(id,workspace_id,source,external_id,candidate,validation_reasons,status,
 intake_idempotency_key,intake_request_hash,created_at,updated_at) values
 ('97000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','meta-inbound',repeat('1a',32),'{}',
  jsonb_build_array(jsonb_build_object('field','identity','code','no_match','message','Needs review')),
  'pending','meta-review-0019',repeat('1b',32),clock_timestamp(),clock_timestamp());
insert into public.connector_webhook_deliveries(id,workspace_id,connection_id,provider,replay_key_hash,raw_body_hash,
 signature_valid,timestamp_valid,outcome,correlation_id,received_at,redacted_result) values
 ('97000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','meta',repeat('1c',32),repeat('1d',32),true,true,'accepted',
  '97000000-0000-4000-8000-000000000004',clock_timestamp(),'review');
insert into public.meta_external_identities(id,workspace_id,connection_id,asset_binding_id,channel,sender_key_hash,
 first_event_at,last_event_at,created_at,updated_at) values
 ('97000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','facebook',repeat('1e',32),
  clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp());
insert into public.meta_conversations(id,workspace_id,connection_id,asset_binding_id,external_identity_id,channel,
 conversation_key_hash,created_at,updated_at) values
 ('97000000-0000-4000-8000-000000000006','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000005','facebook',repeat('2a',32),clock_timestamp(),clock_timestamp());
insert into connector_private.connector_payload_envelopes(id,workspace_id,connection_id,payload_kind,schema_version,
 canonical_hash,ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at)
values ('97000000-0000-4000-8000-000000000007','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000001','meta-inbound-message','meta-inbound-message.v1',repeat('2b',32),
 decode('ZWVl','base64'),decode(repeat('11',12),'hex'),decode(repeat('12',16),'hex'),decode('ZmZm','base64'),
 decode(repeat('13',12),'hex'),decode(repeat('14',16),'hex'),'v1',repeat('2c',32),clock_timestamp(),clock_timestamp());
insert into public.meta_inbound_events(id,workspace_id,connection_id,webhook_delivery_id,asset_binding_id,
 external_identity_id,conversation_id,channel,event_key_hash,message_key_hash,content_hash,content_payload_ref,
 provider_occurred_at,received_at,state,review_reason,incomplete_record_id,correlation_id,created_at,updated_at) values
 ('97000000-0000-4000-8000-000000000008','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000005',
  '97000000-0000-4000-8000-000000000006','facebook',repeat('2d',32),repeat('2e',32),repeat('2b',32),
  '97000000-0000-4000-8000-000000000007',clock_timestamp(),clock_timestamp(),'review','no_match',
  '97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000004',clock_timestamp(),clock_timestamp());

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
 result:=public.read_meta_enquiry_review_authority('97000000-0000-4000-8000-000000000008',
  '91000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002',clock_timestamp());
 if result#>>'{event,incompleteRecordId}'<>'97000000-0000-4000-8000-000000000002'
  or result#>>'{payloadEnvelope,ciphertext}'<>'ZWVl' or result::text ~ 'page-019' then
  raise exception 'review authority failed'; end if;
end $$;
select 'ok 14 - active assistant reviewer gets incomplete-record link, redacted provenance and encrypted content';

do $$ begin
 begin perform public.read_meta_enquiry_review_authority('97000000-0000-4000-8000-000000000008',
  '91000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003',clock_timestamp());
  raise exception 'cross-workspace review authority read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 15 - cross-workspace reviewer cannot access encrypted enquiry content';

reset role;
update public.connector_connections set status='revoking',updated_at=clock_timestamp()
 where id='94000000-0000-4000-8000-000000000001';
insert into public.connector_revocation_jobs(id,workspace_id,connection_id,provider,state,requested_by_membership_id,
 correlation_id,attempt_count,max_attempts,scheduled_at,lease_owner,lease_expires_at,fencing_token,started_at,created_at,updated_at)
values ('98000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
 '94000000-0000-4000-8000-000000000001','meta','executing','93000000-0000-4000-8000-000000000001',
 '98000000-0000-4000-8000-000000000002',1,5,clock_timestamp(),'98000000-0000-4000-8000-000000000003',
 clock_timestamp()+interval '5 minutes',3,clock_timestamp(),clock_timestamp(),clock_timestamp());

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
 result:=public.read_meta_revocation_authority('98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000003',3,clock_timestamp());
 if result#>>'{graphVersion}'<>'v99.0' or result#>>'{loginMode}'<>'facebook-page'
  or result#>>'{selectedAssets,0,assetId}'<>'page-019'
  or result#>>'{selectedAssets,0,pageAccessToken,ciphertext}'<>'YWFh'
  or result#>>'{connectionAccessToken,ciphertext}'<>'Y2Nj' then raise exception 'revocation authority failed'; end if;
end $$;
select 'ok 16 - fenced Meta revocation returns Graph version, exact selected asset and both token envelopes';

do $$ begin
 begin perform public.read_meta_revocation_authority('98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000003',2,clock_timestamp());
  raise exception 'stale fence revocation read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 17 - stale revocation fence cannot read provider credentials';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.meta_asset_subscription_states)
   or exists(select 1 from public.twilio_real_number_uat_evidence_events) then
  raise exception 'cross-workspace evidence visible'; end if;
end $$;
select 'ok 18 - two-workspace RLS hides Meta subscription and Twilio UAT evidence';

reset role;
do $$ begin
 if exists(select 1 from public.meta_asset_subscription_events e
      where e::text ~ 'page-019|YWFh|Y2Nj')
   or exists(select 1 from public.meta_asset_subscription_states s
      where s::text ~ 'page-019|YWFh|Y2Nj') then raise exception 'raw provider/token leaked'; end if;
end $$;
select 'ok 19 - public subscription evidence contains no exact asset ID or token material';

do $$ begin
 if (select count(*) from public.meta_asset_subscription_events
      where connection_id='94000000-0000-4000-8000-000000000001')<>4
   or (select attempt_count from public.meta_asset_subscription_states
      where asset_binding_id='95000000-0000-4000-8000-000000000001')<>2 then
  raise exception 'subscription evidence cardinality failed'; end if;
end $$;
select 'ok 20 - replay creates no duplicate evidence and attempt count advances only on distinct attempts';

do $$ begin
 if not exists(select 1 from pg_constraint where conname='meta_subscription_state_event_workspace_fk')
   or not exists(select 1 from pg_constraint where conname='twilio_uat_evidence_state_job_workspace_fk') then
  raise exception 'composite workspace FK missing'; end if;
end $$;
select 'ok 21 - new projections preserve workspace through composite foreign keys';

rollback;
