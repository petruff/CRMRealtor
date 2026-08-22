-- Omnix guided connector OAuth.
-- Adds one-screen Google workspace consent while retaining per-capability
-- authority, and transaction-versioned Mailchimp reauthorization that keeps
-- the selected audience and the last valid token active until completion.

begin;

-- Google: the guided bundle is only an onboarding aggregate. Runtime actions
-- continue to require the three existing capability rows and exact scopes.
alter table public.google_oauth_completions
  drop constraint google_oauth_completions_bundle;
alter table public.google_oauth_completions
  add constraint google_oauth_completions_bundle check (
    bundle in ('workspace-core','gmail-send','gmail-metadata','calendar-app-created')
  );

create or replace function connector_private.google_bundle_scopes(target_bundle text)
returns text[]
language sql
immutable
security definer
set search_path=''
as $$
  select case target_bundle
    when 'workspace-core' then array[
      'openid','email',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://www.googleapis.com/auth/calendar.app.created'
    ]::text[]
    when 'gmail-send' then array['openid','email','https://www.googleapis.com/auth/gmail.send']::text[]
    when 'gmail-metadata' then array['openid','email','https://www.googleapis.com/auth/gmail.metadata']::text[]
    when 'calendar-app-created' then array['openid','email','https://www.googleapis.com/auth/calendar.app.created']::text[]
    else null::text[] end;
$$;

-- Mailchimp: a new transaction may target the current connection. Existing
-- provider authority is not disabled while the user is on Mailchimp.
create or replace function public.begin_mailchimp_oauth_v2(
  target_connection_id uuid,
  target_workspace_id uuid,
  target_display_label text,
  target_correlation_id uuid,
  target_state_hash text,
  target_requested_scope_bundle text,
  target_requested_scopes text[],
  target_session_binding_hash text,
  target_redirect_uri text,
  target_safe_return_path text,
  target_pkce_ciphertext bytea,
  target_pkce_nonce bytea,
  target_pkce_auth_tag bytea,
  target_pkce_wrapped_dek bytea,
  target_pkce_wrap_nonce bytea,
  target_pkce_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_expires_at timestamptz,
  target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  no_op boolean:=false;
begin
  actor:=public.connector_current_membership(target_workspace_id,true);
  if target_connection_id is null or target_correlation_id is null
     or target_display_label is null or length(btrim(target_display_label)) not between 1 and 120
     or target_state_hash !~ '^[0-9a-f]{64}$'
     or target_session_binding_hash !~ '^[0-9a-f]{64}$'
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_requested_scope_bundle<>'mailchimp.audience-sync.v1'
     or target_requested_scopes is distinct from array['audience.sync','audience.reconcile']::text[]
     or target_redirect_uri is null or length(target_redirect_uri) not between 8 and 2048
     or target_safe_return_path !~ '^/[^/].*|^/$' or length(target_safe_return_path)>512
     or target_occurred_at is null or target_expires_at<=target_occurred_at
     or target_expires_at>target_occurred_at+interval '15 minutes'
     or octet_length(target_pkce_ciphertext)=0 or octet_length(target_pkce_nonce)<>12
     or octet_length(target_pkce_auth_tag)<>16 or octet_length(target_pkce_wrapped_dek)=0
     or octet_length(target_pkce_wrap_nonce)<>12 or octet_length(target_pkce_wrap_auth_tag)<>16 then
    raise exception 'invalid Mailchimp OAuth start request' using errcode='22023';
  end if;

  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id for update;
  if found then
    if target_connection.workspace_id<>target_workspace_id or target_connection.provider<>'mailchimp'
       or target_connection.status not in ('authorizing','active','degraded','reauthorization_required') then
      raise exception 'Mailchimp OAuth connection binding is invalid' using errcode='42501';
    end if;
  else
    insert into public.connector_connections(
      id,workspace_id,provider,display_label,status,granted_scopes,
      remote_identity_summary,created_by_membership_id
    ) values (
      target_connection_id,target_workspace_id,'mailchimp',btrim(target_display_label),
      'authorizing','{}','{}'::jsonb,actor.id
    ) returning * into target_connection;
  end if;

  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash=target_state_hash for update;
  if found then
    if target_transaction.workspace_id<>target_workspace_id
       or target_transaction.connection_id<>target_connection_id
       or target_transaction.provider<>'mailchimp'
       or target_transaction.requested_scope_bundle<>target_requested_scope_bundle
       or target_transaction.requested_scopes<>target_requested_scopes
       or target_transaction.actor_user_id<>actor.user_id
       or target_transaction.membership_id<>actor.id
       or target_transaction.session_binding_hash<>target_session_binding_hash
       or target_transaction.redirect_uri<>target_redirect_uri
       or target_transaction.safe_return_path<>target_safe_return_path
       or target_transaction.expires_at<>target_expires_at then
      raise exception 'Mailchimp OAuth start replay conflicts' using errcode='23505';
    end if;
    no_op:=true;
  else
    insert into connector_private.connector_oauth_transactions(
      workspace_id,connection_id,provider,state_hash,requested_scope_bundle,
      requested_scopes,actor_user_id,membership_id,session_binding_hash,
      redirect_uri,safe_return_path,pkce_ciphertext,pkce_nonce,pkce_auth_tag,
      pkce_wrapped_dek,pkce_wrap_nonce,pkce_wrap_auth_tag,kek_version,aad_hash,
      expires_at,created_at
    ) values (
      target_workspace_id,target_connection_id,'mailchimp',target_state_hash,
      target_requested_scope_bundle,target_requested_scopes,actor.user_id,actor.id,
      target_session_binding_hash,target_redirect_uri,target_safe_return_path,
      target_pkce_ciphertext,target_pkce_nonce,target_pkce_auth_tag,
      target_pkce_wrapped_dek,target_pkce_wrap_nonce,target_pkce_wrap_auth_tag,
      target_kek_version,target_aad_hash,target_expires_at,target_occurred_at
    ) returning * into target_transaction;
  end if;

  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_workspace_id
    and receipt.event_key='mailchimp.oauth.started:'||target_transaction.id::text;
  if not found then
    insert into public.connector_receipt_events(
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      redacted_metadata,occurred_at
    ) values (
      target_workspace_id,target_connection_id,'mailchimp','oauth.started',
      'mailchimp.oauth.started:'||target_transaction.id::text,target_correlation_id,
      jsonb_build_object('transactionId',target_transaction.id,
        'scopeBundle',target_requested_scope_bundle,'actorMembershipId',actor.id),
      target_occurred_at
    ) returning * into target_receipt;
  end if;

  return jsonb_build_object('connection',to_jsonb(target_connection),
    'oauthTransaction',jsonb_build_object(
      'transactionId',target_transaction.id,'workspaceId',target_transaction.workspace_id,
      'connectionId',target_transaction.connection_id,'provider','mailchimp',
      'requestedScopeBundle',target_transaction.requested_scope_bundle,
      'requestedScopes',target_transaction.requested_scopes,
      'safeReturnPath',target_transaction.safe_return_path,
      'expiresAt',target_transaction.expires_at,'consumedAt',target_transaction.consumed_at),
    'receipt',to_jsonb(target_receipt),'noOp',no_op);
end;
$$;

create or replace function public.consume_mailchimp_oauth_transaction_v2(
  target_state_hash text,target_workspace_id uuid,target_actor_user_id uuid,
  target_membership_id uuid,target_session_binding_hash text,target_redirect_uri text,
  target_consumed_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_access_version integer;
begin
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash=target_state_hash and transaction_row.provider='mailchimp'
  for update;
  if not found then raise exception 'Mailchimp OAuth transaction not found' using errcode='P0002'; end if;
  if target_transaction.consumed_at is not null
     or target_transaction.expires_at<=target_consumed_at
     or target_transaction.workspace_id<>target_workspace_id
     or target_transaction.actor_user_id<>target_actor_user_id
     or target_transaction.membership_id<>target_membership_id
     or target_transaction.session_binding_hash<>target_session_binding_hash
     or target_transaction.redirect_uri<>target_redirect_uri
     or target_transaction.requested_scope_bundle<>'mailchimp.audience-sync.v1'
     or target_transaction.requested_scopes is distinct from array['audience.sync','audience.reconcile']::text[]
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.user_id=target_actor_user_id and membership.role='owner'
         and membership.status='active') then
    raise exception 'Mailchimp OAuth transaction binding, expiry or replay check failed' using errcode='42501';
  end if;
  update connector_private.connector_oauth_transactions set consumed_at=target_consumed_at
  where id=target_transaction.id returning * into target_transaction;
  select secret.secret_version into target_access_version
  from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_transaction.connection_id
    and secret.secret_type='mailchimp-access-token' and secret.destroyed_at is null;
  return jsonb_build_object(
    'transactionId',target_transaction.id,'workspaceId',target_transaction.workspace_id,
    'connectionId',target_transaction.connection_id,'provider','mailchimp',
    'requestedScopeBundle',target_transaction.requested_scope_bundle,
    'requestedScopes',target_transaction.requested_scopes,
    'safeReturnPath',target_transaction.safe_return_path,
    'pkceCiphertext',encode(target_transaction.pkce_ciphertext,'base64'),
    'pkceNonce',encode(target_transaction.pkce_nonce,'base64'),
    'pkceAuthTag',encode(target_transaction.pkce_auth_tag,'base64'),
    'pkceWrappedDek',encode(target_transaction.pkce_wrapped_dek,'base64'),
    'pkceWrapNonce',encode(target_transaction.pkce_wrap_nonce,'base64'),
    'pkceWrapAuthTag',encode(target_transaction.pkce_wrap_auth_tag,'base64'),
    'kekVersion',target_transaction.kek_version,'aadHash',target_transaction.aad_hash,
    'expectedAccessSecretVersion',target_access_version,'consumedAt',target_transaction.consumed_at);
end;
$$;

create or replace function public.finalize_mailchimp_oauth_v2(
  target_transaction_id uuid,target_connection_id uuid,
  target_provider_account_key_hash text,target_granted_scopes text[],
  target_remote_identity_summary jsonb,target_ciphertext bytea,target_nonce bytea,
  target_auth_tag bytea,target_wrapped_dek bytea,target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,target_kek_version text,target_aad_hash text,
  target_expected_access_secret_version integer,target_occurred_at timestamptz,
  target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
begin
  if target_transaction_id is null or target_connection_id is null
     or target_provider_account_key_hash !~ '^[0-9a-f]{64}$'
     or target_granted_scopes is distinct from array['audience.sync','audience.reconcile']::text[]
     or target_remote_identity_summary is null or jsonb_typeof(target_remote_identity_summary)<>'object'
     or not (target_remote_identity_summary-array['accountIdHash','accountName','dataCenter'])='{}'::jsonb
     or target_remote_identity_summary->>'accountIdHash'<>target_provider_account_key_hash
     or target_remote_identity_summary->>'dataCenter' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(coalesce(target_remote_identity_summary->>'accountName','')) not between 1 and 160
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_occurred_at is null or target_correlation_id is null
     or octet_length(target_ciphertext)=0 or octet_length(target_nonce)<>12
     or octet_length(target_auth_tag)<>16 or octet_length(target_wrapped_dek)=0
     or octet_length(target_wrap_nonce)<>12 or octet_length(target_wrap_auth_tag)<>16 then
    raise exception 'invalid Mailchimp OAuth completion request' using errcode='22023';
  end if;
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.id=target_transaction_id and transaction_row.provider='mailchimp'
  for update;
  if not found or target_transaction.connection_id<>target_connection_id
     or target_transaction.consumed_at is null
     or target_transaction.requested_scope_bundle<>'mailchimp.audience-sync.v1'
     or target_transaction.requested_scopes is distinct from target_granted_scopes then
    raise exception 'consumed Mailchimp OAuth transaction required' using errcode='42501';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id for update;
  if not found or target_connection.workspace_id<>target_transaction.workspace_id
     or target_connection.provider<>'mailchimp'
     or target_connection.status not in ('authorizing','active','degraded','reauthorization_required') then
    raise exception 'current Mailchimp connection required' using errcode='42501';
  end if;
  if target_connection.provider_account_key_hash is not null
     and target_connection.provider_account_key_hash<>target_provider_account_key_hash then
    raise exception 'Mailchimp account swap requires a new connection' using errcode='42501';
  end if;

  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_connection.workspace_id
    and receipt.event_key='mailchimp.oauth.completed:'||target_transaction.id::text;
  if found then
    if target_receipt.redacted_metadata->>'accountIdHash'<>target_provider_account_key_hash then
      raise exception 'Mailchimp OAuth completion replay conflicts' using errcode='23505';
    end if;
    select secret.* into strict target_secret
    from connector_private.connector_connection_secrets secret
    where secret.connection_id=target_connection.id and secret.secret_type='mailchimp-access-token';
    return jsonb_build_object('connection',to_jsonb(target_connection),'receipt',to_jsonb(target_receipt),
      'secret',jsonb_build_object('secretId',target_secret.id,'connectionId',target_secret.connection_id,
        'secretType',target_secret.secret_type,'secretVersion',target_secret.secret_version,
        'kekVersion',target_secret.kek_version,'destroyedAt',target_secret.destroyed_at),'noOp',true);
  end if;

  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='mailchimp-access-token'
  for update;
  if found then
    if target_expected_access_secret_version is null
       or target_expected_access_secret_version<>target_secret.secret_version then
      raise exception 'Mailchimp access token version conflict' using errcode='40001';
    end if;
    update connector_private.connector_connection_secrets set
      secret_version=secret_version+1,ciphertext=target_ciphertext,nonce=target_nonce,
      auth_tag=target_auth_tag,wrapped_dek=target_wrapped_dek,wrap_nonce=target_wrap_nonce,
      wrap_auth_tag=target_wrap_auth_tag,kek_version=target_kek_version,aad_hash=target_aad_hash,
      refreshed_at=target_occurred_at,destroyed_at=null,updated_at=target_occurred_at
    where id=target_secret.id returning * into target_secret;
  else
    if target_expected_access_secret_version is not null then
      raise exception 'Mailchimp access token does not exist for expected version' using errcode='40001';
    end if;
    insert into connector_private.connector_connection_secrets(
      workspace_id,connection_id,secret_type,ciphertext,nonce,auth_tag,wrapped_dek,
      wrap_nonce,wrap_auth_tag,kek_version,aad_hash,refreshed_at
    ) values (
      target_connection.workspace_id,target_connection.id,'mailchimp-access-token',
      target_ciphertext,target_nonce,target_auth_tag,target_wrapped_dek,target_wrap_nonce,
      target_wrap_auth_tag,target_kek_version,target_aad_hash,target_occurred_at
    ) returning * into target_secret;
  end if;

  update public.connector_connections set status='active',
    provider_account_key_hash=target_provider_account_key_hash,
    granted_scopes=target_granted_scopes,
    display_label=target_remote_identity_summary->>'accountName',
    remote_identity_summary=remote_identity_summary||target_remote_identity_summary,
    last_probe_at=target_occurred_at,last_error_category=null,disconnected_at=null
  where id=target_connection.id returning * into target_connection;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'mailchimp','oauth.completed',
    'mailchimp.oauth.completed:'||target_transaction.id::text,target_correlation_id,
    jsonb_build_object('transactionId',target_transaction.id,
      'accountIdHash',target_provider_account_key_hash,
      'dataCenter',target_remote_identity_summary->>'dataCenter',
      'grantedScopes',target_granted_scopes,'secretVersion',target_secret.secret_version),
    target_occurred_at
  ) returning * into target_receipt;
  return jsonb_build_object('connection',to_jsonb(target_connection),'receipt',to_jsonb(target_receipt),
    'secret',jsonb_build_object('secretId',target_secret.id,'connectionId',target_secret.connection_id,
      'secretType',target_secret.secret_type,'secretVersion',target_secret.secret_version,
      'kekVersion',target_secret.kek_version,'destroyedAt',target_secret.destroyed_at),'noOp',false);
end;
$$;

revoke all on function public.begin_mailchimp_oauth_v2(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.consume_mailchimp_oauth_transaction_v2(text,uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.finalize_mailchimp_oauth_v2(uuid,uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_mailchimp_oauth_v2(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.consume_mailchimp_oauth_transaction_v2(text,uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.finalize_mailchimp_oauth_v2(uuid,uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,integer,timestamptz,uuid) to service_role;

commit;
