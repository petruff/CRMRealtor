-- Story 4.4 HIGH follow-up: per-Page access-token authority.
begin;
select '1..18';

do $$ begin
  if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='connector_private' and relation.relname='meta_page_access_token_bindings'
        and relation.relrowsecurity and relation.relforcerowsecurity)
     or has_table_privilege('authenticated','connector_private.meta_page_access_token_bindings','SELECT')
     or has_table_privilege('service_role','connector_private.meta_page_access_token_bindings','SELECT') then
    raise exception '0018 private token table boundary failed';
  end if;
end $$;
select 'ok 1 - Page-token pointers and encrypted envelopes remain private with forced RLS';

do $$ begin
  if has_function_privilege('authenticated','public.read_meta_page_token_setup_state(uuid,uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.bind_meta_facebook_page_access_tokens(uuid,text,text,jsonb,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_meta_page_token_setup_state(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.bind_meta_facebook_page_access_tokens(uuid,text,text,jsonb,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz)','EXECUTE') then
    raise exception '0018 RPC grant boundary failed';
  end if;
end $$;
select 'ok 2 - browser roles cannot inspect versions or Page-token ciphertext and only service RPCs execute';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0018@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0018@omnix.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0018@omnix.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
 ('82000000-0000-4000-8000-000000000001','0018 Workspace A'),
 ('82000000-0000-4000-8000-000000000002','0018 Workspace B');
select set_config('omnix.actor_user_id','81000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner','active'),
 ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','81000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values
 ('83000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate; set constraints all deferred;

insert into public.connector_connections(
 id,workspace_id,provider,provider_account_key_hash,display_label,status,granted_scopes,
 remote_identity_summary,created_by_membership_id,created_at,updated_at
) values
 ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','meta',repeat('1',64),
  'Facebook owner account','active',array['pages_manage_metadata','pages_messaging','pages_show_list'],'{}',
  '83000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp()),
 ('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','meta',repeat('2',64),
  'Instagram owner account','active',array['instagram_business_basic','instagram_business_manage_messages'],'{}',
  '83000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());
insert into public.meta_connection_authorities(
 connection_id,workspace_id,login_mode,graph_version,version_source_url,version_source_hash,
 version_reviewed_at,version_approved_by_membership_id,requested_scopes,granted_scopes,account_key_hash,
 business_verified,business_verification_hash,app_review_approved,app_review_evidence_hash,
 readiness_state,enabled,created_by_membership_id,created_at,updated_at
) values
 ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','facebook-page','v99.0',
  'https://developers.facebook.com/docs/graph-api/changelog/',repeat('3',64),clock_timestamp(),
  '83000000-0000-4000-8000-000000000001',array['pages_manage_metadata','pages_messaging','pages_show_list'],
  array['pages_manage_metadata','pages_messaging','pages_show_list'],repeat('1',64),true,repeat('4',64),true,repeat('5',64),
  'asset_selection_required',true,'83000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp()),
 ('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','instagram-login','v99.0',
  'https://developers.facebook.com/docs/graph-api/changelog/',repeat('3',64),clock_timestamp(),
  '83000000-0000-4000-8000-000000000001',array['instagram_business_basic','instagram_business_manage_messages'],
  array['instagram_business_basic','instagram_business_manage_messages'],repeat('2',64),true,repeat('4',64),true,repeat('5',64),
  'asset_selection_required',true,'83000000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare staged jsonb; begin
  staged:=public.replace_meta_eligible_assets('84000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
    jsonb_build_array(
      jsonb_build_object('channel','facebook','assetId','page-001','displayLabel','Page One'),
      jsonb_build_object('channel','facebook','assetId','page-002','displayLabel','Page Two')
    ),clock_timestamp());
  if staged#>>'{snapshotHash}'<>repeat('7',64) or jsonb_array_length(staged->'assets')<>2
     or staged::text ~ 'page-001|page-002' then raise exception 'Page staging failed'; end if;
end $$;
reset role;
select 'ok 3 - eligible Page discovery stores exact IDs privately and returns only asset hashes';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare setup jsonb; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  if not (setup->>'requiresPerAssetToken')::boolean or jsonb_array_length(setup->'assets')<>2
     or (select bool_or((asset->>'hasActiveToken')::boolean) from jsonb_array_elements(setup->'assets') asset)
     or setup::text ~ 'page-001|page-002' then raise exception 'initial setup-state failed'; end if;
end $$;
select 'ok 4 - owner-bound setup reports the exact redacted Page set and no active token before bind';

do $$ begin
  begin perform public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003');
    raise exception 'cross-workspace owner inspected setup'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 5 - a cross-workspace owner cannot inspect Page-token setup state';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ begin
  begin perform public.select_meta_assets('84000000-0000-4000-8000-000000000001',repeat('7',64),
    array[(select asset_id_hash from public.meta_asset_bindings where display_label='Page One')],90,repeat('8',64),
    gen_random_uuid(),clock_timestamp());
    raise exception 'Page selected without Page token'; exception when check_violation then null; end;
end $$;
select 'ok 6 - owner cannot select a Facebook Page before its per-Page token is active';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope jsonb:=jsonb_build_object(
 'ciphertext','YWFh','nonce',encode(decode(repeat('01',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek','YmJi',
 'wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('a',64),'expiresAt',null);
 setup jsonb; one_hash text; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  one_hash:=setup#>>'{assets,0,assetIdHash}';
  begin perform public.bind_meta_facebook_page_access_tokens('84000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
    jsonb_build_array(jsonb_build_object('assetIdHash',one_hash,'expectedTokenVersion',null,
      'tokenHash',repeat('a',64),'expiresAt',null,'envelope',envelope)),clock_timestamp());
    raise exception 'partial Page token set accepted'; exception when serialization_failure then null; end;
end $$;
reset role;
do $$ begin if exists(select 1 from connector_private.meta_page_access_token_bindings) then
  raise exception 'partial Page token set mutated state'; end if; end $$;
select 'ok 7 - incomplete Page-token batches fail atomically with zero envelope mutation';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope_a jsonb:=jsonb_build_object(
 'ciphertext','YWFh','nonce',encode(decode(repeat('01',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('02',16),'hex'),'base64'),'wrappedDek','YmJi','wrapNonce',encode(decode(repeat('03',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('04',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('a',64),'expiresAt',null);
 envelope_b jsonb:=jsonb_build_object(
 'ciphertext','Y2Nj','nonce',encode(decode(repeat('05',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('06',16),'hex'),'base64'),'wrappedDek','ZGRk','wrapNonce',encode(decode(repeat('07',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('08',16),'hex'),'base64'),'kekVersion','v1','aadHash',repeat('b',64),'expiresAt',null);
 result jsonb; setup jsonb; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  result:=public.bind_meta_facebook_page_access_tokens('84000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
    (select jsonb_agg(jsonb_build_object('assetIdHash',asset->>'assetIdHash','expectedTokenVersion',null,
      'tokenHash',case ordinality when 1 then repeat('a',64) else repeat('b',64) end,
      'expiresAt',null,'envelope',case ordinality when 1 then envelope_a else envelope_b end)
      order by ordinality) from jsonb_array_elements(setup->'assets') with ordinality entry(asset,ordinality)),clock_timestamp());
  if jsonb_array_length(result->'tokens')<>2 or result#>>'{tokens,0,tokenVersion}'<>'1'
     or result::text ~ 'YWFh|Y2Nj|page-001|page-002' then raise exception 'Page token bind failed'; end if;
end $$;
select 'ok 8 - service atomically binds the exact encrypted eligible Page-token set and returns redacted version metadata';

do $$ declare setup jsonb; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  if (select count(*) from jsonb_array_elements(setup->'assets') asset
      where (asset->>'hasActiveToken')::boolean and (asset->>'tokenVersion')::integer=1)<>2 then
    raise exception 'active setup-state failed'; end if;
end $$;
select 'ok 9 - setup state exposes only current versions and active-token booleans after bind';

do $$ declare envelope jsonb:=jsonb_build_object(
 'ciphertext','ZWVl','nonce',encode(decode(repeat('09',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('0a',16),'hex'),'base64'),'wrappedDek','ZmZm','wrapNonce',encode(decode(repeat('0b',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('0c',16),'hex'),'base64'),'kekVersion','v2','aadHash',repeat('c',64),'expiresAt',null);
 setup jsonb; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  begin perform public.bind_meta_facebook_page_access_tokens('84000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
    (select jsonb_agg(jsonb_build_object('assetIdHash',asset->>'assetIdHash',
      'expectedTokenVersion',case ordinality when 1 then 99 else 1 end,
      'tokenHash',repeat('c',64),'expiresAt',null,'envelope',envelope) order by ordinality)
      from jsonb_array_elements(setup->'assets') with ordinality entry(asset,ordinality)),clock_timestamp());
    raise exception 'stale Page token CAS accepted'; exception when serialization_failure then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from connector_private.connector_payload_envelopes where payload_kind='meta-page-access-token')<>2
     or exists(select 1 from connector_private.meta_page_access_token_bindings where token_version<>1) then
    raise exception 'stale Page CAS partially mutated data'; end if;
end $$;
select 'ok 10 - one stale asset version rejects the entire Page-token rotation without partial writes';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare envelope_c jsonb:=jsonb_build_object(
 'ciphertext','ZWVl','nonce',encode(decode(repeat('09',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('0a',16),'hex'),'base64'),'wrappedDek','ZmZm','wrapNonce',encode(decode(repeat('0b',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('0c',16),'hex'),'base64'),'kekVersion','v2','aadHash',repeat('c',64),'expiresAt',null);
 envelope_d jsonb:=jsonb_build_object(
 'ciphertext','Z2dn','nonce',encode(decode(repeat('0d',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('0e',16),'hex'),'base64'),'wrappedDek','aGho','wrapNonce',encode(decode(repeat('0f',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('10',16),'hex'),'base64'),'kekVersion','v2','aadHash',repeat('d',64),'expiresAt',null);
 result jsonb; setup jsonb; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  result:=public.bind_meta_facebook_page_access_tokens('84000000-0000-4000-8000-000000000001','v99.0',repeat('7',64),
    (select jsonb_agg(jsonb_build_object('assetIdHash',asset->>'assetIdHash','expectedTokenVersion',1,
      'tokenHash',case ordinality when 1 then repeat('c',64) else repeat('d',64) end,
      'expiresAt',null,'envelope',case ordinality when 1 then envelope_c else envelope_d end)
      order by ordinality) from jsonb_array_elements(setup->'assets') with ordinality entry(asset,ordinality)),clock_timestamp());
  if (select count(*) from jsonb_array_elements(result->'tokens') token where (token->>'tokenVersion')::integer=2)<>2 then
    raise exception 'Page token rotation failed'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from connector_private.connector_payload_envelopes
      where payload_kind='meta-page-access-token' and destroyed_at is not null and ciphertext is null)<>2
     or (select count(*) from connector_private.meta_page_access_token_bindings where token_version=2 and destroyed_at is null)<>2 then
    raise exception 'old Page token cryptoshred failed'; end if;
end $$;
select 'ok 11 - exact CAS rotation cryptoshreds old envelopes while preserving current version metadata';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  perform public.replace_meta_eligible_assets('84000000-0000-4000-8000-000000000001','v99.0',repeat('8',64),
    jsonb_build_array(jsonb_build_object('channel','facebook','assetId','page-003','displayLabel','Page Three')),clock_timestamp());
end $$;
reset role;
do $$ begin
  if (select count(*) from connector_private.meta_page_access_token_bindings where destroyed_at is null)<>0
     or (select count(*) from connector_private.connector_payload_envelopes
       where payload_kind='meta-page-access-token' and destroyed_at is not null and ciphertext is null)<>4
     or (select count(*) from public.meta_asset_bindings where state='eligible' and display_label='Page Three')<>1 then
    raise exception 'discovery replacement cryptoshred failed'; end if;
end $$;
select 'ok 12 - replacing the eligible Page snapshot cryptoshreds every superseded Page token';

set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare setup jsonb; envelope jsonb:=jsonb_build_object(
 'ciphertext','aWlp','nonce',encode(decode(repeat('11',12),'hex'),'base64'),
 'authTag',encode(decode(repeat('12',16),'hex'),'base64'),'wrappedDek','ampq','wrapNonce',encode(decode(repeat('13',12),'hex'),'base64'),
 'wrapAuthTag',encode(decode(repeat('14',16),'hex'),'base64'),'kekVersion','v3','aadHash',repeat('e',64),'expiresAt',null); begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  if jsonb_array_length(setup->'assets')<>1 or setup#>>'{assets,0,state}'<>'eligible'
     or (setup#>>'{assets,0,hasActiveToken}')::boolean then raise exception 'replacement setup-state failed'; end if;
  perform public.bind_meta_facebook_page_access_tokens('84000000-0000-4000-8000-000000000001','v99.0',repeat('8',64),
    jsonb_build_array(jsonb_build_object('assetIdHash',setup#>>'{assets,0,assetIdHash}',
      'expectedTokenVersion',null,'tokenHash',repeat('e',64),'expiresAt',null,'envelope',envelope)),clock_timestamp());
  perform set_config('omnix.page_three_hash',setup#>>'{assets,0,assetIdHash}',true);
end $$;
select 'ok 13 - replacement setup is resumable and a new exact Page token can be bound with version one';

reset role; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.select_meta_assets('84000000-0000-4000-8000-000000000001',repeat('8',64),
    array[(select asset_id_hash from public.meta_asset_bindings where display_label='Page Three')],90,repeat('9',64),
    gen_random_uuid(),clock_timestamp());
    raise exception 'assistant selected Page'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ declare selected jsonb; begin
  selected:=public.select_meta_assets('84000000-0000-4000-8000-000000000001',repeat('8',64),
    array[(select asset_id_hash from public.meta_asset_bindings where display_label='Page Three')],90,repeat('9',64),
    '85000000-0000-4000-8000-000000000001',clock_timestamp());
  if selected#>>'{authority,readiness_state}'<>'webhook_setup_required'
     or selected#>>'{selectedAssets,0,state}'<>'selected' then raise exception 'owner Page selection failed'; end if;
end $$;
select 'ok 14 - assistant selection is denied and owner selection succeeds only after the Page token bind';

reset role; set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ declare authority jsonb; begin
  authority:=public.read_meta_page_subscription_authority('84000000-0000-4000-8000-000000000001',
    current_setting('omnix.page_three_hash'),
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',clock_timestamp());
  if authority#>>'{asset,assetId}'<>'page-003' or authority#>>'{pageAccessToken,tokenVersion}'<>'1'
     or authority#>>'{pageAccessToken,ciphertext}'<>'aWlp' or authority#>>'{graphVersion}'<>'v99.0' then
    raise exception 'Page subscription authority failed'; end if;
  begin perform public.read_meta_page_subscription_authority('84000000-0000-4000-8000-000000000001',
    current_setting('omnix.page_three_hash'),
    '81000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003',clock_timestamp());
    raise exception 'cross-workspace Page subscription read succeeded'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 15 - owner-bound service setup reads the selected exact Page ID and encrypted token; cross-workspace read fails';

reset role;
do $$ begin
  if exists(select 1 from public.connector_receipt_events receipt
      where receipt.workspace_id='82000000-0000-4000-8000-000000000001'
        and to_jsonb(receipt)::text ~ 'page-001|page-002|page-003|YWFh|Y2Nj|ZWVl|Z2dn|aWlp') then
    raise exception 'Page token or exact Page ID leaked to public receipt'; end if;
end $$;
select 'ok 16 - exact Page IDs, ciphertext and raw tokens never enter public receipts';

do $$ begin
  update public.connector_connections set status='revoking',updated_at=clock_timestamp()
    where id='84000000-0000-4000-8000-000000000001';
  perform set_config('omnix.connector_revocation_transition','on',true);
  update public.connector_connections set status='disconnected',disconnected_at=clock_timestamp(),updated_at=clock_timestamp()
    where id='84000000-0000-4000-8000-000000000001';
  if exists(select 1 from connector_private.meta_page_access_token_bindings where connection_id='84000000-0000-4000-8000-000000000001'
      and destroyed_at is null)
     or exists(select 1 from connector_private.connector_payload_envelopes where connection_id='84000000-0000-4000-8000-000000000001'
       and payload_kind='meta-page-access-token' and destroyed_at is null) then
    raise exception 'confirmed disconnect preserved active Page token'; end if;
end $$;
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  begin perform public.read_meta_page_subscription_authority('84000000-0000-4000-8000-000000000001',
    current_setting('omnix.page_three_hash'),
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',clock_timestamp());
    raise exception 'disconnected Page token remained readable'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 17 - confirmed disconnect cryptoshreds all Page-token material and removes subscription authority';

do $$ declare setup jsonb; begin
  setup:=public.read_meta_page_token_setup_state('84000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
  if (setup->>'requiresPerAssetToken')::boolean or setup#>>'{loginMode}'<>'instagram-login'
     or jsonb_array_length(setup->'assets')<>0 then raise exception 'Instagram token mode failed'; end if;
end $$;
select 'ok 18 - Instagram Login correctly keeps using the connection token and requires no per-asset Page token';

rollback;
