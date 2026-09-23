# Epic 10 follow-up: independent QA

Reviewer: Argus. Date: 2026-09-07. Baseline: `eedc12e`; ongoing uncommitted follow-up to the first conversation-loop slice. Scope: current-review export, minimized extraction telemetry, optional cited highlights, additional canonical capture operations and their recovery paths.

**Disposition: NEEDS_WORK for full-story acceptance.** The reviewed correction set has no known unresolved material application-source defect. Final local package gates pass. This is not release acceptance: SQL/RLS and authenticated/provider acceptance have not been executed, and required story scope remains open.

## Independent checks

Executed from `packages/crm`:

```text
npm test -- --run lib/application/capture-outcome-export.test.ts lib/application/capture-outcome-telemetry.test.ts lib/application/meeting-brief-narration.test.ts components/meeting-brief-highlights.test.tsx lib/application/capture-outcome-service.test.ts
```

Result at process-local `19:59:34`: **5 files / 44 tests passed**: export 8, telemetry 3, capture service 11, narration 18, highlights component 4. This supersedes the initial 38-test follow-up run. No broad package gates were rerun by this reviewer while other owners were editing.

Additional provider-focused run at `20:04:25`: **2 files / 13 tests passed** (`capture-outcome-provider.test.ts`: 2; `omnix-provider-gateway.test.ts`: 11). The supplied optional operations-test filename matched no file and is not claimed as coverage. These checks include owner authority, provider-awaiting semantics, prepared-Gmail receipt recovery, exact recipient validation and normalized opt-out phrases.

Final independent recovery run at `20:08:09`: **3 files / 26 tests passed** (`capture-outcome-provider.test.ts`: 2; `omnix-provider-gateway.test.ts`: 13; `capture-outcome-service.test.ts`: 11). Added evidence covers sent-Gmail receipt recovery without preparing again, Calendar receipt recovery after target changes and changed-time rejection, and a nurture replay stub returning the production-shaped mutable version 3 while the approved pause retains receipt version 2. These totals overlap earlier runs and must not be added together as unique coverage.

Read the ratified architecture addendum, actual application/domain/repository/action/UI changes, export transport/receipt integration, and migrations `131000`, `132000`, `133000`, `140000`. Database observations below are source review only; Docker's Linux engine remains unavailable and no production database was used.

## Findings and correction status

| Finding | Concrete failure | Status |
| --- | --- | --- |
| Source-inclusive export serialized the entire capture document | Unknown internal parent/nested fields could appear in an explicitly requested recap export | Root replaced raw serialization with field allowlists and runtime scalar/string-array checks. Unknown-field and nested-object regressions pass. |
| Highlight response envelope was unbounded | `response.json()` allocated an arbitrary body before the extracted-text limit | Brief owner added a 16,384-byte streamed envelope limit; oversized response regression passes. |
| Source could change during budget finalization | Narration checked freshness before finalization and could return stale text afterward | Brief owner rechecks freshness after finalization; race regression passes. |
| Available highlights ignored a later stale prop | Client state survived a stale rerender and hid refresh guidance | Root requires `!stale`; available-to-stale rerender regression passes. |
| Telemetry pgTAP planned 7 assertions but contained 11 | Copied brief assertions made the suite fail its own plan | Root removed unrelated fixtures/assertions and added positive JSON export receipt coverage; plan is now 9. SQL execution remains open. |
| Forged parent `awaiting-provider` state | Direct RPC could mark a review terminal while selected children remained pending | Capture owner notified. Current source adds aggregate checks, provider receipt category/intent relationship checks and provider owner authority. Database execution remains open. |
| Newline/curly-apostrophe opt-out bypass | `Do not\nemail me` and `Don’t email me` missed the recap opt-out detector | Source normalizes NFKC, apostrophes and whitespace; focused regressions pass. |
| Extracted due-date serialization mismatch | A valid offset date stayed raw in the operation but became UTC in the child, conflicting with full SQL JSON equality | Extracted task payload now uses canonical `captureInstant`; PostgreSQL equality validation remains unrun. |
| Nurture replay returned current state | Lost pause acknowledgment followed by a separate resume could report the later plan version as the pause receipt | Executor derives approved expected version + 1 and rejects another plan ID. Production-shaped mutable-row regression passes. Migration `133000` binds original plan/action/version/options; historical snooze/stop receipts without stored options fail closed. SQL execution remains open. |
| Calendar intent did not bind downstream time fields | RPC accepted a supplied encrypted payload hash without deriving its exact event title/start/end from the approved proposal | New SQL hash reconstructs the versioned canonical calendar payload and checks equality. PostgreSQL/Node hash parity and rejection tests remain unrun. |
| Provider recovery checked mutable targets before existing receipts | A task/recipient change after intent creation but before acknowledgment could prevent recovering the original intent | Calendar immutable receipt lookup and prepared-Gmail exact-hash lookup now precede mutable-target checks. Sent Gmail resolves its original intent through its workspace-scoped connector job. Prepared/sent Gmail and Calendar recovery regressions pass without new preparation. |

An additional consistency issue was corrected: operation options and the Google gateway now both query 20 connections. Previously the gateway searched only 10, so a visible connection could be unavailable at execution. This is a usability correction, not an authorization substitute.

## Authority and privacy assessment

- Export resolves authenticated workspace/canonical-contact binding, prepares one exact current review, records its receipt before returning bytes, and sends private/no-store responses. Default export omits confidential recap-derived fields. It is not full-history portability or deletion. Source-inclusive download remains explicitly labeled.
- Extraction telemetry projects named metadata fields, does not copy source/prose/credentials, uses one model-budget correlation, and labels conservative upper-bound accounting separately from provider-measured usage. Optional extracted content is discarded if durable run metadata cannot be recorded. Budget accounting remains the existing reserve/finalize authority.
- Highlights are opt-in, select existing fact IDs, reconstruct displayed text/citations server-side, and remain separate from immutable deterministic snapshots. They grant no execution authority and do not imply a live model was exercised.
- Pipeline/nurture/provider items must retain exact parent/child binding, current target preconditions, authoritative channel checks and canonical receipts. A connector intent means preparation/awaiting provider approval, not delivery or a published calendar event.
- Source retention, redaction and deletion remain open. Export does not erase the recap's copies in parent/history, notes, child payloads or cited briefs.

## Required closing evidence

1. Bind the reviewed correction set and final package/browser results to the final source manifest. Concrete corrections above are present; application regressions pass within the stated scope.
2. Run the final package lint, TypeScript, full tests and build; keep sample browser evidence distinct from authenticated owner/assistant behavior.
3. Exercise new migrations and pgTAP in an authorized disposable database, including direct-RPC forgery, scalar/date validation, receipt substitution, exact provider payload binding and pause/resume crash recovery.
4. Complete authenticated/provider journeys and remaining story scope, adversarial corpus, accessibility and confidential-data lifecycle requirements before granting story/release acceptance.

QA owns only this report for the follow-up. No application files, other agents' documents, story lifecycle fields or Git commits were changed by this reviewer.

## Final evidence addendum

Independently read the final continuation audit and retained logs in `docs/audits/evidence/2026-09-07-epic10-followup/`:

- **Full tests PASS:** `tests-final.txt` reports 268 files / 1,336 tests, 69.25 seconds. The initial `tests.txt` retains one suite-loading failure caused by a server-only gateway dependency in the outcome action test. The corrected test isolation was followed by the passing complete rerun; the initial failure is not concealed.
- **Lint, typecheck and production build PASS:** retained logs corroborate the lead's completed gates. Build generated the brief, outcome and JSON export routes. No additional broad tests were necessary for this evidence review.
- **Source manifest verified:** independently recalculated every SHA-256 in `source-sha256.json`: **89 package files, zero mismatches**. This identifies current uncommitted package bytes; it is not a commit-bound production release manifest or independent proof of runtime deployment.
- **Lighthouse report inspected:** the retained mobile JSON has no runtime error and reports accessibility 100, best practices 100, SEO 60 and agentic browsing 50. Fetch time is `2026-09-08T00:10:10.865Z` (September 7 locally). These category scores do not imply complete accessibility or all-audit acceptance.
- **Lead-observed sample browser evidence:** note + pipeline + nurture selection/confirmation, canonical receipts retained on reopen, source-inclusive JSON HTTP 200 with `no-store, private`, and a fresh brief displaying the newly active plan. Sample export has no durable production receipt. Browser journeys and viewport measurements were documented by the lead, not independently replayed by this reviewer.

The local package evidence and manifest close items 1–2 above within their stated scope. **Full-story disposition remains NEEDS_WORK; release acceptance is not granted.** SQL/RLS/concurrency/rollback, authenticated owner/assistant behavior and live provider/model journeys remain unexecuted. Native 200% zoom was attempted but not verified; full keyboard, reduced motion and physical Safari/PWA checks remain open. Remaining adapters/evaluation corpus, provider lifecycle reconciliation, and confidential-source retention/redaction/deletion are still required. No remote migration, commit, push, merge or deployment is claimed.
