-- Story 3.5 QA remediation: server-only bounded KEK rewrap operations.
--
-- This migration never decrypts an envelope and never returns ciphertext.
-- The application server unwraps/re-wraps only the DEK. CAS preserves the
-- encrypted payload, data nonce/tag, AAD binding and business envelope version.
--
-- ROLLBACK: ../rollbacks/0008_connector_kek_rewrap.rollback.sql is safe only
-- before the first completed rewrap. After a completed rewrap, retain both KEKs
-- and use a new forward rotation or PITR; do not discard the new wrapper.

begin;

create table connector_private.connector_rewrap_claims (
  id                         uuid primary key default gen_random_uuid(),
  envelope_kind              text not null,
  envelope_id                uuid not null,
  workspace_id               uuid not null references public.workspaces (id) on delete restrict,
  source_kek_version         text not null,
  target_kek_version         text not null,
  expected_crypto_version    integer not null,
  expected_wrapped_dek_hash  text not null,
  expected_aad_hash          text not null,
  claimed_by                 uuid not null,
  lease_expires_at           timestamptz not null,
  fencing_token              bigint not null default 1,
  completed_at               timestamptz,
  completed_wrapped_dek_hash text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint connector_rewrap_claims_target_unique
    unique (envelope_kind, envelope_id, target_kek_version),
  constraint connector_rewrap_claims_kind check (
    envelope_kind in ('payload', 'connection-secret', 'oauth-pkce', 'sync-cursor')
  ),
  constraint connector_rewrap_claims_kek_versions check (
    source_kek_version ~ '^[A-Za-z0-9_.-]{1,64}$'
    and target_kek_version ~ '^[A-Za-z0-9_.-]{1,64}$'
    and source_kek_version <> target_kek_version
  ),
  constraint connector_rewrap_claims_crypto_version check (expected_crypto_version > 0),
  constraint connector_rewrap_claims_hashes check (
    expected_wrapped_dek_hash ~ '^[0-9a-f]{64}$'
    and expected_aad_hash ~ '^[0-9a-f]{64}$'
    and (
      completed_wrapped_dek_hash is null
      or completed_wrapped_dek_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  constraint connector_rewrap_claims_fence check (fencing_token > 0),
  constraint connector_rewrap_claims_completion check (
    (completed_at is null and completed_wrapped_dek_hash is null)
    or (completed_at is not null and completed_wrapped_dek_hash is not null)
  )
);

create index connector_rewrap_claims_active_lease_idx
  on connector_private.connector_rewrap_claims (
    target_kek_version, lease_expires_at, envelope_kind, envelope_id
  ) where completed_at is null;

create index connector_payload_envelopes_active_kek_rewrap_idx
  on connector_private.connector_payload_envelopes (kek_version, id)
  where destroyed_at is null;

create index connector_oauth_transactions_active_kek_rewrap_idx
  on connector_private.connector_oauth_transactions (
    kek_version, consumed_at, expires_at, id
  );

create index connector_sync_cursors_active_kek_rewrap_idx
  on connector_private.connector_sync_cursors (kek_version, expires_at, id);

alter table connector_private.connector_rewrap_claims enable row level security;
alter table connector_private.connector_rewrap_claims force row level security;

revoke all on table connector_private.connector_rewrap_claims
  from public, anon, authenticated, service_role;

create or replace function public.list_connector_kek_version_counts(
  target_now timestamptz default clock_timestamp()
)
returns table (
  envelope_kind text,
  kek_version text,
  active_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select counts.envelope_kind, counts.kek_version, sum(counts.active_count)::bigint
  from (
    select 'payload'::text as envelope_kind, envelope.kek_version,
      count(*)::bigint as active_count
    from connector_private.connector_payload_envelopes envelope
    where envelope.destroyed_at is null
    group by envelope.kek_version
    union all
    select 'connection-secret', secret.kek_version, count(*)::bigint
    from connector_private.connector_connection_secrets secret
    where secret.destroyed_at is null
    group by secret.kek_version
    union all
    select 'oauth-pkce', transaction_row.kek_version, count(*)::bigint
    from connector_private.connector_oauth_transactions transaction_row
    where transaction_row.consumed_at is null
      and transaction_row.expires_at > target_now
    group by transaction_row.kek_version
    union all
    select 'sync-cursor', cursor_row.kek_version, count(*)::bigint
    from connector_private.connector_sync_cursors cursor_row
    where cursor_row.expires_at is null or cursor_row.expires_at > target_now
    group by cursor_row.kek_version
  ) counts
  group by counts.envelope_kind, counts.kek_version
  order by counts.envelope_kind, counts.kek_version;
$$;

create or replace function public.claim_connector_kek_rewrap_candidates(
  target_worker_id uuid,
  target_source_kek_version text,
  target_target_kek_version text,
  target_batch_size integer,
  target_lease_seconds integer,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  acquired_claim connector_private.connector_rewrap_claims%rowtype;
  candidates jsonb := '[]'::jsonb;
  acquired_count integer := 0;
begin
  if target_worker_id is null
     or target_source_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_source_kek_version = target_target_kek_version
     or target_batch_size not between 1 and 100
     or target_lease_seconds not between 30 and 900
     or target_now is null then
    raise exception 'connector KEK rewrap claim command is invalid'
      using errcode = '23514';
  end if;

  for candidate in
    select candidate_rows.*
    from (
      select 'payload'::text as envelope_kind, envelope.id as envelope_id,
        envelope.workspace_id, envelope.kek_version,
        envelope.envelope_version as crypto_version,
        envelope.connection_id::text as aad_connection_id,
        connection.provider as aad_provider,
        envelope.payload_kind as aad_secret_type,
        encode(extensions.digest(envelope.wrapped_dek, 'sha256'), 'hex') as wrapped_dek_hash,
        envelope.wrapped_dek, envelope.wrap_nonce, envelope.wrap_auth_tag,
        envelope.aad_hash
      from connector_private.connector_payload_envelopes envelope
      join public.connector_connections connection
        on connection.id = envelope.connection_id
       and connection.workspace_id = envelope.workspace_id
      where envelope.destroyed_at is null
        and envelope.kek_version = target_source_kek_version
      union all
      select 'connection-secret', secret.id, secret.workspace_id,
        secret.kek_version, secret.secret_version,
        secret.connection_id::text, connection.provider, secret.secret_type,
        encode(extensions.digest(secret.wrapped_dek, 'sha256'), 'hex'),
        secret.wrapped_dek, secret.wrap_nonce, secret.wrap_auth_tag,
        secret.aad_hash
      from connector_private.connector_connection_secrets secret
      join public.connector_connections connection
        on connection.id = secret.connection_id
       and connection.workspace_id = secret.workspace_id
      where secret.destroyed_at is null
        and secret.kek_version = target_source_kek_version
      union all
      select 'oauth-pkce', transaction_row.id, transaction_row.workspace_id,
        transaction_row.kek_version, 1,
        coalesce(
          transaction_row.connection_id::text,
          'oauth-transaction-' || transaction_row.id::text
        ),
        transaction_row.provider, 'oauth-pkce',
        encode(extensions.digest(transaction_row.pkce_wrapped_dek, 'sha256'), 'hex'),
        transaction_row.pkce_wrapped_dek, transaction_row.pkce_wrap_nonce,
        transaction_row.pkce_wrap_auth_tag, transaction_row.aad_hash
      from connector_private.connector_oauth_transactions transaction_row
      where transaction_row.consumed_at is null
        and transaction_row.expires_at > target_now
        and transaction_row.kek_version = target_source_kek_version
      union all
      select 'sync-cursor', cursor_row.id, cursor_row.workspace_id,
        cursor_row.kek_version, cursor_row.cursor_version,
        cursor_row.connection_id::text, connection.provider, cursor_row.stream_key,
        encode(extensions.digest(cursor_row.wrapped_dek, 'sha256'), 'hex'),
        cursor_row.wrapped_dek, cursor_row.wrap_nonce,
        cursor_row.wrap_auth_tag, cursor_row.aad_hash
      from connector_private.connector_sync_cursors cursor_row
      join public.connector_connections connection
        on connection.id = cursor_row.connection_id
       and connection.workspace_id = cursor_row.workspace_id
      where (cursor_row.expires_at is null or cursor_row.expires_at > target_now)
        and cursor_row.kek_version = target_source_kek_version
    ) candidate_rows
    order by candidate_rows.envelope_kind, candidate_rows.envelope_id
    limit target_batch_size * 8
  loop
    acquired_claim := null;
    insert into connector_private.connector_rewrap_claims (
      envelope_kind, envelope_id, workspace_id,
      source_kek_version, target_kek_version,
      expected_crypto_version, expected_wrapped_dek_hash,
      expected_aad_hash, claimed_by, lease_expires_at,
      fencing_token, created_at, updated_at
    ) values (
      candidate.envelope_kind, candidate.envelope_id, candidate.workspace_id,
      target_source_kek_version, target_target_kek_version,
      candidate.crypto_version, candidate.wrapped_dek_hash,
      candidate.aad_hash, target_worker_id,
      target_now + make_interval(secs => target_lease_seconds),
      1, target_now, target_now
    )
    on conflict (envelope_kind, envelope_id, target_kek_version) do update
      set source_kek_version = excluded.source_kek_version,
          workspace_id = excluded.workspace_id,
          expected_crypto_version = excluded.expected_crypto_version,
          expected_wrapped_dek_hash = excluded.expected_wrapped_dek_hash,
          expected_aad_hash = excluded.expected_aad_hash,
          claimed_by = excluded.claimed_by,
          lease_expires_at = excluded.lease_expires_at,
          fencing_token = connector_private.connector_rewrap_claims.fencing_token + 1,
          updated_at = excluded.updated_at
      where connector_private.connector_rewrap_claims.completed_at is null
        and connector_private.connector_rewrap_claims.lease_expires_at <= target_now
    returning * into acquired_claim;

    if acquired_claim.id is not null then
      candidates := candidates || jsonb_build_array(jsonb_build_object(
        'claimId', acquired_claim.id,
        'envelopeKind', candidate.envelope_kind,
        'envelopeId', candidate.envelope_id,
        'workspaceId', candidate.workspace_id,
        'connectionId', candidate.aad_connection_id,
        'provider', candidate.aad_provider,
        'secretType', candidate.aad_secret_type,
        'recordVersion', candidate.crypto_version,
        'sourceKekVersion', target_source_kek_version,
        'targetKekVersion', target_target_kek_version,
        'cryptoVersion', candidate.crypto_version,
        'wrappedDek', encode(candidate.wrapped_dek, 'base64'),
        'wrapNonce', encode(candidate.wrap_nonce, 'base64'),
        'wrapAuthTag', encode(candidate.wrap_auth_tag, 'base64'),
        'aadHash', candidate.aad_hash,
        'leaseExpiresAt', acquired_claim.lease_expires_at,
        'fencingToken', acquired_claim.fencing_token
      ));
      acquired_count := acquired_count + 1;
      exit when acquired_count >= target_batch_size;
    end if;
  end loop;

  return jsonb_build_object(
    'sourceKekVersion', target_source_kek_version,
    'targetKekVersion', target_target_kek_version,
    'count', acquired_count,
    'candidates', candidates
  );
end;
$$;

create or replace function public.cas_rewrap_connector_envelope(
  target_claim_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_claim connector_private.connector_rewrap_claims%rowtype;
  affected_count integer;
  completed_hash text;
begin
  if target_claim_id is null or target_worker_id is null
     or target_fencing_token <= 0
     or target_wrapped_dek is null or octet_length(target_wrapped_dek) = 0
     or target_wrap_nonce is null or octet_length(target_wrap_nonce) <> 12
     or target_wrap_auth_tag is null or octet_length(target_wrap_auth_tag) <> 16
     or target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_now is null then
    raise exception 'connector KEK rewrap CAS command is invalid'
      using errcode = '23514';
  end if;

  select claim.* into target_claim
  from connector_private.connector_rewrap_claims claim
  where claim.id = target_claim_id
  for update;
  if not found then
    raise exception 'connector KEK rewrap claim not found' using errcode = 'P0002';
  end if;
  if target_claim.claimed_by <> target_worker_id then
    raise exception 'connector KEK rewrap claim belongs to another worker'
      using errcode = '42501';
  end if;
  if target_claim.fencing_token <> target_fencing_token then
    raise exception 'stale connector KEK rewrap fencing token'
      using errcode = '40001';
  end if;
  if target_kek_version <> target_claim.target_kek_version
     or target_aad_hash <> target_claim.expected_aad_hash then
    raise exception 'connector KEK rewrap binding conflicts with claim'
      using errcode = '23505';
  end if;

  completed_hash := encode(extensions.digest(target_wrapped_dek, 'sha256'), 'hex');
  if target_claim.completed_at is not null then
    if target_claim.completed_wrapped_dek_hash <> completed_hash then
      raise exception 'completed connector KEK rewrap replay diverges'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'claimId', target_claim.id,
      'envelopeKind', target_claim.envelope_kind,
      'envelopeId', target_claim.envelope_id,
      'workspaceId', target_claim.workspace_id,
      'sourceKekVersion', target_claim.source_kek_version,
      'targetKekVersion', target_claim.target_kek_version,
      'cryptoVersion', target_claim.expected_crypto_version,
      'completedAt', target_claim.completed_at,
      'noOp', true
    );
  end if;
  if target_claim.lease_expires_at <= target_now then
    raise exception 'connector KEK rewrap claim lease expired'
      using errcode = '40001';
  end if;

  affected_count := 0;
  if target_claim.envelope_kind = 'payload' then
    update connector_private.connector_payload_envelopes envelope
       set wrapped_dek = target_wrapped_dek,
           wrap_nonce = target_wrap_nonce,
           wrap_auth_tag = target_wrap_auth_tag,
           kek_version = target_kek_version,
           aad_hash = target_aad_hash
     where envelope.id = target_claim.envelope_id
       and envelope.workspace_id = target_claim.workspace_id
       and envelope.destroyed_at is null
       and envelope.envelope_version = target_claim.expected_crypto_version
       and envelope.kek_version = target_claim.source_kek_version
       and envelope.aad_hash = target_claim.expected_aad_hash
       and encode(extensions.digest(envelope.wrapped_dek, 'sha256'), 'hex')
         = target_claim.expected_wrapped_dek_hash;
  elsif target_claim.envelope_kind = 'connection-secret' then
    update connector_private.connector_connection_secrets secret
       set wrapped_dek = target_wrapped_dek,
           wrap_nonce = target_wrap_nonce,
           wrap_auth_tag = target_wrap_auth_tag,
           kek_version = target_kek_version,
           aad_hash = target_aad_hash
     where secret.id = target_claim.envelope_id
       and secret.workspace_id = target_claim.workspace_id
       and secret.destroyed_at is null
       and secret.secret_version = target_claim.expected_crypto_version
       and secret.kek_version = target_claim.source_kek_version
       and secret.aad_hash = target_claim.expected_aad_hash
       and encode(extensions.digest(secret.wrapped_dek, 'sha256'), 'hex')
         = target_claim.expected_wrapped_dek_hash;
  elsif target_claim.envelope_kind = 'oauth-pkce' then
    update connector_private.connector_oauth_transactions transaction_row
       set pkce_wrapped_dek = target_wrapped_dek,
           pkce_wrap_nonce = target_wrap_nonce,
           pkce_wrap_auth_tag = target_wrap_auth_tag,
           kek_version = target_kek_version,
           aad_hash = target_aad_hash
     where transaction_row.id = target_claim.envelope_id
       and transaction_row.workspace_id = target_claim.workspace_id
       and transaction_row.consumed_at is null
       and transaction_row.expires_at > target_now
       and target_claim.expected_crypto_version = 1
       and transaction_row.kek_version = target_claim.source_kek_version
       and transaction_row.aad_hash = target_claim.expected_aad_hash
       and encode(extensions.digest(transaction_row.pkce_wrapped_dek, 'sha256'), 'hex')
         = target_claim.expected_wrapped_dek_hash;
  elsif target_claim.envelope_kind = 'sync-cursor' then
    update connector_private.connector_sync_cursors cursor_row
       set wrapped_dek = target_wrapped_dek,
           wrap_nonce = target_wrap_nonce,
           wrap_auth_tag = target_wrap_auth_tag,
           kek_version = target_kek_version,
           aad_hash = target_aad_hash
     where cursor_row.id = target_claim.envelope_id
       and cursor_row.workspace_id = target_claim.workspace_id
       and (cursor_row.expires_at is null or cursor_row.expires_at > target_now)
       and cursor_row.cursor_version = target_claim.expected_crypto_version
       and cursor_row.kek_version = target_claim.source_kek_version
       and cursor_row.aad_hash = target_claim.expected_aad_hash
       and encode(extensions.digest(cursor_row.wrapped_dek, 'sha256'), 'hex')
         = target_claim.expected_wrapped_dek_hash;
  else
    raise exception 'connector KEK rewrap claim kind is invalid'
      using errcode = '23514';
  end if;

  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'connector KEK rewrap CAS conflict'
      using errcode = '40001';
  end if;

  update connector_private.connector_rewrap_claims claim
     set completed_at = target_now,
         completed_wrapped_dek_hash = completed_hash,
         updated_at = target_now
   where claim.id = target_claim.id
   returning * into target_claim;

  return jsonb_build_object(
    'claimId', target_claim.id,
    'envelopeKind', target_claim.envelope_kind,
    'envelopeId', target_claim.envelope_id,
    'workspaceId', target_claim.workspace_id,
    'sourceKekVersion', target_claim.source_kek_version,
    'targetKekVersion', target_claim.target_kek_version,
    'cryptoVersion', target_claim.expected_crypto_version,
    'completedAt', target_claim.completed_at,
    'noOp', false
  );
end;
$$;

revoke all on function public.list_connector_kek_version_counts(timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_connector_kek_rewrap_candidates(
  uuid, text, text, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.cas_rewrap_connector_envelope(
  uuid, uuid, bigint, bytea, bytea, bytea, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.list_connector_kek_version_counts(timestamptz)
  to service_role;
grant execute on function public.claim_connector_kek_rewrap_candidates(
  uuid, text, text, integer, integer, timestamptz
) to service_role;
grant execute on function public.cas_rewrap_connector_envelope(
  uuid, uuid, bigint, bytea, bytea, bytea, text, text, timestamptz
) to service_role;

comment on table connector_private.connector_rewrap_claims is
  'Server-only bounded KEK rewrap leases. Claims bind worker, fence, source wrapper hash, AAD hash and unchanged business crypto version.';
comment on function public.list_connector_kek_version_counts(timestamptz) is
  'Service-role-only active envelope counts by kind and KEK version; returns no encrypted material.';
comment on function public.claim_connector_kek_rewrap_candidates(
  uuid, text, text, integer, integer, timestamptz
) is
  'Service-role-only bounded rewrap claim. Returns wrapped DEK components and canonical non-secret AAD fields but never payload ciphertext or plaintext. AAD is workspaceId|connectionId|provider|secretType|recordVersion; nullable pre-connection OAuth uses oauth-transaction-{id}, oauth-pkce, version 1.';
comment on function public.cas_rewrap_connector_envelope(
  uuid, uuid, bigint, bytea, bytea, bytea, text, text, timestamptz
) is
  'Service-role-only fenced CAS that replaces only DEK wrapping components and KEK metadata while preserving ciphertext, AAD binding and business version.';

do $$
declare target_function text;
begin
  if has_table_privilege('anon', 'connector_private.connector_rewrap_claims', 'SELECT')
     or has_table_privilege('authenticated', 'connector_private.connector_rewrap_claims', 'SELECT')
     or has_table_privilege('service_role', 'connector_private.connector_rewrap_claims', 'SELECT') then
    raise exception 'connector rewrap claims have a forbidden direct read grant';
  end if;

  foreach target_function in array array[
    'list_connector_kek_version_counts(timestamp with time zone)',
    'claim_connector_kek_rewrap_candidates(uuid,text,text,integer,integer,timestamp with time zone)',
    'cas_rewrap_connector_envelope(uuid,uuid,bigint,bytea,bytea,bytea,text,text,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', 'public.' || target_function, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || target_function, 'EXECUTE')
       or not has_function_privilege('service_role', 'public.' || target_function, 'EXECUTE') then
      raise exception 'connector rewrap RPC privilege mismatch on %', target_function;
    end if;
  end loop;
end;
$$;

commit;
