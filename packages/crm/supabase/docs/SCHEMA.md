# Omnix Supabase schema

## Exact-contact merge activation

Migration `0028_contact_merge_activation.sql` unlocks the whole-plan apply and
reverse RPCs installed inertly by migration 0027. Activation changes only the
workspace gate (`apply_enabled=true`, `activation_version=2`). Apply archives
all donors and creates one-level logical aliases in one transaction; reverse
deactivates every plan alias, restores each donor's captured archive projection
and advances the workspace alias epoch. Existing contact foreign keys and
immutable provenance/event rows are never reparented.

The 0028 rollback is allowed only after every applied plan has been reversed
and no active alias remains. It restores the structural 0027 gate while keeping
historical plans, inactive aliases and events. Production adoption additionally
requires the application/import/connector compatibility and external backup
gates documented in `CONTACT_DEDUPLICATION_REVERSIBLE_MERGE_DESIGN.md`.

## Canonical tenant authority

Migration `0004_shared_workspace_authority.sql` makes `workspace_id` the only
tenant-authorization key. The legacy `owner_id` columns remain temporarily so
the existing repository and composite foreign keys can be migrated without
changing business IDs or losing history. They must not be used for access
control after migration 0004.

An application `WorkspaceScope` resolves:

- authenticated user ID (the actor);
- active membership ID;
- workspace ID;
- role (`owner` or `assistant`);
- the active owner user ID while legacy `owner_id` writes remain necessary.

`owner_id` continues to identify the workspace owner during the compatibility
window. It is not the assistant actor ID. Actor identity belongs in the command
context or an explicit `actor_user_id` audit/event column.

An active assistant may read their own membership and the active owner
membership for the same workspace, but not unrelated assistant memberships.
This is the bounded path used to resolve the legacy `owner_id` compatibility
value without turning that column back into an authorization key.

## Authority tables

### `workspaces`

The immutable workspace ID is the root tenant key. Direct product deletion is
not granted. Only an active owner may update the workspace name.

### `workspace_members`

Each `(workspace_id, user_id)` pair has one durable membership row. Revocation
changes `status` from `active` to `revoked` and records `revoked_at`; reactivation
reuses the same row. A partial unique index allows exactly one active `owner`,
and deferred constraint triggers prevent a committed workspace with zero active
owners. Ownership transfer and broader roles are intentionally absent.

Membership-derived RLS calls:

- `has_workspace_access(workspace_id)` for ordinary CRM access;
- `is_workspace_owner(workspace_id)` for authority management.

Both helpers derive the user from `auth.uid()`. No caller-supplied user ID,
workspace ID or legacy owner ID can grant access.

### `workspace_authority_audit_events`

Append-only audit evidence records bootstrap, rename, add, revoke and reactivate
operations with workspace, membership, actor, result, optional reason, time and correlation ID.
Only the active owner can read these rows; product roles cannot update or delete
them.

`bootstrap_personal_workspace(workspace_name text)` is the first-login RPC. It
serializes by authenticated user, returns the single active membership when one
exists, creates a workspace plus owner membership atomically when none exists,
and rejects multiple active memberships as ambiguous. Its result columns are
`workspace_id`, `membership_id`, `owner_user_id` and `role`.

Membership writes use owner-only RPCs so a command correlation ID reaches the
append-only audit row without relying on client-controlled SQL session state:

- `add_workspace_assistant(target_user_id, target_correlation_id, target_reason)`
  creates, returns, or reactivates one assistant membership;
- `revoke_workspace_assistant(target_membership_id, target_correlation_id, target_reason)`
  revokes or returns the already-revoked assistant membership.

Both membership RPCs return the complete `workspace_members` row. Authenticated
clients have table `SELECT` only; direct membership inserts, updates and deletes
are not granted.

## Backfilled tables

Migration 0004 adds a non-null, indexed `workspace_id` to:

- `contacts`
- `notes`
- `mailers`
- `mailer_sends`
- `contact_external_links`
- `contact_intake_receipts`

One workspace and owner membership are created per distinct legacy `owner_id`.
Count, null and relationship assertions run before the authority switch.
Composite foreign keys prevent cross-workspace referrals, notes, mailer sends
and external links even for a privileged ingestion path that bypasses RLS.

## CRM work queue foundation

Migration `0005_crm_work_queue.sql` adds four workspace-bound CRM tables. New
rows use `workspace_id` as their only tenant key and never add `owner_id`:

- `smart_lists` stores a versioned `smart-list-filter.v1` definition, creator
  membership and archive metadata. Database validation restricts criteria to
  the Story 3.1 field/operator allowlist and at most 20 criteria.
- `incomplete_records` is the quarantine inbox. Candidate JSON and validation
  reasons are data-only allowlisted structures; intake and conversion keys are
  unique per workspace. Records transition from `pending` to `converted` or
  `archived` and are never product-deleted.
- `tasks` stores optional workspace-safe contact links, creator/assignee
  memberships and explicit `open`, `completed` and `archived` lifecycle
  metadata. Product writes go through atomic RPCs; authenticated table access
  is read-only.
- `activity_events` is the immutable activity ledger. Its nine event types are
  fixed by Story 3.1, related contact/task/incomplete-record foreign keys are
  workspace-safe, and `(workspace_id, idempotency_key)` is unique.

All four tables have RLS enabled and forced. Policies derive authorization from
`has_workspace_access(workspace_id)`; revoked memberships fail closed. Direct
`UPDATE`/`DELETE` of activity rows is rejected by both privileges and triggers.
Archive transitions preserve task, Smart List and quarantine history instead
of deleting it. Composite foreign keys prevent cross-workspace relationships
even for privileged RPC execution.

Authenticated application writes use these `SECURITY DEFINER` boundaries:

- `append_activity_event(...)` returns
  `{ "event": <activity_events row>, "noOp": boolean }`.
- `create_task_with_event(...)` atomically creates a task plus its
  `task-created` event and returns
  `{ "task": <tasks row>, "event": <activity_events row>, "noOp": boolean }`.
- `transition_tasks_with_events(...)` applies one transition to 1–100 unique
  task IDs, appends completed/archived events as applicable, and returns
  `{ "tasks": [...], "events": [...], "noOpTaskIds": [...] }`. Reopen has no
  event type in Story 3.1 and therefore appends no event.
- `create_incomplete_record(...)` creates or race-safely replays an intake row;
  reuse of a workspace intake key with a different request hash is rejected.
- `convert_incomplete_record(...)` locks the quarantine row and atomically
  executes the application-selected `create`, `update` or `unchanged` plan,
  links the contact, marks conversion and appends the conversion event. It
  returns `{ "record": <incomplete_records row>, "contactId": <uuid>,
  "action": <conversion action>, "noOp": boolean }`.

RPC envelopes use camel-case control keys; embedded database rows retain
snake_case columns for explicit adapter mapping. Idempotent commands serialize
through unique indexes plus locked committed rows and reject payload divergence.
Conversion does not perform fuzzy identity or merge selection in SQL: it only
executes the already validated application plan. While legacy contacts still
require `owner_id`, conversion derives the single active workspace owner inside
the transaction; the caller cannot supply or authorize by that compatibility
value.

## Provider-disabled connector foundation

Migration `0006_connector_platform_foundation.sql` adds the provider-neutral
Story 3.5 substrate. It does not enable Google, Mailchimp, Twilio, Meta or any
other live provider. `contract-test` is a deterministic non-live adapter ID.

Workspace-visible tables contain only redacted operational authority:

- `connector_connections` stores workspace/provider binding, scope names,
  redacted remote identity metadata and connection health. Authenticated users
  have `SELECT` only; owner administration is through guarded RPCs.
- `connector_automation_policies` is an immutable version stream. Foundation
  owner-created policies always use `owner_required`; autonomous external
  writes are not enabled.
- `connector_action_intents` plus immutable
  `connector_action_intent_versions` bind one reviewed summary to an encrypted
  payload reference, canonical hash, connection and policy snapshot.
- `connector_approval_events` and `connector_receipt_events` are append-only.
  Trigger guards reject update/delete even for a privileged direct SQL path.
- `connector_jobs` is the durable queue. `(workspace_id, idempotency_key)` and
  one job per intent version prevent divergent replay; claims use bounded
  `FOR UPDATE SKIP LOCKED`, leases and monotonically increasing fencing tokens.
- `connector_webhook_deliveries` stores signature/timestamp decisions, hashes
  and replay keys only. Raw webhook bodies are not retained. Only owners can
  inspect this security metadata.

The non-exposed `connector_private` schema stores binary AES-256-GCM envelope
components for connection secrets, OAuth PKCE verifiers, action payloads and
sync cursors, plus hashed webhook endpoint bindings. It has no `anon` or
`authenticated` schema usage and no direct table grants, including to
`service_role`. Narrow `SECURITY DEFINER` RPCs are the only service path. Their
`search_path` is empty, objects are schema-qualified, and execution is granted
only to the required role.

Authenticated owner/member RPCs:

- `create_connector_connection`, `request_connector_disconnect`
- `create_connector_automation_policy`
- `create_connector_action_intent`, `revise_connector_action_intent`
- `reject_connector_action_intent`
- `approve_and_enqueue_connector_action` — locks the reviewed version, checks
  its hash/policy/payload/connection, appends owner approval, inserts exactly
  one job and returns the persisted `job.queued` receipt in one transaction.
- `cancel_connector_job`, `retry_connector_job` — owner-only and restricted to
  pre-side-effect/safe-retry states.

Service-role RPCs provide connection-state persistence, envelope/CAS storage,
single-use OAuth consumption, cursor storage, webhook endpoint resolution and
dedupe, job claims, attempt start, fenced transitions, reconciliation claims,
expired-lease sweeps and lease-bound material reads. No RPC accepts a provider
endpoint, arbitrary SQL, table name or caller-selected worker workspace.

`transition_connector_job` keeps its original signature and result keys. On a
normal `succeeded` + `provider.accepted` transition it also appends a
deterministic `provider.final` receipt in the same transaction and returns it
in the additive `finalReceipt` result key. Reconciliation success retains its
single `reconciliation.resolved` evidence and returns `finalReceipt: null`.

The worker delivery guarantee is exactly one durable approval-to-job insert
and at-least-once pickup. An expired `executing` lease becomes
`reconciliation_required`; a stale worker cannot complete with an old lease or
fence. Ambiguous outcomes are never blindly retried.

### Durable live disconnect remediation

Migration `0009_connector_live_disconnect.sql` replaces the metadata-only
disconnect path with a provider-neutral two-phase revocation workflow.
`connector_revocation_jobs` is workspace-bound, forces RLS, is directly
read-only to authenticated members, and has one durable row per connection.
Its states are `queued`, `leased`, `executing`, `retry_wait`, `succeeded`, and
`disconnected_unconfirmed`; claims are bounded and use `SKIP LOCKED`, leases,
monotonic fencing tokens, bounded attempts and deterministic receipts.

`request_connector_disconnect(uuid, uuid)` remains the authenticated owner
contract and now returns `{connection, receipt, revocationJob, noOp}`. It moves
the connection to `revoking`, appends a provider-bound
`revocation.requested`, and race-safely returns the existing request/job on
replay. Normal connector claims exclude `revoking` connections.

Service-only revocation RPCs are:

- `claim_connector_revocation_jobs(uuid, integer, integer, timestamptz)`;
- `start_connector_revocation_attempt(uuid, uuid, bigint, timestamptz)`;
- `read_connector_revocation_secret_envelope(uuid, uuid, bigint, text,
  timestamptz)`; and
- `transition_connector_revocation_job(uuid, uuid, bigint, text, text,
  timestamptz, jsonb, timestamptz)`.

A confirmed transition requires typed `provider-confirmed` evidence. It atomically marks the connection
`disconnected`, cryptoshreds connection-secret and payload envelopes, removes
connection-bound OAuth/cursor material, revokes the webhook binding, cancels
eligible ordinary jobs and appends `revocation.completed`. Terminal or
exhausted uncertainty marks `disconnected_unconfirmed`, appends
`confirmed: false`, and preserves encrypted recovery material. The generic
connection-state RPC cannot manufacture a revocation status. Exact JSON
envelopes and operations are frozen in
`CONNECTOR_LIVE_DISCONNECT_RUNBOOK.md`.

## Rich contact lifecycle

Migration `0007_rich_contact_lifecycle.sql` makes `contact_points` the
canonical phone/email authority while preserving `contacts.phone`,
`secondary_phone`, `email` and `email_subscribed` as synchronous compatibility
projections. Existing scalar data is backfilled with deterministic UUIDs after
a fail-closed validation preflight. Active phone points are bounded to three,
email points to two, and each type has at most one active primary point. Shared
normalized values across different contacts remain legal so identity resolution
can report ambiguity instead of silently merging people.

The richer workspace-scoped tables are:

- `contact_points` — normalized, labeled and ordered phone/email values with
  archive history and email subscription state only;
- `households` and `household_memberships` — grouping plus durable ended-at / 
  ended-by membership history, never an authorization or identity key;
- `contact_relationships` — one canonical unordered active contact pair with
  archive evidence;
- `contact_assignments` — explicit assignee membership history;
- `contact_custom_field_definitions` and `contact_custom_field_values` —
  owner-defined, bounded text/number/date/boolean/single-select data.

Every new table has a non-null `workspace_id`, workspace-composite foreign keys,
RLS enabled and forced, and read-only authenticated table privileges. Typed
`SECURITY DEFINER` RPCs own product mutations. Ordinary updates may be performed
by an active owner or assistant; field-definition and household archive
administration is owner-only. Direct product deletes are rejected by lifecycle
guards.

`contacts.archived_at`, `archived_by_membership_id` and `archive_reason` provide
soft archive/restore without changing contact identity. `active_contacts` is
the default active-only read view. The Story 3.1 task write guard now rejects a
new task linked to an archived contact. `lead_type` (`hot`, `warm`, `nurture`)
remains the only priority/rating authority; migration 0007 adds no `rating`
column.

`resolve_contact_import_identity(...)` returns `none`, `active-match`,
`archived-match` or `ambiguous-identity` using explicit external ID, email and
phone evidence. `apply_contact_import_group(...)` atomically applies one
application-collapsed target group: contact create/update/unchanged, points,
households, assignments, typed custom values, external link, exact-deduplicated
note and `contact-imported` evidence. Its v1 result is
`{ contactId, action, notesAdded, noOp }`; same-hash replay is a no-op and
divergent replay fails. Merge rows are `unchanged` groups for the selected
target and retain their link/note/import receipt.

Story 3.2 activity labels are persisted through
`crm_activity_event_type_v2`, while the public Story 3.1
`append_activity_event(... crm_activity_event_type ...)` signature remains
stable. Archive, point, household, relationship, assignment and custom-field
changes append deterministic lifecycle evidence. See
`RICH_CONTACT_LIFECYCLE_RUNBOOK.md` for apply, operation and rollback details.

## Server-only KEK rewrap operations

Migration `0008_connector_kek_rewrap.sql` closes the Story 3.5 CLI rotation
gap without enabling a provider. `connector_private.connector_rewrap_claims`
stores bounded operational leases that bind one envelope kind/ID/workspace,
source and target KEK versions, source wrapped-DEK hash, AAD hash, unchanged
business crypto version, worker UUID, lease and monotonically increasing fence.
The table forces RLS and has no direct grants, including to `service_role`.

Three `SECURITY DEFINER` RPCs with empty `search_path` are executable only by
`service_role`:

- `list_connector_kek_version_counts(target_now)` returns active counts grouped
  by `payload`, `connection-secret`, `oauth-pkce` or `sync-cursor` and KEK
  version. It returns no encrypted material.
- `claim_connector_kek_rewrap_candidates(worker_id, source_version,
  target_version, batch_size, lease_seconds, now)` claims 1–100 candidates for
  30–900 seconds. It returns only the wrapped DEK, wrapping nonce/tag, AAD hash,
  unchanged crypto version, canonical non-secret AAD fields and redacted claim
  authority; ciphertext and data nonce/tag are absent. AAD fields are
  `workspaceId|connectionId|provider|secretType|recordVersion`: payload uses
  payload kind, connection secret uses secret type, cursor uses stream key, and
  OAuth uses `oauth-pkce` with version 1. Pre-connection OAuth uses
  `oauth-transaction-{transaction_id}` as its non-empty connection binding.
- `cas_rewrap_connector_envelope(claim_id, worker_id, fence, wrapped_dek,
  wrap_nonce, wrap_auth_tag, target_version, aad_hash, now)` replaces only the
  DEK wrapper and KEK metadata. CAS compares claim ownership/lease/fence,
  workspace, active state, source KEK, source wrapper hash, AAD hash and business
  version. Same completed replay is a no-op; divergent replay fails.

Payload and connection-secret active rows are non-destroyed. OAuth PKCE must be
unconsumed/unexpired and cursor state unexpired. Webhook endpoint bindings are
hash-only and have no KEK wrapper. See `CONNECTOR_KEK_REWRAP_RUNBOOK.md`.

## Mailchimp selected-audience synchronization

Migration `0010_mailchimp_audience_sync.sql` adds the Story 4.1 database
authority without placing provider calls or secrets in the browser. Exactly
one active `mailchimp_audience_bindings` row may exist per connection;
replacement preserves history, cryptoshreds the prior audience cursor and
moves old queued webhook work to review. A new selection requires both an
initial baseline and provider webhook registration before incremental/webhook
claims become eligible.

`mailchimp_member_links` binds Mailchimp subscriber/member IDs to a canonical
workspace email `contact_point` without duplicating raw email.
`mailchimp_subscription_authority` records the provider's current state and a
durable fresh-consent requirement after unsubscribe/cleaned.
`mailchimp_sync_evidence` is append-only, origin/idempotency-keyed and contains
only hashes, IDs, status and outcomes. Ordinary outbound or inbound sync cannot
turn subscription back on while provider unsubscribe authority is locked.

`mailchimp_webhook_jobs` is a workspace-bound asynchronous queue over encrypted
`connector_private.connector_payload_envelopes`. Registration persists the
verified delivery, replay decision, payload reference and queue row in one
short transaction. Claims are bounded, use `SKIP LOCKED`, leases and monotonic
fences, recover expired work, enforce an attempt budget and end in `succeeded`
or honest `review`. Payload reads and inbound application require the exact
live worker/lease/fence.

Owner RPCs atomically begin OAuth, ensure the immutable `audience.sync` v1
owner-required policy, and select/replace the audience. Service-only RPCs
consume/finalize OAuth, read an encrypted access-token envelope only for an
explicit active owner tuple, record baseline/webhook readiness, return
lease-bound selected routing, enforce unsubscribe authority, store/read
version-CAS cursors, and operate the webhook queue. Five public Mailchimp
tables force RLS and grant authenticated roles redacted `SELECT` only. PKCE,
access-token, webhook-body and cursor ciphertext stays in `connector_private`.
Exact signatures, result envelopes and recovery rules are in
`MAILCHIMP_AUDIENCE_SYNC_RUNBOOK.md`.

## Mailchimp per-connection webhook secret authority

Migration `0011_mailchimp_webhook_secret_authority.sql` removes the global
Mailchimp webhook signing-secret assumption. The one-time provider signing
secret is encrypted before SQL and stored as private connection secret type
`mailchimp-webhook-signing-secret`. The existing private endpoint binding gains
only `remote_webhook_id_hash` and `updated_at`; both the endpoint key and remote
webhook ID remain opaque/hash-only. Disconnect revocation therefore blocks and
cryptoshreds this material through the existing Story 3.5 authority.

Service-only `read_mailchimp_webhook_setup_state` returns the nullable secret
version and readiness flags without endpoint/envelope material. Atomic
`bind_mailchimp_webhook_secret` creates or CAS-rotates the encrypted secret,
binds/replaces the endpoint and confirms selected-audience webhook registration.
`read_mailchimp_webhook_signing_secret` resolves only an active opaque endpoint,
active/degraded connection and current selected audience, returning the
encrypted envelope/version for bounded server verification.

`register_mailchimp_webhook_event_encrypted` replaces the service grant on the
0010 two-step registration seam. It decides replay before storing an accepted
encrypted body, then creates delivery/receipt/payload/job atomically. Exact
provider retries may use a new server correlation UUID and reuse the original
job/receipt/payload reference; divergent replay fails without an orphan
envelope. Rejected verification stores redacted evidence but no body envelope.

`apply_mailchimp_baseline_member` applies one bounded provider baseline item
with origin `baseline-reconciliation`, canonical email identity, durable
unsubscribe authority, per-item idempotency and the same fail-closed
ambiguous/archived/wrong-audience behavior as webhook processing, without
inventing a webhook delivery. See
`MAILCHIMP_WEBHOOK_SECRET_AUTHORITY_RUNBOOK.md` for frozen signatures and
incident/rollback instructions.

## Mailchimp resumable baseline and reconciliation

Migration `0012_mailchimp_reconciliation_runs.sql` makes the initial audience
baseline and later full reconciliations durable and resumable. Public
`mailchimp_reconciliation_runs` rows bind the exact workspace, connection,
selected-audience version, mode, snapshot hash, page size, numeric checkpoint,
attempt budget and lease/fence. Append-only `mailchimp_reconciliation_pages`
records redacted offset, count, total and hash evidence; neither table stores
raw provider bodies, emails, tokens or cursor values. Both force RLS and deny
direct browser mutation.

An owner creates an idempotent run. Service workers claim and start it with a
bounded lease, read the encrypted access-token envelope plus selected routing
only under the live lease/fence, apply pages of at most 500 exact member rows,
and complete or retry/review the run. Audience replacement atomically cancels
unfinished work for the previous binding. Initial baseline readiness can now
be confirmed only by successful completion of the final persisted page; the
older direct service grant is revoked.

The migration also wraps the existing inbound and baseline member paths. A
valid normalized email with no canonical contact, an ambiguous identity or an
archived identity is quarantined idempotently in `incomplete_records` with
append-only activity/evidence, without inventing or restoring a Contact.
Receipts remain hash/ID-only. Exact contracts and recovery rules are in
`MAILCHIMP_RECONCILIATION_RUNBOOK.md`.

## Mailchimp durable outbound backfill and tag-drift repair

Migration `0013_mailchimp_outbound_backfill.sql` adds an owner-governed,
resumable bulk path without bypassing the existing per-item connector job
authority. Public `mailchimp_outbound_backfill_runs` binds the current selected
audience, canonical mapping version, exact snapshot/counts, page size, approval
policy and lease/fence. Append-only approvals, page checkpoints and job links
force workspace RLS. The frozen contact/member/tag rows remain in
`connector_private` without direct browser or service-role table grants.

An active owner creates a count-only preview and approves only the exact
recomputed snapshot. Service workers read bounded pages of hash-only operations,
encrypt each canonical payload outside SQL, and atomically materialize normal
Story 3.5 `audience.sync` intents, owner approvals and jobs. Provider execution,
retry, reconciliation and accepted/final receipts continue through the generic
connector worker. Audience replacement cancels work for the old binding.

A service-only due scheduler creates periodic `tag-reconcile` previews, but it
cannot approve, enqueue or write externally. Each scheduled snapshot still
requires an active owner approval. Public evidence contains only IDs, hashes
and counts; raw email, provider body, credentials and encrypted envelopes are
excluded. Exact contracts and recovery rules are in
`MAILCHIMP_OUTBOUND_BACKFILL_RUNBOOK.md`.

## Google incremental OAuth, Gmail and Calendar authority

Migration `0014_google_connector_authority.sql` adds Story 4.2's workspace-
scoped Google authority without treating Google sign-in as connector consent.
`google_connection_capabilities` records the exact Gmail-send, Gmail-metadata
and Calendar-app-created bundles. OAuth completion stores access and refresh
tokens separately in the existing private connector vault and idempotently
creates one canonical owner-required policy per action unlocked by the returned
scopes. Account swaps fail closed; the normalized account email is visible only
as the RLS-protected connection label while receipts remain hash-only.

`google_email_drafts` and append-only `google_email_draft_versions` bind a
canonical contact/email point to a private encrypted payload, recipient hash,
CAS version and exact pending intent. Assistants may draft, but only the
existing owner approval/enqueue seam creates an executable job. The fenced
worker authority returns the exact immutable payload envelope and separate
token/cursor envelopes. Expired access tokens require a live refresh secret and
rotate by secret-version CAS without changing account, scopes or capability.

Private Gmail resource rows bind message/thread IDs to minimized hashes and
contact activity. Send completion derives the approved draft/contact from the
job graph, marks the draft sent and emits hash-only evidence. Metadata sync
receives the normalized counterpart ephemerally: exactly one active canonical
email links, while none/shared/archived/self/group identities create redacted
review state without contact mutation. No raw counterpart, subject or body is
stored in public rows, receipts or activity.

Private Calendar rows hold one dedicated Omnix-created secondary calendar and
stable task-event resources. Public task state binds the database-managed task
version; stale writes fail and provider divergence records conflict without
overwriting the canonical Omnix task. Gmail history and Calendar sync cursors
reuse the encrypted cursor seam with explicit full-resync state. Exact worker,
OAuth, draft, resource and recovery contracts are in
`GOOGLE_CONNECTOR_AUTHORITY_RUNBOOK.md`.

## Twilio consent-aware texting authority

Migration `0015_twilio_compliant_texting.sql` adds Story 4.3's workspace-bound
Twilio sender/readiness, immutable consent, encrypted draft, exact approval,
message, callback and reconciliation authority. Owners configure the sender,
registration and versioned compliance policies; assistants can record bounded
consent evidence and compose drafts but cannot read credentials, change policy
or self-approve `message.send`. Public tables force workspace RLS and expose
only redacted IDs, hashes, state and timestamps. Restricted provider/API
credentials, webhook Auth Token, raw Message SID and message content remain in
private encrypted/resource tables without browser grants.

Every send binds one active, non-shared canonical phone point, current opt-in
event, exact body/sender/policy/timezone snapshot and owner approval. The
generic Story 3.5 `start_connector_job_attempt` transition triggers an atomic
`side_effect_started_at` boundary on its Twilio message, so STOP and disable
cancel only work that has not begun provider execution. Fenced worker reads
revalidate connection readiness, current consent/suppression and immutable
payload/approval authority before returning encrypted material.

Callback routes first resolve a private opaque endpoint, decrypt the Auth Token
server-side and validate the exact public URL plus all parameters/raw body with
the official Twilio SDK. Only then does atomic ingress deduplicate and apply
STOP before other processing. START/HELP append evidence; unsupported or
none/shared/archived identity is quarantined hash-only. Status transitions are
monotonic and missing terminal callbacks use bounded lease/fence reconciliation.
Disable preserves consent, STOP, message, callback and receipt history and may
destroy only send credentials while retaining late-callback verification.
Exact contracts and recovery rules are in
`TWILIO_COMPLIANT_TEXTING_RUNBOOK.md`.

## Applying and validating

1. Take a `pg_dump --schema-only` snapshot and a verified data backup.
2. Apply migrations in numeric order with `ON_ERROR_STOP=1`.
3. From `packages/crm`, run `supabase db reset --local` against the isolated
   local project so migrations `0001` through `0015` replay from an empty
   database.
4. Run the official TAP matrices with:
   `supabase test db supabase/tests/0004_shared_workspace_authority_test.sql --local`
   and
   `supabase test db supabase/tests/0005_crm_work_queue_test.sql --local`
   and
   `supabase test db supabase/tests/0006_connector_platform_foundation_test.sql --local`
   and
   `supabase test db supabase/tests/0007_rich_contact_lifecycle_test.sql --local`
   and
   `supabase test db supabase/tests/0008_connector_kek_rewrap_test.sql --local`.
   and
   `supabase test db supabase/tests/0009_connector_live_disconnect_test.sql --local`
   and
   `supabase test db supabase/tests/0010_mailchimp_audience_sync_test.sql --local`.
   and
   `supabase test db supabase/tests/0011_mailchimp_webhook_secret_authority_test.sql --local`.
   and
   `supabase test db supabase/tests/0012_mailchimp_reconciliation_runs_test.sql --local`.
   and
   `supabase test db supabase/tests/0013_mailchimp_outbound_backfill_test.sql --local`.
   and
   `supabase test db supabase/tests/0014_google_connector_authority_test.sql --local`.
   and
   `supabase test db supabase/tests/0015_twilio_compliant_texting_test.sql --local`.
5. Verify the two-workspace, active assistant, revoked assistant, cross-link,
   replay, conversion, bulk-transition, connector role/grant, lease/fencing,
   webhook replay, contact lifecycle, ambiguous identity, import atomicity and
   append-only cases before any remote deployment.

On 2026-08-11, isolated local replay through migration 0005 passed and the 0005
matrix reported `Files=1, Tests=16` and `Result: PASS`. This is local database
evidence only; it is not proof of remote migration, deployment or production
operation.

On 2026-08-11, migration 0006 applied locally and its database matrix reported
`Files=1, Tests=19` and `Result: PASS`; the 0004 and 0005 matrices also remained
green at 11 and 16 tests. One intermediate CLI reset applied all migrations but
timed out while checking restarted Storage; `supabase status` was healthy and a
later full reset completed normally. This is isolated local evidence only. It
is not remote migration, provider credentials, provider verification,
live-account UAT, deployment or production evidence.

On 2026-08-11, a clean isolated reset replayed migrations 0001–0007. The 0007
matrix reported `Files=1, Tests=18` and `Result: PASS`; the combined 0004–0007
regression reported `Files=4, Tests=64` and `Result: PASS`. This remains local
database evidence, not remote migration, deployed adapter, production backup
recovery or end-to-end import evidence.

On 2026-08-11, the 0008 matrix reported `Files=1, Tests=14` and `Result: PASS`.
After a clean 0001–0008 replay, the combined 0004–0008 regression reported
`Files=5, Tests=78` and `Result: PASS`. This is local database evidence only; it
does not establish production KEK access, escrow, remote deployment or
completed rotation.

On 2026-08-11, a clean isolated reset replayed migrations 0001–0010. The 0010
Mailchimp matrix reported `Files=1, Tests=25` and `Result: PASS`; the combined
0004–0010 regression reported `Files=7, Tests=119` and `Result: PASS`. The
pre-write 0010 rollback removed its tables/functions and the 0004–0009
regression remained green at `Files=6, Tests=94`; 0010 then replayed cleanly.
Schema lint reported no warning owned by migration 0010; remaining warnings
are in pre-existing 0005–0007 routines. This is local database evidence only,
not live Mailchimp OAuth, webhook traffic, provider credentials, remote apply,
real-account UAT or production deployment evidence.

On 2026-08-11, a clean isolated reset replayed migrations 0001–0011. The 0011
Mailchimp per-connection webhook/baseline matrix reported `Files=1, Tests=22`
and `Result: PASS`; the post-0011 compatible 0004–0009 plus 0011 regression
reported `Files=7, Tests=116` and `Result: PASS`. The frozen 0010 matrix calls
the intentionally revoked two-step ingress RPC, so it is run in the 0010
pre-write rollback state, where it remained green at 25 tests; modifying that
historical matrix would erase the regression proof. The rollback removed the
0011 functions/columns, restored the 0010 registration grant/constraint and
migration 0011 then replayed cleanly. This remains
local database evidence only, not hosted callback, live Mailchimp signature,
real-audience UAT, remote migration or production deployment evidence.

On 2026-08-12, a clean isolated reset replayed migrations 0001–0012. The 0012
resumable reconciliation/quarantine matrix reported `Files=1, Tests=24` and
`Result: PASS`; the compatible 0004–0009 plus 0011–0012 regression reported
`Files=8, Tests=140` and `Result: PASS`. The 0012 pre-write rollback was
rehearsed against the 0011 state and followed by a clean 0012 replay. This is
isolated local database evidence only, not live Mailchimp pagination, provider
credentials, remote migration, real-audience UAT or production deployment.

On 2026-08-12, migration 0013 replayed locally through the full 0001–0013 SQL
chain. Its focused outbound backfill/tag-drift matrix reported `Files=1,
Tests=27` and `Result: PASS`; the compatible 0004–0009 plus 0011–0013
regression reported `Files=9, Tests=167` and `Result: PASS`. The pre-write
rollback removed every 0013 object while preserving the 0012 reconciliation
tables and was followed by a successful SQL replay. On the final two resets,
all migrations applied but the CLI timed out only while probing the restarted
Storage HTTP endpoint; `supabase status` was healthy and the full 167-test DB
matrix passed afterward. Schema lint reported no 0013-owned warning; remaining
warnings are in pre-existing 0005–0007 routines. This is isolated local
database evidence only, not live Mailchimp tags, remote migration, provider
credentials, real-audience UAT or production deployment.

On 2026-08-12, a clean isolated reset replayed migrations 0001–0014. The 0014
Google authority matrix reported `Files=1, Tests=29` and `Result: PASS`; the
compatible 0004–0009 plus 0011–0014 regression reported `Files=10, Tests=196`
and `Result: PASS`. The pre-write rollback removed every 0014 object while
preserving the 0013 Mailchimp outbound authority and was followed by a clean
0014 replay. Schema lint reported no 0014-owned warning after cleanup;
remaining warnings are in pre-existing 0005–0007/0006 routines. This is local
database evidence only, not Google verification, credentials, remote apply,
live Gmail/Calendar UAT, deployment or production operation.

On 2026-08-12, migration 0015 replayed locally through the full 0001–0015 SQL
chain. Its focused consent/texting/callback/reconciliation matrix reported
`Files=1, Tests=26` and `Result: PASS`; the compatible 0004–0009 plus
0011–0015 regression reported `Files=11, Tests=222` and `Result: PASS`. The
pre-write rollback removed every 0015 function, trigger, table and enum and a
subsequent reset replayed 0015 cleanly. One final reset applied every migration
but received a transient 502 only while probing restarted services;
`supabase status` was healthy and the full 222-test DB matrix passed
immediately afterward. Schema lint reported no error; its 0015 findings were
limited to unused validation row variables, alongside pre-existing 0005–0007/
0006 warnings. This is local deterministic database evidence only, not Twilio
credentials, carrier registration, counsel approval, hosted exact-URL callback,
remote migration, real-number UAT, deployment or production operation.

Migration 0016 adds the Meta inbound-only authority. Public forced-RLS tables
hold redacted connection/version/scope authority, selected-asset hashes,
external-sender hashes, conversation/event provenance and durable normalization
jobs. Private tables hold exact eligible asset IDs, endpoint secret binding and
event provider IDs; token and message-content envelopes reuse the connector
vault. Owner OAuth/asset selection, service-only signed ingress, lease/fence
normalization, incomplete-review quarantine, retention cryptoshred and
disconnect all remain workspace-bound. The schema explicitly excludes Lead
Ads, outbound DM and an invented reconciliation stream. See
`META_INBOUND_BUSINESS_MESSAGING_RUNBOOK.md`.

Migration 0017 adds one public forced-RLS controlled real-number UAT queue and
one private provider-SID binding. It also adds a separate exact `/status` URL
hash beside the existing exact `/inbound` hash, a kind-aware verification read,
a status-only atomic ingress RPC, a redacted service setup/version read and
STOP/disconnect cancellation guards. Only delivered/read UAT evidence can move
Twilio from authorizing to active; normal `message.send` remains unchanged and
active-only. See `TWILIO_ACTIVATION_CALLBACK_ROUTES_RUNBOOK.md`.

On 2026-08-12, a clean local reset replayed migrations 0001–0017. The focused
0016 Meta matrix reported `Files=1, Tests=24` and `Result: PASS`; the focused
0017 activation/routes matrix reported `Files=1, Tests=16` and `Result: PASS`;
the adjusted 0015 Twilio matrix remained green at 26 tests. This is local
deterministic database evidence only, not Meta/Twilio credentials, App Review,
carrier approval, hosted callback verification, real-account UAT, remote apply
or production deployment.

## Typed contact import source facts (migration 0026)

Migration `0026_contact_import_source_facts.sql` adds an immutable, bounded
provenance ledger for preserved import cells. It complements the editable rich
custom-field projection from migration 0007; it does not replace canonical
contact fields or create one physical column per vendor header.

`contact_import_source_facts` stores one typed scalar fact per
`(workspace_id, group_idempotency_key, source_key)`. Each row binds the contact,
active actor membership, provider, schema version, source label/category,
optional physical row number, request hash, value hash and capture time. Values
are limited to typed text, number, boolean, date or timestamp scalars. Raw rows,
workbooks, CSV buffers and arbitrary JSON objects are rejected.

The authenticated role receives `SELECT` only and forced RLS derives reads from
`has_workspace_access(workspace_id)`. An immutable trigger rejects updates and
deletes even through privileged SQL. The versioned
`apply_contact_import_group(...)` wrapper accepts an optional bounded
`sourceProfile`, calls the frozen 0025/0007 import transaction, then appends all
facts in the same database transaction. Invalid facts roll back the contact,
receipt and profile together; exact replays are no-ops and divergent request or
fact replays fail closed. Facts categorized as `consent` remain evidence only
and do not mutate any messaging authorization table.

The pre-write rollback
`supabase/rollbacks/0026_contact_import_source_facts.rollback.sql` refuses once
any fact exists. After that boundary, preserve provenance and use PITR or a
reviewed forward migration. Local evidence on 2026-08-18: clean reset replayed
0001–0026; focused 0026 pgTAP passed 18 cases; the forward-compatible 0023–0026
matrix passed 64 cases; the empty-state rollback removed the ledger/wrapper,
restored the 0025 function, and 0026 replayed with the focused suite green.
Schema lint reported no 0026-owned finding; all reported warnings predate this
migration.

## Rollback

Prefer the pre-migration snapshot/PITR. The manual rollback file is intentionally
restricted to the pre-write window because it removes workspace authority and
audit rows. Never run it after assistant or workspace-aware writes without a
separately approved data-reconciliation plan.

For migration 0005, `supabase/rollbacks/0005_crm_work_queue.rollback.sql` drops
the RPCs, policies, work-queue tables, triggers, validators and enums in reverse
dependency order. It is destructive and is restricted to the pre-write window;
after CRM queue writes exist, restore/PITR or an approved reconciliation plan is
required. The rollback was rehearsed locally with `ON_ERROR_STOP`, verified to
remove the 0005 objects while preserving Story 3.0 workspaces, and followed by a
successful full migration replay and 16-test TAP pass.

For migration 0006,
`supabase/rollbacks/0006_connector_platform_foundation.rollback.sql` refuses to
run once any connector row exists. In the pre-write window it removes the
connector RPCs, tables, private schema and enums in reverse dependency order.
After writes exist, stop new enqueue/provider flags, preserve jobs/approvals and
receipts, reconcile ambiguous operations, and use PITR or an approved forward
fix. See `CONNECTOR_FOUNDATION_RUNBOOK.md` for the operational sequence.

The pre-write rollback was rehearsed locally with `ON_ERROR_STOP`: it removed
the connector tables/private schema while preserving Story 3.0 workspaces. A
subsequent clean reset replayed migrations 0001–0006 and all three database
matrices passed again.

For migration 0007,
`supabase/rollbacks/0007_rich_contact_lifecycle.rollback.sql` accepts only the
pre-write state: deterministic scalar backfill points, no rich lifecycle event,
no archived contact and no household, relationship, assignment or custom-field
row. It restores the Story 3.1 task guard, activity enum/constraint and
conversion validators, then removes the rich tables/types/functions. The
rollback was rehearsed locally with `ON_ERROR_STOP`; the 0004–0006 matrices
then passed `Files=3, Tests=46`. After any rich-contact write, use PITR or an
approved forward reconciliation instead. See
`RICH_CONTACT_LIFECYCLE_RUNBOOK.md`.

For migration 0008,
`supabase/rollbacks/0008_connector_kek_rewrap.rollback.sql` removes the three
service RPCs, operational claim table and supporting indexes only when no claim
has completed. It refuses to run after a wrapped DEK was replaced because a
schema rollback cannot reconstruct the prior wrapper. Keep both KEKs and use a
reviewed forward rotation or PITR after that boundary. See
`CONNECTOR_KEK_REWRAP_RUNBOOK.md`. The pre-write rollback was rehearsed locally
with `ON_ERROR_STOP`; the 0004–0007 regression then passed `Files=4, Tests=64`
before migration 0008 was replayed cleanly.

For migration 0010,
`supabase/rollbacks/0010_mailchimp_audience_sync.rollback.sql` removes the
Mailchimp RPCs, policies, triggers, tables and the contact-point composite key
only in the pre-write window. It refuses after any Mailchimp OAuth, policy,
audience, member, subscription, sync, queue or receipt authority exists. The
six connector receipt enum labels remain because PostgreSQL cannot safely
remove enum values. After writes, stop callbacks/workers and use managed PITR
or a reviewed forward migration. See `MAILCHIMP_AUDIENCE_SYNC_RUNBOOK.md`.

For migration 0011,
`supabase/rollbacks/0011_mailchimp_webhook_secret_authority.rollback.sql`
removes the four service RPCs plus setup-state RPC and the two private endpoint
metadata columns only before any 0011 webhook/baseline authority is written.
It restores the 0010 evidence-origin constraint and former two-step register
grant only in that empty rollback window. Once a webhook ID hash, encrypted
signing-secret row or baseline-reconciliation evidence exists, use managed
PITR or a reviewed forward migration. See
`MAILCHIMP_WEBHOOK_SECRET_AUTHORITY_RUNBOOK.md`.

For migration 0012,
`supabase/rollbacks/0012_mailchimp_reconciliation_runs.rollback.sql` removes
the reconciliation RPCs, RLS tables, triggers and quarantine wrappers only in
the pre-write window. It restores the 0011 apply functions, baseline-complete
service grant and prior activity constraint; the additive enum label remains.
It refuses once any reconciliation page/run or 0012 quarantine/activity/
receipt evidence exists. After writes, stop workers/callbacks and use managed
PITR or a reviewed forward migration. See
`MAILCHIMP_RECONCILIATION_RUNBOOK.md`.

For migration 0013,
`supabase/rollbacks/0013_mailchimp_outbound_backfill.rollback.sql` removes the
outbound backfill RPCs, audience-replacement trigger, private frozen-item/helper
objects and four public RLS tables only in the pre-write window. It refuses
once any preview/run, approval, page, job-link or backfill receipt exists. Once
work exists, stop schedulers/workers, preserve the generated per-item jobs and
receipts, reconcile ambiguous provider operations, and use managed PITR or a
reviewed forward migration. See
`MAILCHIMP_OUTBOUND_BACKFILL_RUNBOOK.md`.

For migration 0014,
`supabase/rollbacks/0014_google_connector_authority.rollback.sql` removes the
Google RPCs, disconnect/task triggers, private provider-resource tables,
public RLS state/draft tables and task-version column only in the pre-write
window. It refuses after any Google connection, OAuth/token/cursor, draft,
resource, activity or receipt authority exists. Enum labels remain because
PostgreSQL cannot safely remove values. After writes, stop callbacks/workers,
preserve CRM/provider evidence, reconcile ambiguous external operations and
use managed PITR or a reviewed forward migration. See
`GOOGLE_CONNECTOR_AUTHORITY_RUNBOOK.md`.

For migration 0015,
`supabase/rollbacks/0015_twilio_compliant_texting.rollback.sql` removes the
Twilio RPCs, connection/job triggers, public RLS metadata, private provider
resources and 0015 enums only in the pre-write window. It refuses after any
authority, policy, consent, STOP/suppression, draft, message, callback,
reconciliation, encrypted Twilio payload/secret or generic Twilio
policy/intent/job/receipt exists. Once evidence exists, stop new sends and
workers, preserve consent and provider-delivery history, reconcile ambiguous
operations, and use managed PITR or a reviewed forward migration. See
`TWILIO_COMPLIANT_TEXTING_RUNBOOK.md`.

For migration 0016,
`supabase/rollbacks/0016_meta_inbound_business_messaging.rollback.sql` removes
the Meta RPCs, trigger, public RLS/private identity tables and enums only before
any Meta OAuth, secret, asset, webhook, event, job, review, receipt or encrypted
payload exists. After writes, stop ingress/workers and use managed PITR or a
reviewed forward remediation. See `META_INBOUND_BUSINESS_MESSAGING_RUNBOOK.md`.

For migration 0017,
`supabase/rollbacks/0017_twilio_activation_and_callback_routes.rollback.sql`
removes the controlled UAT queue/resources, kind-specific verification/status
RPCs, exact-route/STOP/disconnect guards and `/status` hash only before any UAT
or kind-specific callback evidence exists. It restores the 0015 readiness RPC
and legacy verification grant in that empty window. After writes, preserve UAT,
consent and callback evidence and use PITR or a reviewed forward migration. See
`TWILIO_ACTIVATION_CALLBACK_ROUTES_RUNBOOK.md`.

## Meta Page token authority (migration 0018)

Migration 0018 closes the Facebook Page token authority gap without changing
the frozen 0016 contracts. Each eligible/selected Facebook Page has a private
current version pointer to a generic encrypted payload envelope; exact Page
IDs remain in the 0016 private identity table. Service-only RPCs expose an
owner-bound redacted setup/CAS view, atomically bind the exact Page-token batch,
and return one selected Page/token envelope for provider subscription setup.
Selection fails closed without a live Page token. Rotation, eligible-snapshot
replacement and confirmed disconnect cryptoshred superseded token material;
`disconnected_unconfirmed` preserves encrypted recovery evidence without read
authority. Instagram Login remains connection-token based. See
`META_PAGE_ACCESS_TOKEN_AUTHORITY_RUNBOOK.md`.

`supabase/rollbacks/0018_meta_page_access_token_authority.rollback.sql`
removes the Page selection guards, service setup/bind/read RPCs and private
current-token table only before any Page-token binding or encrypted payload is
written. Once a token has been bound, rotated or cryptoshredded, preserve the
evidence and use managed PITR or a reviewed forward remediation.

On 2026-08-12, a clean local reset replayed migrations 0001–0018. The focused
0018 matrix reported `Files=1, Tests=18` and `Result: PASS`; the forward-
compatible 0016+0018 pair reported 42 passing tests. A compatible regression
excluding the separately owned 0010 grant-drift test reported
`Files=14, Tests=280` and `Result: PASS`. The final pre-write rollback was
executed with `ON_ERROR_STOP`, verified to remove the 0018 table/RPC, replayed,
and the 42-test Meta pair passed again. Schema lint reported no 0018 finding;
remaining warnings are historical functions outside this migration. This is
local deterministic database evidence only, not live Page credentials, Meta
Business Verification/App Review, subscription UAT, remote apply, deployment
or production operation.

## Verified Twilio UAT and Meta subscription evidence (migration 0019)

Migration 0019 makes production Twilio activation depend on four ordered
persisted facts: signed delivered/read status callback, signed inbound reply,
applied STOP and cancellation of a durable safety probe before any side
effect. Polling-delivered alone cannot populate callback/UAT evidence or make
the connection active. `twilio_real_number_uat_evidence_events` is append-only;
`twilio_real_number_uat_evidence_state` is the guarded projection.

Meta selected assets now have append-only provider-subscription events and a
workspace-bound `pending|subscribed|failed|unsubscribed` projection. Exact
selection replay is a no-op, so failed/pending subscription setup is retryable
without rediscovery. A service-only owner-bound authority supports both
Facebook Page tokens and Instagram Login connection tokens. Separate
lease/fence and reviewer-bound reads expose only the encrypted material needed
for Meta revocation and human enquiry review; public rows remain hash-only.

`supabase/rollbacks/0019_twilio_uat_meta_subscription_evidence.rollback.sql`
is pre-write only and restores the frozen 0016–0018 function bodies before
removing the new objects. It refuses once any UAT safety/evidence or Meta
subscription row exists. After that boundary, preserve evidence and use PITR
or a reviewed forward migration. See
`TWILIO_UAT_META_SUBSCRIPTION_EVIDENCE_RUNBOOK.md`.

On 2026-08-12 a clean local reset replayed migrations 0001–0019. The focused
0019 suite passed 21 cases and the 0004–0019 compatible matrix passed
`Files=16, Tests=326`. The pre-write rollback ran with `ON_ERROR_STOP`, removed
the 0019 objects, restored the frozen Page authority and was followed by a
clean replay. Schema lint produced no 0019 finding; only historical warnings
outside this migration remain.

## Twilio post-STOP UAT recovery and Meta converted review (migration 0020)

Migration 0020 preserves the single Twilio UAT send boundary while allowing
the already-bound provider SID to be polled/finalized after STOP only when the
same job has the complete signed four-fact sequence. The fenced read adds
`evidenceComplete`; a bound SID always returns `lookup-only` with no payload.
The reserved `uat_sequence_pending` retry category represents an unbounded
human wait without consuming the separate bounded provider-error budget.
The equally bound `uat_finalize_pending` category permits the complete
same-job sequence to obtain one lookup-only finalization lease even when the
provider-attempt counter is at its ceiling.

The existing Meta review RPC now accepts a generic incomplete-record
conversion only for its exact converted active contact. It then atomically
links event, external identity and conversation; wrong-contact and divergent
linked replays fail before mutation. No table, RLS policy, provider scope or
public RPC signature changes in this migration. See
`TWILIO_UAT_POST_STOP_RECOVERY_RUNBOOK.md` and the pre-use rollback
`supabase/rollbacks/0020_twilio_uat_post_stop_recovery.rollback.sql`.

On 2026-08-12, reset/replay 0001–0020 and the focused 52-case behavioral
matrix passed. The 11-file forward-compatible connector matrix passed 222
cases. The 0020 pre-use rollback restored the prior function bodies under
`ON_ERROR_STOP` and 0020 replayed cleanly afterward. Schema lint found no
0020-owned warning. The six known historical direct-table TAP/grant drifts are
documented in the runbook rather than mislabeled as a green all-files run.

## Google push, ambiguity and Calendar lifecycle authority (migration 0021)

Migration 0021 adds hash-only `google_gmail_watch_deliveries`, durable
coalescing `google_gmail_history_wakeup_jobs` and public redacted
`google_gmail_send_reconciliations`. Exact watch routing metadata remains in
`connector_private.google_gmail_watch_ingress_authorities`; access tokens,
refresh tokens and Gmail history cursors remain encrypted private records.
Push delivery is only a wake-up: bounded authoritative Gmail history pages and
cursor CAS determine sync state. Generation capture prevents a notification
arriving during execution from being lost. Due watch renewals use the same
lease/fence queue with `job_kind=watch-renewal`; watch/ingress CAS rotation
occurs only after a real `users.watch` result.

Gmail send ambiguity uses the hash of the deterministic encrypted draft
Message-ID/client marker. With an exact active gmail-metadata capability, the
worker may inspect at most 100 recent metadata IDs without Gmail `q`; otherwise
the operation is `unavailable-no-resend`. Calendar resources now preserve
`active|completed|cancelled|deleted` lifecycle and evidence hashes. The exact
Omnix task version/status remains canonical for all remote lifecycle writes.

The service-only probe read/refresh requires an explicit active owner and exposes only
encrypted token envelopes plus redacted identity binding. Probe recording
requires exact observed OIDC subject and normalized-email hashes and never
changes scopes or identity. Confirmed generic revocation now accepts only
provider-confirmed evidence; no provider endpoint remains honest unconfirmed
state.

See `GOOGLE_PUSH_RECONCILIATION_CALENDAR_LIFECYCLE_RUNBOOK.md` and the pre-use
rollback `supabase/rollbacks/0021_google_push_reconciliation_calendar_lifecycle.rollback.sql`.

On 2026-08-12, a clean local reset replayed migrations 0001–0021. The focused
0021 suite passed 30 cases; the 12-file forward-compatible connector matrix
passed 252 cases. The pre-use rollback ran under `ON_ERROR_STOP`, removed the
0021 objects, restored the frozen 0014/0009 functions, and 0021 replayed with
the focused suite green again. Schema lint reports no 0021-owned warning; all
reported warnings predate this migration. The raw all-files TAP invocation
still stops in six documented historical tests (0004/0005/0007/0010/0011/0012)
because those tests query tables directly under roles whose later migrations
intentionally revoked that access; no grant was weakened to make a legacy test
pass. This remains local deterministic evidence, not Google provider UAT,
production credential/configuration, remote apply or deployment evidence.

## Inert exact-contact merge foundation (migration 0027)

Migration 0027 adds the reversible logical-alias foundation approved by Story
3.15. It does not reparent or delete contacts or dependent evidence. A plan is
group-scoped, stores one database-selected survivor and one or more physical
donors, and persists only SHA-256 identity/snapshot evidence plus aggregate
dependency counts. Survivor selection is deterministic: exact external link
first, oldest `contacts.created_at` second, stable UUID last.

`contact_merge_workspace_state` owns the per-workspace alias epoch. Its
`contact_merge_foundation_inert` constraint fixes `apply_enabled=false` and
`activation_version=0`; therefore a valid owner plan still cannot apply or
reverse in 0027. Activation requires a separate forward migration 0028 after
all repositories, import flows and outbound dispatchers implement the alias
contract. There is no table grant or product configuration path that can turn
the foundation on.

`contact_merge_plans`, `contact_merge_plan_members`,
`contact_merge_aliases` and `contact_merge_events` are RPC-only. Active aliases
form a one-level star enforced by a constraint trigger; a donor cannot become
a survivor, a survivor cannot become a donor, and cycles/chains fail closed.
The append-only redacted event receipt contains no raw email, phone, provider
ID, name, address or note body. Active workspace members may read active alias
rows; only owners may read event evidence or plan/apply/reverse through the
guarded RPCs. Pending plan internals and member snapshots have no authenticated
table grant.

`contact_merge_contact_snapshot` discovers every present foreign-key consumer
of `contacts` and `contact_points` from the PostgreSQL catalog, hashes complete
dependency state inside the database, and returns only per-path counts and a
digest. `contact_merge_plan_snapshot` binds the ordered member set, selected
survivor, dependency digests and alias epoch. Apply locks contacts in UUID
order and recomputes that digest before checking activation; stale plans return
SQLSTATE `40001` with zero mutation. Provider/outbound consumers make a plan
review-only while application compatibility is incomplete.

The application-facing primitives are:

- `resolve_canonical_contact_id(workspace_id, contact_id)`;
- `list_contact_alias_group_ids(workspace_id, contact_id)` returning physical
  group IDs, canonical marker and alias epoch;
- `assert_contact_outbound_target(workspace_id, contact_id, contact_point_id)`
  rejecting donors, donor-owned/foreign points and archived targets;
- owner-only `plan_exact_contact_merge`, `apply_exact_contact_merge` and
  `reverse_exact_contact_merge` contracts.

`supabase/rollbacks/0027_contact_merge_foundation.rollback.sql` is deliberately
pre-write only. It refuses when any plan, member, alias or event exists. After
the first write use a reviewed forward correction; after activation use the
whole-plan reverse RPC. No backup table is created in Supabase.

On 2026-08-18 a clean local reset replayed migrations 0001–0027. The focused
0027 pgTAP matrix passed 33 cases covering grants, owner/assistant/revoked and
two-workspace boundaries, deterministic survivor selection, PII-free receipts,
stale-plan refusal, cycle rejection, resolver/group behavior, outbound refusal
and apply/reverse activation gates. The pre-write rollback ran with
`ON_ERROR_STOP`, removed the complete 0027 foundation, and the migration
replayed successfully. This is local foundation evidence only: no 0028
activation, production apply, production alias, merge or reverse is claimed.

On 2026-08-20 the same 0001–0027 reset, focused 33-case pgTAP and pre-write
rollback/replay sequence passed again. Schema lint reports no 0027-owned
warning after removing two unused PL/pgSQL declarations; remaining warnings
belong to earlier migrations. No application consumer of the canonical/group/
outbound resolver contract was present, so the 0028 activation boundary
remains closed and no production mutation was attempted.
