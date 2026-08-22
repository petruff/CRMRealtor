# Omnix connector foundation database runbook

Scope: migration `0006_connector_platform_foundation.sql` only. This runbook
does not enable or certify Gmail, Google Calendar, Mailchimp, Twilio or Meta.
All live providers remain disabled until their provider stories, credentials,
verification/compliance and real-account tests pass.

## Pre-deploy gate

1. Stop connector worker/cron drains and keep every provider deployment flag
   disabled.
2. Confirm migrations 0001–0005 are applied and Story 3.0 workspace authority
   is healthy.
3. Take a verified managed backup/PITR checkpoint and a schema snapshot. For
   local rehearsal:

   ```powershell
   supabase db dump --local --schema public --file $env:TEMP\omnix-before-0006.sql
   ```

4. Confirm production KEKs and `CRON_SECRET` are server-only, escrowed and do
   not use a `NEXT_PUBLIC_` name. Secrets do not belong in SQL, YAML, logs or
   migration output.
5. Review the migration and the architecture contract at
   `docs/architecture/connector-security-jobs-approvals.md`.

## Isolated apply and verification

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0004_shared_workspace_authority_test.sql --local
supabase test db supabase/tests/0005_crm_work_queue_test.sql --local
supabase test db supabase/tests/0006_connector_platform_foundation_test.sql --local
```

The 0006 matrix must report `Files=1, Tests=19` and `Result: PASS`. It proves
local two-workspace RLS, role boundaries, private grants, immutable evidence,
atomic approve/enqueue, lease expiry, stale fencing denial, reconciliation,
normal-success `attempt.started`/`provider.accepted`/`provider.final` evidence,
webhook replay dedupe, OAuth single use and lease-bound envelope reads. It does
not prove remote deployment or provider operation.

After a remote migration, verify with read-only catalog queries:

- all eight `public.connector_*` visible tables have RLS enabled and forced;
- `anon` and `authenticated` lack `USAGE` on `connector_private`;
- no role has direct reads on private tables;
- authenticated users have only `SELECT` on public connector tables;
- authenticated executes only user RPCs and `service_role` executes only
  server/worker RPCs;
- every security-definer connector RPC has an explicit empty `search_path`;
- providers remain disabled and no cron drain is running.

## First provider-disabled smoke

Use the deterministic `contract-test` adapter only:

1. Create a redacted connection and an owner-required policy.
2. Store an encrypted payload envelope through the service RPC.
3. Let an owner or assistant create a draft intent.
4. Verify an assistant cannot approve it.
5. Owner approval must return one approval event, one job, and the persisted
   `job.queued` receipt. Replaying the same intent/version/hash/idempotency key
   returns the same job with `noOp: true`.
6. Claim one job, start the attempt, and complete through the fenced transition
   RPC. Normal success must atomically append both `provider.accepted` and
   `provider.final`; the additive `finalReceipt` response carries the latter.
   A worker with an old lease owner or fencing token must receive a
   serialization conflict.
7. For an unknown outcome, transition to `reconciliation_required`; do not
   enqueue a blind retry. Reconciliation owns the next remote observation.

## Incident controls

- Disable provider flags and stop new enqueue first.
- Stop cron wakeups; do not delete queued, executing or reconciliation jobs.
- Preserve approval and receipt evidence.
- For an expired `leased` job that never started, the sweep can requeue safely.
- For an expired `executing` or reconciliation lease, sweep to
  `reconciliation_required`; never assume the provider did nothing.
- Never manually lower a fencing token or complete a job without matching job
  ID, lease owner and fence.
- Invalid webhook signatures/timestamps may persist redacted rejection
  evidence but must not enqueue business work. A duplicate replay key returns
  the original delivery.

## Key rotation and cryptographic deletion

Migration `0008_connector_kek_rewrap.sql` supplies the service-role-only live
CLI seam. See `CONNECTOR_KEK_REWRAP_RUNBOOK.md` for exact signatures, claim
leases/fencing, conflict handling and rollback boundaries.

1. Add and escrow the new KEK while retaining the old KEK.
2. Switch the active version for newly created envelopes.
3. Inspect active counts with `list_connector_kek_version_counts`.
4. Claim bounded wrapper-only batches and rewrap the DEK in server memory. Do
   not request or decrypt provider ciphertext for rotation.
5. Submit the new wrapper through `cas_rewrap_connector_envelope`. Its claim
   binds workspace, source wrapper hash, AAD hash and unchanged business version.
6. Verify no active row references the retiring version, account separately for
   retained inactive material, and retain both KEKs through the recovery window.
   Remove the old KEK only in a separately approved change.

Disconnect is two phase. `revoking` blocks new jobs; provider revocation is
attempted and receipted. Confirmed revocation cryptographically destroys the
envelope. Unknown repeated failures become an honest unconfirmed disconnect;
they are not presented as successful revocation.

## Rollback

The manual rollback is destructive and only for a verified pre-write window:

```powershell
Get-Content -Raw supabase/rollbacks/0006_connector_platform_foundation.rollback.sql |
  docker exec -i supabase_db_omnix-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The script refuses to run if any connector row exists. After writes exist:

1. Keep providers and enqueue disabled.
2. Reconcile uncertain jobs and preserve approvals/receipts.
3. Restore with PITR/verified backup or deploy an approved forward correction.
4. Keep every KEK required by surviving envelopes.
5. After any application deployment rollback, explicitly verify cron settings;
   deployment rollback does not guarantee cron rollback.

## Live enablement blockers

Production remains blocked until the shared Supabase/Vercel secrets, backup and
restore plan, privacy/retention/incident process and provider-specific evidence
exist. Google consent/scope verification, Mailchimp registered OAuth/webhook
proof, Twilio A2P 10DLC/consent controls, and Meta Business Verification/App
Review are separate acceptance gates.
