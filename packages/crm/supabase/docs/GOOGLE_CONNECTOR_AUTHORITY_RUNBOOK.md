# Omnix Google connector authority runbook

Scope: migration `0014_google_connector_authority.sql`, Story 4.2. This is the
database authority for incremental Google OAuth, encrypted Gmail/Calendar
credentials and cursors, local encrypted email drafts, exact provider-resource
links and Calendar task conflict evidence. Provider HTTP, Google verification,
credentials, encryption/decryption and real-account UAT remain server/runtime
responsibilities. A green local migration does not enable Google in production.

## Security and authority boundaries

Google sign-in remains authentication-only. Connector OAuth accepts only the
three bundles `gmail-send`, `gmail-metadata` and `calendar-app-created` with
their exact allowlisted scopes. Only an active workspace owner starts and
completes incremental authorization. A different Google account on an existing
connection fails closed.

Public tables contain workspace-scoped, RLS-protected, redacted state. Access
tokens, refresh tokens, PKCE verifier material, cursors and provider resource
IDs stay in `connector_private` with no direct browser or `service_role` table
grant. Public receipts/activities contain IDs, hashes and states, never email
body, subject, raw counterpart address, token, cursor or provider message ID.

OAuth completion idempotently installs an `owner_required` version-1 policy for
every action unlocked by the full returned scope set:

- Gmail send: `gmail.send`
- Gmail metadata: `gmail.sync-metadata`
- Calendar app-created: `calendar.create-omnix-calendar`,
  `calendar.upsert-omnix-event`, `calendar.sync`

Each policy allowlists only its own action and binds provider, capability,
connection, immutable payload and canonical authority constraints. Completion
never queues or executes an external operation.

## OAuth contracts

```text
begin_google_oauth(connection_id uuid, workspace_id uuid, bundle text,
  correlation_id uuid, state_hash text, session_binding_hash text,
  redirect_uri text, safe_return_path text, pkce_ciphertext bytea,
  pkce_nonce bytea, pkce_auth_tag bytea, pkce_wrapped_dek bytea,
  pkce_wrap_nonce bytea, pkce_wrap_auth_tag bytea, kek_version text,
  aad_hash text, expires_at timestamptz, occurred_at timestamptz) -> jsonb
```

Authenticated owner only. `connection_id` is pre-generated so the caller can
bind PKCE AAD before the transaction. Result:
`{connection,transaction:{transactionId,workspaceId,connectionId,provider,bundle,requestedScopes,safeReturnPath,expiresAt,consumedAt},receipt,noOp}`.

```text
consume_google_oauth_transaction(state_hash text, workspace_id uuid,
  actor_user_id uuid, membership_id uuid, session_binding_hash text,
  redirect_uri text, consumed_at timestamptz) -> jsonb
```

Service-only and single-use. Result contains transaction/workspace/connection,
bundle, exact scopes, safe return path, base64 PKCE envelope, KEK/AAD binding,
`expectedAccessSecretVersion`, `expectedRefreshSecretVersion` and `consumedAt`.

```text
finalize_google_oauth(transaction_id uuid, workspace_id uuid,
  actor_user_id uuid, membership_id uuid, provider_account_key_hash text,
  account_email text, granted_scopes text[], expected_access_version integer,
  access_envelope jsonb, expected_refresh_version integer,
  refresh_envelope jsonb, correlation_id uuid, occurred_at timestamptz) -> jsonb
```

Service-only. Completion replay is checked before new envelopes/CAS are
required. New authorization requires a refresh token; incremental authorization
may retain the current one by exact version. Result is
`{connection,transaction,capabilities,policies,secrets:{access,refresh},receipt,noOp}`.
The normalized account email may appear only as the RLS-protected connection
display label; evidence remains hash-only.

`read_google_connection_capability_state(connection_id uuid) -> jsonb` is an
authenticated workspace-member read returning redacted connection,
capabilities, sync health, token-presence/version/expiry and Calendar-created
state, never encrypted bytes or provider resource IDs.

## Local Gmail draft and approval contracts

```text
create_google_email_draft(draft_id uuid, connection_id uuid, contact_id uuid,
  contact_point_id uuid, payload_hash text, recipient_hash text,
  request_key_hash text, envelope jsonb, correlation_id uuid,
  occurred_at timestamptz) -> jsonb
edit_google_email_draft(draft_id uuid, expected_version integer,
  payload_hash text, recipient_hash text, envelope jsonb,
  correlation_id uuid, occurred_at timestamptz) -> jsonb
archive_google_email_draft(draft_id uuid, expected_version integer,
  correlation_id uuid, occurred_at timestamptz) -> jsonb
prepare_google_gmail_send_intent(draft_id uuid,
  expected_draft_version integer, summary text, correlation_id uuid,
  occurred_at timestamptz) -> jsonb
```

Owner and assistant may create/edit/archive within their workspace. Subject and
body exist only in the encrypted private payload. CAS versions prevent drift.
Intent preparation binds the current payload/version/recipient/contact to the
canonical `gmail.send` policy but remains pending; an owner must separately use
the Story 3.5 approval/enqueue path.

## Fenced worker authority and access refresh

```text
read_google_job_authority(job_id uuid, worker_id uuid,
  fencing_token bigint, now timestamptz) -> jsonb
```

Only the exact executing job lease/fence may read. Result:

```text
{
  job:{jobId,workspaceId,connectionId,actionType,payloadHash,
       fencingToken,leaseExpiresAt},
  bundle, accessState:"live"|"refresh-required",
  connection:{id,workspaceId,status,displayLabel,accountKeyHash,grantedScopes},
  payloadEnvelope:{payloadRef,payloadKind,schemaVersion,canonicalHash,
    envelopeVersion,ciphertext,nonce,authTag,wrappedDek,wrapNonce,wrapAuthTag,
    kekVersion,aadHash},
  accessEnvelope:{secretId,secretType,secretVersion,ciphertext,nonce,authTag,
    wrappedDek,wrapNonce,wrapAuthTag,kekVersion,aadHash,expiresAt},
  refreshEnvelope:<same shape|null>, cursorEnvelope:<cursor shape|null>,
  calendarResource:<private provider binding|null>
}
```

An expired access token is returned only with a current refresh envelope and
`accessState=refresh-required`; otherwise the read fails closed.

```text
refresh_google_job_access_token(job_id uuid, worker_id uuid,
  fencing_token bigint, expected_access_secret_version integer,
  access_envelope jsonb, occurred_at timestamptz) -> jsonb
```

This service-only seam revalidates the executing job, lease/fence and active
bundle, requires the current refresh secret, and CAS-rotates only the access
token. It never changes account, scopes or capability. Result:
`{jobId,connectionId,accountKeyHash,grantedScopes,secret:{secretId,secretType,secretVersion,expiresAt,kekVersion},receipt}`.

## Gmail evidence contracts

```text
bind_google_gmail_send_resource(job_id uuid, worker_id uuid,
  fencing_token bigint, message_id text, thread_id text,
  operation_hash text, occurred_at timestamptz) -> jsonb
```

For `gmail.send` only. SQL derives the exact approved draft/contact/point from
the immutable job graph, stores provider IDs privately, marks the draft sent,
appends an `email-sent` activity and redacted receipt atomically. Exact replay
returns `{resource,draft,activity,receipt,noOp}`; divergent replay conflicts.

```text
bind_google_gmail_metadata_resource(job_id uuid, worker_id uuid,
  fencing_token bigint, message_id text, thread_id text, direction text,
  normalized_counterpart_email text, counterpart_kind text, labels text[],
  provider_occurred_at timestamptz, resource_hash text,
  occurred_at timestamptz) -> jsonb
```

The normalized counterpart is ephemeral. Exactly one active canonical email
links to contact activity; none/shared/archived/self-only/group-address enters
redacted review without contact mutation. Raw address, subject and body are
never persisted. Result is `{resource,review,receipt,noOp}`.

Gmail cursor/watch contracts are:

```text
commit_google_sync_checkpoint(job_id uuid, worker_id uuid, fence bigint,
  stream text, expected_cursor_version integer, cursor_envelope jsonb,
  provider_checkpoint_hash text, has_more boolean,
  provider_occurred_at timestamptz, occurred_at timestamptz) -> jsonb
mark_google_sync_cursor_expired(job_id uuid, worker_id uuid, fence bigint,
  stream text, expected_cursor_version integer, error_category text,
  occurred_at timestamptz) -> jsonb
bind_google_gmail_watch_resource(job_id uuid, worker_id uuid, fence bigint,
  channel_key_hash text, resource_key_hash text, expires_at timestamptz,
  occurred_at timestamptz) -> jsonb
```

## Calendar authority

`calendar.create-omnix-calendar` creates and privately binds one dedicated
secondary Calendar through
`bind_google_calendar_resource(job,worker,fence,calendar_id,resource_hash,etag_hash,occurred_at)`.
The app never claims authority over the user's primary calendar.

`bind_google_task_event_resource(job,worker,fence,task_id,task_version,event_id,resource_hash,etag_hash,provider_updated_at,occurred_at)`
requires the exact canonical task version. Remote divergence is recorded by
`record_google_calendar_task_conflict(job,worker,fence,task_id,task_version,resource_hash,reason,provider_updated_at,occurred_at)`;
it never overwrites the Omnix task.

## Apply, validation and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0014_google_connector_authority_test.sql --local
```

Also run the compatible 0004–0009 and 0011–0014 matrices. Before remote apply,
take a managed backup/schema dump and validate real Google incremental consent,
account-swap rejection, revoked grants, token refresh, Gmail provider replay,
history expiry, dedicated Calendar creation and task conflicts in UAT.

`0014_google_connector_authority.rollback.sql` is pre-write only. It refuses
after any Google connection/OAuth/token/cursor/draft/resource/activity/receipt
authority exists. In an empty window it removes only 0014 functions, triggers,
tables and task-version column, restoring the prior activity constraint. Enum
labels remain. After writes, stop callbacks/workers, preserve provider and CRM
evidence, revoke provider grants if required, reconcile ambiguous operations,
then use PITR or a reviewed forward migration.
