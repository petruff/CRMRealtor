# Omnix Mailchimp audience-sync runbook

Scope: migration `0010_mailchimp_audience_sync.sql`. This migration provides
the database authority for one selected Mailchimp audience per connection,
encrypted OAuth/token/checkpoint seams, unsubscribe enforcement, and a durable
webhook queue. Provider HTTP calls, app credentials and provider verification
remain server/adaptor responsibilities.

> Migration `0011_mailchimp_webhook_secret_authority.sql` supersedes the
> global-signing-secret and two-step webhook ingress assumptions below. Use
> its per-connection bind/read/setup-state and atomic encrypted register RPCs;
> see `MAILCHIMP_WEBHOOK_SECRET_AUTHORITY_RUNBOOK.md`.

## Authority and visible data

The workspace-visible tables are `mailchimp_audience_bindings`,
`mailchimp_member_links`, `mailchimp_subscription_authority`,
`mailchimp_sync_evidence`, and `mailchimp_webhook_jobs`. All force RLS;
authenticated workspace members have redacted `SELECT` only. No table stores a
raw email or provider body. Member rows store Mailchimp's lowercase MD5
subscriber hash plus the provider member ID and canonical `contact_point_id`.

Encrypted PKCE, access tokens, webhook payloads and incremental cursors remain
in `connector_private`. `anon` and `authenticated` cannot resolve that schema.
`service_role` has no direct table reads; narrow `SECURITY DEFINER` functions
return only the envelope required for one authorized operation.

## Frozen owner contracts

```text
begin_mailchimp_oauth(connection_id uuid, workspace_id uuid,
  display_label text, correlation_id uuid, state_hash text,
  requested_scope_bundle text, requested_scopes text[],
  session_binding_hash text, redirect_uri text, safe_return_path text,
  pkce_ciphertext bytea, pkce_nonce bytea, pkce_auth_tag bytea,
  pkce_wrapped_dek bytea, pkce_wrap_nonce bytea, pkce_wrap_auth_tag bytea,
  kek_version text, aad_hash text, expires_at timestamptz,
  occurred_at timestamptz) -> jsonb

ensure_mailchimp_sync_policy(workspace_id uuid, correlation_id uuid,
  occurred_at timestamptz) -> jsonb

select_mailchimp_audience(connection_id uuid, account_id_hash text,
  data_center text, audience_external_id text, audience_name text,
  mapping_version integer, correlation_id uuid,
  selected_at timestamptz) -> jsonb
```

OAuth start returns `{connection, oauthTransaction, receipt, noOp}` and uses
the caller-generated connection UUID so PKCE AAD can bind
`workspace|connection|mailchimp|oauth-pkce|1` before the transaction. Only the
redacted transaction metadata is returned. The scope bundle is exactly
`mailchimp.audience-sync.v1`; scopes are exactly `audience.sync` and
`audience.reconcile`.

Policy ensure returns `{policy, noOp}`. Its immutable v1 action is
`audience.sync`, approval mode is `owner_required`, and the allowlist contains
only `audience.sync`. The policy requires an active selected Mailchimp
audience/mapping v1, provider unsubscribe authority and conservative batch,
attempt and delay limits.

Audience select returns `{binding, replacedBinding, receipt,
invalidatedCursors, invalidatedWebhookJobs, noOp}`. Same-selection replay is a
no-op. Replacement appends a new binding, marks the prior binding replaced,
deletes the old audience cursor envelope, and moves queued/leased/executing
webhook work bound to the prior audience to terminal review. Every new binding
starts with `baseline_required=true` and
`webhook_registration_required=true`; incremental/webhook claims do not run
until the service records both provider operations.

## OAuth and provider credential contracts

Service role only:

```text
finalize_mailchimp_oauth(connection_id uuid,
  provider_account_key_hash text, granted_scopes text[],
  remote_identity_summary jsonb, ciphertext bytea, nonce bytea,
  auth_tag bytea, wrapped_dek bytea, wrap_nonce bytea,
  wrap_auth_tag bytea, kek_version text, aad_hash text,
  occurred_at timestamptz, correlation_id uuid) -> jsonb

read_mailchimp_access_token(workspace_id uuid, connection_id uuid,
  authenticated_user_id uuid, membership_id uuid) -> jsonb
```

Finalize requires a consumed, connection-bound OAuth transaction; it stores or
rotates secret type `mailchimp-access-token`, activates the connection and
appends `oauth.completed` atomically. It returns `{connection, receipt,
secret, noOp}` where `secret` contains metadata only.

Token read validates the explicit workspace, connection, authenticated user
and active owner membership tuple. It returns the encrypted access-token
envelope plus provider/account/scope binding. It is not executable by a
browser role. Decrypt only in server memory, never log the envelope or token,
and discard both immediately after the fixed Mailchimp operation.

## Audience readiness and outbound work

```text
complete_mailchimp_audience_baseline(connection_id uuid, binding_id uuid,
  provider_request_hash text, correlation_id uuid,
  occurred_at timestamptz) -> jsonb

confirm_mailchimp_webhook_registration(connection_id uuid, binding_id uuid,
  provider_request_hash text, correlation_id uuid,
  occurred_at timestamptz) -> jsonb

read_mailchimp_job_binding(job_id uuid, worker_id uuid,
  fencing_token bigint, now timestamptz) -> jsonb

record_mailchimp_outbound_sync_evidence(job_id uuid, worker_id uuid,
  fencing_token bigint, subscriber_hash text, source_key_hash text,
  requested_status text, outcome text, correlation_id uuid,
  occurred_at timestamptz) -> jsonb

store_mailchimp_sync_checkpoint(job_id uuid, worker_id uuid,
  fencing_token bigint, expected_cursor_version integer,
  ciphertext bytea, nonce bytea, auth_tag bytea, wrapped_dek bytea,
  wrap_nonce bytea, wrap_auth_tag bytea, kek_version text, aad_hash text,
  expires_at timestamptz, now timestamptz) -> jsonb

read_mailchimp_sync_checkpoint(job_id uuid, worker_id uuid,
  fencing_token bigint, now timestamptz) -> jsonb
```

Both readiness functions are replay-safe monotonic true-to-false transitions
with provider request hashes and `sync.applied` receipts. Job binding requires
the live worker/lease/fence and returns `{workspaceId, connectionId,
dataCenter, audienceId, accountIdHash, mappingVersion, baselineRequired,
webhookRegistrationRequired}`. The provider destination never comes from the
encrypted action payload.

Before any outbound subscribe, call `record_mailchimp_outbound_sync_evidence`.
It returns `allowed=false` and persists
`blocked-unsubscribe-authority` when Mailchimp previously unsubscribed or
cleaned the member. Only a separate reviewed consent workflow may ever clear
that lock; ordinary sync cannot.

Checkpoints derive a non-secret stream key from the selected audience ID and
use expected-version CAS. A stale version, worker, lease or fence fails closed.

## Durable webhook worker

The 0010 contract below is retained for migration compatibility, but migration
0011 revokes its `service_role` grant because storing a payload first can leave
an orphan on provider replay. Do not call it in current runtime:

```text
register_mailchimp_webhook_event(connection_id uuid,
  audience_external_id text, replay_key_hash text, raw_body_hash text,
  signature_valid boolean, timestamp_valid boolean, payload_ref uuid,
  payload_hash text, correlation_id uuid, received_at timestamptz,
  max_attempts integer) -> jsonb
```

It returns `{delivery, webhookJob, receipt, accepted, noOp}`. Invalid
signature/timestamp creates an honest rejected delivery/receipt and no job.
Accepted replay returns the original delivery/job. The HTTP handler can return
after this transaction; it does not apply contact state synchronously.

Worker RPCs are service-only:

```text
claim_mailchimp_webhook_jobs(worker_id uuid, batch_size integer,
  lease_seconds integer, now timestamptz)
  -> setof mailchimp_webhook_jobs
start_mailchimp_webhook_job(webhook_job_id uuid, worker_id uuid,
  fencing_token bigint, started_at timestamptz) -> jsonb
read_claimed_mailchimp_webhook_payload(webhook_job_id uuid, worker_id uuid,
  fencing_token bigint, now timestamptz) -> jsonb
apply_claimed_mailchimp_inbound_subscription_event(webhook_job_id uuid,
  worker_id uuid, fencing_token bigint, member_external_id text,
  subscriber_hash text, normalized_email text, subscription_status text,
  provider_event_id_hash text, originating_operation_key_hash text,
  occurred_at timestamptz) -> jsonb
transition_mailchimp_webhook_job(webhook_job_id uuid, worker_id uuid,
  fencing_token bigint, outcome text, error_category text,
  retry_at timestamptz, occurred_at timestamptz) -> jsonb
```

Claims are bounded to 1–25 and leases to 15–900 seconds. Expired work is
rescheduled or moved to review when the attempt budget is exhausted; every new
claim increments the fence. Read/apply/start/transition require the exact live
worker/fence. `retry` requires a future application schedule. `succeeded`
requires persisted delivery processing evidence. A crash after apply but
before transition is safe: provider-event evidence replay returns `noOp` and
the new fenced worker can finish the job.

The inbound apply resolves by normalized canonical email. Exactly one active
match may be linked/mutated. No match, multiple matches, archived contact,
wrong audience, baseline not complete, member conflict or out-of-order event
records `sync.reviewed` with no contact mutation. Verified unsubscribe/cleaned
sets canonical `contact_points.email_subscribed=false`, updates the legacy
projection, locks provider unsubscribe authority and appends lifecycle
evidence. Public receipts contain hashes/IDs and outcome only.

## Apply, tests and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0010_mailchimp_audience_sync_test.sql --local
```

Also run the 0004–0009 matrices. Before remote apply, take a managed backup,
schema-only dump and verify the Mailchimp application credentials, redirect
URI, per-connection encrypted webhook signing-secret workflow, data-center
routing and provider sandbox/UAT.
Local SQL evidence does not establish a live Mailchimp account connection.

`0010_mailchimp_audience_sync.rollback.sql` is pre-write only. It refuses once
OAuth, policy, audience, member, sync, queue or receipt authority exists. Enum
labels remain after rollback because PostgreSQL cannot safely remove enum
values. After any write, stop workers and provider callbacks, preserve
receipts/envelopes, and use PITR or a reviewed forward migration.
