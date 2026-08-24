-- Story 3.31 rollback: restore strict all-or-nothing Google bundle completion.
begin;

create or replace function public.finalize_google_oauth(
  target_transaction_id uuid,target_workspace_id uuid,target_actor_user_id uuid,
  target_membership_id uuid,target_provider_account_key_hash text,target_account_email text,
  target_granted_scopes text[],target_expected_access_secret_version integer,
  target_access_envelope jsonb,target_expected_refresh_secret_version integer,
  target_refresh_envelope jsonb,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_connection public.connector_connections%rowtype;
  target_completion public.google_oauth_completions%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  target_refresh connector_private.connector_connection_secrets%rowtype;
  access_metadata jsonb; refresh_metadata jsonb; capabilities jsonb; policies jsonb;
  canonical_email text; canonical_scopes text[]; scopes_hash text; bundle text;
  capability_bundle text; required text[]; state_value text;
begin
  canonical_email:=public.normalize_contact_email(target_account_email);
  select array_agg(distinct scope order by scope) into canonical_scopes
  from unnest(target_granted_scopes) scope;
  if target_transaction_id is null or target_workspace_id is null
     or target_provider_account_key_hash !~ '^[0-9a-f]{64}$'
     or canonical_email is null or canonical_email<>target_account_email
     or not public.is_valid_contact_email(target_account_email) or length(canonical_email)>120
     or target_correlation_id is null or target_occurred_at is null
     or canonical_scopes is null or cardinality(canonical_scopes)<>cardinality(target_granted_scopes)
     or exists(select 1 from unnest(canonical_scopes) scope where scope not in (
       'openid','email','https://www.googleapis.com/auth/gmail.send',
       'https://www.googleapis.com/auth/gmail.metadata',
       'https://www.googleapis.com/auth/calendar.app.created'
     )) then raise exception 'invalid Google OAuth completion request' using errcode='22023'; end if;
  scopes_hash:=encode(extensions.digest(pg_catalog.convert_to(array_to_string(canonical_scopes,','),'UTF8'),'sha256'),'hex');
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.id=target_transaction_id and transaction_row.provider='google' for update;
  if not found then raise exception 'Google OAuth transaction not found' using errcode='P0002'; end if;
  bundle:=target_transaction.requested_scope_bundle;
  select completion.* into target_completion from public.google_oauth_completions completion
  where completion.transaction_id=target_transaction.id for update;
  if found then
    if target_completion.workspace_id<>target_workspace_id
       or target_completion.actor_user_id<>target_actor_user_id
       or target_completion.actor_membership_id<>target_membership_id
       or target_completion.account_key_hash<>target_provider_account_key_hash
       or target_completion.granted_scopes<>canonical_scopes then
      raise exception 'Google OAuth completion replay conflicts' using errcode='23505';
    end if;
    select connection.* into strict target_connection from public.connector_connections connection
    where connection.id=target_completion.connection_id;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_completion.workspace_id
      and receipt.event_key='google.oauth.completed:'||target_completion.transaction_id::text;
    select coalesce(jsonb_agg(to_jsonb(capability) order by capability.bundle),'[]'::jsonb)
      into capabilities from public.google_connection_capabilities capability
      where capability.connection_id=target_completion.connection_id;
    select coalesce(jsonb_agg(to_jsonb(policy) order by policy.action_type),'[]'::jsonb)
      into policies from public.connector_automation_policies policy
      where policy.workspace_id=target_completion.workspace_id
        and policy.action_type=any(array[
          case when 'https://www.googleapis.com/auth/gmail.send'=any(target_completion.granted_scopes)
            then 'gmail.send' end,
          case when 'https://www.googleapis.com/auth/gmail.metadata'=any(target_completion.granted_scopes)
            then 'gmail.sync-metadata' end,
          case when 'https://www.googleapis.com/auth/calendar.app.created'=any(target_completion.granted_scopes)
            then 'calendar.create-omnix-calendar' end,
          case when 'https://www.googleapis.com/auth/calendar.app.created'=any(target_completion.granted_scopes)
            then 'calendar.upsert-omnix-event' end,
          case when 'https://www.googleapis.com/auth/calendar.app.created'=any(target_completion.granted_scopes)
            then 'calendar.sync' end
        ]::text[]);
    return jsonb_build_object('connection',to_jsonb(target_connection),
      'transaction',jsonb_build_object('transactionId',target_completion.transaction_id,
        'bundle',target_completion.bundle,'consumedAt',target_transaction.consumed_at),
      'capabilities',capabilities,'policies',policies,'secrets',jsonb_build_object(
        'access',jsonb_build_object('secretVersion',target_completion.access_secret_version),
        'refresh',case when target_completion.refresh_secret_version is null then null
          else jsonb_build_object('secretVersion',target_completion.refresh_secret_version) end),
      'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  if target_transaction.consumed_at is null
     or target_transaction.workspace_id<>target_workspace_id
     or target_transaction.actor_user_id<>target_actor_user_id
     or target_transaction.membership_id<>target_membership_id
     or target_transaction.connection_id is null
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.user_id=target_actor_user_id and membership.role='owner'
         and membership.status='active')
     or exists(select 1 from unnest(target_transaction.requested_scopes) required_scope
       where required_scope<>all(canonical_scopes)) then
    raise exception 'consumed Google OAuth owner/scope binding required' using errcode='42501';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_transaction.connection_id and connection.workspace_id=target_workspace_id
    and connection.provider='google' for update;
  if not found or target_connection.status not in ('authorizing','active','degraded','reauthorization_required') then
    raise exception 'current Google connection required' using errcode='42501';
  end if;
  if target_connection.provider_account_key_hash is not null
     and target_connection.provider_account_key_hash<>target_provider_account_key_hash then
    raise exception 'Google account swap requires a new connection' using errcode='42501';
  end if;
  if target_access_envelope is null then
    raise exception 'encrypted Google access token required' using errcode='22023';
  end if;
  access_metadata:=connector_private.upsert_google_secret(
    target_connection.id,'google-access-token',target_expected_access_secret_version,
    target_access_envelope,target_occurred_at);
  select secret.* into target_refresh from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='google-refresh-token'
    and secret.destroyed_at is null for update;
  if target_refresh_envelope is not null then
    refresh_metadata:=connector_private.upsert_google_secret(
      target_connection.id,'google-refresh-token',target_expected_refresh_secret_version,
      target_refresh_envelope,target_occurred_at);
  elsif target_refresh.id is null then
    raise exception 'new Google connection requires an offline refresh token' using errcode='23514';
  else
    if target_expected_refresh_secret_version is not null
       and target_expected_refresh_secret_version<>target_refresh.secret_version then
      raise exception 'Google refresh token version conflict' using errcode='40001';
    end if;
    refresh_metadata:=jsonb_build_object('secretId',target_refresh.id,
      'secretType',target_refresh.secret_type,'secretVersion',target_refresh.secret_version,
      'expiresAt',target_refresh.expires_at,'kekVersion',target_refresh.kek_version);
  end if;
  update public.connector_connections set provider_account_key_hash=target_provider_account_key_hash,
    display_label=canonical_email,status='active',granted_scopes=canonical_scopes,
    remote_identity_summary=jsonb_build_object('accountKeyHash',target_provider_account_key_hash,
      'emailVerified',true),last_error_category=null,disconnected_at=null,
    updated_at=target_occurred_at
  where id=target_connection.id returning * into target_connection;
  foreach capability_bundle in array array['gmail-send','gmail-metadata','calendar-app-created'] loop
    required:=connector_private.google_bundle_scopes(capability_bundle);
    state_value:=case when not exists(select 1 from unnest(required) required_scope
      where required_scope<>all(canonical_scopes)) then 'active' else 'missing' end;
    insert into public.google_connection_capabilities(
      workspace_id,connection_id,bundle,required_scopes,granted_scopes,state,
      account_key_hash,authorized_by_membership_id,authorized_at,revoked_at,
      last_error_category,created_at,updated_at
    ) values (
      target_workspace_id,target_connection.id,capability_bundle,required,
      array(select scope from unnest(canonical_scopes) scope where scope=any(required)),
      state_value,target_provider_account_key_hash,
      case when state_value='active' then target_membership_id else null end,
      case when state_value='active' then target_occurred_at else null end,
      null,case when state_value='missing' then 'scope_missing' else null end,
      target_occurred_at,target_occurred_at
    ) on conflict on constraint google_connection_capabilities_connection_bundle_unique do update set
      required_scopes=excluded.required_scopes,granted_scopes=excluded.granted_scopes,
      state=excluded.state,account_key_hash=excluded.account_key_hash,
      authorized_by_membership_id=excluded.authorized_by_membership_id,
      authorized_at=excluded.authorized_at,revoked_at=null,
      last_error_category=excluded.last_error_category,updated_at=excluded.updated_at;
  end loop;
  policies:=connector_private.ensure_google_action_policies(target_workspace_id,target_membership_id,
    canonical_scopes,target_correlation_id,target_occurred_at);
  insert into public.google_oauth_completions(
    workspace_id,connection_id,transaction_id,bundle,account_key_hash,granted_scopes,
    granted_scopes_hash,access_secret_version,refresh_secret_version,actor_user_id,
    actor_membership_id,correlation_id,occurred_at,created_at
  ) values (
    target_workspace_id,target_connection.id,target_transaction.id,bundle,
    target_provider_account_key_hash,canonical_scopes,scopes_hash,
    (access_metadata->>'secretVersion')::integer,(refresh_metadata->>'secretVersion')::integer,
    target_actor_user_id,target_membership_id,target_correlation_id,target_occurred_at,target_occurred_at
  ) returning * into target_completion;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_workspace_id,target_connection.id,'google','oauth.completed',
    'google.oauth.completed:'||target_transaction.id::text,target_correlation_id,
    scopes_hash,jsonb_build_object('transactionId',target_transaction.id,'bundle',bundle,
      'accountKeyHash',target_provider_account_key_hash,'grantedScopes',canonical_scopes,
      'accessSecretVersion',target_completion.access_secret_version,
      'refreshSecretVersion',target_completion.refresh_secret_version),target_occurred_at
  ) returning * into target_receipt;
  select coalesce(jsonb_agg(to_jsonb(capability) order by capability.bundle),'[]'::jsonb)
    into capabilities from public.google_connection_capabilities capability
    where capability.connection_id=target_connection.id;
  return jsonb_build_object('connection',to_jsonb(target_connection),
    'transaction',jsonb_build_object('transactionId',target_transaction.id,
      'bundle',bundle,'consumedAt',target_transaction.consumed_at),
    'capabilities',capabilities,'policies',policies,'secrets',jsonb_build_object(
      'access',access_metadata,'refresh',refresh_metadata),
    'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

revoke all on function public.finalize_google_oauth(uuid,uuid,uuid,uuid,text,text,text[],integer,
  jsonb,integer,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.finalize_google_oauth(uuid,uuid,uuid,uuid,text,text,text[],integer,
  jsonb,integer,jsonb,uuid,timestamptz) to service_role;

commit;
