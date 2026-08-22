-- Story 4.4 Meta inbound-only provider, asset, webhook and identity authority.
begin;
select '1..26';

do $$ declare target_table text; begin
  foreach target_table in array array[
    'meta_connection_authorities','meta_asset_bindings','meta_external_identities',
    'meta_conversations','meta_inbound_events','meta_normalization_jobs'
  ] loop
    if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity)
      or has_table_privilege('authenticated','public.'||target_table,'INSERT')
      or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
      or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception '0016 RLS/grant failed for %',target_table; end if;
  end loop;
end $$;
select 'ok 1 - every public Meta table forces workspace RLS and browser writes use RPCs';

do $$ begin
  if has_table_privilege('authenticated','connector_private.meta_asset_identities','SELECT')
     or has_table_privilege('authenticated','connector_private.meta_webhook_authorities','SELECT')
     or has_table_privilege('authenticated','connector_private.meta_event_identities','SELECT')
     or has_function_privilege('authenticated','public.read_meta_webhook_authority(text,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.register_meta_webhook_delivery_encrypted(text,text,text,text,boolean,jsonb,timestamptz,uuid)','EXECUTE') then
    raise exception '0016 private/service boundary failed'; end if;
end $$;
select 'ok 2 - exact asset/message IDs, encrypted content and webhook secrets remain server-only';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','71000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0016@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','71000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0016@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','71000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0016@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('72000000-0000-4000-8000-000000000001','0016 Workspace A'),
 ('72000000-0000-4000-8000-000000000002','0016 Workspace B');
select set_config('omnix.actor_user_id','71000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','owner','active'),
 ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','71000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('73000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate; set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ declare envelope jsonb:=jsonb_build_object(
 'ciphertext','YWFh','nonce',encode(decode(repeat('01',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek','YmJi',
 'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('a',64),'expiresAt',null); begin
 begin perform public.begin_meta_oauth('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'facebook-page','v99.0','https://developers.facebook.com/docs/graph-api/changelog/',repeat('1',64),clock_timestamp(),
  array['pages_manage_metadata','pages_messaging','pages_show_list'],gen_random_uuid(),repeat('2',64),repeat('3',64),
  'https://omnix.test/meta/callback','/connections',envelope,clock_timestamp()+interval '10 minutes',clock_timestamp());
  raise exception 'assistant began Meta OAuth'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 3 - assistant cannot start Business Login or create a Meta connection';

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$ declare envelope jsonb:=jsonb_build_object(
 'ciphertext','YWFh','nonce',encode(decode(repeat('01',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek','YmJi',
 'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('a',64),'expiresAt',null); started jsonb; begin
 begin perform public.begin_meta_oauth('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'facebook-page','PIN_IN_PROVIDER_STORY','https://developers.facebook.com/docs/graph-api/changelog/',repeat('1',64),clock_timestamp(),
  array['pages_manage_metadata','pages_messaging','pages_show_list'],gen_random_uuid(),repeat('2',64),repeat('3',64),
  'https://omnix.test/meta/callback','/connections',envelope,clock_timestamp()+interval '10 minutes',clock_timestamp());
  raise exception 'placeholder graph version accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.begin_meta_oauth('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'facebook-page','v99.0','https://developers.facebook.com/docs/graph-api/changelog/',repeat('1',64),clock_timestamp(),
  array['pages_manage_metadata','pages_messaging','pages_read_engagement','pages_show_list'],gen_random_uuid(),repeat('2',64),repeat('3',64),
  'https://omnix.test/meta/callback','/connections',envelope,clock_timestamp()+interval '10 minutes',clock_timestamp());
  raise exception 'extra pages_read_engagement accepted'; exception when invalid_parameter_value then null; end;
 started:=public.begin_meta_oauth('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'facebook-page','v99.0','https://developers.facebook.com/docs/graph-api/changelog/',repeat('1',64),clock_timestamp(),
  array['pages_manage_metadata','pages_messaging','pages_show_list'],'75000000-0000-4000-8000-000000000001',repeat('2',64),repeat('3',64),
  'https://omnix.test/meta/callback','/connections',envelope,clock_timestamp()+interval '10 minutes',clock_timestamp());
 perform set_config('omnix.meta_tx',started#>>'{transaction,transactionId}',true);
 if started#>>'{authority,graph_version}'<>'v99.0' or started#>>'{authority,version_source_hash}'<>repeat('1',64)
  or started#>>'{transaction,requestedScopes,2}'<>'pages_show_list' then raise exception 'reviewed Meta OAuth start failed'; end if;
end $$;
select 'ok 4 - owner must pin an explicitly reviewed numeric Graph version and the exact inbound Page scope set';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare consumed jsonb; finalized jsonb; envelope jsonb:=jsonb_build_object(
 'ciphertext','Y2Nj','nonce',encode(decode(repeat('05',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('06',16),'hex'),'base64'),'wrappedDek','ZGRk',
 'wrapNonce',encode(decode(repeat('07',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('08',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('b',64),
 'expiresAt',(clock_timestamp()+interval '60 days')::text); begin
 consumed:=public.consume_meta_oauth_transaction(repeat('2',64),'72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001',repeat('3',64),
  'https://omnix.test/meta/callback',clock_timestamp());
 finalized:=public.finalize_meta_oauth(current_setting('omnix.meta_tx')::uuid,'72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001',repeat('4',64),
  array['pages_manage_metadata','pages_messaging','pages_show_list'],true,repeat('5',64),true,repeat('6',64),
  null,envelope,'75000000-0000-4000-8000-000000000002',clock_timestamp());
 if consumed#>>'{graphVersion}'<>'v99.0' or finalized#>>'{connection,status}'<>'active'
  or finalized#>>'{authority,readiness_state}'<>'asset_selection_required'
  or finalized::text ~ 'Y2Nj' then raise exception 'Meta OAuth finalize failed'; end if;
end $$;
select 'ok 5 - service finalizes the owner/version/account-bound OAuth token without exposing ciphertext publicly';

do $$ declare discovery jsonb; staged jsonb; begin
 discovery:=public.read_meta_asset_discovery_authority('74000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001',clock_timestamp());
 staged:=public.replace_meta_eligible_assets('74000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
  jsonb_build_array(jsonb_build_object('channel','facebook','assetId','page-123','displayLabel','Judith Realty Page')),clock_timestamp());
 if discovery#>>'{accessToken,ciphertext}' is null or staged#>>'{assets,0,asset_id_hash}' is null
  or staged::text ~ 'page-123' then raise exception 'eligible asset discovery failed'; end if;
end $$;
select 'ok 6 - owner-bound server discovery stages eligible asset hashes while exact asset IDs remain private';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ begin begin
 perform public.select_meta_assets('74000000-0000-4000-8000-000000000001',repeat('7',64),
  array[(select asset_id_hash from public.meta_asset_bindings limit 1)],90,repeat('8',64),gen_random_uuid(),clock_timestamp());
 raise exception 'assistant selected Meta asset'; exception when insufficient_privilege then null; end; end $$;
select 'ok 7 - assistant cannot select or replace Meta business assets';

-- Migration 0018 adds the forward-only Page-token prerequisite. Keep this
-- legacy 0016 scenario compatible by preparing the discovered Page token
-- before exercising the unchanged owner selection contract.
reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare setup jsonb; envelope jsonb:=jsonb_build_object(
 'ciphertext','cGFnZS10b2tlbg==','nonce',encode(decode(repeat('15',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('16',16),'hex'),'base64'),'wrappedDek','a2tr',
 'wrapNonce',encode(decode(repeat('17',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('18',16),'hex'),'base64'),'kekVersion','v1',
 'aadHash',repeat('8',64),'expiresAt',null); begin
 setup:=public.read_meta_page_token_setup_state('74000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001');
 perform public.bind_meta_facebook_page_access_tokens('74000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
  jsonb_build_array(jsonb_build_object('assetIdHash',setup#>>'{assets,0,assetIdHash}',
    'expectedTokenVersion',null,'tokenHash',repeat('8',64),'expiresAt',null,'envelope',envelope)),clock_timestamp());
end $$;

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$ declare selected jsonb; begin
 selected:=public.select_meta_assets('74000000-0000-4000-8000-000000000001',repeat('7',64),
  array[(select asset_id_hash from public.meta_asset_bindings limit 1)],90,repeat('8',64),
  '75000000-0000-4000-8000-000000000003',clock_timestamp());
 if selected#>>'{authority,readiness_state}'<>'webhook_setup_required'
  or selected#>>'{selectedAssets,0,state}'<>'selected' then raise exception 'owner asset selection failed'; end if;
end $$;
select 'ok 8 - owner selects only token-bound assets from the current staged snapshot and binds retention evidence';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope jsonb:=jsonb_build_object('ciphertext','ZWVl','nonce',encode(decode(repeat('09',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('0a',16),'hex'),'base64'),'wrappedDek','ZmZm','wrapNonce',encode(decode(repeat('0b',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('0c',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('9',64),'expiresAt',null);
 bound jsonb; verified jsonb; begin
 bound:=public.bind_meta_webhook_authority('74000000-0000-4000-8000-000000000001',repeat('a',64),null,envelope,
  null,envelope||jsonb_build_object('aadHash',repeat('b',64)),repeat('c',64),gen_random_uuid(),clock_timestamp());
 verified:=public.read_meta_webhook_authority(repeat('a',64),clock_timestamp());
 perform public.confirm_meta_webhook_challenge(repeat('a',64),repeat('d',64),clock_timestamp());
 if bound#>>'{authority,readiness_state}'<>'webhook_challenge_required'
  or verified#>>'{selectedAssets,0,assetId}'<>'page-123' or verified#>>'{appSecret,ciphertext}' is null then
  raise exception 'Meta webhook bind/read failed'; end if;
end $$;
select 'ok 9 - service binds endpoint-specific encrypted app secret/verify token and confirms the challenge';

do $$ declare envelope jsonb:=jsonb_build_object('ciphertext','Z2dn','nonce',encode(decode(repeat('0d',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('0e',16),'hex'),'base64'),'wrappedDek','aGho','wrapNonce',encode(decode(repeat('0f',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('10',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('e',64),'expiresAt',null);
 event jsonb; begin
 event:=jsonb_build_array(jsonb_build_object('channel','facebook','assetId','page-123','senderId','sender-1',
  'recipientId','page-123','messageId','mid-1','providerOccurredAt',clock_timestamp(),'eventKeyHash',repeat('1a',32),
  'contentHash',repeat('1b',32),'attachmentTypes','[]'::jsonb,'envelope',envelope));
 begin perform public.register_meta_webhook_delivery_encrypted(repeat('a',64),repeat('1c',32),repeat('1d',32),
  'v99.0',false,event,clock_timestamp(),gen_random_uuid()); raise exception 'invalid signature persisted';
  exception when insufficient_privilege then null; end;
 begin perform public.register_meta_webhook_delivery_encrypted(repeat('a',64),repeat('1c',32),repeat('1d',32),
  'v98.0',true,event,clock_timestamp(),gen_random_uuid()); raise exception 'wrong version persisted';
  exception when insufficient_privilege then null; end;
 begin perform public.register_meta_webhook_delivery_encrypted(repeat('a',64),repeat('1c',32),repeat('1d',32),
  'v99.0',true,jsonb_set(event,'{0,assetId}','"attacker-page"'),clock_timestamp(),gen_random_uuid());
  raise exception 'wrong asset persisted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from connector_private.connector_payload_envelopes where payload_kind='meta-inbound-message')
  or exists(select 1 from public.meta_normalization_jobs)
  or exists(select 1 from public.meta_inbound_events)
  or exists(select 1 from public.connector_webhook_deliveries where provider='meta') then
   raise exception 'invalid ingress mutated data';
 end if;
end $$;
select 'ok 10 - invalid signature, wrong pinned version or wrong asset produces zero payload/job mutation';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope jsonb:=jsonb_build_object('ciphertext','Z2dn','nonce',encode(decode(repeat('0d',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('0e',16),'hex'),'base64'),'wrappedDek','aGho','wrapNonce',encode(decode(repeat('0f',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('10',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('e',64),'expiresAt',null);
 event jsonb; ingested jsonb; replay jsonb; begin
 event:=jsonb_build_array(jsonb_build_object('channel','facebook','assetId','page-123','senderId','sender-1',
  'recipientId','page-123','messageId','mid-1','providerOccurredAt',clock_timestamp(),'eventKeyHash',repeat('1a',32),
  'contentHash',repeat('1b',32),'attachmentTypes','[]'::jsonb,'envelope',envelope));
 ingested:=public.register_meta_webhook_delivery_encrypted(repeat('a',64),repeat('1c',32),repeat('1d',32),
  'v99.0',true,event,clock_timestamp(),'75000000-0000-4000-8000-000000000004');
 replay:=public.register_meta_webhook_delivery_encrypted(repeat('a',64),repeat('1c',32),repeat('1d',32),
  'v99.0',true,event,clock_timestamp(),gen_random_uuid());
 perform set_config('omnix.meta_job',ingested#>>'{jobs,0,id}',true);
 perform set_config('omnix.meta_event',ingested#>>'{events,0,id}',true);
 if ingested#>>'{accepted}'<>'1' or ingested#>>'{jobs,0,state}'<>'queued'
  or not (replay->>'noOp')::boolean then
   raise exception 'atomic Meta ingress/replay failed';
 end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.meta_inbound_events)<>1
  or (select count(*) from public.meta_normalization_jobs)<>1
  or (select count(*) from connector_private.connector_payload_envelopes
    where payload_kind='meta-inbound-message')<>1 then
   raise exception 'Meta ingress replay created duplicate durable rows';
 end if;
end $$;
select 'ok 11 - verified delivery atomically persists one encrypted event/job and exact replay creates no orphan payload';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare claimed jsonb; job_id uuid; fence bigint; started jsonb; authority jsonb; t timestamptz:=clock_timestamp(); begin
 claimed:=public.claim_meta_normalization_jobs('76000000-0000-4000-8000-000000000001',10,900,t);
 job_id:=(claimed#>>'{jobs,0,id}')::uuid; fence:=(claimed#>>'{jobs,0,fencing_token}')::bigint;
 started:=public.start_meta_normalization_attempt(job_id,'76000000-0000-4000-8000-000000000001',fence,t+interval '1 second');
 authority:=public.read_meta_normalization_authority(job_id,'76000000-0000-4000-8000-000000000001',fence,t+interval '2 seconds');
 perform set_config('omnix.meta_fence',fence::text,true);
 if authority#>>'{providerIdentity,messageId}'<>'mid-1' or authority#>>'{payloadEnvelope,canonicalHash}'<>repeat('1b',32)
  or authority#>>'{asset,asset_id_hash}' is null then raise exception 'fenced normalization authority failed'; end if;
end $$;
select 'ok 12 - leased worker gets exact provider identity and encrypted content only under current fence';

do $$ begin begin perform public.read_meta_normalization_authority(current_setting('omnix.meta_job')::uuid,
 '76000000-0000-4000-8000-000000000002',current_setting('omnix.meta_fence')::bigint,clock_timestamp());
 raise exception 'wrong worker read Meta content'; exception when insufficient_privilege then null; end; end $$;
select 'ok 13 - wrong worker or stale fence cannot read Meta message content or provider identity';

do $$ declare applied jsonb; begin
 applied:=public.apply_meta_normalized_enquiry(current_setting('omnix.meta_job')::uuid,
  '76000000-0000-4000-8000-000000000001',current_setting('omnix.meta_fence')::bigint,null,null,repeat('2a',32),clock_timestamp());
 if applied#>>'{outcome}'<>'review' or applied#>>'{event,review_reason}'<>'no_canonical_match'
  or applied#>>'{reviewRecord,status}'<>'pending' then raise exception 'Meta quarantine failed'; end if;
end $$;
select 'ok 14 - no trustworthy contact point creates one idempotent incomplete-review record without fabricating a Contact';

reset role;
select set_config('omnix.actor_user_id','71000000-0000-4000-8000-000000000001',true);
insert into public.contacts(id,owner_id,workspace_id,first_name,last_name,email_subscribed,lead_type,
 relationship,intent,source,pipeline_stage,tags,created_at,updated_at) values
 ('77000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'Manual','Review',true,'warm','lead','buyer','other','new','{}',now(),now());
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ declare converted jsonb; candidate jsonb; contact_input jsonb; conversion_plan jsonb; begin
 candidate:=jsonb_build_object('firstName','Meta','lastName','Converted','tags',jsonb_build_array('inbound'));
 contact_input:=public.incomplete_candidate_contact_input(candidate);
 conversion_plan:=jsonb_build_object('action','create','contactInput',contact_input,
   'changes',(select jsonb_agg(key) from jsonb_object_keys(contact_input) key));
 converted:=public.convert_incomplete_record(
   (select incomplete_record_id from public.meta_inbound_events where id=current_setting('omnix.meta_event')::uuid),
   candidate,conversion_plan,'meta-generic-create-0016','73000000-0000-4000-8000-000000000002',clock_timestamp());
 perform set_config('omnix.meta_converted_contact',converted->>'contactId',true);
 if converted#>>'{record,status}'<>'converted' or (converted->>'noOp')::boolean
    or converted->>'contactId' is null then raise exception 'generic Meta review conversion failed'; end if;
end $$;
select 'ok 15 - generic incomplete-record create converts the Meta review before provider linking';

do $$ begin
 begin
  perform public.resolve_meta_enquiry_review(current_setting('omnix.meta_event')::uuid,
   '77000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002',
   'meta-review-wrong-0016','75000000-0000-4000-8000-000000000004',clock_timestamp());
  raise exception 'different converted contact linked'; exception when unique_violation then null;
 end;
 if (select state from public.meta_inbound_events where id=current_setting('omnix.meta_event')::uuid)<>'review'
    or exists(select 1 from public.meta_external_identities where id=(select external_identity_id from public.meta_inbound_events
      where id=current_setting('omnix.meta_event')::uuid) and contact_id is not null)
    or exists(select 1 from public.meta_conversations where id=(select conversation_id from public.meta_inbound_events
      where id=current_setting('omnix.meta_event')::uuid) and contact_id is not null) then
   raise exception 'failed converted-contact mismatch mutated Meta links'; end if;
end $$;
select 'ok 16 - converted review aimed at a different contact fails with zero identity/conversation/event linkage';

do $$ declare resolved jsonb; replayed jsonb; target_contact uuid; begin
 target_contact:=current_setting('omnix.meta_converted_contact')::uuid;
 resolved:=public.resolve_meta_enquiry_review(current_setting('omnix.meta_event')::uuid,target_contact,
  '73000000-0000-4000-8000-000000000002','meta-review-0016',
  '75000000-0000-4000-8000-000000000005',clock_timestamp());
 replayed:=public.resolve_meta_enquiry_review(current_setting('omnix.meta_event')::uuid,target_contact,
  '73000000-0000-4000-8000-000000000002','meta-review-0016',
  '75000000-0000-4000-8000-000000000005',clock_timestamp());
 if resolved#>>'{event,state}'<>'linked' or resolved#>>'{externalIdentity,contact_id}'<>target_contact::text
    or resolved#>>'{conversation,contact_id}'<>target_contact::text
    or not (resolved->>'conversionPreexisting')::boolean or (resolved->>'noOp')::boolean
    or not (replayed->>'noOp')::boolean then raise exception 'converted review resolution/replay failed'; end if;
end $$;
select 'ok 17 - exact pre-converted contact links Meta event, identity and conversation; replay is a no-op';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare envelope jsonb:=jsonb_build_object('ciphertext','aWlp','nonce',encode(decode(repeat('11',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('12',16),'hex'),'base64'),'wrappedDek','ampq','wrapNonce',encode(decode(repeat('13',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('14',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('f',64),'expiresAt',null);
 event jsonb; ingested jsonb; claimed jsonb; applied jsonb; job_id uuid; fence bigint; begin
 event:=jsonb_build_array(jsonb_build_object('channel','facebook','assetId','page-123','senderId','sender-1',
  'recipientId','page-123','messageId','mid-2','providerOccurredAt',clock_timestamp()+interval '1 second',
  'eventKeyHash',repeat('2b',32),'contentHash',repeat('2c',32),'attachmentTypes','[]'::jsonb,'envelope',envelope));
 ingested:=public.register_meta_webhook_delivery_encrypted(repeat('a',64),repeat('2d',32),repeat('2e',32),
  'v99.0',true,event,clock_timestamp(),gen_random_uuid());
 claimed:=public.claim_meta_normalization_jobs('76000000-0000-4000-8000-000000000003',1,900,clock_timestamp());
 job_id:=(claimed#>>'{jobs,0,id}')::uuid; fence:=(claimed#>>'{jobs,0,fencing_token}')::bigint;
 perform public.start_meta_normalization_attempt(job_id,'76000000-0000-4000-8000-000000000003',fence,clock_timestamp());
 applied:=public.apply_meta_normalized_enquiry(job_id,'76000000-0000-4000-8000-000000000003',fence,
  null,null,repeat('2f',32),clock_timestamp());
 if applied#>>'{outcome}'<>'linked' or applied#>>'{contact,id}'<>current_setting('omnix.meta_converted_contact')
  then raise exception 'exact external identity did not remain canonical'; end if;
end $$;
select 'ok 18 - subsequent event from the exact external sender links the same Contact without name/handle matching';

reset role;
do $$ begin
 if exists(select 1 from public.connector_receipt_events where provider='meta'
    and redacted_metadata::text ~ 'page-123|sender-1|mid-1|aWlp|Z2dn')
  or exists(select 1 from public.meta_inbound_events where to_jsonb(meta_inbound_events)::text ~ 'page-123|sender-1|mid-1') then
  raise exception 'Meta raw content/identity leaked to public evidence'; end if;
end $$;
select 'ok 19 - receipts and public event state contain no raw asset/sender/message ID, signature or content';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ declare state jsonb; begin
 state:=public.read_meta_connection_state('74000000-0000-4000-8000-000000000001');
 if not (state->>'inboundOnly')::boolean or (state->>'leadAdsSupported')::boolean
  or (state->>'outboundMessagingSupported')::boolean or (state->>'reconciliationSupported')::boolean then
  raise exception 'truthful Meta capability state failed'; end if;
end $$;
select 'ok 20 - member state is explicitly inbound-only with no Lead Ads, outbound replies or invented reconciliation API';

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
do $$ begin
 if (select count(*) from public.meta_inbound_events)<>0 then raise exception 'cross-workspace Meta events visible'; end if;
 begin perform public.read_meta_connection_state('74000000-0000-4000-8000-000000000001');
  raise exception 'cross-workspace state read'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 21 - Meta state/events remain isolated across workspaces';

reset role;
update public.meta_connection_authorities set retention_days=1 where connection_id='74000000-0000-4000-8000-000000000001';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare purged jsonb; begin
 purged:=public.purge_expired_meta_content(clock_timestamp()+interval '2 days',100);
 if (purged#>>'{count}')::integer<2 then raise exception 'Meta retention cryptoshred failed'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from connector_private.connector_payload_envelopes payload
   join public.meta_inbound_events event on event.content_payload_ref=payload.id where payload.destroyed_at is null) then
   raise exception 'Meta retention envelope remains readable';
 end if;
end $$;
select 'ok 22 - bounded retention cryptoshreds encrypted message content while preserving redacted provenance';

do $$ begin
 if (select count(*) from public.meta_inbound_events)<2
  or (select count(*) from public.meta_external_identities)<>1 then raise exception 'provenance was lost'; end if;
end $$;
select 'ok 23 - content deletion preserves event, conversation, external identity and review/activity provenance';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$ declare disconnected jsonb; begin
 disconnected:=public.request_connector_disconnect('74000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000006');
 if disconnected#>>'{connection,status}'<>'revoking' then raise exception 'Meta disconnect request failed'; end if;
end $$;
select 'ok 24 - owner disconnect immediately disables new Meta ingress/normalization while generic revocation remains durable';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin begin
 perform public.read_meta_webhook_authority(repeat('a',64),clock_timestamp());
 raise exception 'revoking Meta endpoint remained writable'; exception when no_data_found or insufficient_privilege then null; end; end $$;
select 'ok 25 - revoking connection blocks endpoint authority without erasing CRM/review history';

reset role;
do $$ begin
 if (select count(*) from public.meta_inbound_events)=0 or (select count(*) from public.activity_events
  where id in (select activity_event_id from public.meta_inbound_events where activity_event_id is not null))=0
  or exists(select 1 from public.connector_action_intents where provider='meta' and action_type<>'dm.ingest') then
  raise exception 'Meta retained evidence/outbound exclusion failed'; end if;
end $$;
select 'ok 26 - retained history survives disconnect and schema contains no outbound DM or Lead Ads work';

rollback;
