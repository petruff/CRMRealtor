# Omnix Mailchimp resumable reconciliation runbook

Scope: migration `0012_mailchimp_reconciliation_runs.sql`. It provides the
durable initial-baseline and periodic-reconciliation authority required by
Story 4.1 AC5/AC8. Provider HTTP calls remain in the server adapter. A local
green database does not enable Mailchimp or establish live-audience UAT.

## Authority model

`mailchimp_reconciliation_runs` is the durable run/checkpoint authority. Every
row binds a workspace, Mailchimp connection, immutable selected-audience row,
mode (`baseline` or `reconcile`), exact snapshot hash, idempotency request hash,
approved page size, attempt budget, numeric offset/total and lease/fence.

`mailchimp_reconciliation_pages` is append-only redacted page evidence. It
stores offsets, total, counts and page hash only. It never stores raw email,
provider body, token or cursor value. Both tables force RLS; workspace members
have `SELECT`, direct browser mutations are denied, and service mutations are
restricted to `SECURITY DEFINER` RPCs.

One active run per connection is allowed. Audience replacement atomically
cancels queued, leased, executing or retrying work bound to the prior selected
audience. The next run must bind the replacement row and its fresh baseline.

## Frozen owner request

```text
request_mailchimp_reconciliation_run(connection_id uuid, binding_id uuid,
  mode text, snapshot_hash text, request_key_hash text, page_size integer,
  correlation_id uuid, requested_at timestamptz,
  max_attempts integer) -> jsonb
```

Only an active owner may call it. `page_size` is 1–500 and attempts 1–20.
Baseline requires `baseline_required=true`; periodic reconcile requires the
baseline already complete. Result is `{run, receipt, noOp}`, where `run` and
`receipt` are their snake-case database rows. Exact replay reuses the run;
divergent payload or a second active run fails.

## Frozen worker contracts

```text
claim_mailchimp_reconciliation_runs(worker_id uuid, batch_size integer,
  lease_seconds integer, now timestamptz)
  -> setof mailchimp_reconciliation_runs

start_mailchimp_reconciliation_run(run_id uuid, worker_id uuid,
  fencing_token bigint, started_at timestamptz) -> jsonb

read_mailchimp_reconciliation_access_token(run_id uuid, worker_id uuid,
  fencing_token bigint, now timestamptz) -> jsonb

apply_mailchimp_reconciliation_page(run_id uuid, worker_id uuid,
  fencing_token bigint, expected_offset integer, members jsonb,
  next_offset integer, provider_total integer, page_hash text,
  applied_at timestamptz) -> jsonb

complete_mailchimp_reconciliation_run(run_id uuid, worker_id uuid,
  fencing_token bigint, provider_request_hash text,
  completed_at timestamptz) -> jsonb

transition_mailchimp_reconciliation_run(run_id uuid, worker_id uuid,
  fencing_token bigint, outcome text, error_category text,
  retry_at timestamptz, occurred_at timestamptz) -> jsonb
```

Claims are 1–25 and leases 15–900 seconds. Expired leases return to
`retry_wait` or end in honest `review` after the attempt budget. Every claim
increments the fence. Start increments the attempt. Token read, page apply,
completion and transition require the exact active worker, lease and fence.

Token read returns:

```text
{
  run: { runId, mode, snapshotHash, pageSize, nextOffset, providerTotal,
         attemptCount, fencingToken, leaseExpiresAt },
  binding: { workspaceId, connectionId, bindingId, dataCenter, audienceId,
             accountIdHash, mappingVersion },
  secret: { secretId, secretType, secretVersion, ciphertext, nonce, authTag,
            wrappedDek, wrapNonce, wrapAuthTag, kekVersion, aadHash,
            expiresAt, refreshedAt }
}
```

Envelope fields are base64. The worker decrypts in bounded server memory and
must route only with the returned binding. A stale fence, replaced audience,
inactive connection, destroyed/expired token or foreign run fails closed.

## Page contract and completion

`members` is an array of 0–500 exact objects:

```json
{
  "memberId": "provider member ID",
  "subscriberHash": "lowercase MD5 canonical email hash",
  "normalizedEmail": "canonical email",
  "status": "subscribed|unsubscribed|pending|cleaned|transactional|archived",
  "sourceHash": "64 lowercase hex provider item/version hash"
}
```

No extra/missing key is accepted. Member processing and checkpoint insert are
one transaction. Result is `{run, page, receipt, finalPage, noOp}` with
snake-case rows. Offset must equal persisted `next_offset`; `next_offset`
equals offset plus item count and cannot exceed a stable provider total. Same
page/hash replay returns the original row without reapplying members. Empty
page is valid only for a genuinely empty final snapshot (`0/0`).

Completion requires at least one persisted page, `next_offset=provider_total`
and `items_seen=provider_total`. A zero-review baseline becomes `succeeded`
and invokes `complete_mailchimp_audience_baseline` atomically. Direct service
execution of that 0010 function is revoked by 0012, so readiness cannot bypass
the durable run. Any review/blocked item makes the run `review` and leaves the
baseline required. Completion returns `{run, baselineConfirmation, receipt,
completed, noOp}`.

`transition` accepts `retry` or terminal `review`, returns `{run, receipt,
noOp}`, and never reports provider success.

## Identity quarantine

The public signatures of `apply_mailchimp_inbound_subscription_event` and
`apply_mailchimp_baseline_member` remain unchanged. Migration 0012 wraps the
0010/0011 implementations and removes all grants from the renamed internal
functions, preventing a worker bypass.

For `no-canonical-match`, `ambiguous-email` or `archived-email`, the wrapper
creates or reuses one `incomplete_records` row keyed by the source hash. The
allowlisted candidate contains normalized email, `source=other` and
`emailSubscribed=false`; source is `mailchimp-live`; external member identity
is SHA-256 hashed. This is quarantine for human review, never automatic contact
creation, merge or restore. A new append-only `incomplete-record-received`
activity links the quarantine. Public receipts contain only record/binding IDs,
subscriber/member hashes and reason—never raw email.

Wrapper results add:

```text
quarantine: null | {
  incompleteRecordId, status, source, memberExternalIdHash,
  activityId, receipt, noOp
}
```

All original result fields remain intact. Replay creates no duplicate record,
activity or receipt. Cross-workspace links fail.

## Apply, recovery and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0012_mailchimp_reconciliation_runs_test.sql --local
```

Also run the 0004–0009, 0011 and compatible post-0012 matrices. Before remote
apply, take a managed backup/schema dump and validate real Mailchimp pagination,
rate-limit handling, snapshot semantics and disconnect races in UAT.

`0012_mailchimp_reconciliation_runs.rollback.sql` is pre-write only. It refuses
after any run/page, Mailchimp quarantine, new activity or related receipt. In
the empty window it restores the 0011 wrappers and direct baseline-completion
grant, removes the tables/functions/triggers and restores the Story 3.2
activity constraint. The enum label remains intentionally. After writes, stop
workers and callbacks, preserve evidence, then use PITR or a reviewed forward
fix.
