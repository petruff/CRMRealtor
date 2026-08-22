# Omnix connector KEK rewrap runbook

Scope: migration `0008_connector_kek_rewrap.sql` and the server-only CLI
rotation workflow. This operation never decrypts provider content in Postgres.
The trusted server process unwraps a DEK with the retiring KEK, rewraps that DEK
with the active KEK, and submits only the replacement wrapper through fenced
CAS.

## Security boundary

- The three RPCs are `SECURITY DEFINER`, use an empty `search_path`, and grant
  execution only to `service_role`.
- `anon`, `authenticated`, browser clients and end-user CLI modes cannot inspect
  KEK counts, claim candidates or update wrappers.
- The private claim table has forced RLS and no direct table grants, including
  to `service_role`.
- A claim response contains the wrapped DEK, wrapping nonce/tag, AAD hash,
  business crypto version and the canonical non-secret AAD fields. It never
  contains ciphertext, data nonce/tag, plaintext token, OAuth verifier, cursor
  or webhook secret.
- Webhook endpoint bindings need no rotation: the foundation stores only an
  irreversible endpoint hash, not a KEK-encrypted webhook secret.

## Supported active envelopes

`list_connector_kek_version_counts(target_now)` and claims use the same active
definition:

- payload: `destroyed_at is null`;
- connection secret: `destroyed_at is null`;
- OAuth PKCE: not consumed and not expired;
- sync cursor: no expiry or expiry after `target_now`.

Retention cleanup for expired/consumed material is separate. Do not retire a
KEK if retained encrypted material outside this active set still requires it;
either delete that material under the approved retention policy or expand the
rotation plan in a reviewed forward change.

## Pre-rotation gate

1. Keep providers operational only if the server has both retiring and target
   KEKs. Never remove the old KEK before counts converge and the recovery
   window closes.
2. Verify the target KEK is escrowed, server-only, and not referenced by a
   `NEXT_PUBLIC_` environment variable.
3. Take a verified managed backup/PITR checkpoint and schema snapshot.
4. Run `list_connector_kek_version_counts` and save only counts; do not log
   claim material.
5. Choose a UUID worker ID per CLI process. Use batches of 10 by default,
   bounded to 1–100, and leases of 90 seconds by default, bounded to 30–900.
6. Ensure only one operational rotation direction is approved. The database
   prevents two workers from owning one active claim but does not decide which
   KEK should be organizationally active.

## Bounded CLI loop

1. Call `claim_connector_kek_rewrap_candidates(worker_id, old_version,
   new_version, batch_size, lease_seconds, now)`.
2. Reconstruct AAD exactly as
   `workspaceId|connectionId|provider|secretType|recordVersion`. Candidate
   mapping is frozen for all writers:
   - payload: persisted `connection_id`, joined connection provider,
     `payload_kind`, `envelope_version`;
   - connection secret: persisted `connection_id`, joined provider,
     `secret_type`, `secret_version`;
   - OAuth PKCE: `connection_id` when present, otherwise
     `oauth-transaction-{transaction_id}`; row provider; literal
     `oauth-pkce`; record version `1`;
   - sync cursor: persisted `connection_id`, joined provider, `stream_key`,
     `cursor_version`.
   Story 4.x writers must calculate and persist `aad_hash` from this mapping.
3. For each candidate, select the old KEK by `sourceKekVersion`, unwrap
   `wrappedDek`, and immediately rewrap the same DEK with the target KEK.
4. Do not decrypt `ciphertext`; it is intentionally absent from the response.
5. Call `cas_rewrap_connector_envelope` with the claim ID, worker ID, fencing
   token, new wrapped DEK/nonce/tag, exact target KEK version and unchanged AAD
   hash.
6. A successful response has `noOp: false`. Retrying the identical completed
   CAS returns `noOp: true`; different wrapper bytes on that completed claim
   fail as divergent replay.
7. Continue until claim returns `count: 0`, then inspect counts again. A zero
   old-version count is necessary but not sufficient to remove the old KEK;
   observe the recovery window and retained inactive material policy.

Never write claim material, DEKs or keys to stdout, structured logs, shell
history, telemetry or receipts. Metrics include only kind/version counts,
duration, success/conflict totals and redacted worker correlation.

## Conflict handling

- Another active worker owns the claim: skip it; do not override the worker ID.
- Lease expired: reclaim through the claim RPC. It increments the fencing token;
  the prior worker is stale and cannot complete.
- `40001` CAS conflict: the lease/fence, source wrapper hash, active state or
  business crypto version changed. Discard decrypted in-memory DEK material and
  claim again. Never force-update the private table.
- `23505` binding/replay conflict: target KEK, AAD hash or completed wrapper
  differs from the claim. Stop that batch and investigate configuration drift.
- `42501`: wrong worker/authority. Treat as a security failure, not a retryable
  provider error.

The CAS statement updates only `wrapped_dek`/`pkce_wrapped_dek`, wrapping
nonce/tag, `kek_version` and the equal AAD hash. Its predicates compare
workspace, envelope identity, source KEK, source wrapped-DEK hash, AAD hash,
active state and unchanged business version. Ciphertext and data nonce/tag are
not update targets.

## Local apply and verification

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0004_shared_workspace_authority_test.sql --local
supabase test db supabase/tests/0005_crm_work_queue_test.sql --local
supabase test db supabase/tests/0006_connector_platform_foundation_test.sql --local
supabase test db supabase/tests/0007_rich_contact_lifecycle_test.sql --local
supabase test db supabase/tests/0008_connector_kek_rewrap_test.sql --local
```

The 0008 matrix must report 14 tests. It covers private grants, active counts,
browser denial, redacted bounded claims, two-worker exclusion, cross-worker
denial, ciphertext/AAD/version preservation, no-op/divergent replay, lease
reclaim/fencing, all four envelope kinds, business-version conflict,
cross-workspace AAD substitution, nullable OAuth AAD mapping and batch bounds.

Local green evidence does not prove remote deployment, production KEK escrow,
key access, restore readiness or production rotation completion.

## Rollback

Before any completed CAS, the manual rollback removes only the three RPCs,
claim table and supporting indexes:

```powershell
Get-Content -Raw supabase/rollbacks/0008_connector_kek_rewrap.rollback.sql |
  docker exec -i supabase_db_omnix-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The script refuses to run after a completed rewrap. After that boundary:

1. Keep both old and new KEKs available.
2. Stop rotation claims if configuration is wrong.
3. Rotate affected envelopes forward to a reviewed KEK, or use PITR under an
   approved recovery incident.
4. Do not use application rollback as evidence that wrapped DEKs reverted.
