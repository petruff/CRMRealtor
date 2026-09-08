# Story 5.4 — independent workspace assistant QA

Reviewer: Argus. Review date: September 7, 2026 locally (September 8 UTC). Baseline: `eedc12eec250535946405671577e356f5f24c8e9` plus the current uncommitted candidate. Scope: Story 5.4, approved workspace-assistant architecture and regression of the preceding Epic 10 slice. This report is the only file owned by this review.

**Local engineering candidate: APPROVED for commit, exact-candidate CI and isolated sample Preview. Full Story 5.4: NEEDS_WORK. Production acceptance: not granted.** All concrete local-candidate defects identified below are corrected, focused regressions and final package gates pass, and the frozen source manifest matches the reviewed workspace. AC8's complete device/zoom evidence and AC10's authenticated deployment/model acceptance remain open.

## Concrete findings

| Priority | Finding and observable consequence | Correction status |
| --- | --- | --- |
| P2 | A selected client's canonical ID was reduced to their display name. With two Alex Morgan records, `and her status?` became `client status Alex Morgan` and returned both choices despite an explicit selected record. Reproduced through the actual request helper, parser and module reader. | Corrected. Compact follow-ups preserve server-loaded canonical ID; pronoun-based model routes rebind matching names case-insensitively. Two action regressions pass. Explicit different-person questions are not forcibly rebound. |
| P2 | Canonical contact resolution discarded historical alias-owned module records. Actual module-reader probe supplied one retained transaction linked to `merged-alias`, with `get(merged-alias)` resolving the canonical client. The result incorrectly contained zero transactions. The existing alias test used a canonical-owned transaction and did not expose this failure. | Corrected through authenticated group lookup plus per-ID canonical verification, bounded to 20 members with canonical ID pinned first. Historical transaction/plan/proposal/capture and foreign-group regressions pass. Alias-owned capture rows explicitly say reopening is unavailable and link to the canonical contact, preserving immutable subject/write authority instead of presenting a broken action. |
| P2 | Approval review offered Retry for failed `note-append` and `nurture-transition` proposals, but `executeProposal` dispatched neither kind. A valid retry could silently do nothing; approving such a pending item could leave it approved without dispatch. | Corrected. Dispatcher uses canonical executor and capture repository for notes. Retry submits/revalidates exact version/hash/expiry/target flags, retains original approval and recovers via the existing failed-to-executing transition. Both action tests demonstrate failed then executed with canonical receipt and unchanged proposal payload. |

No P0/P1 security defect has been established in the inspected source. The P2 findings affect real client identity, status completeness and action recovery and are local-candidate correction requirements, not generic deployment caveats.

## Independent execution evidence

All commands ran from `packages/crm`; no remote operation or live model/provider request was performed.

- At `20:42:04`, **8 files / 69 tests PASS**: assistant request validation, module reads, Gemini router, new-intent narration, proposal persistence, Omnix action and approval page/action suites. This establishes the existing positive/negative fixtures; it does not cover the newly reported failures automatically.
- At `20:44:17`, **6 files / 60 tests PASS** for Epic 10 regression: capture service 11, capture provider 2, underlying provider gateway 15, brief service 11, brief narration 18 and native capture CLI 3. Real Node strip-types CLI help ran. These are local application tests, not SQL/provider acceptance.
- Read-only Node function probes reproduced the duplicate-selected-name ambiguity and retained-alias transaction omission. No test/application files were edited to run those probes.
- Correction run at `20:49:02`: **7 files / 64 tests PASS** (request 4, router 19, Omnix action 12, approvals action 4/page 6, module reads 12, native copilot CLI 7). Native CLI ran workspace overview, client status, transactions, properties, finances, nurture and proposals through Node.
- AI CLI isolation suite at `20:49:35`: **10 tests PASS**. Overlapping suite totals above must not be added together as unique coverage.
- Final historical-capture presentation correction at `20:51:15`: **12 module-reader tests PASS**; regression verifies canonical destination, explicit historical-unavailable detail and warning.

## Authority and capability observations

- The server accepts only the bounded question, explicit CRM/public source and optional contact ID. Browser transcript/facts are rejected. Selected context is loaded through the current repository; membership and data mode remain server-owned.
- Unsupported CRM routing does not automatically fall through to public search. Public research requires explicit public mode and a valid public route, and receives the question without retrieved CRM rows/history. Private-context checks precede model dispatch. Native copilot and AI CLI isolation checks pass within the recorded scope.
- New module readers use bounded repository projections and label unavailable, partial and non-total coverage. Relationship status is distinguished from transaction lifecycle; finances identify authority/verification and do not imply received funds. Restricted/expired licensed property facts are withheld. The alias-source correction above is present and regression-tested.
- New workspace intents use model-selected fact IDs and exact server reconstruction. Legacy narrative compatibility remains citation-checked rather than fully fact-reconstructed; that boundary must stay explicit. Provider response size, request time, credential policy and durable budget controls are reused. No configured live Gemini was exercised in this review.
- Generated follow-ups require the user to choose an exact date in capture. Provider drafts persist ordinary proposal versions with unresolved-target flags and actual review links. Approval page, server action and provider gateway block unresolved recipients/audiences. No preparation response is evidence of execution or delivery.

## Candidate and Production disposition

The three concrete findings are closed. Final local-candidate approval is bound to the following inspected evidence, not to a deployment or an as-yet-uncreated commit.

## Final evidence binding

Evidence directory: `docs/audits/evidence/2026-09-07-gemini-workspace/`.

- Independently recalculated SHA-256 for all **122 package files** in the final LF-normalized `source-sha256.json`: **zero mismatches**. The manifest's own SHA-256 is `7d6882aad8337e98e7b9cb25383cd2cae810f16c797d2da8c36f0975ec5edd11`; baseline is `eedc12eec250535946405671577e356f5f24c8e9`, generated at `2026-09-08T01:12:30.3073715Z`. This supersedes the pre-normalization hash. Root reports only CRLF/trailing-whitespace/empty-EOF normalization after the tests, with no logic changes. This is an uncommitted source-byte binding, not a Production release manifest.
- Independently inspected `tests-final.txt`: **274 files / 1,429 tests PASS**, 72.31 seconds. The initial full run's four stale test expectations are retained in `tests.txt`; final complete rerun passes after their correction.
- Inspected `lint-final.txt`, `typecheck-final.txt`, `build-final.txt` and `dependency-audit-final.txt`: lead-reported exit-zero gates are corroborated by the retained outputs; lint uses zero warnings, build completes all 23 static pages and generates Omnix/approvals/brief/outcome/export routes, and dependency audit reports **zero vulnerabilities**. The final build follows the `qs` dependency update.
- Inspected `browser-checks.json`, recording the lead's local sample journeys: actual sample workspace records and citations; selected Daniel Okafor followed by fresh scoped status; keyboard Space switching to Public web with selected private context cleared; unique response DOM IDs; no document overflow at 390×844, 768×1024 and 1440×1000. Mobile light-mode composer bottom is 732.22 within the 844-pixel viewport; desktop dark mode was checked. These are lead-observed browser checks, not independently replayed by this reviewer. Inline screenshot inspection is recorded; no saved screenshot artifact is claimed.
- Lead separately reports Gitleaks 8.29.1 against the staged tree with 11 accepted baseline findings and no drift. This reviewer did not independently rerun that scan and does not treat it as live credential/model acceptance.

**Final local-candidate verdict: APPROVED.** No known unresolved P0/P1/P2 source defect remains in this reviewed scope. This approval permits the next candidate-validation step; it neither closes the entire story nor authorizes bypassing failed CI or promotion requirements.

The approved architecture permits candidate CI and an isolated Preview for evidence collection. It explicitly preserves the full exact-SHA Production manifest contract. Live canonical Gemini configuration is absent, and no unrelated secret may be substituted. Nine pending migrations require remote-equivalent disposable recovery/authority evidence before production application; authored rollback/repair SQL alone does not establish recoverability. Authenticated owner/assistant, real Gemini budget receipt and other applicable promotion requirements remain separate from local-candidate correctness.

No source edits, story lifecycle edits, commits, remote migrations or deployments were performed by this reviewer.

## Release-correction review — September 8, 2026 UTC

Reviewed pending corrections above committed candidate `8af588f` after CI run `34175991645` failed the first three meeting-brief privilege assertions. The earlier local engineering approval did not establish SQL acceptance; this observed CI failure remains a failed gate until a corrected candidate passes.

- Independently ran `omnix-generative-narrator.test.ts`: **27 tests PASS**, local start `21:26:25`. Tests verify that even valid JSON is withheld for MAX_TOKENS, safety/non-STOP and missing finish status; truncated output is classified without being accepted; thought-marked parts do not reach the result; durable receipts contain fixed categories rather than arbitrary provider diagnostics; local schema limits and 600-output-token/monetary policy ceilings remain unchanged. This does not establish the cause of the live attention failure or acceptance of a new live Gemini response.
- Source inspection confirms the brief migration and forward repair explicitly revoke inherited privileges before restoring their named allowlist. The additional SQL suite checks effective table/function privileges, PUBLIC execution, RLS and security-definer search paths across the conversation authority. It is authored evidence, **not executed SQL evidence** in this review.
- **P1 containment correction requested:** the inspected rollback revoked only authenticated snapshot RPC execution and service INSERT. Applied to the failed definition with inherited ALL grants, it would leave other table grants (including TRUNCATE) and inherited function execution available. Row RLS and UPDATE/DELETE triggers do not substitute for revoking those capabilities. Requested the same explicit ACL normalization in containment, restoring only intended reads.
- **P2 accounting concern reported:** missing/invalid provider usage currently falls back to zero output tokens, including the new MAX_TOKENS fixture. Withholding output is correct but does not prove conservative accounting; unknown consumed output should retain its reserved bound, and thought usage must not be silently omitted. This is a receipt/cost concern, not an established data leak.

Inspected `docs/audits/evidence/2026-09-07-gemini-release/live-ai-observation.json`. It supersedes the earlier configuration-absent observation: the owner configured paid-private Gemini during this task. The lead observed an existing-Production pipeline request with a succeeded usage receipt, and an attention request with `invalid-response` while deterministic facts remained visible. Both belong to deployment metadata SHA `eedc12e`, not candidate `8af588f` or these pending corrections. Raw output was not retained, so the attention failure's cause remains undetermined. This reviewer did not replay those live journeys.

**Current release-correction disposition: NEEDS_WORK** pending the containment correction, bounded accounting disposition, final candidate gates and actual corrected SQL CI evidence. No new-candidate Production, migration recovery or full-story acceptance is granted.

### Correction closure

The two findings above are now corrected in the inspected working tree above `8af588f`:

- Brief containment revokes **all** affected table/function privileges from PUBLIC, anonymous, authenticated and service roles, then restores authenticated/service reads only. Forward repair restores only the intended service append and authenticated guarded command. The 13-assertion ACL suite now includes deliberately broad grants followed by containment/repair checks. Those tests duplicate the policy statements; actual recovery-artifact execution remains the separate CI stage. No SQL test was executed by this reviewer.
- Narration validates prior and provider counters, includes visible plus thought tokens, and deducts router usage from the existing 600-token combined ledger ceiling. Missing usage, timeouts and oversized envelopes retain a bounded output commitment rather than zero. Invalid counters fail closed with SQL-compatible finite values; estimated commitments remain labeled in the result and fixed durable categories. UI action and CLI propagate estimated router provenance. Generated content is still withheld if finalization fails. This is conservative reservation accounting, not a provider invoice.
- Independently reran router/narrator at `21:35:14`: **2 files / 71 tests PASS** (27 router, 44 narrator). Independently reran UI action/AI CLI at `21:36:23`: **2 files / 22 tests PASS**. Inspected the final provenance-propagation assertions and caller wiring. These four suites provide **93 focused passing tests**; they supersede the earlier 27-test narration run for this correction set.

**Correction source review: APPROVED for the next exact-candidate CI run; no known unresolved source blocker remains in this correction scope. Release readiness remains NEEDS_WORK.** Final package gates belong to the newly frozen candidate, and corrected SQL/authority/recovery acceptance still requires actual CI results. Neither the earlier local approval nor the old-Production Gemini success accepts this new candidate for Production.

### Final correction candidate source/log binding

Independently verified `docs/audits/evidence/2026-09-07-gemini-workspace/source-sha256-promotion-candidate.json`: **123 files, zero hash mismatches**. Manifest SHA-256: `8aabc49a1f1c2402a9443344c0d766a85a4210ea8731a6e2073f85a542659a5f`; baseline `eedc12eec250535946405671577e356f5f24c8e9`; generated `2026-09-08T01:39:35.4708493Z`. This supersedes the earlier 122-file binding for the corrected candidate.

Inspected the corresponding `*-promotion-candidate.txt` logs: **274 files / 1,461 tests PASS**, 52.22 seconds; zero-warning lint, TypeScript and production build PASS. The build completed all 23 static pages and generated the Omnix and approvals routes. These are retained local gate results, not remote SQL or deployment evidence.

**Final corrected local source gate: APPROVED for staging, commit and exact-candidate CI.** Corrected SQL CI and migration/authority/recovery evidence remain pending; Production and full-story acceptance remain ungranted. The filename `promotion-candidate` does not itself authorize promotion.

### Captured-prestate reconciliation correction — September 8, 2026 UTC

Independently reviewed the bounded patch above `a25088c`. The protected captured catalog contains 749 objects and nine pending migration entries. Static comparison of its Gmail function body confirms the original dollar-quoted regex matches **zero** lookups, while the corrected literal single-quote pattern matches **one**. This check translated the whitespace regex subset locally; it is not PostgreSQL execution. Captured definitions and customer data were not copied into this report.

- Corrected the Gmail literal and three analogous validator literals. Validator assignments are replaced before declaration removal, so intermediate function definitions remain compilable. `CREATE OR REPLACE` permits helper creation again in the same session. The other inspected captured connector payload/policy/membership variables occur only in unused declarations.
- Gmail reconciliation preserves workspace, connection, resource-hash, incoming-direction and linked-contact predicates, plus an explicit `P0002` missing-resource exception. The captured `UNIQUE (connection_id, resource_hash)` constraint is validated and nondeferrable, supporting the preserved at-most-one lookup cardinality. Unknown lookup shapes still abort before the declaration is removed. The enclosing transaction remains intact; no privilege, owner or security-definer changes were introduced by this patch.
- Independently reran the frozen source-binding suite at **22:06:02 local: 1 file / 4 tests PASS**. It binds the embedded helper, ordered validator transformations and Gmail block to the actual migration. The SQL fixture contains **15 authored PostgreSQL assertions**, including real-shape rewriting, invalid-cast rejection, missing-resource rejection, helper replay, byte-identical canonical replay and unknown-shape failure preserving the definition. These assertions have **not been executed by this reviewer**; source binding is not their runtime result.

Frozen source SHA-256 bindings:

| File under `packages/crm/` | SHA-256 |
| --- | --- |
| `supabase/migrations/20260901180000_remote_lint_definition_reconciliation.sql` | `980f3b465927afd26df74fcad778be53a464bca33f8e2ec0bd38df69a67dde15` |
| `supabase/tests/20260907141500_remote_lint_reconciliation_test.sql` | `0c8f6b546f6ce4d70ebd5494183e386e24fdafdb6d63beeb92ce4c1f78826e5b` |
| `scripts/remote-lint-reconciliation.test.ts` | `0974a4d321dc3924d4b3ee55e081edf03cac93854ef69ca767f2202770adb870` |

**Bounded source verdict: APPROVED for the next exact-SHA CI run.** No unresolved source blocker was found in this correction. Earlier package results and CI run `34178322000` do not certify this subsequent patch.

**Production/recovery disposition: NEEDS_WORK.** The existing reconciliation rollback and forward repair remain existence-check no-ops; they do not restore captured predefinitions, owners, settings or privileges. Fresh-schema CI and this sanitized fixture cannot establish remote equivalence. A disposable rehearsal of the captured schema/ACL/defaults/hooks and all nine pending migrations, actual restoration evidence and the final exact-candidate release manifest remain required before Production changes. No remote SQL, deployment or application edits were performed by this reviewer.

### Contact-form test teardown correction — September 8, 2026 UTC

Inspected the retained failure log for CI `34179128489` on `13495d8`: **275 files / 1,465 tests passed, but one unhandled React scheduler `ReferenceError: window is not defined` failed the run**. Vitest attributes the error to the contact-form test environment after teardown. Passing assertions did not make that CI run successful.

**P2 test-isolation defect:** this file rendered React roots without explicit cleanup. The installed Vitest defaults disable globals, and the project does not enable them; the installed React Testing Library only registers automatic cleanup when a global `afterEach` or `teardown` exists. The owner reports a deterministic probe adding only the new empty-body `beforeEach` assertion: the second case failed with expected zero child elements, received one. This reviewer inspected the corresponding source and independently tested the fix, but did not replay that pre-fix probe. Neither reviewer nor owner reproduced the timing-specific scheduler exception locally; retained roots establish an isolation defect and a plausible teardown cause, not an exact reproduction of that stack.

The bounded patch adds explicit awaited `act`/`cleanup` in `afterEach` and checks that the body is empty before each case. Existing behavior assertions remain intact. Independently ran `npm test -- components/contact-form.test.tsx` at **22:17:18 local: 1 file / 2 tests PASS**, without an unhandled error. Source SHA-256: `01cb06482c3d4ef79cd4bbde9e443887f028ecabbb1839e0edc260177b284540` for `packages/crm/components/contact-form.test.tsx`; whitespace check passes. The owner additionally reports five passing focused processes and a passing five-file neighbor suite; those are not independent reruns by this reviewer.

**Bounded test-source verdict: APPROVED for the next exact-SHA CI run.** No application code changed. Full local gates and successful replacement CI remain the lead's next validation steps; this focused result does not clear the previous failed CI, establish Production recovery or grant release acceptance.
