-- Omnix — provider-disabled connector platform foundation
-- Story 3.5: workspace-scoped connector metadata, immutable approvals and
-- receipts, private encrypted envelopes, durable jobs, leases, fencing and
-- replay-safe webhook intake.
--
-- Forward-only migration. Provider-specific business operations and provider
-- enablement are intentionally absent. Apply only after migrations 0001..0005.
-- The pre-write-window rollback is documented in
-- ../rollbacks/0006_connector_platform_foundation.rollback.sql.

begin;

-- Fixed platform state -----------------------------------------------------

create type connector_connection_status as enum (
  'authorizing',
  'active',
  'degraded',
  'reauthorization_required',
  'revoking',
  'disconnected',
  'disconnected_unconfirmed'
);

create type connector_action_intent_state as enum (
  'pending',
  'approved',
  'rejected',
  'editing',
  'queued',
  'executing',
  'succeeded',
  'failed',
  'cancelled'
);

create type connector_approval_decision as enum ('approved', 'rejected');

create type connector_job_state as enum (
  'queued',
  'leased',
  'executing',
  'retry_wait',
  'reconciliation_required',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled'
);

create type connector_receipt_event_type as enum (
  'intent.created',
  'intent.edited',
  'intent.approved',
  'intent.rejected',
  'job.queued',
  'attempt.started',
  'provider.accepted',
  'provider.final',
  'provider.failed',
  'provider.unknown',
  'job.retry-scheduled',
  'job.reconciled',
  'job.failed',
  'reconciliation.started',
  'reconciliation.resolved',
  'webhook.accepted',
  'webhook.rejected',
  'revocation.requested',
  'revocation.completed',
  'connection.probed',
  'connection.tested',
  'connection.disconnected',
  'lease.expired',
  'job.cancelled',
  'job.retried'
);

create type connector_approval_mode as enum (
  'owner_required',
  'system_read_only',
  'system_inbound'
);

-- Private cryptographic authority -----------------------------------------

create schema connector_private;

revoke all on schema connector_private from public;
revoke all on schema connector_private from anon;
revoke all on schema connector_private from authenticated;
grant usage on schema connector_private to service_role;

create table connector_private.connector_payload_envelopes (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete restrict,
  connection_id       uuid not null,
  payload_kind        text not null,
  schema_version      text not null,
  canonical_hash      text not null,
  ciphertext          bytea,
  nonce               bytea,
  auth_tag             bytea,
  wrapped_dek          bytea,
  wrap_nonce           bytea,
  wrap_auth_tag        bytea,
  kek_version          text not null,
  aad_hash             text not null,
  envelope_version     integer not null default 1,
  destroyed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint connector_payload_envelopes_id_workspace_unique
    unique (id, workspace_id),
  constraint connector_payload_envelopes_kind check (
    payload_kind ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_payload_envelopes_schema_version check (
    schema_version ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_payload_envelopes_hashes check (
    canonical_hash ~ '^[0-9a-f]{64}$'
    and aad_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_payload_envelopes_kek_version check (
    kek_version ~ '^[A-Za-z0-9_.-]{1,64}$'
  ),
  constraint connector_payload_envelopes_version check (envelope_version > 0),
  constraint connector_payload_envelopes_crypto_state check (
    (
      destroyed_at is null
      and ciphertext is not null and octet_length(ciphertext) > 0
      and nonce is not null and octet_length(nonce) = 12
      and auth_tag is not null and octet_length(auth_tag) = 16
      and wrapped_dek is not null and octet_length(wrapped_dek) > 0
      and wrap_nonce is not null and octet_length(wrap_nonce) = 12
      and wrap_auth_tag is not null and octet_length(wrap_auth_tag) = 16
    )
    or (
      destroyed_at is not null
      and ciphertext is null and nonce is null and auth_tag is null
      and wrapped_dek is null and wrap_nonce is null and wrap_auth_tag is null
    )
  )
);

-- Public metadata is declared before the remaining private tables so every
-- private foreign key can bind workspace and connection together.

create table public.connector_connections (
  id                            uuid primary key default gen_random_uuid(),
  workspace_id                  uuid not null references public.workspaces (id) on delete restrict,
  provider                      text not null,
  provider_account_key_hash     text,
  display_label                 text not null,
  status                        connector_connection_status not null default 'authorizing',
  granted_scopes                text[] not null default '{}',
  remote_identity_summary       jsonb not null default '{}'::jsonb,
  last_probe_at                 timestamptz,
  last_error_category           text,
  created_by_membership_id      uuid not null,
  disconnected_at               timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint connector_connections_id_workspace_unique unique (id, workspace_id),
  constraint connector_connections_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_connections_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_connections_account_hash check (
    provider_account_key_hash is null
    or provider_account_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_connections_label check (
    length(trim(display_label)) between 1 and 120
  ),
  constraint connector_connections_scope_values check (
    array_length(granted_scopes, 1) is null
    or cardinality(granted_scopes) <= 64
  ),
  constraint connector_connections_remote_summary check (
    jsonb_typeof(remote_identity_summary) = 'object'
    and octet_length(remote_identity_summary::text) <= 4096
  ),
  constraint connector_connections_error_category check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_connections_disconnect_state check (
    (status in ('disconnected', 'disconnected_unconfirmed') and disconnected_at is not null)
    or (status not in ('disconnected', 'disconnected_unconfirmed') and disconnected_at is null)
  )
);

-- Resolve the forward reference created above after both tables exist.
alter table connector_private.connector_payload_envelopes
  add constraint connector_payload_envelopes_connection_workspace_fk
  foreign key (connection_id, workspace_id)
  references public.connector_connections (id, workspace_id)
  on delete restrict
  not valid;

alter table connector_private.connector_payload_envelopes
  validate constraint connector_payload_envelopes_connection_workspace_fk;

create unique index connector_connections_active_remote_account_idx
  on public.connector_connections (workspace_id, provider, provider_account_key_hash)
  where provider_account_key_hash is not null
    and status in ('authorizing', 'active', 'degraded', 'reauthorization_required', 'revoking');

create index connector_connections_workspace_status_idx
  on public.connector_connections (workspace_id, status, updated_at desc);

create table connector_private.connector_connection_secrets (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete restrict,
  connection_id       uuid not null,
  secret_type         text not null,
  secret_version      integer not null default 1,
  ciphertext          bytea,
  nonce               bytea,
  auth_tag             bytea,
  wrapped_dek          bytea,
  wrap_nonce           bytea,
  wrap_auth_tag        bytea,
  kek_version          text not null,
  aad_hash             text not null,
  expires_at           timestamptz,
  refreshed_at         timestamptz,
  destroyed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint connector_connection_secrets_connection_unique
    unique (connection_id, secret_type),
  constraint connector_connection_secrets_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_connection_secrets_type check (
    secret_type ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_connection_secrets_version check (secret_version > 0),
  constraint connector_connection_secrets_kek_version check (
    kek_version ~ '^[A-Za-z0-9_.-]{1,64}$'
  ),
  constraint connector_connection_secrets_aad_hash check (
    aad_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_connection_secrets_crypto_state check (
    (
      destroyed_at is null
      and ciphertext is not null and octet_length(ciphertext) > 0
      and nonce is not null and octet_length(nonce) = 12
      and auth_tag is not null and octet_length(auth_tag) = 16
      and wrapped_dek is not null and octet_length(wrapped_dek) > 0
      and wrap_nonce is not null and octet_length(wrap_nonce) = 12
      and wrap_auth_tag is not null and octet_length(wrap_auth_tag) = 16
    )
    or (
      destroyed_at is not null
      and ciphertext is null and nonce is null and auth_tag is null
      and wrapped_dek is null and wrap_nonce is null and wrap_auth_tag is null
    )
  )
);

create index connector_connection_secrets_kek_version_idx
  on connector_private.connector_connection_secrets (kek_version)
  where destroyed_at is null;

create table connector_private.connector_oauth_transactions (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces (id) on delete restrict,
  connection_id               uuid,
  provider                    text not null,
  state_hash                  text not null unique,
  requested_scope_bundle      text not null,
  requested_scopes            text[] not null,
  actor_user_id               uuid not null references auth.users (id) on delete restrict,
  membership_id               uuid not null,
  session_binding_hash        text not null,
  redirect_uri                text not null,
  safe_return_path            text not null,
  pkce_ciphertext             bytea not null,
  pkce_nonce                  bytea not null,
  pkce_auth_tag               bytea not null,
  pkce_wrapped_dek            bytea not null,
  pkce_wrap_nonce             bytea not null,
  pkce_wrap_auth_tag          bytea not null,
  kek_version                 text not null,
  aad_hash                    text not null,
  expires_at                  timestamptz not null,
  consumed_at                 timestamptz,
  created_at                  timestamptz not null default now(),

  constraint connector_oauth_transactions_membership_workspace_fk
    foreign key (membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_oauth_transactions_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_oauth_transactions_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_oauth_transactions_hashes check (
    state_hash ~ '^[0-9a-f]{64}$'
    and session_binding_hash ~ '^[0-9a-f]{64}$'
    and aad_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_oauth_transactions_scope_bundle check (
    requested_scope_bundle ~ '^[a-z][a-z0-9_.-]{1,79}$'
    and cardinality(requested_scopes) between 1 and 64
  ),
  constraint connector_oauth_transactions_redirect check (
    length(redirect_uri) between 8 and 2048
    and safe_return_path ~ '^/[^/].*|^/$'
    and length(safe_return_path) <= 512
  ),
  constraint connector_oauth_transactions_pkce_crypto check (
    octet_length(pkce_ciphertext) > 0
    and octet_length(pkce_nonce) = 12
    and octet_length(pkce_auth_tag) = 16
    and octet_length(pkce_wrapped_dek) > 0
    and octet_length(pkce_wrap_nonce) = 12
    and octet_length(pkce_wrap_auth_tag) = 16
  ),
  constraint connector_oauth_transactions_expiry check (expires_at > created_at),
  constraint connector_oauth_transactions_consumed check (
    consumed_at is null or consumed_at >= created_at
  )
);

create index connector_oauth_transactions_expiry_idx
  on connector_private.connector_oauth_transactions (expires_at)
  where consumed_at is null;

create table connector_private.connector_sync_cursors (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete restrict,
  connection_id       uuid not null,
  stream_key          text not null,
  cursor_version      integer not null default 1,
  ciphertext          bytea not null,
  nonce               bytea not null,
  auth_tag             bytea not null,
  wrapped_dek          bytea not null,
  wrap_nonce           bytea not null,
  wrap_auth_tag        bytea not null,
  kek_version          text not null,
  aad_hash             text not null,
  expires_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint connector_sync_cursors_connection_stream_unique
    unique (connection_id, stream_key),
  constraint connector_sync_cursors_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_sync_cursors_stream check (
    stream_key ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_sync_cursors_version check (cursor_version > 0),
  constraint connector_sync_cursors_hash check (aad_hash ~ '^[0-9a-f]{64}$'),
  constraint connector_sync_cursors_crypto check (
    octet_length(ciphertext) > 0
    and octet_length(nonce) = 12
    and octet_length(auth_tag) = 16
    and octet_length(wrapped_dek) > 0
    and octet_length(wrap_nonce) = 12
    and octet_length(wrap_auth_tag) = 16
  )
);

create table connector_private.connector_webhook_bindings (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete restrict,
  connection_id       uuid not null,
  provider            text not null,
  endpoint_key_hash   text not null unique,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),

  constraint connector_webhook_bindings_connection_unique unique (connection_id),
  constraint connector_webhook_bindings_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_webhook_bindings_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_webhook_bindings_endpoint_hash check (
    endpoint_key_hash ~ '^[0-9a-f]{64}$'
  )
);

-- Workspace-visible intent, policy, job and evidence authority -------------

create table public.connector_automation_policies (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  action_type               text not null,
  version                   integer not null,
  approval_mode             connector_approval_mode not null default 'owner_required',
  allowlisted_actions       text[] not null,
  target_constraints        jsonb not null default '{}'::jsonb,
  compliance_requirements   jsonb not null default '{}'::jsonb,
  execution_limits          jsonb not null default '{}'::jsonb,
  created_by_membership_id  uuid not null,
  correlation_id            uuid not null,
  created_at                timestamptz not null default now(),

  constraint connector_automation_policies_workspace_action_version_unique
    unique (workspace_id, action_type, version),
  constraint connector_automation_policies_id_workspace_unique
    unique (id, workspace_id),
  constraint connector_automation_policies_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_automation_policies_action check (
    action_type ~ '^[a-z][a-z0-9]*([.-][a-z0-9]+)*$'
    and length(action_type) <= 96
    and version > 0
  ),
  constraint connector_automation_policies_allowlist check (
    cardinality(allowlisted_actions) between 1 and 64
    and action_type = any(allowlisted_actions)
  ),
  constraint connector_automation_policies_json check (
    jsonb_typeof(target_constraints) = 'object'
    and jsonb_typeof(compliance_requirements) = 'object'
    and jsonb_typeof(execution_limits) = 'object'
    and octet_length(target_constraints::text) <= 8192
    and octet_length(compliance_requirements::text) <= 8192
    and octet_length(execution_limits::text) <= 8192
  )
);

create index connector_automation_policies_current_idx
  on public.connector_automation_policies (workspace_id, action_type, version desc);

create table public.connector_action_intents (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  connection_id             uuid not null,
  provider                  text not null,
  action_type               text not null,
  summary                   text not null,
  state                     connector_action_intent_state not null default 'pending',
  current_version           integer not null default 1,
  created_by_membership_id  uuid not null,
  correlation_id            uuid not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint connector_action_intents_id_workspace_unique unique (id, workspace_id),
  constraint connector_action_intents_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_action_intents_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_action_intents_action check (
    action_type ~ '^[a-z][a-z0-9]*([.-][a-z0-9]+)*$'
    and length(action_type) <= 96
  ),
  constraint connector_action_intents_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_action_intents_summary check (
    length(trim(summary)) between 1 and 500
  ),
  constraint connector_action_intents_version check (current_version > 0)
);

create index connector_action_intents_workspace_state_idx
  on public.connector_action_intents (workspace_id, state, updated_at desc);

create table public.connector_action_intent_versions (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  intent_id                 uuid not null,
  version                   integer not null,
  connection_id             uuid not null,
  action_type               text not null,
  payload_ref               uuid not null,
  payload_hash              text not null,
  policy_id                 uuid not null,
  policy_version            integer not null,
  compliance_snapshot       jsonb not null default '{}'::jsonb,
  created_by_membership_id  uuid not null,
  correlation_id            uuid not null,
  created_at                timestamptz not null default now(),

  constraint connector_action_intent_versions_intent_version_unique
    unique (intent_id, version),
  constraint connector_action_intent_versions_id_workspace_unique
    unique (id, workspace_id),
  constraint connector_action_intent_versions_intent_workspace_fk
    foreign key (intent_id, workspace_id)
    references public.connector_action_intents (id, workspace_id)
    on delete restrict,
  constraint connector_action_intent_versions_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_action_intent_versions_payload_workspace_fk
    foreign key (payload_ref, workspace_id)
    references connector_private.connector_payload_envelopes (id, workspace_id)
    on delete restrict,
  constraint connector_action_intent_versions_policy_workspace_fk
    foreign key (policy_id, workspace_id)
    references public.connector_automation_policies (id, workspace_id)
    on delete restrict,
  constraint connector_action_intent_versions_creator_workspace_fk
    foreign key (created_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_action_intent_versions_version check (
    version > 0 and policy_version > 0
  ),
  constraint connector_action_intent_versions_action check (
    action_type ~ '^[a-z][a-z0-9]*([.-][a-z0-9]+)*$'
    and length(action_type) <= 96
  ),
  constraint connector_action_intent_versions_payload_hash check (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_action_intent_versions_compliance check (
    jsonb_typeof(compliance_snapshot) = 'object'
    and octet_length(compliance_snapshot::text) <= 8192
  )
);

create table public.connector_approval_events (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  intent_id                 uuid not null,
  intent_version_id         uuid not null,
  intent_version            integer not null,
  connection_id             uuid not null,
  payload_hash              text not null,
  decision                  connector_approval_decision not null,
  actor_user_id             uuid not null references auth.users (id) on delete restrict,
  actor_membership_id       uuid not null,
  actor_role_snapshot       workspace_role not null,
  policy_id                 uuid not null,
  policy_version            integer not null,
  reason                    text,
  correlation_id            uuid not null,
  occurred_at               timestamptz not null default now(),

  constraint connector_approval_events_version_decision_unique
    unique (intent_version_id),
  constraint connector_approval_events_intent_workspace_fk
    foreign key (intent_id, workspace_id)
    references public.connector_action_intents (id, workspace_id)
    on delete restrict,
  constraint connector_approval_events_version_workspace_fk
    foreign key (intent_version_id, workspace_id)
    references public.connector_action_intent_versions (id, workspace_id)
    on delete restrict,
  constraint connector_approval_events_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_approval_events_actor_workspace_fk
    foreign key (actor_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id)
    on delete restrict,
  constraint connector_approval_events_policy_workspace_fk
    foreign key (policy_id, workspace_id)
    references public.connector_automation_policies (id, workspace_id)
    on delete restrict,
  constraint connector_approval_events_hash check (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_approval_events_version check (
    intent_version > 0 and policy_version > 0
  ),
  constraint connector_approval_events_reason check (
    reason is null or length(reason) <= 500
  )
);

create index connector_approval_events_workspace_occurred_idx
  on public.connector_approval_events (workspace_id, occurred_at desc);

create table public.connector_jobs (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  connection_id             uuid not null,
  intent_id                 uuid not null,
  intent_version_id         uuid not null,
  intent_version            integer not null,
  provider                  text not null,
  action_type               text not null,
  schema_version            text not null,
  payload_ref               uuid not null,
  payload_hash              text not null,
  policy_id                 uuid not null,
  policy_version            integer not null,
  idempotency_key           text not null,
  correlation_id            uuid not null,
  priority                  smallint not null default 0,
  state                     connector_job_state not null default 'queued',
  scheduled_at              timestamptz not null default now(),
  attempt_count             integer not null default 0,
  max_attempts              integer not null default 5,
  lease_owner               uuid,
  lease_expires_at          timestamptz,
  fencing_token             bigint not null default 0,
  last_error_category       text,
  provider_request_hash     text,
  remote_operation_id       text,
  completed_at              timestamptz,
  cancelled_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint connector_jobs_workspace_idempotency_unique
    unique (workspace_id, idempotency_key),
  constraint connector_jobs_intent_version_unique
    unique (intent_version_id),
  constraint connector_jobs_id_workspace_unique unique (id, workspace_id),
  constraint connector_jobs_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_jobs_intent_workspace_fk
    foreign key (intent_id, workspace_id)
    references public.connector_action_intents (id, workspace_id)
    on delete restrict,
  constraint connector_jobs_version_workspace_fk
    foreign key (intent_version_id, workspace_id)
    references public.connector_action_intent_versions (id, workspace_id)
    on delete restrict,
  constraint connector_jobs_payload_workspace_fk
    foreign key (payload_ref, workspace_id)
    references connector_private.connector_payload_envelopes (id, workspace_id)
    on delete restrict,
  constraint connector_jobs_policy_workspace_fk
    foreign key (policy_id, workspace_id)
    references public.connector_automation_policies (id, workspace_id)
    on delete restrict,
  constraint connector_jobs_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_jobs_action_schema check (
    action_type ~ '^[a-z][a-z0-9]*([.-][a-z0-9]+)*$'
    and length(action_type) <= 96
    and schema_version ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_jobs_payload_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint connector_jobs_idempotency check (
    length(idempotency_key) between 1 and 128
    and idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  constraint connector_jobs_priority check (priority between -100 and 100),
  constraint connector_jobs_attempts check (
    attempt_count >= 0 and max_attempts between 1 and 20
    and attempt_count <= max_attempts
  ),
  constraint connector_jobs_fencing check (fencing_token >= 0),
  constraint connector_jobs_error_category check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_jobs_request_hash check (
    provider_request_hash is null
    or provider_request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_jobs_lease_pair check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint connector_jobs_state_lease check (
    (state in ('leased', 'executing') and lease_owner is not null)
    or (state = 'reconciliation_required')
    or (state not in ('leased', 'executing', 'reconciliation_required') and lease_owner is null)
  ),
  constraint connector_jobs_terminal_timestamps check (
    (state in ('succeeded', 'failed', 'dead_letter') and completed_at is not null and cancelled_at is null)
    or (state = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (state not in ('succeeded', 'failed', 'dead_letter', 'cancelled')
        and completed_at is null and cancelled_at is null)
  )
);

create index connector_jobs_due_claim_idx
  on public.connector_jobs (priority desc, scheduled_at, created_at, id)
  where state in ('queued', 'retry_wait');

create index connector_jobs_reconciliation_claim_idx
  on public.connector_jobs (scheduled_at, created_at, id)
  where state = 'reconciliation_required';

create index connector_jobs_expired_lease_idx
  on public.connector_jobs (lease_expires_at, id)
  where lease_owner is not null;

create index connector_jobs_workspace_state_idx
  on public.connector_jobs (workspace_id, state, scheduled_at);

create table public.connector_receipt_events (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  connection_id             uuid not null,
  provider                  text not null,
  job_id                    uuid,
  intent_id                 uuid,
  intent_version_id         uuid,
  event_type                connector_receipt_event_type not null,
  event_key                 text not null,
  correlation_id            uuid not null,
  attempt_number            integer,
  fencing_token             bigint,
  provider_request_hash     text,
  remote_operation_id       text,
  provider_status           text,
  error_category            text,
  reconciliation_result     text,
  redacted_metadata         jsonb not null default '{}'::jsonb,
  occurred_at               timestamptz not null default now(),

  constraint connector_receipt_events_workspace_event_key_unique
    unique (workspace_id, event_key),
  constraint connector_receipt_events_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_receipt_events_job_workspace_fk
    foreign key (job_id, workspace_id)
    references public.connector_jobs (id, workspace_id)
    on delete restrict,
  constraint connector_receipt_events_intent_workspace_fk
    foreign key (intent_id, workspace_id)
    references public.connector_action_intents (id, workspace_id)
    on delete restrict,
  constraint connector_receipt_events_version_workspace_fk
    foreign key (intent_version_id, workspace_id)
    references public.connector_action_intent_versions (id, workspace_id)
    on delete restrict,
  constraint connector_receipt_events_event_key check (
    length(event_key) between 8 and 200
  ),
  constraint connector_receipt_events_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_receipt_events_attempt check (
    attempt_number is null or attempt_number > 0
  ),
  constraint connector_receipt_events_fencing check (
    fencing_token is null or fencing_token >= 0
  ),
  constraint connector_receipt_events_request_hash check (
    provider_request_hash is null
    or provider_request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_receipt_events_error_category check (
    error_category is null
    or error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint connector_receipt_events_metadata check (
    jsonb_typeof(redacted_metadata) = 'object'
    and octet_length(redacted_metadata::text) <= 8192
  )
);

create index connector_receipt_events_workspace_occurred_idx
  on public.connector_receipt_events (workspace_id, occurred_at desc);

create index connector_receipt_events_job_occurred_idx
  on public.connector_receipt_events (job_id, occurred_at)
  where job_id is not null;

create table public.connector_webhook_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete restrict,
  connection_id         uuid not null,
  provider              text not null,
  replay_key_hash       text not null,
  raw_body_hash         text not null,
  signature_valid       boolean not null,
  timestamp_valid       boolean not null,
  outcome               text not null,
  correlation_id        uuid not null,
  received_at           timestamptz not null,
  processed_at          timestamptz,
  redacted_result       text,
  created_at            timestamptz not null default now(),

  constraint connector_webhook_deliveries_connection_replay_unique
    unique (connection_id, replay_key_hash),
  constraint connector_webhook_deliveries_id_workspace_unique unique (id, workspace_id),
  constraint connector_webhook_deliveries_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id)
    on delete restrict,
  constraint connector_webhook_deliveries_provider check (
    provider ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  constraint connector_webhook_deliveries_hashes check (
    replay_key_hash ~ '^[0-9a-f]{64}$'
    and raw_body_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint connector_webhook_deliveries_outcome check (
    outcome in ('accepted', 'rejected')
    and (
      (outcome = 'accepted' and signature_valid and timestamp_valid)
      or outcome = 'rejected'
    )
  ),
  constraint connector_webhook_deliveries_result check (
    redacted_result is null or length(redacted_result) <= 500
  )
);

create index connector_webhook_deliveries_workspace_received_idx
  on public.connector_webhook_deliveries (workspace_id, received_at desc);

-- Defense-in-depth mutation guards ----------------------------------------

create or replace function public.connector_current_membership(
  target_workspace_id uuid,
  require_owner boolean default false
)
returns public.workspace_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  membership public.workspace_members%rowtype;
begin
  if caller_id is null then
    raise exception 'authenticated connector actor required' using errcode = '42501';
  end if;

  select candidate.*
    into membership
  from public.workspace_members candidate
  where candidate.workspace_id = target_workspace_id
    and candidate.user_id = caller_id
    and candidate.status = 'active';

  if not found then
    raise exception 'active workspace membership required' using errcode = '42501';
  end if;

  if require_owner and membership.role <> 'owner' then
    raise exception 'workspace owner authority required' using errcode = '42501';
  end if;

  return membership;
end;
$$;

revoke all on function public.connector_current_membership(uuid, boolean) from public;

create or replace function public.guard_connector_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

revoke all on function public.guard_connector_append_only() from public;

create or replace function public.prepare_connector_connection_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.provider <> old.provider
     or new.created_by_membership_id <> old.created_by_membership_id
     or new.created_at <> old.created_at then
    raise exception 'connector connection identity is immutable' using errcode = '55000';
  end if;

  if new.status <> old.status and not (
    (old.status = 'authorizing' and new.status in ('active', 'reauthorization_required', 'disconnected_unconfirmed'))
    or (old.status = 'active' and new.status in ('degraded', 'reauthorization_required', 'revoking'))
    or (old.status = 'degraded' and new.status in ('active', 'reauthorization_required', 'revoking'))
    or (old.status = 'reauthorization_required' and new.status in ('authorizing', 'active', 'revoking'))
    or (old.status = 'revoking' and new.status in ('disconnected', 'disconnected_unconfirmed'))
    or (old.status in ('disconnected', 'disconnected_unconfirmed') and new.status = 'authorizing')
  ) then
    raise exception 'invalid connector connection transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_connector_action_intent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id
     or new.provider <> old.provider
     or new.action_type <> old.action_type
     or new.created_by_membership_id <> old.created_by_membership_id
     or new.correlation_id <> old.correlation_id
     or new.created_at <> old.created_at then
    raise exception 'connector action intent identity is immutable' using errcode = '55000';
  end if;

  if new.current_version < old.current_version
     or new.current_version > old.current_version + 1 then
    raise exception 'connector intent versions must advance exactly once'
      using errcode = '23514';
  end if;

  if new.state <> old.state and not (
    (old.state in ('pending', 'editing') and new.state in ('pending', 'rejected', 'queued'))
    or (old.state in ('rejected', 'cancelled') and new.state = 'pending')
    or (old.state = 'failed' and new.state in ('pending', 'queued'))
    or (old.state = 'queued' and new.state in ('executing', 'cancelled', 'failed'))
    or (old.state = 'executing' and new.state in ('succeeded', 'failed', 'cancelled'))
  ) then
    raise exception 'invalid connector intent transition: % -> %', old.state, new.state
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_connector_job_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id
     or new.intent_id <> old.intent_id
     or new.intent_version_id <> old.intent_version_id
     or new.intent_version <> old.intent_version
     or new.provider <> old.provider
     or new.action_type <> old.action_type
     or new.schema_version <> old.schema_version
     or new.payload_ref <> old.payload_ref
     or new.payload_hash <> old.payload_hash
     or new.policy_id <> old.policy_id
     or new.policy_version <> old.policy_version
     or new.idempotency_key <> old.idempotency_key
     or new.correlation_id <> old.correlation_id
     or new.created_at <> old.created_at then
    raise exception 'connector job authorization binding is immutable' using errcode = '55000';
  end if;

  if new.fencing_token < old.fencing_token then
    raise exception 'connector job fencing token cannot decrease' using errcode = '23514';
  end if;

  if new.state <> old.state and not (
    (old.state in ('queued', 'retry_wait') and new.state in ('leased', 'cancelled'))
    or (old.state = 'leased' and new.state in ('executing', 'queued', 'dead_letter'))
    or (old.state = 'executing' and new.state in (
      'succeeded', 'retry_wait', 'reconciliation_required', 'failed', 'dead_letter'
    ))
    or (old.state = 'reconciliation_required' and new.state in (
      'succeeded', 'retry_wait', 'failed', 'dead_letter'
    ))
    or (old.state in ('failed', 'dead_letter') and new.state = 'queued')
  ) then
    raise exception 'invalid connector job transition: % -> %', old.state, new.state
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_connector_receipt_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_provider text;
begin
  select connection.provider into connection_provider
  from public.connector_connections connection
  where connection.id = new.connection_id
    and connection.workspace_id = new.workspace_id;

  if not found then
    raise exception 'connector receipt connection binding is invalid'
      using errcode = '23503';
  end if;

  if new.provider is not null and new.provider <> connection_provider then
    raise exception 'connector receipt provider binding is invalid'
      using errcode = '23514';
  end if;

  new.provider := connection_provider;
  return new;
end;
$$;

revoke all on function public.prepare_connector_connection_update() from public;
revoke all on function public.prepare_connector_action_intent_update() from public;
revoke all on function public.prepare_connector_job_update() from public;
revoke all on function public.prepare_connector_receipt_insert() from public;

create trigger connector_connections_prepare_update
  before update on public.connector_connections
  for each row execute function public.prepare_connector_connection_update();

create trigger connector_action_intents_prepare_update
  before update on public.connector_action_intents
  for each row execute function public.prepare_connector_action_intent_update();

create trigger connector_jobs_prepare_update
  before update on public.connector_jobs
  for each row execute function public.prepare_connector_job_update();

create trigger connector_receipt_events_prepare_insert
  before insert on public.connector_receipt_events
  for each row execute function public.prepare_connector_receipt_insert();

create trigger connector_automation_policies_guard_update
  before update or delete on public.connector_automation_policies
  for each row execute function public.guard_connector_append_only();

create trigger connector_action_intent_versions_guard_update
  before update or delete on public.connector_action_intent_versions
  for each row execute function public.guard_connector_append_only();

create trigger connector_approval_events_guard_update
  before update or delete on public.connector_approval_events
  for each row execute function public.guard_connector_append_only();

create trigger connector_receipt_events_guard_update
  before update or delete on public.connector_receipt_events
  for each row execute function public.guard_connector_append_only();

-- Row-level authorization and grants --------------------------------------

alter table public.connector_connections enable row level security;
alter table public.connector_connections force row level security;
alter table public.connector_automation_policies enable row level security;
alter table public.connector_automation_policies force row level security;
alter table public.connector_action_intents enable row level security;
alter table public.connector_action_intents force row level security;
alter table public.connector_action_intent_versions enable row level security;
alter table public.connector_action_intent_versions force row level security;
alter table public.connector_approval_events enable row level security;
alter table public.connector_approval_events force row level security;
alter table public.connector_jobs enable row level security;
alter table public.connector_jobs force row level security;
alter table public.connector_receipt_events enable row level security;
alter table public.connector_receipt_events force row level security;
alter table public.connector_webhook_deliveries enable row level security;
alter table public.connector_webhook_deliveries force row level security;

alter table connector_private.connector_connection_secrets enable row level security;
alter table connector_private.connector_connection_secrets force row level security;
alter table connector_private.connector_oauth_transactions enable row level security;
alter table connector_private.connector_oauth_transactions force row level security;
alter table connector_private.connector_payload_envelopes enable row level security;
alter table connector_private.connector_payload_envelopes force row level security;
alter table connector_private.connector_sync_cursors enable row level security;
alter table connector_private.connector_sync_cursors force row level security;
alter table connector_private.connector_webhook_bindings enable row level security;
alter table connector_private.connector_webhook_bindings force row level security;

create policy connector_connections_member_select
  on public.connector_connections for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_automation_policies_member_select
  on public.connector_automation_policies for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_action_intents_member_select
  on public.connector_action_intents for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_action_intent_versions_member_select
  on public.connector_action_intent_versions for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_approval_events_member_select
  on public.connector_approval_events for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_jobs_member_select
  on public.connector_jobs for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_receipt_events_member_select
  on public.connector_receipt_events for select to authenticated
  using (public.has_workspace_access(workspace_id));

create policy connector_webhook_deliveries_owner_select
  on public.connector_webhook_deliveries for select to authenticated
  using (public.is_workspace_owner(workspace_id));

revoke all on all tables in schema connector_private from public;
revoke all on all tables in schema connector_private from anon;
revoke all on all tables in schema connector_private from authenticated;
revoke all on all tables in schema connector_private from service_role;

alter default privileges in schema connector_private revoke all on tables from public;
alter default privileges in schema connector_private revoke all on tables from anon;
alter default privileges in schema connector_private revoke all on tables from authenticated;
alter default privileges in schema connector_private revoke all on tables from service_role;

revoke all on table public.connector_connections from anon, authenticated, service_role;
revoke all on table public.connector_automation_policies from anon, authenticated, service_role;
revoke all on table public.connector_action_intents from anon, authenticated, service_role;
revoke all on table public.connector_action_intent_versions from anon, authenticated, service_role;
revoke all on table public.connector_approval_events from anon, authenticated, service_role;
revoke all on table public.connector_jobs from anon, authenticated, service_role;
revoke all on table public.connector_receipt_events from anon, authenticated, service_role;
revoke all on table public.connector_webhook_deliveries from anon, authenticated, service_role;

grant select on table public.connector_connections to authenticated, service_role;
grant select on table public.connector_automation_policies to authenticated, service_role;
grant select on table public.connector_action_intents to authenticated, service_role;
grant select on table public.connector_action_intent_versions to authenticated, service_role;
grant select on table public.connector_approval_events to authenticated, service_role;
grant select on table public.connector_jobs to authenticated, service_role;
grant select on table public.connector_receipt_events to authenticated, service_role;
grant select on table public.connector_webhook_deliveries to authenticated, service_role;

-- Owner/member application RPCs ------------------------------------------

create or replace function public.create_connector_connection(
  target_workspace_id uuid,
  target_provider text,
  target_display_label text,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  created_connection public.connector_connections%rowtype;
begin
  actor := public.connector_current_membership(target_workspace_id, true);

  if target_provider is null
     or target_provider !~ '^[a-z][a-z0-9-]{1,31}$'
     or target_display_label is null
     or target_correlation_id is null then
    raise exception 'invalid connector connection request' using errcode = '22023';
  end if;

  insert into public.connector_connections (
    workspace_id, provider, display_label, created_by_membership_id
  ) values (
    target_workspace_id, target_provider, target_display_label, actor.id
  )
  returning * into created_connection;

  return jsonb_build_object(
    'connection', to_jsonb(created_connection),
    'correlationId', target_correlation_id,
    'noOp', false
  );
end;
$$;

create or replace function public.request_connector_disconnect(
  target_connection_id uuid,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  no_op boolean := false;
begin
  if target_correlation_id is null then
    raise exception 'correlation ID is required' using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
  for update;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_connection.workspace_id, true);

  if target_connection.status in ('disconnected', 'disconnected_unconfirmed', 'revoking') then
    no_op := true;
  elsif target_connection.status in ('active', 'degraded', 'reauthorization_required') then
    update public.connector_connections
       set status = 'revoking'
     where id = target_connection.id
     returning * into target_connection;

    insert into public.connector_receipt_events (
      workspace_id, connection_id, event_type, event_key, correlation_id,
      redacted_metadata
    ) values (
      target_connection.workspace_id,
      target_connection.id,
      'revocation.requested',
      'revocation.requested:' || target_correlation_id::text,
      target_correlation_id,
      jsonb_build_object('actorMembershipId', actor.id)
    );
  else
    raise exception 'connection cannot be disconnected from state %', target_connection.status
      using errcode = '23514';
  end if;

  return jsonb_build_object('connection', to_jsonb(target_connection), 'noOp', no_op);
end;
$$;

create or replace function public.create_connector_automation_policy(
  target_workspace_id uuid,
  target_action_type text,
  target_allowlisted_actions text[],
  target_target_constraints jsonb,
  target_compliance_requirements jsonb,
  target_execution_limits jsonb,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  next_version integer;
  created_policy public.connector_automation_policies%rowtype;
begin
  actor := public.connector_current_membership(target_workspace_id, true);

  if target_action_type is null
     or target_action_type !~ '^[a-z][a-z0-9]*([.-][a-z0-9]+)*$'
     or length(target_action_type) > 96
     or target_correlation_id is null then
    raise exception 'invalid connector policy request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text || ':' || target_action_type, 0));

  select coalesce(max(policy.version), 0) + 1
    into next_version
  from public.connector_automation_policies policy
  where policy.workspace_id = target_workspace_id
    and policy.action_type = target_action_type;

  insert into public.connector_automation_policies (
    workspace_id, action_type, version, approval_mode, allowlisted_actions,
    target_constraints, compliance_requirements, execution_limits,
    created_by_membership_id, correlation_id
  ) values (
    target_workspace_id,
    target_action_type,
    next_version,
    'owner_required',
    target_allowlisted_actions,
    coalesce(target_target_constraints, '{}'::jsonb),
    coalesce(target_compliance_requirements, '{}'::jsonb),
    coalesce(target_execution_limits, '{}'::jsonb),
    actor.id,
    target_correlation_id
  )
  returning * into created_policy;

  return jsonb_build_object('policy', to_jsonb(created_policy), 'noOp', false);
end;
$$;

create or replace function public.create_connector_action_intent(
  target_connection_id uuid,
  target_action_type text,
  target_summary text,
  target_payload_ref uuid,
  target_payload_hash text,
  target_policy_id uuid,
  target_policy_version integer,
  target_compliance_snapshot jsonb,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_policy public.connector_automation_policies%rowtype;
  created_intent public.connector_action_intents%rowtype;
  created_version public.connector_action_intent_versions%rowtype;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_connection.workspace_id, false);

  if target_connection.status not in ('active', 'degraded') then
    raise exception 'connector connection is not available for an action intent'
      using errcode = '23514';
  end if;

  select payload.* into target_payload
  from connector_private.connector_payload_envelopes payload
  where payload.id = target_payload_ref
    and payload.workspace_id = target_connection.workspace_id
    and payload.connection_id = target_connection.id
    and payload.canonical_hash = target_payload_hash
    and payload.destroyed_at is null;

  if not found then
    raise exception 'payload envelope binding mismatch' using errcode = '23503';
  end if;

  select policy.* into target_policy
  from public.connector_automation_policies policy
  where policy.id = target_policy_id
    and policy.workspace_id = target_connection.workspace_id
    and policy.version = target_policy_version
    and policy.action_type = target_action_type
    and target_action_type = any(policy.allowlisted_actions)
    and policy.approval_mode = 'owner_required';

  if not found then
    raise exception 'owner-required policy binding mismatch' using errcode = '23503';
  end if;

  insert into public.connector_action_intents (
    workspace_id, connection_id, provider, action_type, summary, state,
    current_version, created_by_membership_id, correlation_id
  ) values (
    target_connection.workspace_id, target_connection.id,
    target_connection.provider, target_action_type,
    target_summary, 'pending', 1, actor.id, target_correlation_id
  )
  returning * into created_intent;

  insert into public.connector_action_intent_versions (
    workspace_id, intent_id, version, connection_id, action_type,
    payload_ref, payload_hash, policy_id, policy_version,
    compliance_snapshot, created_by_membership_id, correlation_id
  ) values (
    target_connection.workspace_id, created_intent.id, 1,
    target_connection.id, target_action_type, target_payload_ref,
    target_payload_hash, target_policy_id, target_policy_version,
    coalesce(target_compliance_snapshot, '{}'::jsonb), actor.id,
    target_correlation_id
  )
  returning * into created_version;

  return jsonb_build_object(
    'intent', to_jsonb(created_intent),
    'version', to_jsonb(created_version),
    'noOp', false
  );
end;
$$;

create or replace function public.revise_connector_action_intent(
  target_intent_id uuid,
  target_expected_version integer,
  target_summary text,
  target_payload_ref uuid,
  target_payload_hash text,
  target_policy_id uuid,
  target_policy_version integer,
  target_compliance_snapshot jsonb,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_intent public.connector_action_intents%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_policy public.connector_automation_policies%rowtype;
  created_version public.connector_action_intent_versions%rowtype;
begin
  select intent.* into target_intent
  from public.connector_action_intents intent
  where intent.id = target_intent_id
  for update;

  if not found then
    raise exception 'connector action intent not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_intent.workspace_id, false);

  if target_intent.current_version <> target_expected_version
     or target_intent.state not in ('pending', 'editing', 'rejected', 'failed', 'cancelled') then
    raise exception 'connector intent revision conflict' using errcode = '40001';
  end if;

  select payload.* into target_payload
  from connector_private.connector_payload_envelopes payload
  where payload.id = target_payload_ref
    and payload.workspace_id = target_intent.workspace_id
    and payload.connection_id = target_intent.connection_id
    and payload.canonical_hash = target_payload_hash
    and payload.destroyed_at is null;

  if not found then
    raise exception 'payload envelope binding mismatch' using errcode = '23503';
  end if;

  select policy.* into target_policy
  from public.connector_automation_policies policy
  where policy.id = target_policy_id
    and policy.workspace_id = target_intent.workspace_id
    and policy.version = target_policy_version
    and policy.action_type = target_intent.action_type
    and target_intent.action_type = any(policy.allowlisted_actions)
    and policy.approval_mode = 'owner_required';

  if not found then
    raise exception 'owner-required policy binding mismatch' using errcode = '23503';
  end if;

  insert into public.connector_action_intent_versions (
    workspace_id, intent_id, version, connection_id, action_type,
    payload_ref, payload_hash, policy_id, policy_version,
    compliance_snapshot, created_by_membership_id, correlation_id
  ) values (
    target_intent.workspace_id, target_intent.id, target_expected_version + 1,
    target_intent.connection_id, target_intent.action_type, target_payload_ref,
    target_payload_hash, target_policy_id, target_policy_version,
    coalesce(target_compliance_snapshot, '{}'::jsonb), actor.id,
    target_correlation_id
  )
  returning * into created_version;

  update public.connector_action_intents
     set summary = target_summary,
         state = 'pending',
         current_version = target_expected_version + 1
   where id = target_intent.id
   returning * into target_intent;

  return jsonb_build_object(
    'intent', to_jsonb(target_intent),
    'version', to_jsonb(created_version),
    'noOp', false
  );
end;
$$;

create or replace function public.reject_connector_action_intent(
  target_intent_id uuid,
  target_expected_version integer,
  target_payload_hash text,
  target_reason text,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_intent public.connector_action_intents%rowtype;
  target_version public.connector_action_intent_versions%rowtype;
  existing_event public.connector_approval_events%rowtype;
  created_event public.connector_approval_events%rowtype;
begin
  select intent.* into target_intent
  from public.connector_action_intents intent
  where intent.id = target_intent_id
  for update;

  if not found then
    raise exception 'connector action intent not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_intent.workspace_id, true);

  select version_row.* into target_version
  from public.connector_action_intent_versions version_row
  where version_row.intent_id = target_intent.id
    and version_row.version = target_expected_version;

  if not found
     or target_intent.current_version <> target_expected_version
     or target_version.payload_hash <> target_payload_hash then
    raise exception 'connector approval version or payload hash conflict' using errcode = '40001';
  end if;

  select approval.* into existing_event
  from public.connector_approval_events approval
  where approval.intent_version_id = target_version.id;

  if found then
    if existing_event.decision = 'rejected'
       and existing_event.payload_hash = target_payload_hash then
      return jsonb_build_object(
        'intent', to_jsonb(target_intent),
        'approval', to_jsonb(existing_event),
        'noOp', true
      );
    end if;
    raise exception 'connector intent version already decided' using errcode = '23505';
  end if;

  if target_intent.state not in ('pending', 'editing') then
    raise exception 'connector intent is not pending approval' using errcode = '23514';
  end if;

  insert into public.connector_approval_events (
    workspace_id, intent_id, intent_version_id, intent_version,
    connection_id, payload_hash, decision, actor_user_id,
    actor_membership_id, actor_role_snapshot, policy_id, policy_version,
    reason, correlation_id
  ) values (
    target_intent.workspace_id, target_intent.id, target_version.id,
    target_version.version, target_intent.connection_id,
    target_version.payload_hash, 'rejected', actor.user_id, actor.id,
    actor.role, target_version.policy_id, target_version.policy_version,
    target_reason, target_correlation_id
  )
  returning * into created_event;

  update public.connector_action_intents
     set state = 'rejected'
   where id = target_intent.id
   returning * into target_intent;

  return jsonb_build_object(
    'intent', to_jsonb(target_intent),
    'approval', to_jsonb(created_event),
    'noOp', false
  );
end;
$$;

create or replace function public.approve_and_enqueue_connector_action(
  target_intent_id uuid,
  target_expected_version integer,
  target_payload_hash text,
  target_idempotency_key text,
  target_correlation_id uuid,
  target_scheduled_at timestamptz default now(),
  target_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_intent public.connector_action_intents%rowtype;
  target_version public.connector_action_intent_versions%rowtype;
  target_connection public.connector_connections%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  existing_job public.connector_jobs%rowtype;
  created_job public.connector_jobs%rowtype;
  created_event public.connector_approval_events%rowtype;
  approval_receipt public.connector_receipt_events%rowtype;
  queued_receipt public.connector_receipt_events%rowtype;
begin
  select intent.* into target_intent
  from public.connector_action_intents intent
  where intent.id = target_intent_id
  for update;

  if not found then
    raise exception 'connector action intent not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_intent.workspace_id, true);

  select version_row.* into target_version
  from public.connector_action_intent_versions version_row
  where version_row.intent_id = target_intent.id
    and version_row.version = target_expected_version;

  if not found
     or target_intent.current_version <> target_expected_version
     or target_version.payload_hash <> target_payload_hash then
    raise exception 'connector approval version or payload hash conflict' using errcode = '40001';
  end if;

  select job.* into existing_job
  from public.connector_jobs job
  where job.intent_version_id = target_version.id;

  if found then
    if existing_job.idempotency_key = target_idempotency_key
       and existing_job.payload_hash = target_payload_hash then
      select receipt.* into queued_receipt
      from public.connector_receipt_events receipt
      where receipt.job_id = existing_job.id
        and receipt.event_type = 'job.queued'
      order by receipt.occurred_at
      limit 1;

      return jsonb_build_object(
        'intent', to_jsonb(target_intent),
        'job', to_jsonb(existing_job),
        'receipt', to_jsonb(queued_receipt),
        'noOp', true
      );
    end if;
    raise exception 'connector intent version already queued with different binding'
      using errcode = '23505';
  end if;

  if target_intent.state not in ('pending', 'editing') then
    raise exception 'connector intent is not pending approval' using errcode = '23514';
  end if;

  if target_idempotency_key is null
     or length(target_idempotency_key) not between 1 and 128
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
     or target_correlation_id is null
     or target_max_attempts not between 1 and 20 then
    raise exception 'invalid connector enqueue request' using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_intent.connection_id
    and connection.workspace_id = target_intent.workspace_id
    and connection.status in ('active', 'degraded');

  if not found then
    raise exception 'connector connection is not executable' using errcode = '23514';
  end if;

  select payload.* into target_payload
  from connector_private.connector_payload_envelopes payload
  where payload.id = target_version.payload_ref
    and payload.workspace_id = target_intent.workspace_id
    and payload.connection_id = target_intent.connection_id
    and payload.canonical_hash = target_payload_hash
    and payload.destroyed_at is null;

  if not found then
    raise exception 'payload envelope is missing or destroyed' using errcode = '23503';
  end if;

  insert into public.connector_approval_events (
    workspace_id, intent_id, intent_version_id, intent_version,
    connection_id, payload_hash, decision, actor_user_id,
    actor_membership_id, actor_role_snapshot, policy_id, policy_version,
    correlation_id
  ) values (
    target_intent.workspace_id, target_intent.id, target_version.id,
    target_version.version, target_intent.connection_id,
    target_version.payload_hash, 'approved', actor.user_id, actor.id,
    actor.role, target_version.policy_id, target_version.policy_version,
    target_correlation_id
  )
  returning * into created_event;

  insert into public.connector_jobs (
    workspace_id, connection_id, intent_id, intent_version_id,
    intent_version, provider, action_type, schema_version, payload_ref,
    payload_hash, policy_id, policy_version, idempotency_key,
    correlation_id, scheduled_at, max_attempts
  ) values (
    target_intent.workspace_id, target_intent.connection_id,
    target_intent.id, target_version.id, target_version.version,
    target_connection.provider, target_intent.action_type,
    target_payload.schema_version, target_version.payload_ref,
    target_version.payload_hash, target_version.policy_id,
    target_version.policy_version, target_idempotency_key,
    target_correlation_id, target_scheduled_at, target_max_attempts
  )
  returning * into created_job;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, job_id, intent_id, intent_version_id,
    event_type, event_key, correlation_id, provider_request_hash,
    error_category, redacted_metadata
  ) values (
    target_intent.workspace_id, target_intent.connection_id, created_job.id,
    target_intent.id, target_version.id, 'intent.approved',
    'intent.approved:' || target_version.id::text,
    target_correlation_id, target_payload_hash, 'none',
    jsonb_build_object('actorMembershipId', actor.id)
  )
  returning * into approval_receipt;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, job_id, intent_id, intent_version_id,
    event_type, event_key, correlation_id, provider_request_hash,
    error_category, redacted_metadata
  ) values (
    target_intent.workspace_id, target_intent.connection_id, created_job.id,
    target_intent.id, target_version.id, 'job.queued',
    'job.queued:' || created_job.id::text,
    target_correlation_id, target_payload_hash, 'none',
    jsonb_build_object('actorMembershipId', actor.id)
  )
  returning * into queued_receipt;

  update public.connector_action_intents
     set state = 'queued'
   where id = target_intent.id
   returning * into target_intent;

  return jsonb_build_object(
    'intent', to_jsonb(target_intent),
    'approval', to_jsonb(created_event),
    'job', to_jsonb(created_job),
    'receipt', to_jsonb(queued_receipt),
    'noOp', false
  );
end;
$$;

-- Server-only connection, vault and OAuth RPCs ----------------------------

create or replace function public.record_connector_connection_state(
  target_connection_id uuid,
  target_status connector_connection_status,
  target_provider_account_key_hash text,
  target_granted_scopes text[],
  target_remote_identity_summary jsonb,
  target_last_probe_at timestamptz,
  target_last_error_category text,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  receipt_type public.connector_receipt_event_type;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id
  for update;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  if target_status in ('active', 'degraded', 'reauthorization_required')
     and target_provider_account_key_hash is null then
    raise exception 'remote account binding hash is required' using errcode = '22023';
  end if;

  update public.connector_connections
     set status = target_status,
         provider_account_key_hash = coalesce(
           target_provider_account_key_hash,
           provider_account_key_hash
         ),
         granted_scopes = coalesce(target_granted_scopes, granted_scopes),
         remote_identity_summary = coalesce(
           target_remote_identity_summary,
           remote_identity_summary
         ),
         last_probe_at = coalesce(target_last_probe_at, last_probe_at),
         last_error_category = target_last_error_category,
         disconnected_at = case
           when target_status in ('disconnected', 'disconnected_unconfirmed')
             then coalesce(disconnected_at, now())
           else null
         end
   where id = target_connection_id
   returning * into target_connection;

  if target_status in ('disconnected', 'disconnected_unconfirmed') then
    receipt_type := 'revocation.completed';
  elsif target_last_probe_at is not null then
    receipt_type := 'connection.probed';
  end if;

  if receipt_type is not null then
    insert into public.connector_receipt_events (
      workspace_id, connection_id, event_type, event_key, correlation_id,
      error_category, redacted_metadata
    ) values (
      target_connection.workspace_id,
      target_connection.id,
      receipt_type,
      receipt_type::text || ':' || target_correlation_id::text,
      target_correlation_id,
      target_last_error_category,
      jsonb_build_object(
        'status', target_connection.status,
        'confirmed', target_connection.status = 'disconnected'
      )
    )
    on conflict (workspace_id, event_key) do nothing;
  end if;

  return jsonb_build_object('connection', to_jsonb(target_connection), 'noOp', false);
end;
$$;

create or replace function public.store_connector_payload_envelope(
  target_connection_id uuid,
  target_payload_kind text,
  target_schema_version text,
  target_canonical_hash text,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  created_payload connector_private.connector_payload_envelopes%rowtype;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  insert into connector_private.connector_payload_envelopes (
    workspace_id, connection_id, payload_kind, schema_version,
    canonical_hash, ciphertext, nonce, auth_tag, wrapped_dek,
    wrap_nonce, wrap_auth_tag, kek_version, aad_hash
  ) values (
    target_connection.workspace_id, target_connection.id,
    target_payload_kind, target_schema_version, target_canonical_hash,
    target_ciphertext, target_nonce, target_auth_tag, target_wrapped_dek,
    target_wrap_nonce, target_wrap_auth_tag, target_kek_version,
    target_aad_hash
  )
  returning * into created_payload;

  return jsonb_build_object(
    'payloadRef', created_payload.id,
    'workspaceId', created_payload.workspace_id,
    'connectionId', created_payload.connection_id,
    'canonicalHash', created_payload.canonical_hash,
    'schemaVersion', created_payload.schema_version,
    'kekVersion', created_payload.kek_version,
    'envelopeVersion', created_payload.envelope_version
  );
end;
$$;

create or replace function public.store_connector_connection_secret(
  target_connection_id uuid,
  target_secret_type text,
  target_expected_secret_version integer,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_expires_at timestamptz,
  target_refreshed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection_id
    and secret.secret_type = target_secret_type
  for update;

  if found then
    if target_expected_secret_version is null
       or target_secret.secret_version <> target_expected_secret_version then
      raise exception 'connector secret version conflict' using errcode = '40001';
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
           expires_at = target_expires_at,
           refreshed_at = target_refreshed_at,
           destroyed_at = null,
           updated_at = now()
     where id = target_secret.id
     returning * into target_secret;
  else
    if target_expected_secret_version is not null then
      raise exception 'connector secret does not exist for expected version'
        using errcode = '40001';
    end if;

    insert into connector_private.connector_connection_secrets (
      workspace_id, connection_id, secret_type, ciphertext, nonce, auth_tag,
      wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash,
      expires_at, refreshed_at
    ) values (
      target_connection.workspace_id, target_connection.id, target_secret_type,
      target_ciphertext, target_nonce, target_auth_tag, target_wrapped_dek,
      target_wrap_nonce, target_wrap_auth_tag, target_kek_version,
      target_aad_hash, target_expires_at, target_refreshed_at
    )
    returning * into target_secret;
  end if;

  return jsonb_build_object(
    'secretId', target_secret.id,
    'connectionId', target_secret.connection_id,
    'secretType', target_secret.secret_type,
    'secretVersion', target_secret.secret_version,
    'kekVersion', target_secret.kek_version,
    'expiresAt', target_secret.expires_at,
    'destroyedAt', target_secret.destroyed_at
  );
end;
$$;

create or replace function public.destroy_connector_connection_secret(
  target_connection_id uuid,
  target_secret_type text,
  target_expected_secret_version integer,
  target_destroyed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection_id
    and secret.secret_type = target_secret_type
  for update;

  if not found then
    raise exception 'connector secret not found' using errcode = 'P0002';
  end if;

  if target_secret.destroyed_at is not null then
    return jsonb_build_object(
      'secretId', target_secret.id,
      'secretVersion', target_secret.secret_version,
      'destroyedAt', target_secret.destroyed_at,
      'noOp', true
    );
  end if;

  if target_secret.secret_version <> target_expected_secret_version then
    raise exception 'connector secret version conflict' using errcode = '40001';
  end if;

  update connector_private.connector_connection_secrets
     set secret_version = secret_version + 1,
         ciphertext = null,
         nonce = null,
         auth_tag = null,
         wrapped_dek = null,
         wrap_nonce = null,
         wrap_auth_tag = null,
         destroyed_at = target_destroyed_at,
         updated_at = target_destroyed_at
   where id = target_secret.id
   returning * into target_secret;

  return jsonb_build_object(
    'secretId', target_secret.id,
    'secretVersion', target_secret.secret_version,
    'destroyedAt', target_secret.destroyed_at,
    'noOp', false
  );
end;
$$;

create or replace function public.create_connector_oauth_transaction(
  target_workspace_id uuid,
  target_connection_id uuid,
  target_provider text,
  target_state_hash text,
  target_requested_scope_bundle text,
  target_requested_scopes text[],
  target_actor_user_id uuid,
  target_membership_id uuid,
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
  target_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_membership public.workspace_members%rowtype;
  created_transaction connector_private.connector_oauth_transactions%rowtype;
begin
  select membership.* into target_membership
  from public.workspace_members membership
  where membership.id = target_membership_id
    and membership.workspace_id = target_workspace_id
    and membership.user_id = target_actor_user_id
    and membership.role = 'owner'
    and membership.status = 'active';

  if not found then
    raise exception 'OAuth transaction owner binding is invalid' using errcode = '42501';
  end if;

  if target_connection_id is not null and not exists (
    select 1 from public.connector_connections connection
    where connection.id = target_connection_id
      and connection.workspace_id = target_workspace_id
      and connection.provider = target_provider
  ) then
    raise exception 'OAuth transaction connection binding is invalid'
      using errcode = '23503';
  end if;

  insert into connector_private.connector_oauth_transactions (
    workspace_id, connection_id, provider, state_hash,
    requested_scope_bundle, requested_scopes, actor_user_id, membership_id,
    session_binding_hash, redirect_uri, safe_return_path,
    pkce_ciphertext, pkce_nonce, pkce_auth_tag, pkce_wrapped_dek,
    pkce_wrap_nonce, pkce_wrap_auth_tag, kek_version, aad_hash, expires_at
  ) values (
    target_workspace_id, target_connection_id, target_provider,
    target_state_hash, target_requested_scope_bundle, target_requested_scopes,
    target_actor_user_id, target_membership_id, target_session_binding_hash,
    target_redirect_uri, target_safe_return_path, target_pkce_ciphertext,
    target_pkce_nonce, target_pkce_auth_tag, target_pkce_wrapped_dek,
    target_pkce_wrap_nonce, target_pkce_wrap_auth_tag, target_kek_version,
    target_aad_hash, target_expires_at
  )
  returning * into created_transaction;

  return jsonb_build_object(
    'transactionId', created_transaction.id,
    'workspaceId', created_transaction.workspace_id,
    'connectionId', created_transaction.connection_id,
    'provider', created_transaction.provider,
    'expiresAt', created_transaction.expires_at,
    'consumedAt', created_transaction.consumed_at
  );
end;
$$;

create or replace function public.consume_connector_oauth_transaction(
  target_state_hash text,
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_membership_id uuid,
  target_session_binding_hash text,
  target_redirect_uri text,
  target_consumed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_transaction connector_private.connector_oauth_transactions%rowtype;
begin
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash = target_state_hash
  for update;

  if not found then
    raise exception 'OAuth transaction not found' using errcode = 'P0002';
  end if;

  if target_transaction.consumed_at is not null
     or target_transaction.expires_at <= target_consumed_at
     or target_transaction.workspace_id <> target_workspace_id
     or target_transaction.actor_user_id <> target_actor_user_id
     or target_transaction.membership_id <> target_membership_id
     or target_transaction.session_binding_hash <> target_session_binding_hash
     or target_transaction.redirect_uri <> target_redirect_uri then
    raise exception 'OAuth transaction binding, expiry or replay check failed'
      using errcode = '42501';
  end if;

  update connector_private.connector_oauth_transactions
     set consumed_at = target_consumed_at
   where id = target_transaction.id
   returning * into target_transaction;

  return jsonb_build_object(
    'transactionId', target_transaction.id,
    'workspaceId', target_transaction.workspace_id,
    'connectionId', target_transaction.connection_id,
    'provider', target_transaction.provider,
    'requestedScopeBundle', target_transaction.requested_scope_bundle,
    'requestedScopes', to_jsonb(target_transaction.requested_scopes),
    'safeReturnPath', target_transaction.safe_return_path,
    'pkceCiphertext', encode(target_transaction.pkce_ciphertext, 'base64'),
    'pkceNonce', encode(target_transaction.pkce_nonce, 'base64'),
    'pkceAuthTag', encode(target_transaction.pkce_auth_tag, 'base64'),
    'pkceWrappedDek', encode(target_transaction.pkce_wrapped_dek, 'base64'),
    'pkceWrapNonce', encode(target_transaction.pkce_wrap_nonce, 'base64'),
    'pkceWrapAuthTag', encode(target_transaction.pkce_wrap_auth_tag, 'base64'),
    'kekVersion', target_transaction.kek_version,
    'aadHash', target_transaction.aad_hash,
    'consumedAt', target_transaction.consumed_at
  );
end;
$$;

create or replace function public.store_connector_sync_cursor(
  target_connection_id uuid,
  target_stream_key text,
  target_expected_cursor_version integer,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_cursor connector_private.connector_sync_cursors%rowtype;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  select cursor_row.* into target_cursor
  from connector_private.connector_sync_cursors cursor_row
  where cursor_row.connection_id = target_connection_id
    and cursor_row.stream_key = target_stream_key
  for update;

  if found then
    if target_expected_cursor_version is null
       or target_cursor.cursor_version <> target_expected_cursor_version then
      raise exception 'connector cursor version conflict' using errcode = '40001';
    end if;

    update connector_private.connector_sync_cursors
       set cursor_version = cursor_version + 1,
           ciphertext = target_ciphertext,
           nonce = target_nonce,
           auth_tag = target_auth_tag,
           wrapped_dek = target_wrapped_dek,
           wrap_nonce = target_wrap_nonce,
           wrap_auth_tag = target_wrap_auth_tag,
           kek_version = target_kek_version,
           aad_hash = target_aad_hash,
           expires_at = target_expires_at,
           updated_at = now()
     where id = target_cursor.id
     returning * into target_cursor;
  else
    if target_expected_cursor_version is not null then
      raise exception 'connector cursor does not exist for expected version'
        using errcode = '40001';
    end if;

    insert into connector_private.connector_sync_cursors (
      workspace_id, connection_id, stream_key, ciphertext, nonce, auth_tag,
      wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash, expires_at
    ) values (
      target_connection.workspace_id, target_connection.id, target_stream_key,
      target_ciphertext, target_nonce, target_auth_tag, target_wrapped_dek,
      target_wrap_nonce, target_wrap_auth_tag, target_kek_version,
      target_aad_hash, target_expires_at
    )
    returning * into target_cursor;
  end if;

  return jsonb_build_object(
    'cursorId', target_cursor.id,
    'connectionId', target_cursor.connection_id,
    'streamKey', target_cursor.stream_key,
    'cursorVersion', target_cursor.cursor_version,
    'kekVersion', target_cursor.kek_version,
    'expiresAt', target_cursor.expires_at
  );
end;
$$;

create or replace function public.bind_connector_webhook_endpoint(
  target_connection_id uuid,
  target_endpoint_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_binding connector_private.connector_webhook_bindings%rowtype;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  insert into connector_private.connector_webhook_bindings (
    workspace_id, connection_id, provider, endpoint_key_hash
  ) values (
    target_connection.workspace_id, target_connection.id,
    target_connection.provider, target_endpoint_key_hash
  )
  on conflict (connection_id) do update
    set endpoint_key_hash = excluded.endpoint_key_hash,
        provider = excluded.provider,
        workspace_id = excluded.workspace_id,
        revoked_at = null
  returning * into target_binding;

  return jsonb_build_object(
    'bindingId', target_binding.id,
    'connectionId', target_binding.connection_id,
    'provider', target_binding.provider,
    'revokedAt', target_binding.revoked_at
  );
end;
$$;

create or replace function public.resolve_connector_webhook_endpoint(
  target_provider text,
  target_endpoint_key_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_binding connector_private.connector_webhook_bindings%rowtype;
begin
  select binding.* into target_binding
  from connector_private.connector_webhook_bindings binding
  where binding.provider = target_provider
    and binding.endpoint_key_hash = target_endpoint_key_hash
    and binding.revoked_at is null;

  if not found then
    raise exception 'connector webhook endpoint not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'bindingId', target_binding.id,
    'workspaceId', target_binding.workspace_id,
    'connectionId', target_binding.connection_id,
    'provider', target_binding.provider
  );
end;
$$;

-- Durable worker, lease, fencing and webhook RPCs -------------------------

create or replace function public.claim_connector_jobs(
  target_worker_id uuid,
  target_batch_size integer default 10,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_job public.connector_jobs%rowtype;
begin
  if target_worker_id is null
     or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid connector claim request' using errcode = '22023';
  end if;

  for candidate in
    select job.id
    from public.connector_jobs job
    where job.state in ('queued', 'retry_wait')
      and job.scheduled_at <= target_now
      and job.attempt_count < job.max_attempts
    order by job.priority desc, job.scheduled_at, job.created_at, job.id
    for update skip locked
    limit target_batch_size
  loop
    update public.connector_jobs
       set state = 'leased',
           lease_owner = target_worker_id,
           lease_expires_at = target_now + make_interval(secs => target_lease_seconds),
           fencing_token = fencing_token + 1
     where id = candidate.id
     returning * into claimed_job;

    return next claimed_job;
  end loop;

  return;
end;
$$;

create or replace function public.start_connector_job_attempt(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_started_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job public.connector_jobs%rowtype;
  target_intent public.connector_action_intents%rowtype;
  created_receipt public.connector_receipt_events%rowtype;
begin
  select job.* into target_job
  from public.connector_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception 'connector job not found' using errcode = 'P0002';
  end if;

  if target_job.state <> 'leased'
     or target_job.lease_owner <> target_worker_id
     or target_job.fencing_token <> target_fencing_token
     or target_job.lease_expires_at <= target_started_at then
    raise exception 'stale or invalid connector job lease' using errcode = '40001';
  end if;

  if target_job.attempt_count >= target_job.max_attempts then
    raise exception 'connector job attempt budget exhausted' using errcode = '23514';
  end if;

  update public.connector_jobs
     set state = 'executing',
         attempt_count = attempt_count + 1
   where id = target_job.id
   returning * into target_job;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, job_id, intent_id, intent_version_id,
    event_type, event_key, correlation_id, attempt_number, fencing_token,
    occurred_at
  ) values (
    target_job.workspace_id, target_job.connection_id, target_job.id,
    target_job.intent_id, target_job.intent_version_id, 'attempt.started',
    'attempt.started:' || target_job.id::text || ':' || target_fencing_token::text,
    target_job.correlation_id, target_job.attempt_count,
    target_fencing_token, target_started_at
  )
  returning * into created_receipt;

  update public.connector_action_intents
     set state = 'executing'
   where id = target_job.intent_id
   returning * into target_intent;

  return jsonb_build_object(
    'job', to_jsonb(target_job),
    'intent', to_jsonb(target_intent),
    'receipt', to_jsonb(created_receipt)
  );
end;
$$;

create or replace function public.claim_connector_reconciliation_jobs(
  target_worker_id uuid,
  target_batch_size integer default 10,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_job public.connector_jobs%rowtype;
begin
  if target_worker_id is null
     or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid reconciliation claim request' using errcode = '22023';
  end if;

  for candidate in
    select job.id
    from public.connector_jobs job
    where job.state = 'reconciliation_required'
      and job.scheduled_at <= target_now
      and (job.lease_owner is null or job.lease_expires_at <= target_now)
    order by job.scheduled_at, job.created_at, job.id
    for update skip locked
    limit target_batch_size
  loop
    update public.connector_jobs
       set lease_owner = target_worker_id,
           lease_expires_at = target_now + make_interval(secs => target_lease_seconds),
           fencing_token = fencing_token + 1
     where id = candidate.id
     returning * into claimed_job;

    insert into public.connector_receipt_events (
      workspace_id, connection_id, job_id, intent_id, intent_version_id,
      event_type, event_key, correlation_id, attempt_number, fencing_token,
      occurred_at
    ) values (
      claimed_job.workspace_id, claimed_job.connection_id, claimed_job.id,
      claimed_job.intent_id, claimed_job.intent_version_id,
      'reconciliation.started',
      'reconciliation.started:' || claimed_job.id::text || ':' || claimed_job.fencing_token::text,
      claimed_job.correlation_id, claimed_job.attempt_count,
      claimed_job.fencing_token, target_now
    );

    return next claimed_job;
  end loop;

  return;
end;
$$;

create or replace function public.transition_connector_job(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_state connector_job_state,
  target_receipt_event_type connector_receipt_event_type,
  target_error_category text,
  target_provider_request_hash text,
  target_remote_operation_id text,
  target_provider_status text,
  target_reconciliation_result text,
  target_scheduled_at timestamptz,
  target_redacted_metadata jsonb default '{}'::jsonb,
  target_transitioned_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job public.connector_jobs%rowtype;
  target_intent public.connector_action_intents%rowtype;
  created_receipt public.connector_receipt_events%rowtype;
  final_receipt public.connector_receipt_events%rowtype;
  intent_state public.connector_action_intent_state;
begin
  select job.* into target_job
  from public.connector_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception 'connector job not found' using errcode = 'P0002';
  end if;

  if target_job.state not in ('executing', 'reconciliation_required')
     or target_job.lease_owner <> target_worker_id
     or target_job.fencing_token <> target_fencing_token
     or target_job.lease_expires_at <= target_transitioned_at then
    raise exception 'stale or invalid connector job transition' using errcode = '40001';
  end if;

  if target_state not in (
    'succeeded', 'retry_wait', 'reconciliation_required', 'failed', 'dead_letter'
  ) then
    raise exception 'invalid connector worker target state' using errcode = '22023';
  end if;

  if target_state = 'succeeded'
     and target_receipt_event_type not in ('provider.accepted', 'reconciliation.resolved') then
    raise exception 'successful connector transition requires accepted or reconciled receipt'
      using errcode = '23514';
  elsif target_state = 'reconciliation_required'
     and target_receipt_event_type <> 'provider.unknown' then
    raise exception 'ambiguous connector transition requires provider.unknown receipt'
      using errcode = '23514';
  elsif target_state in ('retry_wait', 'failed', 'dead_letter')
     and target_receipt_event_type not in ('provider.failed', 'reconciliation.resolved') then
    raise exception 'failed connector transition requires failed or reconciled receipt'
      using errcode = '23514';
  end if;

  if target_state = 'retry_wait'
     and (target_scheduled_at is null or target_scheduled_at <= target_transitioned_at) then
    raise exception 'retry_wait requires a future schedule' using errcode = '23514';
  end if;

  if target_state = 'reconciliation_required' and target_scheduled_at is null then
    target_scheduled_at := target_transitioned_at;
  end if;

  update public.connector_jobs
     set state = target_state,
         scheduled_at = case
           when target_state in ('retry_wait', 'reconciliation_required') then target_scheduled_at
           else scheduled_at
         end,
         lease_owner = null,
         lease_expires_at = null,
         last_error_category = target_error_category,
         provider_request_hash = coalesce(
           target_provider_request_hash,
           provider_request_hash
         ),
         remote_operation_id = coalesce(
           target_remote_operation_id,
           remote_operation_id
         ),
         completed_at = case
           when target_state in ('succeeded', 'failed', 'dead_letter')
             then target_transitioned_at
           else null
         end,
         cancelled_at = null
   where id = target_job.id
   returning * into target_job;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, job_id, intent_id, intent_version_id,
    event_type, event_key, correlation_id, attempt_number, fencing_token,
    provider_request_hash, remote_operation_id, provider_status,
    error_category, reconciliation_result, redacted_metadata, occurred_at
  ) values (
    target_job.workspace_id, target_job.connection_id, target_job.id,
    target_job.intent_id, target_job.intent_version_id,
    target_receipt_event_type,
    target_receipt_event_type::text || ':' || target_job.id::text || ':' || target_fencing_token::text,
    target_job.correlation_id, target_job.attempt_count,
    target_fencing_token, target_provider_request_hash,
    target_remote_operation_id, target_provider_status,
    target_error_category, target_reconciliation_result,
    coalesce(target_redacted_metadata, '{}'::jsonb), target_transitioned_at
  )
  returning * into created_receipt;

  -- A normal provider success has two distinct durable facts: the provider
  -- accepted the operation and the provider reported its final outcome. Keep
  -- both in the same transaction as the job/intent terminal transition. The
  -- fencing-scoped event key makes a retried transition deterministic while
  -- the row lock above prevents a stale worker from producing either receipt.
  if target_state = 'succeeded'
     and target_receipt_event_type = 'provider.accepted' then
    insert into public.connector_receipt_events (
      workspace_id, connection_id, job_id, intent_id, intent_version_id,
      event_type, event_key, correlation_id, attempt_number, fencing_token,
      provider_request_hash, remote_operation_id, provider_status,
      error_category, reconciliation_result, redacted_metadata, occurred_at
    ) values (
      target_job.workspace_id, target_job.connection_id, target_job.id,
      target_job.intent_id, target_job.intent_version_id,
      'provider.final',
      'provider.final:' || target_job.id::text || ':' || target_fencing_token::text,
      target_job.correlation_id, target_job.attempt_count,
      target_fencing_token, target_provider_request_hash,
      target_remote_operation_id, target_provider_status,
      coalesce(target_error_category, 'none'), null,
      coalesce(target_redacted_metadata, '{}'::jsonb), target_transitioned_at
    )
    returning * into final_receipt;
  end if;

  if target_state = 'succeeded' then
    intent_state := 'succeeded';
  elsif target_state in ('failed', 'dead_letter') then
    intent_state := 'failed';
  else
    intent_state := 'executing';
  end if;

  update public.connector_action_intents
     set state = intent_state
   where id = target_job.intent_id
   returning * into target_intent;

  return jsonb_build_object(
    'job', to_jsonb(target_job),
    'intent', to_jsonb(target_intent),
    'receipt', to_jsonb(created_receipt),
    'finalReceipt', case
      when final_receipt.id is null then null
      else to_jsonb(final_receipt)
    end
  );
end;
$$;

create or replace function public.sweep_expired_connector_job_leases(
  target_batch_size integer default 100,
  target_now timestamptz default clock_timestamp()
)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_job public.connector_jobs%rowtype;
  swept_job public.connector_jobs%rowtype;
  receipt_type public.connector_receipt_event_type;
  target_error text;
begin
  if target_batch_size not between 1 and 500 then
    raise exception 'invalid connector lease sweep batch size' using errcode = '22023';
  end if;

  for expired_job in
    select job.*
    from public.connector_jobs job
    where job.state in ('leased', 'executing', 'reconciliation_required')
      and job.lease_owner is not null
      and job.lease_expires_at <= target_now
    order by job.lease_expires_at, job.id
    for update skip locked
    limit target_batch_size
  loop
    if expired_job.state = 'leased' and expired_job.attempt_count < expired_job.max_attempts then
      update public.connector_jobs
         set state = 'queued',
             scheduled_at = target_now,
             lease_owner = null,
             lease_expires_at = null,
             last_error_category = 'lease_expired_before_attempt'
       where id = expired_job.id
       returning * into swept_job;
      receipt_type := 'lease.expired';
      target_error := 'lease_expired_before_attempt';
    elsif expired_job.state = 'leased' then
      update public.connector_jobs
         set state = 'dead_letter',
             lease_owner = null,
             lease_expires_at = null,
             last_error_category = 'attempt_budget_exhausted',
             completed_at = target_now
       where id = expired_job.id
       returning * into swept_job;
      receipt_type := 'provider.failed';
      target_error := 'attempt_budget_exhausted';
    else
      update public.connector_jobs
         set state = 'reconciliation_required',
             scheduled_at = target_now,
             lease_owner = null,
             lease_expires_at = null,
             last_error_category = 'lease_expired_outcome_unknown'
       where id = expired_job.id
       returning * into swept_job;
      receipt_type := 'provider.unknown';
      target_error := 'lease_expired_outcome_unknown';
    end if;

    insert into public.connector_receipt_events (
      workspace_id, connection_id, job_id, intent_id, intent_version_id,
      event_type, event_key, correlation_id, attempt_number, fencing_token,
      error_category, occurred_at
    ) values (
      swept_job.workspace_id, swept_job.connection_id, swept_job.id,
      swept_job.intent_id, swept_job.intent_version_id, receipt_type,
      receipt_type::text || ':' || swept_job.id::text || ':' || swept_job.fencing_token::text,
      swept_job.correlation_id, nullif(swept_job.attempt_count, 0),
      swept_job.fencing_token, target_error, target_now
    )
    on conflict (workspace_id, event_key) do nothing;

    return next swept_job;
  end loop;

  return;
end;
$$;

create or replace function public.cancel_connector_job(
  target_job_id uuid,
  target_correlation_id uuid,
  target_cancelled_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_job public.connector_jobs%rowtype;
  target_intent public.connector_action_intents%rowtype;
  created_receipt public.connector_receipt_events%rowtype;
begin
  select job.* into target_job
  from public.connector_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception 'connector job not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_job.workspace_id, true);

  if target_job.state = 'cancelled' then
    return jsonb_build_object('job', to_jsonb(target_job), 'noOp', true);
  end if;

  if target_job.state not in ('queued', 'retry_wait')
     or target_job.remote_operation_id is not null then
    raise exception 'connector job is not safely cancellable' using errcode = '23514';
  end if;

  update public.connector_jobs
     set state = 'cancelled',
         lease_owner = null,
         lease_expires_at = null,
         cancelled_at = target_cancelled_at,
         completed_at = null
   where id = target_job.id
   returning * into target_job;

  update public.connector_action_intents
     set state = 'cancelled'
   where id = target_job.intent_id
   returning * into target_intent;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, job_id, intent_id, intent_version_id,
    event_type, event_key, correlation_id, attempt_number, fencing_token,
    redacted_metadata, occurred_at
  ) values (
    target_job.workspace_id, target_job.connection_id, target_job.id,
    target_job.intent_id, target_job.intent_version_id, 'job.cancelled',
    'job.cancelled:' || target_job.id::text,
    target_correlation_id, nullif(target_job.attempt_count, 0),
    target_job.fencing_token,
    jsonb_build_object('actorMembershipId', actor.id), target_cancelled_at
  )
  returning * into created_receipt;

  return jsonb_build_object(
    'job', to_jsonb(target_job),
    'intent', to_jsonb(target_intent),
    'receipt', to_jsonb(created_receipt),
    'noOp', false
  );
end;
$$;

create or replace function public.retry_connector_job(
  target_job_id uuid,
  target_correlation_id uuid,
  target_scheduled_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  target_job public.connector_jobs%rowtype;
  target_intent public.connector_action_intents%rowtype;
  created_receipt public.connector_receipt_events%rowtype;
begin
  select job.* into target_job
  from public.connector_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception 'connector job not found' using errcode = 'P0002';
  end if;

  actor := public.connector_current_membership(target_job.workspace_id, true);

  if target_job.state not in ('failed', 'dead_letter')
     or target_job.last_error_category not in (
       'provider_unavailable', 'rate_limited', 'network_not_sent',
       'lease_expired_before_attempt', 'attempt_budget_exhausted'
     )
     or target_job.remote_operation_id is not null
     or target_job.attempt_count >= 20 then
    raise exception 'connector job is not safely retryable' using errcode = '23514';
  end if;

  update public.connector_jobs
     set state = 'queued',
         scheduled_at = target_scheduled_at,
         max_attempts = greatest(max_attempts, attempt_count + 1),
         last_error_category = null,
         completed_at = null,
         cancelled_at = null
   where id = target_job.id
   returning * into target_job;

  update public.connector_action_intents
     set state = 'queued'
   where id = target_job.intent_id
   returning * into target_intent;

  insert into public.connector_receipt_events (
    workspace_id, connection_id, job_id, intent_id, intent_version_id,
    event_type, event_key, correlation_id, attempt_number, fencing_token,
    redacted_metadata
  ) values (
    target_job.workspace_id, target_job.connection_id, target_job.id,
    target_job.intent_id, target_job.intent_version_id, 'job.retried',
    'job.retried:' || target_job.id::text || ':' || target_job.attempt_count::text,
    target_correlation_id, nullif(target_job.attempt_count, 0),
    target_job.fencing_token,
    jsonb_build_object('actorMembershipId', actor.id)
  )
  returning * into created_receipt;

  return jsonb_build_object(
    'job', to_jsonb(target_job),
    'intent', to_jsonb(target_intent),
    'receipt', to_jsonb(created_receipt),
    'noOp', false
  );
end;
$$;

create or replace function public.read_connector_job_payload_envelope(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_job public.connector_jobs%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
begin
  select job.* into target_job
  from public.connector_jobs job
  where job.id = target_job_id
    and job.state in ('leased', 'executing', 'reconciliation_required')
    and job.lease_owner = target_worker_id
    and job.fencing_token = target_fencing_token
    and job.lease_expires_at > target_now;

  if not found then
    raise exception 'active connector job lease required' using errcode = '42501';
  end if;

  select payload.* into target_payload
  from connector_private.connector_payload_envelopes payload
  where payload.id = target_job.payload_ref
    and payload.workspace_id = target_job.workspace_id
    and payload.connection_id = target_job.connection_id
    and payload.canonical_hash = target_job.payload_hash
    and payload.destroyed_at is null;

  if not found then
    raise exception 'connector payload envelope unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'payloadRef', target_payload.id,
    'payloadKind', target_payload.payload_kind,
    'schemaVersion', target_payload.schema_version,
    'canonicalHash', target_payload.canonical_hash,
    'ciphertext', encode(target_payload.ciphertext, 'base64'),
    'nonce', encode(target_payload.nonce, 'base64'),
    'authTag', encode(target_payload.auth_tag, 'base64'),
    'wrappedDek', encode(target_payload.wrapped_dek, 'base64'),
    'wrapNonce', encode(target_payload.wrap_nonce, 'base64'),
    'wrapAuthTag', encode(target_payload.wrap_auth_tag, 'base64'),
    'kekVersion', target_payload.kek_version,
    'aadHash', target_payload.aad_hash,
    'envelopeVersion', target_payload.envelope_version
  );
end;
$$;

create or replace function public.read_connector_job_secret_envelope(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_secret_type text,
  target_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_job public.connector_jobs%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  select job.* into target_job
  from public.connector_jobs job
  where job.id = target_job_id
    and job.state in ('leased', 'executing', 'reconciliation_required')
    and job.lease_owner = target_worker_id
    and job.fencing_token = target_fencing_token
    and job.lease_expires_at > target_now;

  if not found then
    raise exception 'active connector job lease required' using errcode = '42501';
  end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_job.connection_id
    and secret.workspace_id = target_job.workspace_id
    and secret.secret_type = target_secret_type
    and secret.destroyed_at is null;

  if not found then
    raise exception 'connector secret envelope unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
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
    'expiresAt', target_secret.expires_at
  );
end;
$$;

create or replace function public.register_connector_webhook_delivery(
  target_connection_id uuid,
  target_replay_key_hash text,
  target_raw_body_hash text,
  target_signature_valid boolean,
  target_timestamp_valid boolean,
  target_received_at timestamptz,
  target_correlation_id uuid,
  target_redacted_result text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_delivery public.connector_webhook_deliveries%rowtype;
  duplicate_delivery boolean := false;
  receipt_type public.connector_receipt_event_type;
begin
  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id = target_connection_id;

  if not found then
    raise exception 'connector connection not found' using errcode = 'P0002';
  end if;

  select delivery.* into target_delivery
  from public.connector_webhook_deliveries delivery
  where delivery.connection_id = target_connection_id
    and delivery.replay_key_hash = target_replay_key_hash;

  if found then
    duplicate_delivery := true;
  else
    insert into public.connector_webhook_deliveries (
      workspace_id, connection_id, provider, replay_key_hash,
      raw_body_hash, signature_valid, timestamp_valid, outcome,
      correlation_id, received_at, redacted_result
    ) values (
      target_connection.workspace_id, target_connection.id,
      target_connection.provider, target_replay_key_hash, target_raw_body_hash,
      target_signature_valid, target_timestamp_valid,
      case when target_signature_valid and target_timestamp_valid
        then 'accepted' else 'rejected' end,
      target_correlation_id, target_received_at, target_redacted_result
    )
    returning * into target_delivery;

    receipt_type := case when target_delivery.outcome = 'accepted'
      then 'webhook.accepted'::public.connector_receipt_event_type
      else 'webhook.rejected'::public.connector_receipt_event_type end;

    insert into public.connector_receipt_events (
      workspace_id, connection_id, event_type, event_key, correlation_id,
      error_category, redacted_metadata, occurred_at
    ) values (
      target_delivery.workspace_id, target_delivery.connection_id,
      receipt_type,
      receipt_type::text || ':' || target_delivery.id::text,
      target_delivery.correlation_id,
      case when target_delivery.outcome = 'rejected'
        then 'webhook_verification_failed' else null end,
      jsonb_build_object(
        'deliveryId', target_delivery.id,
        'signatureValid', target_delivery.signature_valid,
        'timestampValid', target_delivery.timestamp_valid
      ),
      target_delivery.received_at
    );
  end if;

  return jsonb_build_object(
    'delivery', to_jsonb(target_delivery),
    'duplicate', duplicate_delivery,
    'accepted', target_delivery.outcome = 'accepted'
  );
end;
$$;

create or replace function public.mark_connector_webhook_delivery_processed(
  target_delivery_id uuid,
  target_processed_at timestamptz default now(),
  target_redacted_result text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery public.connector_webhook_deliveries%rowtype;
begin
  update public.connector_webhook_deliveries
     set processed_at = coalesce(processed_at, target_processed_at),
         redacted_result = coalesce(target_redacted_result, redacted_result)
   where id = target_delivery_id
   returning * into target_delivery;

  if not found then
    raise exception 'connector webhook delivery not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('delivery', to_jsonb(target_delivery));
end;
$$;

-- Least-privilege RPC grants ----------------------------------------------

revoke all on function public.create_connector_connection(uuid, text, text, uuid) from public;
revoke all on function public.request_connector_disconnect(uuid, uuid) from public;
revoke all on function public.create_connector_automation_policy(uuid, text, text[], jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.create_connector_action_intent(uuid, text, text, uuid, text, uuid, integer, jsonb, uuid) from public;
revoke all on function public.revise_connector_action_intent(uuid, integer, text, uuid, text, uuid, integer, jsonb, uuid) from public;
revoke all on function public.reject_connector_action_intent(uuid, integer, text, text, uuid) from public;
revoke all on function public.approve_and_enqueue_connector_action(uuid, integer, text, text, uuid, timestamptz, integer) from public;
revoke all on function public.cancel_connector_job(uuid, uuid, timestamptz) from public;
revoke all on function public.retry_connector_job(uuid, uuid, timestamptz) from public;

grant execute on function public.create_connector_connection(uuid, text, text, uuid) to authenticated;
grant execute on function public.request_connector_disconnect(uuid, uuid) to authenticated;
grant execute on function public.create_connector_automation_policy(uuid, text, text[], jsonb, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.create_connector_action_intent(uuid, text, text, uuid, text, uuid, integer, jsonb, uuid) to authenticated;
grant execute on function public.revise_connector_action_intent(uuid, integer, text, uuid, text, uuid, integer, jsonb, uuid) to authenticated;
grant execute on function public.reject_connector_action_intent(uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.approve_and_enqueue_connector_action(uuid, integer, text, text, uuid, timestamptz, integer) to authenticated;
grant execute on function public.cancel_connector_job(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.retry_connector_job(uuid, uuid, timestamptz) to authenticated;

revoke all on function public.record_connector_connection_state(uuid, connector_connection_status, text, text[], jsonb, timestamptz, text, uuid) from public;
revoke all on function public.store_connector_payload_envelope(uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text) from public;
revoke all on function public.store_connector_connection_secret(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz, timestamptz) from public;
revoke all on function public.destroy_connector_connection_secret(uuid, text, integer, timestamptz) from public;
revoke all on function public.create_connector_oauth_transaction(uuid, uuid, text, text, text, text[], uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) from public;
revoke all on function public.consume_connector_oauth_transaction(text, uuid, uuid, uuid, text, text, timestamptz) from public;
revoke all on function public.store_connector_sync_cursor(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) from public;
revoke all on function public.bind_connector_webhook_endpoint(uuid, text) from public;
revoke all on function public.resolve_connector_webhook_endpoint(text, text) from public;
revoke all on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) from public;
revoke all on function public.start_connector_job_attempt(uuid, uuid, bigint, timestamptz) from public;
revoke all on function public.claim_connector_reconciliation_jobs(uuid, integer, integer, timestamptz) from public;
revoke all on function public.transition_connector_job(uuid, uuid, bigint, connector_job_state, connector_receipt_event_type, text, text, text, text, text, timestamptz, jsonb, timestamptz) from public;
revoke all on function public.sweep_expired_connector_job_leases(integer, timestamptz) from public;
revoke all on function public.read_connector_job_payload_envelope(uuid, uuid, bigint, timestamptz) from public;
revoke all on function public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz) from public;
revoke all on function public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text) from public;
revoke all on function public.mark_connector_webhook_delivery_processed(uuid, timestamptz, text) from public;

grant execute on function public.record_connector_connection_state(uuid, connector_connection_status, text, text[], jsonb, timestamptz, text, uuid) to service_role;
grant execute on function public.store_connector_payload_envelope(uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text) to service_role;
grant execute on function public.store_connector_connection_secret(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.destroy_connector_connection_secret(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.create_connector_oauth_transaction(uuid, uuid, text, text, text, text[], uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) to service_role;
grant execute on function public.consume_connector_oauth_transaction(text, uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.store_connector_sync_cursor(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) to service_role;
grant execute on function public.bind_connector_webhook_endpoint(uuid, text) to service_role;
grant execute on function public.resolve_connector_webhook_endpoint(text, text) to service_role;
grant execute on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.start_connector_job_attempt(uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.claim_connector_reconciliation_jobs(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.transition_connector_job(uuid, uuid, bigint, connector_job_state, connector_receipt_event_type, text, text, text, text, text, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.sweep_expired_connector_job_leases(integer, timestamptz) to service_role;
grant execute on function public.read_connector_job_payload_envelope(uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz) to service_role;
grant execute on function public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text) to service_role;
grant execute on function public.mark_connector_webhook_delivery_processed(uuid, timestamptz, text) to service_role;

-- Fail-closed migration verification --------------------------------------

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'connector_connections',
    'connector_automation_policies',
    'connector_action_intents',
    'connector_action_intent_versions',
    'connector_approval_events',
    'connector_jobs',
    'connector_receipt_events',
    'connector_webhook_deliveries'
  ] loop
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = target_table
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception 'connector public table % must force RLS', target_table;
    end if;

    if has_table_privilege('authenticated', 'public.' || target_table, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || target_table, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || target_table, 'DELETE') then
      raise exception 'authenticated has forbidden direct mutation on %', target_table;
    end if;
  end loop;

  foreach target_table in array array[
    'connector_connection_secrets',
    'connector_oauth_transactions',
    'connector_payload_envelopes',
    'connector_sync_cursors',
    'connector_webhook_bindings'
  ] loop
    if has_table_privilege('anon', 'connector_private.' || target_table, 'SELECT')
       or has_table_privilege('authenticated', 'connector_private.' || target_table, 'SELECT')
       or has_table_privilege('service_role', 'connector_private.' || target_table, 'SELECT') then
      raise exception 'private connector table % has a forbidden direct read grant', target_table;
    end if;
  end loop;
end;
$$;

comment on schema connector_private is
  'Server-only encrypted connector envelopes, OAuth bindings, cursor state and webhook endpoint hashes. Not exposed through PostgREST.';
comment on table public.connector_connections is
  'Workspace-visible redacted connection metadata. Provider credentials live only in connector_private encrypted envelopes.';
comment on table connector_private.connector_connection_secrets is
  'AES-256-GCM envelope components only. No plaintext provider secret is permitted.';
comment on table connector_private.connector_oauth_transactions is
  'Single-use, expiring OAuth state/session/workspace bindings with encrypted PKCE verifier.';
comment on table connector_private.connector_payload_envelopes is
  'Encrypted immutable action payloads bound to workspace, connection and canonical hash.';
comment on table connector_private.connector_sync_cursors is
  'Encrypted provider cursor state with optimistic cursor_version updates.';
comment on table public.connector_action_intent_versions is
  'Immutable action versions; edits create a new version and require a new owner decision.';
comment on table public.connector_approval_events is
  'Append-only owner decision evidence bound to one immutable version and payload hash.';
comment on table public.connector_jobs is
  'Durable provider-neutral queue with bounded attempts, lease owner, expiry and monotonic fencing token.';
comment on table public.connector_receipt_events is
  'Append-only redacted external-attempt, reconciliation, revocation, probe and webhook evidence.';
comment on table public.connector_webhook_deliveries is
  'Redacted webhook verification and replay-deduplication metadata; raw bodies are not retained.';
comment on function public.approve_and_enqueue_connector_action(uuid, integer, text, text, uuid, timestamptz, integer) is
  'Owner-only atomic compare/approve/enqueue. Replays return the existing matching job; divergent bindings fail.';
comment on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) is
  'Service-role-only bounded SKIP LOCKED claim that issues a lease and increments the fencing token.';
comment on function public.transition_connector_job(uuid, uuid, bigint, connector_job_state, connector_receipt_event_type, text, text, text, text, text, timestamptz, jsonb, timestamptz) is
  'Service-role-only fenced transition that atomically persists a redacted receipt.';
comment on function public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text) is
  'Service-role-only replay dedupe. Invalid verification records rejection evidence and never enqueues business work.';

commit;
