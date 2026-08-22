-- Omnix — Facebook Page access-token authority
-- Story 4.4 HIGH follow-up. Apply after 0017.
--
-- Business Login returns a user token plus one Page access token per eligible
-- Page. Migration 0016 stores only the connection/user token. This forward
-- migration binds encrypted Page tokens to eligible/selected Page assets.

begin;

create table connector_private.meta_page_access_token_bindings (
  asset_binding_id     uuid primary key,
  workspace_id         uuid not null references public.workspaces(id) on delete restrict,
  connection_id        uuid not null,
  token_payload_ref    uuid not null,
  token_version        integer not null,
  token_hash           text not null,
  expires_at           timestamptz,
  bound_at             timestamptz not null,
  destroyed_at         timestamptz,
  updated_at           timestamptz not null,
  constraint meta_page_token_binding_workspace_fk
    foreign key(asset_binding_id,workspace_id) references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_page_token_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_page_token_payload_workspace_fk
    foreign key(token_payload_ref,workspace_id) references connector_private.connector_payload_envelopes(id,workspace_id) on delete restrict,
  constraint meta_page_token_values check (
    token_version>0 and token_hash ~ '^[0-9a-f]{64}$'
    and (expires_at is null or expires_at>bound_at)
    and (destroyed_at is null or destroyed_at>=bound_at)
  )
);

create index meta_page_tokens_connection_active_idx
  on connector_private.meta_page_access_token_bindings(connection_id,asset_binding_id)
  where destroyed_at is null;

alter table connector_private.meta_page_access_token_bindings enable row level security;
alter table connector_private.meta_page_access_token_bindings force row level security;
revoke all on table connector_private.meta_page_access_token_bindings from public,anon,authenticated,service_role;

create or replace function connector_private.meta_page_token_payload_json(
  target_binding connector_private.meta_page_access_token_bindings,
  target_payload connector_private.connector_payload_envelopes
)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('payloadRef',target_payload.id,'payloadKind',target_payload.payload_kind,
    'schemaVersion',target_payload.schema_version,'canonicalHash',target_payload.canonical_hash,
    'tokenVersion',target_binding.token_version,'ciphertext',encode(target_payload.ciphertext,'base64'),
    'nonce',encode(target_payload.nonce,'base64'),'authTag',encode(target_payload.auth_tag,'base64'),
    'wrappedDek',encode(target_payload.wrapped_dek,'base64'),'wrapNonce',encode(target_payload.wrap_nonce,'base64'),
    'wrapAuthTag',encode(target_payload.wrap_auth_tag,'base64'),'kekVersion',target_payload.kek_version,
    'aadHash',target_payload.aad_hash,'envelopeVersion',target_payload.envelope_version,
    'expiresAt',target_binding.expires_at)
$$;

create or replace function connector_private.destroy_meta_page_token(
  target_asset_binding_id uuid,target_destroyed_at timestamptz
)
returns boolean language plpgsql security definer set search_path='' as $$
declare binding connector_private.meta_page_access_token_bindings%rowtype; effective_destroyed_at timestamptz;
begin
  select token.* into binding from connector_private.meta_page_access_token_bindings token
  where token.asset_binding_id=target_asset_binding_id for update;
  if not found or binding.destroyed_at is not null then return false; end if;
  -- The connector update guard normalizes updated_at with transaction_timestamp().
  -- A token may have been bound later in that same transaction using
  -- clock_timestamp(), so never let cryptoshred evidence predate the binding.
  effective_destroyed_at:=greatest(target_destroyed_at,binding.bound_at);
  update connector_private.connector_payload_envelopes set ciphertext=null,nonce=null,auth_tag=null,
    wrapped_dek=null,wrap_nonce=null,wrap_auth_tag=null,destroyed_at=effective_destroyed_at,updated_at=effective_destroyed_at
  where id=binding.token_payload_ref and destroyed_at is null;
  update connector_private.meta_page_access_token_bindings set destroyed_at=effective_destroyed_at,
    updated_at=effective_destroyed_at where asset_binding_id=binding.asset_binding_id;
  return true;
end;
$$;

create or replace function public.read_meta_page_token_setup_state(
  target_connection_id uuid,target_authenticated_user_id uuid,target_membership_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; authority public.meta_connection_authorities%rowtype;
 assets jsonb;
begin
  select c.* into connection from public.connector_connections c
  where c.id=target_connection_id and c.provider='meta';
  if not found or not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active owner Meta Page-token setup binding required' using errcode='42501'; end if;
  select a.* into strict authority from public.meta_connection_authorities a where a.connection_id=connection.id;
  if authority.login_mode<>'facebook-page' then
    return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,
      'loginMode',authority.login_mode,'graphVersion',authority.graph_version,
      'snapshotHash',authority.eligibility_snapshot_hash,'requiresPerAssetToken',false,'assets','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bindingId',asset.id,'assetIdHash',asset.asset_id_hash,
    'state',asset.state,'tokenVersion',token.token_version,
    'hasActiveToken',token.asset_binding_id is not null and token.destroyed_at is null
      and (token.expires_at is null or token.expires_at>clock_timestamp())
      and payload.destroyed_at is null and payload.payload_kind='meta-page-access-token'
      and payload.schema_version='meta-page-access-token.v1'
      and payload.canonical_hash=token.token_hash)
    order by asset.state,asset.id),'[]'::jsonb) into assets
  from public.meta_asset_bindings asset
  left join connector_private.meta_page_access_token_bindings token on token.asset_binding_id=asset.id
  left join connector_private.connector_payload_envelopes payload on payload.id=token.token_payload_ref
  where asset.connection_id=connection.id and asset.state in ('eligible','selected');
  return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,
    'loginMode',authority.login_mode,'graphVersion',authority.graph_version,
    'snapshotHash',authority.eligibility_snapshot_hash,'requiresPerAssetToken',true,'assets',assets);
end;
$$;

create or replace function public.bind_meta_facebook_page_access_tokens(
  target_connection_id uuid,target_graph_version text,target_snapshot_hash text,
  target_token_bindings jsonb,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; authority public.meta_connection_authorities%rowtype;
 item jsonb; asset public.meta_asset_bindings%rowtype; existing connector_private.meta_page_access_token_bindings%rowtype;
 payload connector_private.connector_payload_envelopes%rowtype; token_expires_at timestamptz;
 next_version integer; result jsonb:='[]'::jsonb; expected_count integer;
begin
  if target_snapshot_hash !~ '^[0-9a-f]{64}$' or target_occurred_at is null
     or jsonb_typeof(target_token_bindings)<>'array'
     or jsonb_array_length(target_token_bindings) not between 1 and 20 then
    raise exception 'invalid Meta Page-token batch' using errcode='22023'; end if;
  select c.* into connection from public.connector_connections c
  where c.id=target_connection_id and c.provider='meta' and c.status in ('active','degraded') for update;
  if not found then raise exception 'active Meta connection required' using errcode='42501'; end if;
  select a.* into authority from public.meta_connection_authorities a
  where a.connection_id=connection.id and a.login_mode='facebook-page' and a.enabled
    and a.graph_version=target_graph_version and a.eligibility_snapshot_hash=target_snapshot_hash for update;
  if not found then raise exception 'current Facebook Page discovery snapshot required' using errcode='42501'; end if;
  select count(*) into expected_count from public.meta_asset_bindings candidate
  where candidate.connection_id=connection.id and candidate.channel='facebook'
    and candidate.state in ('eligible','selected') and candidate.eligibility_snapshot_hash=target_snapshot_hash;
  if expected_count<>jsonb_array_length(target_token_bindings)
     or (select count(distinct value->>'assetIdHash') from jsonb_array_elements(target_token_bindings) value)
       <>jsonb_array_length(target_token_bindings) then
    raise exception 'exact eligible Facebook Page token set required' using errcode='40001'; end if;

  -- Validate the complete batch before mutating any token envelope.
  for item in select value from jsonb_array_elements(target_token_bindings) value loop
    if item ?& array['assetIdHash','expectedTokenVersion','tokenHash','expiresAt','envelope'] is false
       or item-array['assetIdHash','expectedTokenVersion','tokenHash','expiresAt','envelope']::text[]<>'{}'::jsonb
       or item->>'assetIdHash' !~ '^[0-9a-f]{64}$' or item->>'tokenHash' !~ '^[0-9a-f]{64}$'
       or not connector_private.meta_envelope_is_valid(item->'envelope',false) then
      raise exception 'invalid Meta Page token binding item' using errcode='22023'; end if;
    token_expires_at:=case when jsonb_typeof(item->'expiresAt')='null' then null
      else (item->>'expiresAt')::timestamptz end;
    if token_expires_at is not null and token_expires_at<=target_occurred_at then
      raise exception 'expired Meta Page token rejected' using errcode='22023'; end if;
    select candidate.* into asset from public.meta_asset_bindings candidate
    where candidate.connection_id=connection.id and candidate.channel='facebook'
      and candidate.state in ('eligible','selected') and candidate.eligibility_snapshot_hash=target_snapshot_hash
      and candidate.asset_id_hash=item->>'assetIdHash';
    if not found then raise exception 'eligible Facebook Page binding not found' using errcode='40001'; end if;
    select token.* into existing from connector_private.meta_page_access_token_bindings token
    where token.asset_binding_id=asset.id;
    if (existing.asset_binding_id is null and jsonb_typeof(item->'expectedTokenVersion')<>'null')
       or (existing.asset_binding_id is not null and
         (jsonb_typeof(item->'expectedTokenVersion')='null'
          or (item->>'expectedTokenVersion')::integer<>existing.token_version)) then
      raise exception 'Meta Page token version conflict' using errcode='40001'; end if;
  end loop;

  for item in select value from jsonb_array_elements(target_token_bindings) value loop
    select candidate.* into strict asset from public.meta_asset_bindings candidate
    where candidate.connection_id=connection.id and candidate.channel='facebook'
      and candidate.state in ('eligible','selected') and candidate.eligibility_snapshot_hash=target_snapshot_hash
      and candidate.asset_id_hash=item->>'assetIdHash';
    select token.* into existing from connector_private.meta_page_access_token_bindings token
    where token.asset_binding_id=asset.id for update;
    next_version:=coalesce(existing.token_version,0)+1;
    token_expires_at:=case when jsonb_typeof(item->'expiresAt')='null' then null
      else (item->>'expiresAt')::timestamptz end;
    if existing.asset_binding_id is not null and existing.destroyed_at is null then
      perform connector_private.destroy_meta_page_token(asset.id,target_occurred_at);
    end if;
    insert into connector_private.connector_payload_envelopes(
      workspace_id,connection_id,payload_kind,schema_version,canonical_hash,ciphertext,nonce,auth_tag,
      wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,created_at,updated_at
    ) values (
      connection.workspace_id,connection.id,'meta-page-access-token','meta-page-access-token.v1',item->>'tokenHash',
      decode(item#>>'{envelope,ciphertext}','base64'),decode(item#>>'{envelope,nonce}','base64'),
      decode(item#>>'{envelope,authTag}','base64'),decode(item#>>'{envelope,wrappedDek}','base64'),
      decode(item#>>'{envelope,wrapNonce}','base64'),decode(item#>>'{envelope,wrapAuthTag}','base64'),
      item#>>'{envelope,kekVersion}',item#>>'{envelope,aadHash}',target_occurred_at,target_occurred_at
    ) returning * into payload;
    insert into connector_private.meta_page_access_token_bindings(
      asset_binding_id,workspace_id,connection_id,token_payload_ref,token_version,token_hash,
      expires_at,bound_at,destroyed_at,updated_at
    ) values (asset.id,connection.workspace_id,connection.id,payload.id,next_version,item->>'tokenHash',
      token_expires_at,target_occurred_at,null,target_occurred_at)
    on conflict(asset_binding_id) do update set token_payload_ref=excluded.token_payload_ref,
      token_version=excluded.token_version,token_hash=excluded.token_hash,expires_at=excluded.expires_at,
      bound_at=excluded.bound_at,destroyed_at=null,updated_at=excluded.updated_at
    returning * into existing;
    result:=result||jsonb_build_array(jsonb_build_object('bindingId',asset.id,
      'assetIdHash',asset.asset_id_hash,'tokenVersion',existing.token_version,
      'expiresAt',existing.expires_at));
  end loop;
  return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,
    'graphVersion',authority.graph_version,'snapshotHash',target_snapshot_hash,'tokens',result);
end;
$$;

create or replace function public.read_meta_page_subscription_authority(
  target_connection_id uuid,target_asset_id_hash text,target_authenticated_user_id uuid,
  target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; authority public.meta_connection_authorities%rowtype;
 asset public.meta_asset_bindings%rowtype; identity connector_private.meta_asset_identities%rowtype;
 token connector_private.meta_page_access_token_bindings%rowtype;
 payload connector_private.connector_payload_envelopes%rowtype;
begin
  if target_asset_id_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid Facebook Page hash' using errcode='22023'; end if;
  select c.* into connection from public.connector_connections c
  where c.id=target_connection_id and c.provider='meta' and c.status in ('active','degraded');
  if not found or not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active owner Meta Page subscription binding required' using errcode='42501'; end if;
  select a.* into authority from public.meta_connection_authorities a
  where a.connection_id=connection.id and a.login_mode='facebook-page' and a.enabled
    and a.app_review_approved and a.business_verified
    and a.readiness_state in ('webhook_setup_required','webhook_challenge_required','active','degraded');
  if not found then raise exception 'Facebook Page subscription authority unavailable' using errcode='42501'; end if;
  select binding.* into asset from public.meta_asset_bindings binding
  where binding.connection_id=connection.id and binding.channel='facebook'
    and binding.asset_id_hash=target_asset_id_hash and binding.state='selected';
  if not found then raise exception 'selected Facebook Page unavailable' using errcode='P0002'; end if;
  select exact.* into strict identity from connector_private.meta_asset_identities exact
  where exact.asset_binding_id=asset.id;
  select binding.* into token from connector_private.meta_page_access_token_bindings binding
  where binding.asset_binding_id=asset.id and binding.connection_id=connection.id
    and binding.destroyed_at is null and (binding.expires_at is null or binding.expires_at>target_now);
  if not found then raise exception 'Facebook Page access token unavailable' using errcode='P0002'; end if;
  select envelope.* into payload from connector_private.connector_payload_envelopes envelope
  where envelope.id=token.token_payload_ref and envelope.workspace_id=connection.workspace_id
    and envelope.connection_id=connection.id and envelope.payload_kind='meta-page-access-token'
    and envelope.schema_version='meta-page-access-token.v1' and envelope.canonical_hash=token.token_hash
    and envelope.destroyed_at is null;
  if not found then raise exception 'Facebook Page token envelope unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,
    'graphVersion',authority.graph_version,'asset',jsonb_build_object('bindingId',asset.id,
      'assetIdHash',asset.asset_id_hash,'assetId',identity.asset_id,'displayLabel',asset.display_label),
    'pageAccessToken',connector_private.meta_page_token_payload_json(token,payload));
end;
$$;

create or replace function public.guard_meta_selected_page_token()
returns trigger language plpgsql security definer set search_path='' as $$
declare authority public.meta_connection_authorities%rowtype;
begin
  if new.channel='facebook' and new.state='selected' and old.state<>'selected' then
    select a.* into strict authority from public.meta_connection_authorities a where a.connection_id=new.connection_id;
    if authority.login_mode<>'facebook-page' or not exists(
      select 1 from connector_private.meta_page_access_token_bindings token
      join connector_private.connector_payload_envelopes payload on payload.id=token.token_payload_ref
      where token.asset_binding_id=new.id and token.connection_id=new.connection_id
        and token.destroyed_at is null and (token.expires_at is null or token.expires_at>clock_timestamp())
        and payload.destroyed_at is null and payload.payload_kind='meta-page-access-token'
        and payload.schema_version='meta-page-access-token.v1'
        and payload.canonical_hash=token.token_hash
    ) then raise exception 'active per-Page access token required before selection' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.destroy_meta_page_token_on_asset_removal()
returns trigger language plpgsql security definer set search_path='' as $$
declare connection_status public.connector_connection_status;
begin
  if new.channel='facebook' and new.state='removed' and old.state<>'removed' then
    select status into connection_status from public.connector_connections where id=new.connection_id;
    -- disconnected_unconfirmed deliberately preserves token ciphertext for
    -- manual provider recovery; every authority read still rejects that state.
    if connection_status<>'disconnected_unconfirmed' then
      perform connector_private.destroy_meta_page_token(new.id,new.updated_at);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.destroy_meta_page_tokens_on_confirmed_disconnect()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate record;
begin
  if new.provider='meta' and new.status is distinct from old.status and new.status='disconnected' then
    for candidate in select token.asset_binding_id from connector_private.meta_page_access_token_bindings token
      where token.connection_id=new.id and token.destroyed_at is null
    loop perform connector_private.destroy_meta_page_token(candidate.asset_binding_id,new.updated_at); end loop;
  end if;
  return new;
end;
$$;

create trigger meta_asset_bindings_require_page_token
  before update on public.meta_asset_bindings
  for each row execute function public.guard_meta_selected_page_token();
create trigger meta_asset_bindings_destroy_page_token
  after update on public.meta_asset_bindings
  for each row execute function public.destroy_meta_page_token_on_asset_removal();
create trigger connector_connections_destroy_meta_page_tokens
  after update on public.connector_connections
  for each row execute function public.destroy_meta_page_tokens_on_confirmed_disconnect();

revoke all on function connector_private.meta_page_token_payload_json(
  connector_private.meta_page_access_token_bindings,connector_private.connector_payload_envelopes
) from public,anon,authenticated,service_role;
revoke all on function connector_private.destroy_meta_page_token(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_meta_page_token_setup_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.bind_meta_facebook_page_access_tokens(uuid,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.guard_meta_selected_page_token() from public,anon,authenticated,service_role;
revoke all on function public.destroy_meta_page_token_on_asset_removal() from public,anon,authenticated,service_role;
revoke all on function public.destroy_meta_page_tokens_on_confirmed_disconnect() from public,anon,authenticated,service_role;

grant execute on function public.read_meta_page_token_setup_state(uuid,uuid,uuid) to service_role;
grant execute on function public.bind_meta_facebook_page_access_tokens(uuid,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz) to service_role;

comment on table connector_private.meta_page_access_token_bindings is
  'Private current Page-token pointer/version. Ciphertext stays in the generic payload envelope so Story 3.5 KEK rewrap remains available.';
comment on function public.bind_meta_facebook_page_access_tokens(uuid,text,text,jsonb,timestamptz) is
  'Service-only exact-snapshot batch CAS. Encrypted plaintext schema is meta-page-access-token.v1 and must bind connection, asset and token version.';
comment on function public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz) is
  'Owner-bound service read for selected Page webhook subscription/setup; never callable by browser roles.';

commit;
