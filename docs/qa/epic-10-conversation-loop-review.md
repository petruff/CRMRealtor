# Epic 10 conversation loop: independent QA review

Reviewed by Argus, 2026-09-07. Baseline: `eedc12e`; working tree remains under active implementation. This review covers the bounded meeting-brief and typed note/task capture slice, not the complete PR #4 roadmap.

**Decision: NEEDS_WORK for complete Story 10.1/10.2 acceptance. Release gate: FAIL until the required database, authenticated, and full-candidate evidence exists.** The focused application behavior passes the tests below. No production migration, provider action, deployment, or Git commit was performed by this reviewer.

## Evidence

Independent command executed from `packages/crm`:

```text
npm test -- --run lib/application/meeting-brief-service.test.ts lib/application/capture-outcome-service.test.ts lib/application/capture-outcome-extraction.test.ts lib/application/omnix-proposal-executor.test.ts
```

Result at 2026-09-07 19:19 local process time: **4 files, 36 tests passed** (meeting brief 10; capture service 7; extraction 17; existing executor 2). Earlier runs during implementation passed 9 and 18 tests respectively; these are superseded by the 36-test run. Test counts must be refreshed after subsequent changes.

Inspected the actual domain, application, repository, factory, server-action, UI, migration and rollback code. SQL findings below are source-reviewed, not claims of executed PostgreSQL acceptance. Docker was reported unavailable by the lead; no production database was substituted.

## Findings returned to implementation owners

| Finding | Impact | Status at this review |
| --- | --- | --- |
| Duplicate migration timestamp `20260907120000` | Migration tracking collision | Corrected: brief `120000`, note enum `121000`, capture tables/RPCs `122000`. |
| Note executor trimmed approved recap body | Leading/trailing whitespace caused exact payload validation to reject saving | Corrected; focused regression preserves exact whitespace and passes. |
| Capture RPC accepted invented completed state/receipts | Authenticated direct RPC callers could claim canonical effects that never occurred | Source correction adds actual child state/reference checks, null-safe operation state validation, and selected-item completion checks. Real database adversarial execution remains required. |
| Child proposal lacked binding to parent operation | Direct RPC child substitution could attach/approve a different operation or reuse another capture's receipt | Source correction verifies kind, contact, version, exact payload/hash; SQL additionally binds the deterministic capture idempotency key. Real database adversarial execution remains required. |
| Atomic note path omitted activity event | Canonical note could be missing from activity history | SQL now calls the existing `append_activity_event` inside the note/receipt transaction. Memory parity and real transaction rollback/replay need final verification. |
| Recovery UI offered forbidden edits after partial execution and no interrupted-execution recovery | Visible controls conflicted with immutable execution; interrupted reviews stranded users | Root corrected separate editable, resumable and retry states. Component/browser verification remains required. |
| Brief route swallowed `notFound()` for a different contact's snapshot | A valid workspace snapshot could display under the wrong contact URL | Root moved the subject check outside the catch. |
| Persisted brief routes were trusted; snapshot had no mutation trigger | Authenticated stored JSON could supply unsafe links; history lacked technical immutability | Source correction reconstructs internal routes on read, validates source relationships/routes in SQL, and adds immutable snapshot trigger. Real RLS/RPC acceptance remains required. |
| Brief section status ignored contradictory/omitted items | Section could read “From your records” despite a conflicting/omitted item | Corrected severity propagation in source. |
| Extraction expanded global output ceiling without an explicit capture policy | Policy identity did not describe the larger extraction response | Corrected with `capture-extraction-policy.v1`, bounded to one call, 2,400 output tokens and 60,000 response bytes; existing monetary/request limits remain. |

## Acceptance trace and limits

| Requirement group | Evidence | Remaining acceptance |
| --- | --- | --- |
| Brief authorized subject and minimized evidence (10.1 AC1–4, 8) | Subject-first read, workspace-filtered sources, bounded queries, omitted unsafe text; unknown/foreign ID tests | Authenticated owner/assistant and cross-workspace SQL/RLS tests; provider sources are explicitly unavailable. |
| Brief truth/freshness and deterministic fallback (10.1 AC5–9, 14) | Exact source citations, false financing/negation preserved, contradictory price range, source-hash and expiry tests, immutable refresh chain | Historical evidence integrity and concurrent refresh at database level; optional narrative not implemented. |
| Brief scanning/accessibility/performance (10.1 AC10–13) | Semantic controls and source disclosure reviewed | Actual 390/768/1440 rendering, keyboard/focus, 200% zoom, reduced motion, first-viewport hierarchy and latency. |
| Capture input/schema/evidence/fallback (10.2 AC2–8, 14, 17) | Strict keys and bounded arrays/text, exact source spans, negation/ownership/date tests, guard-before-model, budget-denied/invalid/refused/oversized model fallback | Full adversarial corpus, actual model execution and timeout, multilingual and domain-specific extraction evaluation. |
| Immutable selected approval and receipts (10.2 AC9–11, 18–20) | Exact version/hash, CAS conflicts, duplicate request, partial failure, lost task acknowledgment and concurrent confirmation tests | Actual SQL concurrency, crash replay of note/event/receipt, immutable history reads, expiry/recovery UI and authenticated receipt checks. |
| Operation allowlist and communications (10.2 AC12–16) | Only `note-append` and `task-create` can execute in this slice; no provider handoff | Preference updates, appointment intent, pipeline/nurture transitions, Gmail/SMS drafts and corresponding consent/lint/provider evidence are not implemented here. |
| Retention and observability (10.2 AC21) | Recap is bounded workspace review data; ordinary failures return redacted errors; extraction uses governed reservation/finalization | Raw recap export/redaction/deletion and independent retention policy are not proven; schema alone is not legal/data-policy acceptance. |
| UI/evaluation/release (10.2 AC22–25; 10.1 AC15–16) | Focused tests above; source review of server-owned scope and UI | Full package lint/typecheck/test/build on final candidate; component/browser evidence; authenticated owner/assistant UAT; migration/RLS execution. |

The injection guard is not a Fair Housing classifier. The model instruction against steering alone does not prove the broader protected-class/steering evaluation requirement. Keep that corpus and deterministic action-policy validation open rather than treating the current extraction tests as full AC24 coverage. Extracted consent is displayed for review and cannot grant eligibility; no communication adapter is active in this slice.

## Required next gates

1. Complete remaining source corrections, then rerun focused and package gates on the final candidate. Record exact source revision/digest and command results.
2. Apply migrations only to an authorized disposable/local database; run owner/assistant/cross-workspace pgTAP plus direct-RPC forged/null receipt, child substitution, duplicate note/event, crash replay and immutable-history tests.
3. Verify desktop/mobile review, edits, explicit selection, confirmation, receipts, deferred/stale recovery and contact identity under authenticated owner and assistant sessions.
4. Retain incomplete story criteria for unsupported adapters, retention and evaluation. Do not label either full story or the PR #4 roadmap complete from this local slice.

## Review method

[AUTO-DECISION] Review active implementation despite story prerequisites? → Perform a bounded independent review and report findings immediately; do not transition the stories to Done (reason: the lead explicitly requested concurrent review and the story acceptance set is larger than the implemented slice).

Only this QA report is owned/edited by this reviewer. No application fixes or story lifecycle fields were changed. The requested `.Codex/commands/AEXOS/agents/qa.md` path and `.aexos/gotchas.json` were absent; the canonical `.aexos-core/development/agents/qa.md`, technical preferences, config, constitution, complete review task and templates were read. The referenced QA master checklist was absent. Standalone CodeRabbit was not found on PATH; review used actual source and executable tests rather than claiming a CodeRabbit pass.

## Final local evidence addendum — 2026-09-07 23:34 UTC

This addendum supersedes earlier statements that package gates, component tests, and sample viewport evidence were still pending. It does not close authenticated or database acceptance.

The reviewer read the final persisted logs under `docs/audits/evidence/2026-09-07-epic10/`, parsed both Lighthouse JSON files, checked the relevant test entries, and read the lead's [implementation audit](../audits/2026-09-07-epic10-conversation-loop-implementation.md). These final package commands were executed by the lead; the independent focused run above was executed by this reviewer.

| Final local gate | Verified evidence |
| --- | --- |
| Lint | PASS, zero warnings: [lint.txt](../audits/evidence/2026-09-07-epic10/lint.txt), using `eslint . --max-warnings=0`. |
| TypeScript | PASS: [typecheck.txt](../audits/evidence/2026-09-07-epic10/typecheck.txt), using `tsc --noEmit`. |
| Full tests | PASS: **262 test files / 1,280 tests**, **43.70 seconds**, in [tests.txt](../audits/evidence/2026-09-07-epic10/tests.txt). Includes capture component confirmation/error tests, capture server-action subject checks, brief page subject checks, brief adapter tests and actual CLI entrypoint tests. |
| Production build | PASS, exit 0 reported by the lead and completed build output independently inspected in [build.txt](../audits/evidence/2026-09-07-epic10/build.txt). Output includes `/contacts/[id]/brief` and `/contacts/[id]/outcome`, successful compilation, all 23 static pages generated, and completed build tracing. |
| Automated accessibility | Both [brief](../audits/evidence/2026-09-07-epic10/brief-lighthouse.json) and [capture](../audits/evidence/2026-09-07-epic10/capture-lighthouse.json) report accessibility **100** and best practices **100**, with no Lighthouse runtime error. Report timestamps are `23:25:34.715Z` and `23:27:29.959Z`. |

The lead's browser audit records actual sample-mode views at **390/768/1440 pixels without horizontal overflow**, a visible keyboard skip link on initial Tab, and the complete sample recap plus manual-task path: selection produced version 2, separate confirmation yielded a note and task receipt, reload retained those receipts, the prior brief became stale, and refresh incorporated the new context. These are lead-observed browser results reviewed through the audit record; this reviewer did not independently repeat the browser journey. No screenshot files were retained or claimed. The capture Lighthouse configuration was mobile on the then-current 768-pixel viewport; its score is an automated snapshot result, not a complete accessibility audit.

Source reinspection confirms the memory note adapter now retains the note promise independently from the activity-event promise, so an event retry does not discard an already-created note. The live SQL note, activity event and note receipt share one transaction. Actual PostgreSQL atomicity, retry, rollback and RLS tests remain unexecuted.

At `2026-09-07T23:34:41Z`, the reviewer computed this working-tree provenance digest over **50 changed/untracked package files** in `app`, `components`, `lib`, `scripts`, `supabase`, `package.json` and `tsconfig.json`:

```text
17e9af8b7382fed6574981d13e9a23697f27b20071064b34e436e485b2db0fc2
```

Method: sort unique repository-relative paths reported by Git; generate lowercase SHA-256 plus two spaces plus path for each existing file; join those lines with LF; SHA-256 the UTF-8 result. This records the inspected working tree, including preserved changes in that scope. It is not a committed release manifest or cryptographic proof that an earlier test command used identical bytes. Base remains `eedc12eec250535946405671577e356f5f24c8e9`; implementation is uncommitted.

The lead also persisted the individual file hashes in [source-sha256.json](../audits/evidence/2026-09-07-epic10/source-sha256.json). Independent read-back and recomputation confirmed **50 entries, zero mismatches**.

**Final disposition remains NEEDS_WORK for full Story 10.1/10.2 acceptance; release gate FAIL. Local package gates and documented sample workflow pass.** The gate is held by missing required scope and acceptance evidence, not by a failing local package test:

- SQL apply, owner/assistant/cross-workspace RLS, direct-RPC forgery, concurrent confirmation, crash replay, and rollback/forward repair: **NOT RUN**; Docker's Linux engine unavailable.
- Authenticated owner/assistant desktop/mobile UAT, full keyboard flow, 200% zoom and reduced motion: **NOT RUN**. Initial Tab and Lighthouse scores cover only the checks stated above.
- Live Gemini/model and provider behavior: **NOT RUN**. The implemented executable capture allowlist remains note/task only.
- Additional adapters, broad source coverage/narration, full contradiction/money/steering/multilingual evaluation, detailed persisted extraction telemetry, and recap retention/export/redaction/deletion remain incomplete as described in the implementation audit.

No production GO, full-story completion, or full PR #4 roadmap completion is granted. Next work is the remaining story scope and authorized database/authenticated acceptance, followed by the repository's exact-candidate release gates. No additional application changes were made during this evidence update.
