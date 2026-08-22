# Omnix live connector disconnect runbook

Scope: migration `0009_connector_live_disconnect.sql`. Disconnect is a
two-phase, owner-authorized operation. A browser request never calls a provider
and never deletes credentials. It records durable authority; a server worker
then performs provider revocation under a lease and fencing token.

## Frozen RPC contract

Authenticated owner:

```text
request_connector_disconnect(connection_id uuid, correlation_id uuid) -> jsonb
```

Returns `{connection, receipt, revocationJob, noOp}`. Embedded persisted rows
use snake_case. First use moves an eligible connection to `revoking`, creates
one `connector_revocation_jobs` row and appends one provider-bound
`revocation.requested` receipt. Replay returns those same durable rows with
`noOp: true`; a new correlation ID does not create a second authority record.

Service role only:

```text
claim_connector_revocation_jobs(worker_id uuid, batch_size integer,
  lease_seconds integer, now timestamptz) -> jsonb
start_connector_revocation_attempt(job_id uuid, worker_id uuid,
  fencing_token bigint, started_at timestamptz) -> jsonb
read_connector_revocation_secret_envelope(job_id uuid, worker_id uuid,
  fencing_token bigint, secret_type text, now timestamptz) -> jsonb
transition_connector_revocation_job(job_id uuid, worker_id uuid,
  fencing_token bigint, outcome text, error_category text,
  next_attempt_at timestamptz, evidence jsonb, now timestamptz) -> jsonb
```

Claim returns `{count, jobs}`. Each item has `id`, `workspaceId`,
`connectionId`, `provider`, `state`, `attemptCount`, `maxAttempts`,
`scheduledAt`, `leaseOwner`, `leaseExpiresAt`, `fencingToken`, `correlationId`
and a nested redacted `connection` database row. It contains no ciphertext.

Start returns `{revocationJob, connection, receipt, noOp}` and atomically
appends `attempt.started`. The envelope read returns only encrypted envelope
components and is valid only for the same live lease owner and fence. Transition
returns `{revocationJob, connection, receipt, noOp}`.

## Worker loop

1. Claim 1–25 due jobs with a unique UUID worker ID and a 15–900 second lease.
   Default operations use 10 jobs and 90 seconds. An expired `leased` job may
   be safely reclaimed because no attempt was started. An `executing` job is
   never blindly reclaimed.
2. Select a compiled provider adapter by `job.provider`; never accept an
   endpoint from the database or caller.
3. Call start before any external request. Persisted `attempt.started` is the
   durable boundary.
4. Read only the required encrypted secret type, decrypt in server memory, and
   call the provider's fixed revocation operation. Do not log the envelope or
   decrypted token.
5. Transition with one outcome:
   - `confirmed`: evidence must contain `confirmationKind` equal to
     `provider-confirmed`;
   - `retry`: a categorized failure with a future `next_attempt_at`;
   - `unknown`: ambiguous provider result with a future retry schedule;
   - `terminal`: no trustworthy confirmation is possible and manual provider
     action is required.
6. Treat `40001` as a stale lease/fence. Discard in-memory material and do not
   write provider state. Treat `42501` as an authority failure. Treat `23505`
   as divergent terminal replay.

Evidence accepts only `confirmationKind`, `providerRequestHash`,
`providerStatus`, and `reasonCode`. The request hash, when present, is exactly
64 lowercase hexadecimal characters. Do not place provider response bodies,
tokens, account addresses, messages or contact data in evidence.

## Terminal behavior

A confirmed outcome is one database transaction that:

- marks the revocation job `succeeded` and connection `disconnected`;
- cryptoshreds active connection-secret and payload envelopes by nulling
  ciphertext, data nonce/tag and wrapped-DEK components and setting
  `destroyed_at`;
- deletes connection-bound OAuth PKCE transactions and sync cursors;
- revokes the hashed webhook binding;
- cancels queued/retry-wait ordinary connector jobs; and
- appends `revocation.completed` with `confirmed: true` and provider evidence.

`terminal`, or a retry/unknown result after the bounded attempt budget is
exhausted, marks both visible authorities `disconnected_unconfirmed`, appends
an honest `revocation.completed` receipt with `confirmed: false`, and preserves
all encrypted material for controlled manual recovery. UI and support must not
describe this state as provider-confirmed.

The generic `record_connector_connection_state` RPC cannot set `revoking`,
`disconnected` or `disconnected_unconfirmed`. Normal provider jobs are not
claimable once a connection is `revoking`.

## Operational recovery

- Retryable provider outage: use exponential backoff with jitter within the
  persisted attempt budget. The database requires a future schedule.
- Unknown provider result: reconcile with provider documentation/support
  before retrying. Never infer confirmation from an HTTP timeout.
- `disconnected_unconfirmed`: preserve KEKs and encrypted rows, show manual
  revocation instructions, and require a new reviewed forward workflow to
  resolve it. Do not edit the terminal row directly.
- Worker died while only `leased`: a later claim reissues the lease and
  increments the fence.
- Worker died while `executing`: stop automation and investigate provider
  state. This migration intentionally does not make an ambiguous retry.

## Apply and verification

Take a managed backup/PITR checkpoint and schema-only dump. From
`packages/crm` run:

```powershell
supabase db reset --local
supabase test db supabase/tests/0004_shared_workspace_authority_test.sql --local
supabase test db supabase/tests/0005_crm_work_queue_test.sql --local
supabase test db supabase/tests/0006_connector_platform_foundation_test.sql --local
supabase test db supabase/tests/0007_rich_contact_lifecycle_test.sql --local
supabase test db supabase/tests/0008_connector_kek_rewrap_test.sql --local
supabase test db supabase/tests/0009_connector_live_disconnect_test.sql --local
```

Rollback is allowed only before the first durable revocation request. After a
request, and especially after cryptoshred, use a reviewed forward migration or
managed PITR; the rollback script refuses to run.
