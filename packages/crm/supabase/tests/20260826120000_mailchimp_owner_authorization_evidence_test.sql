begin;

select '1..5';

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('00000000-0000-0000-0000-000000000000','26120000-0000-4000-8000-000000000001',
 'authenticated','authenticated','mailchimp-owner-proof@omnix.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','26120000-0000-4000-8000-000000000002',
 'authenticated','authenticated','mailchimp-viewer-proof@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name) values
('26120000-0000-4000-8000-000000000010','Mailchimp owner proof workspace');

select set_config('omnix.actor_user_id','26120000-0000-4000-8000-000000000001',true);

insert into public.workspace_members(id,workspace_id,user_id,role,status) values
('26120000-0000-4000-8000-000000000011','26120000-0000-4000-8000-000000000010',
 '26120000-0000-4000-8000-000000000001','owner','active'),
('26120000-0000-4000-8000-000000000012','26120000-0000-4000-8000-000000000010',
 '26120000-0000-4000-8000-000000000002','assistant','active');

insert into public.connector_connections(
  id,workspace_id,provider,provider_account_key_hash,display_label,status,
  granted_scopes,remote_identity_summary,last_probe_at,created_by_membership_id
) values (
  '26120000-0000-4000-8000-000000000020','26120000-0000-4000-8000-000000000010',
  'mailchimp',repeat('a',64),'Mailchimp proof','active',
  array['audience.sync','audience.reconcile']::text[],
  jsonb_build_object('accountIdHash',repeat('a',64)),
  '2026-08-26T11:00:00Z','26120000-0000-4000-8000-000000000011'
);

insert into public.connector_receipt_events(
  workspace_id,connection_id,provider,event_type,event_key,correlation_id,
  redacted_metadata,occurred_at
) values (
  '26120000-0000-4000-8000-000000000010','26120000-0000-4000-8000-000000000020',
  'mailchimp','oauth.completed','oauth.completed:26120000-0000-4000-8000-000000000020',
  '26120000-0000-4000-8000-000000000030',
  jsonb_build_object('grantedScopes',array['audience.sync','audience.reconcile']::text[]),
  '2026-08-26T10:00:00Z'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','26120000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select case when not public.read_mailchimp_owner_authorization_evidence(
  '26120000-0000-4000-8000-000000000020'
) then 'ok 1 - creator identity plus an arbitrary OAuth receipt stays ambiguous'
else 'not ok 1 - ambiguous history became authorized' end;

reset role;

insert into connector_private.connector_oauth_transactions(
  id,workspace_id,connection_id,provider,state_hash,requested_scope_bundle,
  requested_scopes,actor_user_id,membership_id,session_binding_hash,
  redirect_uri,safe_return_path,pkce_ciphertext,pkce_nonce,pkce_auth_tag,
  pkce_wrapped_dek,pkce_wrap_nonce,pkce_wrap_auth_tag,kek_version,aad_hash,
  expires_at,consumed_at,created_at
) values (
  '26120000-0000-4000-8000-000000000040','26120000-0000-4000-8000-000000000010',
  '26120000-0000-4000-8000-000000000020','mailchimp',repeat('b',64),
  'mailchimp.audience-sync.v1',array['audience.sync','audience.reconcile']::text[],
  '26120000-0000-4000-8000-000000000001','26120000-0000-4000-8000-000000000011',
  repeat('c',64),'https://crm.omnix.test/callback','/connections',decode('01','hex'),
  decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),decode('04','hex'),
  decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),'proof-kek',repeat('d',64),
  '2026-08-26T11:15:00Z','2026-08-26T11:00:00Z','2026-08-26T10:55:00Z'
);

insert into public.connector_receipt_events(
  workspace_id,connection_id,provider,event_type,event_key,correlation_id,
  redacted_metadata,occurred_at
) values (
  '26120000-0000-4000-8000-000000000010','26120000-0000-4000-8000-000000000020',
  'mailchimp','oauth.completed','mailchimp.oauth.completed:26120000-0000-4000-8000-000000000040',
  '26120000-0000-4000-8000-000000000031',
  jsonb_build_object(
    'transactionId','26120000-0000-4000-8000-000000000040',
    'accountIdHash',repeat('a',64),
    'grantedScopes',array['audience.sync','audience.reconcile']::text[]
  ),'2026-08-26T11:01:00Z'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','26120000-0000-4000-8000-000000000001',true);

select case when public.read_mailchimp_owner_authorization_evidence(
  '26120000-0000-4000-8000-000000000020'
) then 'ok 2 - guided completion is bound to the current canonical owner'
else 'not ok 2 - canonical owner proof was rejected' end;

select set_config('request.jwt.claim.sub','26120000-0000-4000-8000-000000000002',true);
select case when public.read_mailchimp_owner_authorization_evidence(
  '26120000-0000-4000-8000-000000000020'
) then 'ok 3 - active workspace viewers receive the same read-only proof'
else 'not ok 3 - read-only viewer could not read safe proof' end;

reset role;
insert into public.connector_receipt_events(
  workspace_id,connection_id,provider,event_type,event_key,correlation_id,
  redacted_metadata,occurred_at
) values (
  '26120000-0000-4000-8000-000000000010','26120000-0000-4000-8000-000000000020',
  'mailchimp','oauth.completed','oauth.completed:late:26120000-0000-4000-8000-000000000020',
  '26120000-0000-4000-8000-000000000032','{}'::jsonb,'2026-08-26T11:02:00Z'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','26120000-0000-4000-8000-000000000002',true);
select case when not public.read_mailchimp_owner_authorization_evidence(
  '26120000-0000-4000-8000-000000000020'
) then 'ok 4 - a newer ambiguous completion invalidates older guided evidence'
else 'not ok 4 - older guided evidence overrode newer ambiguous history' end;

select case when not has_function_privilege(
  'anon','public.read_mailchimp_owner_authorization_evidence(uuid)','execute'
) then 'ok 5 - anonymous callers cannot read connector authority proof'
else 'not ok 5 - anonymous execute privilege is present' end;

rollback;
