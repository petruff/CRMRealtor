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
