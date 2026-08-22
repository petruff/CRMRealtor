# Omnix Mailchimp outbound backfill and tag-drift runbook

Scope: migration `0013_mailchimp_outbound_backfill.sql`. It adds the durable
count-only preview, exact owner approval, resumable page materialization and
periodic tag-drift authority required by Story 4.1 AC4/AC8. Provider HTTP stays
in the server adapter. Local green SQL does not enable Mailchimp or prove
live-audience behavior.

## Authority and data boundaries

`mailchimp_outbound_backfill_runs` binds one workspace, active Mailchimp
connection, immutable selected-audience row, mapping version, canonical
snapshot hash, counts, page size, approval policy, checkpoint and lease/fence.
The modes are `backfill` and `tag-reconcile`. Only one non-terminal run may
exist per connection.

`mailchimp_outbound_backfill_approvals`,
`mailchimp_outbound_backfill_pages` and
`mailchimp_outbound_backfill_job_links` are append-only redacted evidence.
Workspace members may read them under forced RLS; authenticated clients cannot
mutate them. The frozen item snapshot is private and has no direct grant even
to `service_role`. Public rows and receipts contain hashes, IDs and counts,
never raw email, provider body, access token or encrypted envelope bytes.

Audience replacement cancels active work bound to the old binding. Cancellation
is valid before approval as well as after approval. Queued/retrying item jobs
are cancelled; executing or ambiguous provider work remains governed by the
normal Story 3.5 reconciliation path.

## Owner preview and approval

```text
preview_mailchimp_outbound_backfill(connection_id uuid, mode text,
  request_key_hash text, page_size integer, correlation_id uuid,
  previewed_at timestamptz, max_attempts integer) -> jsonb
```

Only an active owner may preview. Connection must be `active` or `degraded`,
and the current audience must have completed baseline and webhook setup.
`page_size` is 1–500 and attempts 1–20. The database derives the canonical
eligible rows and exact tag mapping (`Hot`, `Warm`, `Nurture` to the three
Omnix tags), excluding archived contacts/points and provider unsubscribe
authority. Result:

```text
{
  preview: { runId, workspaceId, connectionId, bindingId, mode,
             mappingVersion, snapshotHash, eligibleCount,
             skippedUnlinkedCount, skippedUnsubscribedCount, pageSize,
             containsRawEmails:false },
  run: <snake-case row>, receipt: <snake-case row>, noOp
}
```

Exact request-key replay reuses the run. A changed binding, mapping, snapshot,
count, mode, page size or attempt budget conflicts.

```text
approve_mailchimp_outbound_backfill(run_id uuid,
  expected_snapshot_hash text, expected_mapping_version integer,
  correlation_id uuid, approved_at timestamptz) -> jsonb
```

Approval recomputes the canonical snapshot under the current binding. Drift
returns a serialization conflict and requires a new preview. Success ensures
the canonical owner-required `audience.sync` policy, freezes all private items,
and appends one owner approval plus receipt in the same transaction. Result is
`{run, approval, receipt, noOp}`. Replay cannot change snapshot/mapping.

## Periodic tag-drift scheduling

```text
schedule_due_mailchimp_outbound_backfill_runs(now timestamptz,
  interval_seconds integer, limit integer)
  -> setof mailchimp_outbound_backfill_runs
```

Service-only. Interval is 3,600–2,678,400 seconds and limit 1–100. It creates a
`tag-reconcile` count-only preview only when the selected audience is ready,
the connection is active/degraded, no run is active, and the last periodic
preview is due. It never approves, freezes items, enqueues a provider job or
performs an external write. The receipt explicitly records
`approvalRequired=true`; an active workspace owner must approve the exact
snapshot through the normal approval RPC.

## Frozen worker contracts

```text
claim_mailchimp_outbound_backfill_runs(worker_id uuid, batch_size integer,
  lease_seconds integer, now timestamptz)
  -> setof mailchimp_outbound_backfill_runs

start_mailchimp_outbound_backfill_run(run_id uuid, worker_id uuid,
  fencing_token bigint, started_at timestamptz) -> jsonb

read_mailchimp_outbound_backfill_page(run_id uuid, worker_id uuid,
  fencing_token bigint, now timestamptz) -> jsonb

enqueue_mailchimp_outbound_backfill_page(run_id uuid, worker_id uuid,
  fencing_token bigint, expected_offset integer, page_hash text,
  envelopes jsonb, occurred_at timestamptz) -> jsonb

settle_mailchimp_outbound_backfill_run(run_id uuid, worker_id uuid,
  fencing_token bigint, retry_at timestamptz,
  occurred_at timestamptz) -> jsonb

transition_mailchimp_outbound_backfill_run(run_id uuid, worker_id uuid,
  fencing_token bigint, outcome text, error_category text,
  retry_at timestamptz, occurred_at timestamptz) -> jsonb
```

Claims are 1–25, leases 15–900 seconds and every claim increments the fence.
Start increments the attempt. Page read/enqueue/settle/transition require the
exact active worker, unexpired lease and fence. Expired leases become durable
retry or terminal review when attempts are exhausted.

Page read returns:

```text
{
  run: { runId, workspaceId, connectionId, bindingId, mode, snapshotHash,
         mappingVersion, pageSize, eligibleCount, nextOffset,
         fencingToken, leaseExpiresAt },
  binding: { connectionId, workspaceId, bindingId, dataCenter, audienceId,
             accountIdHash, mappingVersion },
  offset,
  items: [{ itemIndex, operation: { audienceId, subscriberHash, desiredTag,
                                    mappingVersion, operationKey } }],
  pageHash, finalPage
}
```

No item includes email. A zero-item approved snapshot has no page to enqueue;
the worker settles it directly.

Each enqueue envelope must be in page order and contain exactly:

```text
{ itemIndex, operationKey, ciphertext, nonce, authTag, wrappedDek,
  wrapNonce, wrapAuthTag, kekVersion, aadHash }
```

Crypto fields are base64. The service encrypts one canonical operation in
bounded memory; SQL validates operation binding and persists the private
payload envelope. Enqueue then creates the existing normal Story 3.5
`audience.sync` intent/version, owner approval event, queued job and receipts.
The idempotency key is `mc-bf:<run-id>:<operation-key>`. SQL never calls the
provider. Result is `{run, page, receipt, jobIds, finalPage, noOp}`. Exact page
replay reuses original jobs without needing envelopes again; divergent hash or
offset fails closed.

Settlement returns `{run, receipt, jobCounts:{succeeded,pending,review},
completed,noOp}`. Pending item jobs schedule the run for retry. Only all
successful jobs make it `succeeded`; failed/dead/cancelled items produce honest
`review`. Terminal replay recomputes and returns the exact job counts.
`transition` accepts only `retry` or `review`; it cannot assert provider
success.

## Apply, validation and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0013_mailchimp_outbound_backfill_test.sql --local
```

Also run the compatible 0004–0009 and 0011–0013 matrices. The historical 0010
matrix intentionally targets the pre-0011 two-step webhook contract and is not
a valid post-0011 regression. Before remote apply, take managed backup/schema
dump and validate real Mailchimp tag semantics, rate limits, partial provider
outcomes, audience replacement and disconnect races in UAT.

`0013_mailchimp_outbound_backfill.rollback.sql` is pre-write only. It refuses
when any preview/run, approval, page, link or backfill receipt exists. In the
empty window it removes only 0013 functions, triggers, private helper/item
table and public RLS tables. It does not change 0010–0012. After writes, stop
schedulers/workers, preserve item jobs and receipts, reconcile ambiguous
provider operations, and use PITR or a reviewed forward migration.
