# Pending migration effects and targeted recovery preparation

Status: source effects audit and recovery preparation only. No production SQL was executed for this audit. The targeted snapshot query has not been executed or rehearsed. This document is not a database backup, recovery PASS, or deployment authorization.

The release coordinator reported 62 Production migrations through `20260901010000`, leaving the nine migrations below pending. Reconcile that report against the actual migration-history export before applying anything. Candidate `8af588f` failed CI run `34175991645`: the first three meeting-brief pgTAP assertions found authenticated INSERT/UPDATE/DELETE privileges; the other 12 assertions in that file passed. The working correction below changes the meeting migration, so `8af588f` is not the corrected release candidate. Freeze a new SHA and bind new CI and recovery evidence to it.

## Exact source inventory

SHA-256 values identify the reviewed working migration bytes, not an assertion that these definitions are already deployed. Files are under `packages/crm/supabase/migrations/`.

| Order | Migration | SHA-256 |
| --- | --- | --- |
| 1 | `20260901180000_remote_lint_definition_reconciliation.sql` | `eb27cd8c1c88afdf1ef7f18945391a4d4c3f5bbb3cecfa29e2b337a447a270c5` |
| 2 | `20260907120000_meeting_brief_snapshots.sql` | `f9891d34344d2457313e2619906d5f08d7828d381a4d6095001704ae5bcb47d3` |
| 3 | `20260907121000_capture_note_kind.sql` | `e6761a766960016686ff1847fb1945bc0fb20a5fac97405db5b08fbbaadc4929` |
| 4 | `20260907122000_capture_outcome.sql` | `fd4fbdc92dfc6e86b635f6b9548f737d984c2080e61001579456c20dc6ebdf63` |
| 5 | `20260907130000_capture_nurture_transition_kind.sql` | `3596b558b4c9ff53b60af5b4b40e0e92713b266a7ee7e607ca13f462abe6fea7` |
| 6 | `20260907131000_capture_operation_adapters.sql` | `c6bc3f8f0c738f41fe4b0a34cc0007df27a6dad9b555809f4c05aa86cb6ad9bf` |
| 7 | `20260907132000_capture_calendar_intent_receipts.sql` | `f036396280b1f12498aaf977bac12e209a202b382feba7dd6f7c276ebb9e91f1` |
| 8 | `20260907133000_capture_nurture_replay_binding.sql` | `d59bc9f11ae173529ba4d79f9fe38229b6ae16b255e824edf82e3cd0b3b61999` |
| 9 | `20260907140000_capture_export_telemetry.sql` | `bc379543463a0b71ed78c0d8c9f6b170065971f5ce879ce04c3f2179210ffd2c` |

Only the meeting migration differs from its `8af588f` blob, whose hash was `03be35f73445048fb626cc96696b4c01b838e8280c4cc5e98b311e518c99591b`. Recompute all hashes after the final freeze. The reconciliation already exists in Git baseline `eedc12e`; a candidate-diff recovery inventory can omit it even though Production still needs it. Recovery must cover all nine remote-pending entries.

## Apply-time effects versus future command effects

No authored top-level statement in this set deletes, truncates, rewrites, or backfills customer rows. This is a source conclusion, conditional on the actual pre-state and its DDL event triggers. Function replacement, permissions, enum changes, constraint validation, and extension installation still change live behavior and can acquire locks. It would be inaccurate to call the entire set purely additive or risk-free.

| Migration | Statements executed during application | DML only when the new/replaced function is later invoked | Containment and availability impact |
| --- | --- | --- | --- |
| Reconciliation | Explicit transaction; installs `plpgsql_check` if absent; creates a temporary replacement helper; top-level SELECT/DO calls dynamically replace nine existing function definitions; runs lint checks and aborts on warnings. The SELECT calls are catalog mutations, not read-only inspection. | Existing conversion, connector, OAuth, import, Twilio, and inbound intelligence command effects remain in those function bodies. The migration does not invoke those application commands. | Supplied rollback and repair are existence checks, not restoration of previous definitions. Actual captured pre-definitions, ownership, settings and ACLs are required for a remote-equivalent restoration rehearsal. |
| Meeting snapshots | Creates immutable snapshot table, contact/time index, restrictive FKs, RLS read policy, mutation-rejection trigger and guarded creation RPC; normalizes ACLs. Explicit transaction. | Creation RPC validates membership and evidence, then inserts one snapshot. | Rollback retains all evidence and SELECT access, removes ALL application-role table writes and both function execution grants. Generation stops, including service append. Repair restores only the intended read/append/RPC access. |
| Note kind | Adds `note-append` to the existing proposal-kind enum. | None. | Value remains during rollback. Do not remove an enum value or rewrite existing proposals to simulate reversal. Commit this migration before dependent use. |
| Capture core | Creates parent, immutable versions and note-receipt tables, index, FKs, forced RLS, read policies, triggers and two guarded RPCs. | Save performs parent CAS INSERT/UPDATE and immutable version INSERT. Approved note append inserts the note, activity event and receipt atomically; retry uses its receipt. | Rollback revokes the two RPCs and retains tables/data/read access. Repair restores authenticated execution. Previously executed notes/tasks remain real canonical changes; rollback does not undo them. |
| Nurture kind | Adds `nurture-transition` to the proposal-kind enum. | None. | Retain value during containment; commit before dependent use. |
| Operation adapters | Adds an internal payload helper and replaces capture save to bind seven operation kinds, exact child payload/provenance and provider preparation states. Replacement preserves the core RPC ACL. | Save validates and persists capture parent/version state; it does not independently execute the downstream CRM/provider operation. | Rollback revokes capture-save execution; repair restores it. Neither file reinstates the earlier save definition. |
| Calendar receipts | Adds hash helper, immutable intent-receipt table, forced RLS/read policy/trigger, guarded owner RPC. | RPC validates approved proposal and exact envelope hash, reuses receipt or creates canonical connector intent plus receipt. This is preparation; it does not approve, dispatch or send to a provider. | Rollback disables preparation RPC; repair restores it. Existing connector intents/jobs and external provider state are not cancelled or reverted. |
| Nurture replay | Adds nullable `transition_request jsonb` to existing event table, without default or backfill; replaces existing transition RPC. | Transitions update canonical plan state/version/lease and append an event. Replay binds plan/action/version/options. | Historical events without request metadata cannot safely attest some snooze/stop replays and fail closed. Rollback revokes the existing transition RPC globally, affecting manual nurture workflows as well as capture. Repair restores execution; column/new behavior remain. |
| Export/telemetry | Replaces two existing export-receipt CHECK constraints to allow capture JSON export; validates existing rows. Creates telemetry table/index/FKs, forced RLS, read/member-append policies and immutable trigger. | No new RPC: the application can append scoped telemetry metadata and later record an export through existing authority. | Rollback removes telemetry INSERT and adds `capture_exports_paused` CHECK NOT VALID. Existing receipts survive; new capture exports and updates of those historical rows can be blocked. Repair removes that check and restores append. Old narrow constraints cannot simply be restored after valid capture JSON receipts exist. |

The reconciliation targets these existing functions: `is_valid_contact_conversion_payload`, `is_valid_incomplete_conversion_plan`, `create_connector_action_intent`, `revise_connector_action_intent`, `approve_and_enqueue_connector_action`, `create_connector_oauth_transaction`, `resolve_contact_import_identity`, `register_and_apply_twilio_callback`, and `record_omnix_inbound_response_intelligence`. Exact overloads are in the snapshot query. Its Gmail lookup changes `SELECT INTO STRICT` into `PERFORM` plus a not-found guard; verify the actual uniqueness constraint on that lookup before claiming equivalent multiple-row behavior. Validator casts remain evaluated with PERFORM. The lint migration's no-op rollback cannot prove behavioral restoration.

New restrictive foreign keys can constrain deletion of referenced contacts/workspaces/members/transactions once evidence exists. Existing application rollback must tolerate retained enum values, tables, metadata and wider export receipt values. No schema artifact restores lost rows, credentials, encryption keys, or provider state.

## Effective permissions and the CI correction

Supabase default privileges can grant ALL at table creation. `GRANT SELECT` does not remove previously inherited grants. The corrected meeting migration, rollback and forward repair first REVOKE ALL from PUBLIC, anon, authenticated and service_role, then restore only the intended allowlist. They also normalize both meeting function ACLs. This matters because TRUNCATE bypasses row-level security and row mutation triggers.

| New table | authenticated | service_role | anon/PUBLIC |
| --- | --- | --- | --- |
| `meeting_brief_snapshots` | SELECT | SELECT, INSERT | none |
| `capture_outcomes` | SELECT | SELECT | none |
| `capture_outcome_versions` | SELECT | SELECT | none |
| `capture_outcome_note_receipts` | SELECT | SELECT | none |
| `capture_calendar_intent_receipts` | SELECT | SELECT | none |
| `capture_run_telemetry` | SELECT, INSERT subject to member policy | SELECT | none |

All six enable RLS; the five capture tables force it. Service-role brief append is an existing intended grant, not a browser command. No new table grants UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER to these roles. The five relevant member RPCs are authenticated-only: snapshot creation, capture save, capture note append, capture calendar intent and canonical nurture transition. The three new trigger/payload helpers are not directly executable by any of these application roles. Security-definer commands retain an explicit search path and their membership/proposal checks. Table grants do not replace RLS or exact approval tests.

The new `20260907141000_conversation_authority_acl_test.sql` has 13 assertions across effective table/function access, PUBLIC EXECUTE, RLS and function settings. Its final fixture deliberately grants ALL before testing the same containment and repair policy inside a rolled-back transaction. It is a policy regression, not execution of the actual rollback files; the existing CI recovery stage separately executes those files. The original 15 meeting tests remain unchanged. `git diff --check`, package lint and typecheck passed, along with 12 focused release-planning and meeting-repository tests. Local PostgreSQL execution was unavailable because the Docker Desktop Linux engine was not running. The new assertions and recovery files therefore still require a new candidate CI run; source inspection is not SQL execution evidence.

Corrected supporting artifact SHA-256 values (LF, one final newline):

| Artifact | SHA-256 |
| --- | --- |
| Meeting rollback | `6f5d3f222c1f419d2227c9e1696d9ce541c41ea901554520b55e59876f3a8791` |
| Meeting forward repair | `5d2d67633409b4c2e4da9d984f2c615ed6d8e4c64a2560767307b639cd793ecf` |
| Effective ACL pgTAP | `998985567490dcc0e688128de6b4bcf54453a41ab0e444b1fbd66267257f44f1` |
| Targeted snapshot query source (not executed output) | `9429e48a878e1a986141b8c82357e77f7b57d32eeccf19ae6fd107338b5385d2` |

## Snapshot and recovery requirements

The companion [targeted-schema-snapshot.sql](evidence/2026-09-07-gemini-release/targeted-schema-snapshot.sql) is one catalog/history SELECT. It captures actual affected function definitions and hashes, overloads, owner/security/settings/ACLs, safe role/membership metadata, schema/default/effective grants, enum labels, extension and DDL event-trigger metadata, relation columns/defaults/constraints/indexes/triggers/policies and dependencies. It includes the existing immutable trigger helper and trigger functions for named relations. Explicit target functions plus directly qualified dependencies are included; FK relationships expand recursively. It records full migration version inventory and statement counts/hashes, not raw migration statement bodies.

The query reads no application/customer rows, vault values, passwords, provider envelopes or credential tables. Function definitions are protected executable code; inspect the actual export before publishing it because a live definition could contain literals absent from source. Preserve the complete untruncated result in protected evidence and record its hash. The query and its output are not a full schema dump or executable restore script. Required-object presence rows expose drift; a missing expected overload, extra dependent object, DDL event hook, unexpected grant or changed CHECK must be adjudicated rather than silently ignored.

Before deployment:

1. Obtain the read-only actual pre-state export, verify the reported migration history and all nine pending file hashes, and compare dependencies against this source audit.
2. Reproduce that relevant pre-state in disposable infrastructure, including live definitions/settings/grants and representative synthetic historical rows. Fresh code-only replay does not establish recovery of differing live definitions.
3. Apply all nine in order using reviewed transactional units. Preserve separate enum commit boundaries; migrations without explicit BEGIN/COMMIT need the runner's transaction. Export constraint removal/replacement must remain atomic. Only record history after successful SQL, atomically where supported.
4. Rehearse actual containment and forward repair, including the reconciliation's actual pre-definition recovery, historical note/task/receipt preservation, poisoned default ACLs and RLS. Verify normal operation after repair and the documented temporary loss of nurture/generation/export availability.
5. Capture post-state and reconcile schema/history against expected definitions and ACLs. Complete exact-SHA CI and the separate immutable release-manifest/UAT gates in the approved architecture before Production promotion.

If the actual effects inventory exposes a destructive data operation or a recovery dependency this targeted path cannot preserve, obtain real data backup/restore capability before applying it. No exception to that requirement or the Production promotion contract is made here.

## Implementation decisions

IDS: ADAPT existing meeting migration and its paired rollback/repair after inspecting grants and the failed pgTAP evidence. REUSE all other capture ACL definitions; no unrelated SQL behavior changed. CREATE one cross-feature effective-ACL regression because existing per-feature tests did not cover inherited TRUNCATE/PUBLIC/helper access or contaminated containment. CREATE this bounded effects inventory and catalog query after searching existing audit/recovery artifacts; they fill the remote-pending inventory and actual-definition capture gaps. No application edits, commits or remote database mutations were performed for this task.

## Captured pre-state follow-up — 2026-09-08 UTC

This section supersedes the earlier snapshot-not-executed status and reconciliation hash without rewriting historical candidate evidence. The coordinator privately persisted a read-only catalog export for candidate `a25088c`: its file hash, all 65 function definition hashes and count of 749 catalog objects were verified. The export confirms 62 migration-history entries through `20260901010000`, all nine pending versions absent, all six new tables absent, the old export CHECK constraints, and the missing nurture request column/enum additions. Raw catalog contents remain in protected evidence, outside tracked documentation. The snapshot is still not a data backup or recovery PASS.

The live Gmail function retains the unused record declaration and a lookup with `direction='incoming'`. The migration's dollar-quoted regex incorrectly contained doubled apostrophes, matching zero occurrences and reaching its explicit canonicalization failure. The single-quoted correction matches once. Its actual unique `(connection_id, resource_hash)` constraint is validated, resolving the earlier multiple-row equivalence question for this predicate. Eight other targeted live definitions still contain unused declarations/receipts and would also change; this migration is not an already-applied no-op. Their relevant lookup/cast bodies already use PERFORM, so the captured variants do not retain references to the declarations being removed.

The focused correction changes those literal quotes in Gmail and the three validator cast patterns, evaluates/replaces validator assignments before removing declarations, and makes the temporary helper replaceable for same-session replay. Corrected reconciliation migration SHA-256: `980f3b465927afd26df74fcad778be53a464bca33f8e2ec0bd38df69a67dde15`. This supersedes only inventory row 1's earlier `eb27cd...` hash for the next candidate; the earlier candidate artifacts remain historical.

The new `20260907141500_remote_lint_reconciliation_test.sql` contains 15 PostgreSQL assertions using sanitized temporary functions. It executes the actual helper/validator/Gmail blocks against single-quoted shapes, checks invalid UUID/date casts still fail, checks the no-resource guard, repeats canonicalization unchanged, and verifies an unrecognized lookup fails without altering its function. The companion `scripts/remote-lint-reconciliation.test.ts` binds all embedded blocks to the migration source, allowing only temporary target names to differ; its four focused tests pass. This source-binding check is not pgTAP execution; the latter remains a next-candidate CI gate.

The existing rollback/repair remain unchanged: they preserve behavior and test existence, rather than reconstructing environment-specific pre-definitions. Embedding protected live definitions/ACLs in a generic public migration would couple recovery to one environment and cannot honestly provide general restoration. The separately protected actual-definition restoration and all-nine migration rehearsal are still required. Live default ACLs confirm broad app-role table/function grants, while the existing nurture RPC is authenticated-only with its expected search path. Several older connector/import RPCs retain broader EXECUTE grants and actor checks; reconciliation preserves those grants. Replay must include this actual authority state, not substitute fresh-CI ACLs. The captured extension inventory lacks `plpgsql_check`, so disposable extension installation/lint validation is also required. Captured DDL hooks auto-enable public-table RLS and notify PostgREST of schema changes; this is not a provider dispatch.

IDS: ADAPT the existing reconciliation rather than introducing another command or recovery authority. CREATE the sanitized database regression and exact-source binding check after inspecting the existing SQL runner's stdin-based test execution. No production SQL, runtime changes, raw catalog publication or recovered-acceptance claim was made.
