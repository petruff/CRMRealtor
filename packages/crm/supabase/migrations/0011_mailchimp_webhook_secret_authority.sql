-- Omnix — per-connection Mailchimp webhook signing-secret authority
-- Story 4.1 AC5/7/8: bind the one-time provider signing secret to an opaque
-- endpoint and selected audience, keep the envelope server-only, and provide
-- a non-webhook baseline reconciliation seam. No plaintext secret, raw email,
-- signature or provider body is persisted by this migration.

begin;

alter table connector_private.connector_webhook_bindings
  add column remote_webhook_id_hash text,
  add column updated_at timestamptz not null default now();

alter table connector_private.connector_webhook_bindings
  add constraint connector_webhook_bindings_remote_webhook_id_hash check (
    remote_webhook_id_hash is null
    or remote_webhook_id_hash ~ '^[0-9a-f]{64}$'
  );

comment on column connector_private.connector_webhook_bindings.remote_webhook_id_hash is
  'SHA-256-style hash of the provider webhook ID; the provider ID itself is never persisted.';
comment on column connector_private.connector_webhook_bindings.endpoint_key_hash is
  'Hash of the opaque inbound endpoint key; the endpoint bearer value is never persisted.';

alter table public.mailchimp_sync_evidence
  drop constraint mailchimp_sync_evidence_origin;

alter table public.mailchimp_sync_evidence
  add constraint mailchimp_sync_evidence_origin check (
    origin in (
      'mailchimp-webhook',
      'outbound-job',
      'reconciliation',
      'baseline-reconciliation'
    )
  );

create or replace function public.bind_mailchimp_webhook_secret(
  target_connection_id uuid,
  target_endpoint_key_hash text,
  target_expected_secret_version integer,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_webhook_id_hash text,
  target_occurred_at timestamptz,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_audience public.mailchimp_audience_bindings%rowtype;
  target_endpoint connector_private.connector_webhook_bindings%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
  confirmation jsonb;
  endpoint_unchanged boolean := false;
  secret_unchanged boolean := false;
begin
  if target_connection_id is null
     or target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
     or target_expected_secret_version is not null
       and target_expected_secret_version <= 0
     or target_ciphertext is null or octet_length(target_ciphertext) = 0
     or target_nonce is null or octet_length(target_nonce) <> 12
     or target_auth_tag is null or octet_length(target_auth_tag) <> 16
     or target_wrapped_dek is null or octet_length(target_wrapped_dek) = 0
     or target_wrap_nonce is null or octet_length(target_wrap_nonce) <> 12
     or target_wrap_auth_tag is null or octet_length(target_wrap_auth_tag) <> 16
     or target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_webhook_id_hash !~ '^[0-9a-f]{64}$'
     or target_occurred_at is null
     or target_correlation_id is null then
    raise exception 'invalid Mailchimp webhook secret binding'
      using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
    and connection.provider = 'mailchimp'
    and connection.status in ('active', 'degraded')
  for update;

  if not found then
    raise exception 'active Mailchimp connection not found'
      using errcode = 'P0002';
  end if;

  select binding.* into target_audience
  from public.mailchimp_audience_bindings binding
  where binding.connection_id = target_connection.id
    and binding.workspace_id = target_connection.workspace_id
    and binding.replaced_at is null
  for update;

  if not found then
    raise exception 'active selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  select binding.* into target_endpoint
  from connector_private.connector_webhook_bindings binding
  where binding.connection_id = target_connection.id
  for update;

  if found then
    endpoint_unchanged := target_endpoint.workspace_id = target_connection.workspace_id
      and target_endpoint.provider = 'mailchimp'
      and target_endpoint.endpoint_key_hash = target_endpoint_key_hash
      and target_endpoint.remote_webhook_id_hash = target_webhook_id_hash
      and target_endpoint.revoked_at is null;

    if not endpoint_unchanged then
      update connector_private.connector_webhook_bindings
         set workspace_id = target_connection.workspace_id,
             provider = 'mailchimp',
             endpoint_key_hash = target_endpoint_key_hash,
             remote_webhook_id_hash = target_webhook_id_hash,
             revoked_at = null,
             updated_at = target_occurred_at
       where id = target_endpoint.id
       returning * into target_endpoint;
    end if;
  else
    insert into connector_private.connector_webhook_bindings (
      workspace_id, connection_id, provider, endpoint_key_hash,
      remote_webhook_id_hash, created_at, updated_at
    ) values (
      target_connection.workspace_id, target_connection.id, 'mailchimp',
      target_endpoint_key_hash, target_webhook_id_hash,
      target_occurred_at, target_occurred_at
    )
    returning * into target_endpoint;
  end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection.id
    and secret.workspace_id = target_connection.workspace_id
    and secret.secret_type = 'mailchimp-webhook-signing-secret'
  for update;

  if found then
    secret_unchanged := target_secret.destroyed_at is null
      and target_secret.ciphertext = target_ciphertext
      and target_secret.nonce = target_nonce
      and target_secret.auth_tag = target_auth_tag
      and target_secret.wrapped_dek = target_wrapped_dek
      and target_secret.wrap_nonce = target_wrap_nonce
      and target_secret.wrap_auth_tag = target_wrap_auth_tag
      and target_secret.kek_version = target_kek_version
      and target_secret.aad_hash = target_aad_hash;

    if secret_unchanged then
      if target_expected_secret_version is not null
         and target_expected_secret_version not in (
           target_secret.secret_version,
           greatest(target_secret.secret_version - 1, 1)
         ) then
        raise exception 'Mailchimp webhook secret replay version conflicts'
          using errcode = '40001';
      end if;
    else
      if target_expected_secret_version is null
         or target_secret.secret_version <> target_expected_secret_version then
        raise exception 'Mailchimp webhook secret version conflict'
          using errcode = '40001';
      end if;

      update connector_private.connector_connection_secrets
         set secret_version = secret_version + 1,
             ciphertext = target_ciphertext,
             nonce = target_nonce,
             auth_tag = target_auth_tag,
             wrapped_dek = target_wrapped_dek,
             wrap_nonce = target_wrap_nonce,
             wrap_auth_tag = target_wrap_auth_tag,
             kek_version = target_kek_version,
             aad_hash = target_aad_hash,
             expires_at = null,
             refreshed_at = target_occurred_at,
             destroyed_at = null,
             updated_at = target_occurred_at
       where id = target_secret.id
       returning * into target_secret;
    end if;
  else
    if target_expected_secret_version is not null then
      raise exception 'Mailchimp webhook secret does not exist for expected version'
        using errcode = '40001';
    end if;

    insert into connector_private.connector_connection_secrets (
      workspace_id, connection_id, secret_type, ciphertext, nonce, auth_tag,
      wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash,
      expires_at, refreshed_at, created_at, updated_at
    ) values (
      target_connection.workspace_id, target_connection.id,
      'mailchimp-webhook-signing-secret', target_ciphertext, target_nonce,
      target_auth_tag, target_wrapped_dek, target_wrap_nonce,
      target_wrap_auth_tag, target_kek_version, target_aad_hash,
      null, target_occurred_at, target_occurred_at, target_occurred_at
    )
    returning * into target_secret;
  end if;

  confirmation := public.confirm_mailchimp_webhook_registration(
    target_connection.id,
    target_audience.id,
    target_webhook_id_hash,
    target_correlation_id,
    target_occurred_at
  );

  return jsonb_build_object(
    'workspaceId', target_connection.workspace_id,
    'connectionId', target_connection.id,
    'audienceBinding', confirmation -> 'binding',
    'endpointBinding', jsonb_build_object(
      'bindingId', target_endpoint.id,
      'workspaceId', target_endpoint.workspace_id,
      'connectionId', target_endpoint.connection_id,
      'provider', target_endpoint.provider,
      'endpointKeyHash', target_endpoint.endpoint_key_hash,
      'webhookIdHash', target_endpoint.remote_webhook_id_hash,
      'revokedAt', target_endpoint.revoked_at,
      'createdAt', target_endpoint.created_at,
      'updatedAt', target_endpoint.updated_at
    ),
    'secret', jsonb_build_object(
      'secretId', target_secret.id,
      'connectionId', target_secret.connection_id,
      'secretType', target_secret.secret_type,
      'secretVersion', target_secret.secret_version,
      'kekVersion', target_secret.kek_version,
      'aadHash', target_secret.aad_hash,
      'refreshedAt', target_secret.refreshed_at,
      'destroyedAt', target_secret.destroyed_at
    ),
    'receipt', confirmation -> 'receipt',
    'noOp', endpoint_unchanged and secret_unchanged
      and coalesce((confirmation ->> 'noOp')::boolean, false)
  );
end;
$$;

create or replace function public.read_mailchimp_webhook_signing_secret(
  target_endpoint_key_hash text,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_audience public.mailchimp_audience_bindings%rowtype;
  target_endpoint connector_private.connector_webhook_bindings%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
     or target_now is null then
    raise exception 'invalid Mailchimp webhook secret lookup'
      using errcode = '22023';
  end if;

  select endpoint.* into target_endpoint
  from connector_private.connector_webhook_bindings endpoint
  where endpoint.provider = 'mailchimp'
    and endpoint.endpoint_key_hash = target_endpoint_key_hash
    and endpoint.remote_webhook_id_hash is not null
    and endpoint.revoked_at is null;

  if not found then
    raise exception 'active Mailchimp webhook signing authority not found'
      using errcode = 'P0002';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_endpoint.connection_id
    and connection.workspace_id = target_endpoint.workspace_id
    and connection.provider = 'mailchimp'
    and connection.status in ('active', 'degraded');
  if not found then
    raise exception 'active Mailchimp webhook signing authority not found'
      using errcode = 'P0002';
  end if;

  select audience.* into target_audience
  from public.mailchimp_audience_bindings audience
  where audience.connection_id = target_connection.id
    and audience.workspace_id = target_connection.workspace_id
    and audience.replaced_at is null
    and not audience.webhook_registration_required;
  if not found then
    raise exception 'active Mailchimp webhook signing authority not found'
      using errcode = 'P0002';
  end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection.id
    and secret.workspace_id = target_connection.workspace_id
    and secret.secret_type = 'mailchimp-webhook-signing-secret'
    and secret.destroyed_at is null
    and (secret.expires_at is null or secret.expires_at > target_now);
  if not found then
    raise exception 'active Mailchimp webhook signing authority not found'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'workspaceId', target_connection.workspace_id,
    'connectionId', target_connection.id,
    'provider', 'mailchimp',
    'audienceBinding', jsonb_build_object(
      'bindingId', target_audience.id,
      'audienceId', target_audience.audience_external_id,
      'accountIdHash', target_audience.account_id_hash,
      'dataCenter', target_audience.data_center,
      'mappingVersion', target_audience.mapping_version,
      'selectedAt', target_audience.selected_at
    ),
    'endpointBinding', jsonb_build_object(
      'bindingId', target_endpoint.id,
      'endpointKeyHash', target_endpoint.endpoint_key_hash,
      'webhookIdHash', target_endpoint.remote_webhook_id_hash,
      'updatedAt', target_endpoint.updated_at
    ),
    'secret', jsonb_build_object(
      'secretId', target_secret.id,
      'secretType', target_secret.secret_type,
      'secretVersion', target_secret.secret_version,
      'ciphertext', encode(target_secret.ciphertext, 'base64'),
      'nonce', encode(target_secret.nonce, 'base64'),
      'authTag', encode(target_secret.auth_tag, 'base64'),
      'wrappedDek', encode(target_secret.wrapped_dek, 'base64'),
      'wrapNonce', encode(target_secret.wrap_nonce, 'base64'),
      'wrapAuthTag', encode(target_secret.wrap_auth_tag, 'base64'),
      'kekVersion', target_secret.kek_version,
      'aadHash', target_secret.aad_hash,
      'expiresAt', target_secret.expires_at,
      'refreshedAt', target_secret.refreshed_at
    )
  );
end;
$$;

create or replace function public.read_mailchimp_webhook_setup_state(
  target_connection_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_audience public.mailchimp_audience_bindings%rowtype;
  target_secret_version integer;
  endpoint_bound boolean;
begin
  if target_connection_id is null then
    raise exception 'Mailchimp connection ID is required'
      using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
    and connection.provider = 'mailchimp'
    and connection.status in ('active', 'degraded');
  if not found then
    raise exception 'active Mailchimp connection not found'
      using errcode = 'P0002';
  end if;

  select binding.* into target_audience
  from public.mailchimp_audience_bindings binding
  where binding.connection_id = target_connection.id
    and binding.workspace_id = target_connection.workspace_id
    and binding.replaced_at is null;
  if not found then
    raise exception 'active selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  select secret.secret_version into target_secret_version
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection.id
    and secret.workspace_id = target_connection.workspace_id
    and secret.secret_type = 'mailchimp-webhook-signing-secret'
    and secret.destroyed_at is null;

  select exists (
    select 1
    from connector_private.connector_webhook_bindings endpoint
    where endpoint.connection_id = target_connection.id
      and endpoint.workspace_id = target_connection.workspace_id
      and endpoint.provider = 'mailchimp'
      and endpoint.remote_webhook_id_hash is not null
      and endpoint.revoked_at is null
  ) into endpoint_bound;

  return jsonb_build_object(
    'workspaceId', target_connection.workspace_id,
    'connectionId', target_connection.id,
    'secretVersion', target_secret_version,
    'webhookRegistrationRequired',
      target_audience.webhook_registration_required,
    'endpointBound', endpoint_bound
  );
end;
$$;

create or replace function public.apply_mailchimp_baseline_member(
  target_connection_id uuid,
  target_audience_external_id text,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_subscription_status text,
  target_source_key_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_point public.contact_points%rowtype;
  target_link public.mailchimp_member_links%rowtype;
  target_authority public.mailchimp_subscription_authority%rowtype;
  target_evidence public.mailchimp_sync_evidence%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  actor_membership_id uuid;
  normalized_email text;
  expected_subscriber_hash text;
  active_matches integer;
  archived_matches integer;
  prior_subscribed boolean;
  applied_subscribed boolean;
  resolved_outcome text := 'applied';
  review_reason text;
  receipt_type public.connector_receipt_event_type :=
    'sync.applied'::public.connector_receipt_event_type;
begin
  if target_connection_id is null
     or target_audience_external_id is null
     or length(btrim(target_audience_external_id)) not between 1 and 128
     or target_member_external_id is null
     or length(btrim(target_member_external_id)) not between 1 and 128
     or target_member_external_id ~ '[@[:cntrl:]]'
     or target_subscriber_hash !~ '^[0-9a-f]{32}$'
     or target_subscription_status not in (
       'subscribed', 'unsubscribed', 'pending', 'cleaned',
       'transactional', 'archived'
     )
     or target_source_key_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null
     or target_occurred_at is null then
    raise exception 'invalid Mailchimp baseline member'
      using errcode = '22023';
  end if;

  normalized_email := public.normalize_contact_email(target_normalized_email);
  expected_subscriber_hash := encode(
    extensions.digest(pg_catalog.convert_to(normalized_email, 'UTF8'), 'md5'),
    'hex'
  );
  if normalized_email is null
     or expected_subscriber_hash <> target_subscriber_hash then
    raise exception 'Mailchimp baseline subscriber hash does not bind the canonical email'
      using errcode = '23514';
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  join public.connector_connections connection
    on connection.id = binding.connection_id
   and connection.workspace_id = binding.workspace_id
  where binding.connection_id = target_connection_id
    and binding.replaced_at is null
    and connection.provider = 'mailchimp'
    and connection.status in ('active', 'degraded')
  for update of binding;

  if not found then
    raise exception 'active selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  if target_binding.audience_external_id <> target_audience_external_id then
    resolved_outcome := 'review';
    review_reason := 'wrong-audience';
  end if;

  select evidence.* into target_evidence
  from public.mailchimp_sync_evidence evidence
  where evidence.connection_id = target_connection_id
    and evidence.origin = 'baseline-reconciliation'
    and evidence.source_key_hash = target_source_key_hash;

  if found then
    if target_evidence.binding_id <> target_binding.id
       or target_evidence.requested_status <> target_subscription_status then
      raise exception 'Mailchimp baseline member replay conflicts'
        using errcode = '23505';
    end if;
    select receipt.* into target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_evidence.workspace_id
      and receipt.event_key = 'mailchimp.baseline.item:' || target_source_key_hash;
    return jsonb_build_object(
      'outcome', target_evidence.outcome,
      'memberLink', case when target_evidence.member_link_id is null then null
        else to_jsonb((select link from public.mailchimp_member_links link
          where link.id = target_evidence.member_link_id)) end,
      'authority', case when target_evidence.member_link_id is null then null
        else to_jsonb((select authority from public.mailchimp_subscription_authority authority
          where authority.member_link_id = target_evidence.member_link_id)) end,
      'evidence', to_jsonb(target_evidence),
      'receipt', to_jsonb(target_receipt),
      'noOp', true
    );
  end if;

  if review_reason is null then
    select count(*)::integer,
      (min(point.id::text))::uuid,
      (min(point.contact_id::text))::uuid
      into active_matches, target_point.id, target_point.contact_id
    from public.contact_points point
    join public.contacts contact
      on contact.id = point.contact_id
     and contact.workspace_id = point.workspace_id
    where point.workspace_id = target_binding.workspace_id
      and point.type = 'email'
      and point.normalized_value = normalized_email
      and point.archived_at is null
      and contact.archived_at is null;

    select count(*)::integer into archived_matches
    from public.contact_points point
    join public.contacts contact
      on contact.id = point.contact_id
     and contact.workspace_id = point.workspace_id
    where point.workspace_id = target_binding.workspace_id
      and point.type = 'email'
      and point.normalized_value = normalized_email
      and (point.archived_at is not null or contact.archived_at is not null);

    if active_matches <> 1 then
      resolved_outcome := 'review';
      review_reason := case
        when active_matches > 1 then 'ambiguous-email'
        when archived_matches > 0 then 'archived-email'
        else 'no-canonical-match'
      end;
    else
      select point.* into strict target_point
      from public.contact_points point
      where point.id = target_point.id
        and point.workspace_id = target_binding.workspace_id
      for update;
    end if;
  end if;

  if review_reason is null then
    select link.* into target_link
    from public.mailchimp_member_links link
    where link.binding_id = target_binding.id
      and (
        link.subscriber_hash = target_subscriber_hash
        or link.member_external_id = target_member_external_id
      )
    for update;

    if found and (
      target_link.contact_point_id <> target_point.id
      or target_link.subscriber_hash <> target_subscriber_hash
      or target_link.member_external_id <> target_member_external_id
    ) then
      resolved_outcome := 'review';
      review_reason := 'provider-member-conflict';
      target_link.id := null;
    elsif not found then
      insert into public.mailchimp_member_links (
        workspace_id, connection_id, binding_id, contact_id,
        contact_point_id, subscriber_hash, member_external_id
      ) values (
        target_binding.workspace_id, target_binding.connection_id,
        target_binding.id, target_point.contact_id, target_point.id,
        target_subscriber_hash, btrim(target_member_external_id)
      )
      returning * into target_link;
    end if;
  end if;

  if review_reason is null then
    select authority.* into target_authority
    from public.mailchimp_subscription_authority authority
    where authority.member_link_id = target_link.id
    for update;

    if found and target_authority.last_occurred_at > target_occurred_at then
      resolved_outcome := 'review';
      review_reason := 'out-of-order-event';
    elsif target_subscription_status = 'subscribed'
      and target_authority.resubscribe_requires_consent then
      resolved_outcome := 'blocked-unsubscribe-authority';
      review_reason := 'fresh-consent-required';
    else
      prior_subscribed := target_point.email_subscribed;
      if target_subscription_status = 'subscribed' then
        applied_subscribed := true;
      elsif target_subscription_status in ('unsubscribed', 'cleaned') then
        applied_subscribed := false;
      else
        applied_subscribed := prior_subscribed;
        resolved_outcome := 'no-op';
      end if;

      if target_subscription_status in ('subscribed', 'unsubscribed', 'cleaned') then
        update public.contact_points
           set email_subscribed = applied_subscribed
         where id = target_point.id
         returning * into target_point;
      end if;

      insert into public.mailchimp_subscription_authority (
        workspace_id, connection_id, binding_id, member_link_id,
        provider_status, provider_unsubscribed_at,
        resubscribe_requires_consent, last_provider_event_id_hash,
        last_occurred_at
      ) values (
        target_binding.workspace_id, target_binding.connection_id,
        target_binding.id, target_link.id, target_subscription_status,
        case when target_subscription_status in ('unsubscribed', 'cleaned')
          then target_occurred_at end,
        target_subscription_status in ('unsubscribed', 'cleaned'),
        target_source_key_hash, target_occurred_at
      )
      on conflict (member_link_id) do update set
        provider_status = excluded.provider_status,
        provider_unsubscribed_at = case
          when excluded.provider_status in ('unsubscribed', 'cleaned')
            then excluded.provider_unsubscribed_at
          else mailchimp_subscription_authority.provider_unsubscribed_at
        end,
        resubscribe_requires_consent =
          mailchimp_subscription_authority.resubscribe_requires_consent
          or excluded.resubscribe_requires_consent,
        last_provider_event_id_hash = excluded.last_provider_event_id_hash,
        last_occurred_at = excluded.last_occurred_at
      returning * into target_authority;

      if prior_subscribed is distinct from applied_subscribed then
        select membership.id into actor_membership_id
        from public.workspace_members membership
        where membership.workspace_id = target_binding.workspace_id
          and membership.status = 'active'
          and membership.role = 'owner'
        order by membership.created_at, membership.id
        limit 1;

        if actor_membership_id is null then
          raise exception 'active owner required for Mailchimp activity evidence'
            using errcode = '42501';
        end if;

        insert into public.activity_events (
          workspace_id, type, contact_id, actor_membership_id,
          occurred_at, idempotency_key
        ) values (
          target_binding.workspace_id, 'contact-point-updated',
          target_point.contact_id, actor_membership_id, target_occurred_at,
          'mailchimp.baseline:' || target_source_key_hash
        );
      end if;
    end if;
  end if;

  if resolved_outcome in ('review', 'blocked-unsubscribe-authority') then
    receipt_type := 'sync.reviewed'::public.connector_receipt_event_type;
  end if;

  insert into public.mailchimp_sync_evidence (
    workspace_id, connection_id, binding_id, member_link_id,
    contact_point_id, origin, source_key_hash, correlation_id, outcome,
    requested_status, applied_email_subscribed, occurred_at
  ) values (
    target_binding.workspace_id, target_binding.connection_id,
    target_binding.id, target_link.id, target_point.id,
    'baseline-reconciliation', target_source_key_hash,
    target_correlation_id, resolved_outcome, target_subscription_status,
    applied_subscribed, target_occurred_at
  )
  returning * into target_evidence;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, provider, event_type, event_key,
    correlation_id, provider_request_hash, provider_status,
    reconciliation_result, redacted_metadata, occurred_at
  ) values (
    target_binding.workspace_id, target_binding.connection_id, 'mailchimp',
    receipt_type, 'mailchimp.baseline.item:' || target_source_key_hash,
    target_correlation_id, target_source_key_hash,
    target_subscription_status, review_reason,
    jsonb_build_object(
      'audienceId', target_binding.audience_external_id,
      'subscriberHash', target_subscriber_hash,
      'outcome', resolved_outcome,
      'reviewReason', review_reason,
      'memberLinkId', target_link.id
    ),
    target_occurred_at
  )
  returning * into target_receipt;

  return jsonb_build_object(
    'outcome', resolved_outcome,
    'memberLink', case when target_link.id is null then null
      else to_jsonb(target_link) end,
    'authority', case when target_authority.id is null then null
      else to_jsonb(target_authority) end,
    'evidence', to_jsonb(target_evidence),
    'receipt', to_jsonb(target_receipt),
    'noOp', false
  );
end;
$$;

create or replace function public.register_mailchimp_webhook_event_encrypted(
  target_connection_id uuid,
  target_audience_external_id text,
  target_replay_key_hash text,
  target_raw_body_hash text,
  target_signature_valid boolean,
  target_timestamp_valid boolean,
  target_payload_hash text,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_correlation_id uuid,
  target_received_at timestamptz,
  target_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_delivery public.connector_webhook_deliveries%rowtype;
  target_job public.mailchimp_webhook_jobs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  accepted boolean;
  inserted_delivery boolean := false;
begin
  if target_connection_id is null
     or target_audience_external_id is null
     or length(btrim(target_audience_external_id)) not between 1 and 128
     or target_replay_key_hash !~ '^[0-9a-f]{64}$'
     or target_raw_body_hash !~ '^[0-9a-f]{64}$'
     or target_signature_valid is null
     or target_timestamp_valid is null
     or target_payload_hash !~ '^[0-9a-f]{64}$'
     or target_ciphertext is null or octet_length(target_ciphertext) = 0
     or target_nonce is null or octet_length(target_nonce) <> 12
     or target_auth_tag is null or octet_length(target_auth_tag) <> 16
     or target_wrapped_dek is null or octet_length(target_wrapped_dek) = 0
     or target_wrap_nonce is null or octet_length(target_wrap_nonce) <> 12
     or target_wrap_auth_tag is null or octet_length(target_wrap_auth_tag) <> 16
     or target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null
     or target_received_at is null
     or target_max_attempts not between 1 and 20 then
    raise exception 'invalid encrypted Mailchimp webhook registration'
      using errcode = '22023';
  end if;

  select binding.* into target_binding
  from public.mailchimp_audience_bindings binding
  join public.connector_connections connection
    on connection.id = binding.connection_id
   and connection.workspace_id = binding.workspace_id
  where binding.connection_id = target_connection_id
    and binding.replaced_at is null
    and binding.audience_external_id = target_audience_external_id
    and connection.provider = 'mailchimp'
    and connection.status in ('active', 'degraded')
    and not binding.webhook_registration_required;

  if not found then
    raise exception 'webhook-ready selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  accepted := target_signature_valid and target_timestamp_valid;

  insert into public.connector_webhook_deliveries (
    workspace_id, connection_id, provider, replay_key_hash, raw_body_hash,
    signature_valid, timestamp_valid, outcome, correlation_id, received_at,
    redacted_result
  ) values (
    target_binding.workspace_id, target_binding.connection_id, 'mailchimp',
    target_replay_key_hash, target_raw_body_hash, target_signature_valid,
    target_timestamp_valid, case when accepted then 'accepted' else 'rejected' end,
    target_correlation_id, target_received_at,
    case when accepted then 'queued' else 'verification-rejected' end
  )
  on conflict (connection_id, replay_key_hash) do nothing
  returning * into target_delivery;

  inserted_delivery := found;

  if not inserted_delivery then
    select delivery.* into target_delivery
    from public.connector_webhook_deliveries delivery
    where delivery.connection_id = target_connection_id
      and delivery.replay_key_hash = target_replay_key_hash
    for update;

    if not found then
      raise exception 'Mailchimp webhook replay authority disappeared'
        using errcode = '40001';
    end if;

    select webhook_job.* into target_job
    from public.mailchimp_webhook_jobs webhook_job
    where webhook_job.delivery_id = target_delivery.id;

    select receipt.* into target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_delivery.workspace_id
      and receipt.event_key = case
        when target_delivery.outcome = 'accepted'
          then 'webhook.accepted:' || target_delivery.id::text
        else 'webhook.rejected:' || target_delivery.id::text
      end;

    if target_delivery.workspace_id <> target_binding.workspace_id
       or target_delivery.raw_body_hash <> target_raw_body_hash
       or target_receipt.id is null
       or target_receipt.provider_request_hash <> target_payload_hash
       or target_receipt.redacted_metadata ->> 'bindingId'
          <> target_binding.id::text
       or (target_delivery.outcome = 'accepted' and (
         target_job.id is null
         or target_job.binding_id <> target_binding.id
         or target_job.payload_hash <> target_payload_hash
       ))
       or (target_delivery.outcome = 'rejected' and target_job.id is not null) then
      raise exception 'Mailchimp webhook replay conflicts'
        using errcode = '23505';
    end if;

    accepted := target_delivery.outcome = 'accepted';

    if accepted then
      select payload.* into target_payload
      from connector_private.connector_payload_envelopes payload
      where payload.id = target_job.payload_ref
        and payload.workspace_id = target_job.workspace_id
        and payload.connection_id = target_job.connection_id
        and payload.payload_kind = 'mailchimp.webhook'
        and payload.canonical_hash = target_payload_hash;
      if not found then
        raise exception 'Mailchimp webhook replay payload authority is unavailable'
          using errcode = '55000';
      end if;
    end if;

    return jsonb_build_object(
      'delivery', to_jsonb(target_delivery),
      'webhookJob', case when target_job.id is null then null
        else to_jsonb(target_job) end,
      'payload', case when target_payload.id is null then null
        else jsonb_build_object(
          'payloadRef', target_payload.id,
          'payloadHash', target_payload.canonical_hash,
          'envelopeVersion', target_payload.envelope_version,
          'kekVersion', target_payload.kek_version,
          'aadHash', target_payload.aad_hash
        ) end,
      'receipt', to_jsonb(target_receipt),
      'accepted', accepted,
      'noOp', true
    );
  end if;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, provider, event_type, event_key,
    correlation_id, provider_request_hash, error_category,
    redacted_metadata, occurred_at
  ) values (
    target_binding.workspace_id, target_binding.connection_id, 'mailchimp',
    case when accepted then
      'webhook.accepted'::public.connector_receipt_event_type
    else
      'webhook.rejected'::public.connector_receipt_event_type
    end,
    case when accepted then 'webhook.accepted:' || target_delivery.id::text
      else 'webhook.rejected:' || target_delivery.id::text end,
    target_correlation_id, target_payload_hash,
    case when accepted then null else 'webhook_verification_failed' end,
    jsonb_build_object(
      'deliveryId', target_delivery.id,
      'bindingId', target_binding.id,
      'signatureValid', target_signature_valid,
      'timestampValid', target_timestamp_valid
    ),
    target_received_at
  )
  returning * into target_receipt;

  if accepted then
    insert into connector_private.connector_payload_envelopes (
      workspace_id, connection_id, payload_kind, schema_version,
      canonical_hash, ciphertext, nonce, auth_tag, wrapped_dek,
      wrap_nonce, wrap_auth_tag, kek_version, aad_hash, created_at, updated_at
    ) values (
      target_binding.workspace_id, target_binding.connection_id,
      'mailchimp.webhook', 'mailchimp-webhook.v1', target_payload_hash,
      target_ciphertext, target_nonce, target_auth_tag, target_wrapped_dek,
      target_wrap_nonce, target_wrap_auth_tag, target_kek_version,
      target_aad_hash, target_received_at, target_received_at
    )
    returning * into target_payload;

    insert into public.mailchimp_webhook_jobs (
      workspace_id, connection_id, binding_id, delivery_id, payload_ref,
      payload_hash, state, max_attempts, scheduled_at, correlation_id
    ) values (
      target_binding.workspace_id, target_binding.connection_id,
      target_binding.id, target_delivery.id, target_payload.id,
      target_payload.canonical_hash, 'queued', target_max_attempts,
      target_received_at, target_correlation_id
    )
    returning * into target_job;
  end if;

  return jsonb_build_object(
    'delivery', to_jsonb(target_delivery),
    'webhookJob', case when target_job.id is null then null
      else to_jsonb(target_job) end,
    'payload', case when target_payload.id is null then null
      else jsonb_build_object(
        'payloadRef', target_payload.id,
        'payloadHash', target_payload.canonical_hash,
        'envelopeVersion', target_payload.envelope_version,
        'kekVersion', target_payload.kek_version,
        'aadHash', target_payload.aad_hash
      ) end,
    'receipt', to_jsonb(target_receipt),
    'accepted', accepted,
    'noOp', false
  );
end;
$$;

revoke all on function public.bind_mailchimp_webhook_secret(
  uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,
  timestamptz,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_mailchimp_webhook_signing_secret(
  text,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.read_mailchimp_webhook_setup_state(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.register_mailchimp_webhook_event_encrypted(
  uuid,text,text,text,boolean,boolean,text,bytea,bytea,bytea,bytea,bytea,bytea,
  text,text,uuid,timestamptz,integer
) from public, anon, authenticated, service_role;

-- 0010's two-step payload/register seam allocates a payload before replay
-- resolution. Keep the function for rollback compatibility, but remove the
-- only runtime grant so provider ingress cannot create replay orphans.
revoke all on function public.register_mailchimp_webhook_event(
  uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer
) from service_role;

grant execute on function public.bind_mailchimp_webhook_secret(
  uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,
  timestamptz,uuid
) to service_role;
grant execute on function public.read_mailchimp_webhook_signing_secret(
  text,timestamptz
) to service_role;
grant execute on function public.read_mailchimp_webhook_setup_state(uuid)
  to service_role;
grant execute on function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) to service_role;
grant execute on function public.register_mailchimp_webhook_event_encrypted(
  uuid,text,text,text,boolean,boolean,text,bytea,bytea,bytea,bytea,bytea,bytea,
  text,text,uuid,timestamptz,integer
) to service_role;

comment on function public.bind_mailchimp_webhook_secret(
  uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,
  timestamptz,uuid
) is 'Service-only atomic Mailchimp endpoint/signing-envelope bind and selected-audience webhook registration confirmation. Returns no encrypted material.';
comment on function public.read_mailchimp_webhook_signing_secret(
  text,timestamptz
) is 'Service-only resolution of one active opaque Mailchimp endpoint to its selected-audience binding and encrypted signing-secret envelope.';
comment on function public.read_mailchimp_webhook_setup_state(uuid) is
  'Service-only redacted selected-audience webhook setup state with envelope CAS version but no endpoint hash or encrypted material.';
comment on function public.apply_mailchimp_baseline_member(
  uuid,text,text,text,text,text,text,uuid,timestamptz
) is 'Service-only baseline reconciliation item apply without synthetic webhook evidence; canonical ambiguity and unsubscribe authority fail closed.';
comment on function public.register_mailchimp_webhook_event_encrypted(
  uuid,text,text,text,boolean,boolean,text,bytea,bytea,bytea,bytea,bytea,bytea,
  text,text,uuid,timestamptz,integer
) is 'Service-only atomic Mailchimp delivery replay decision, accepted encrypted-payload persistence and durable enqueue. Duplicate delivery creates no payload envelope.';

do $$
begin
  if has_schema_privilege('authenticated', 'connector_private', 'USAGE')
     or has_table_privilege(
       'authenticated',
       'connector_private.connector_connection_secrets',
       'SELECT'
     )
     or has_function_privilege(
       'authenticated',
       'public.bind_mailchimp_webhook_secret(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,timestamptz,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.read_mailchimp_webhook_signing_secret(text,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.read_mailchimp_webhook_setup_state(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.apply_mailchimp_baseline_member(uuid,text,text,text,text,text,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.register_mailchimp_webhook_event_encrypted(uuid,text,text,text,boolean,boolean,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,uuid,timestamptz,integer)',
       'EXECUTE'
     ) then
    raise exception 'Mailchimp signing-secret authority must remain service-only';
  end if;
end;
$$;

commit;
