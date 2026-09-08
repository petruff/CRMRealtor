# Epic 10 remaining implementation — continuation evidence

Date: 2026-09-07. Branch `codex/epic-10-meeting-outcomes`, uncommitted changes above `eedc12eec250535946405671577e356f5f24c8e9`. This report supersedes the first slice's capability limitations where explicitly stated below. It does not declare the entire PR #4 roadmap complete.

## Implemented in this continuation

- **Optional AI brief highlights:** explicit UI and CLI requests select exact cited statements under the existing budget authority. Strict ID-only output, bounded provider responses, timeout/denial fallback and freshness checks before and after model execution protect the deterministic brief. Returned highlights belong to the snapshot and are not persisted as contact facts. Budget receipts remain durable; the narration sidecar is response-only.
- **Additional brief evidence:** bounded, canonical-contact property behavior reads include only allowed events; restricted/revoked events are excluded. Source links open the evidence disclosure. Current sample source adapters are rebound after development reloads while snapshot history is preserved.
- **Expanded outcome review:** manually add/edit a task, relationship-stage move, nurture start/pause/resume/snooze/stop, Gmail draft preparation or task-backed Calendar preparation. Server-derived choices, before/after values, lifecycle consequences and exact target versions are shown. New items start unselected; confirmation is separate. Provider items require owner confirmation. Existing approval/execution services remain authoritative.
- **Provider preparation and recovery:** exact sender/recipient/connection/task/payload binding, deterministic Gmail draft identity, Calendar intent receipt ledger and receipt-first replay. Prepared provider items remain `awaiting-provider`; a connector intent is not a sent email or confirmed appointment. Changed targets and lost acknowledgments have focused regression coverage.
- **Single-review export:** explicit JSON download includes the recap only when requested; CLI defaults to metadata. Both modes project allowed fields, reject malformed nested values and record a scoped export receipt before releasing bytes. Responses use `no-store, private`. This exports one current review, not all historical versions.
- **Redacted extraction telemetry:** separate append-only records contain source hash, correlation, policy/model, duration, fallback reason and explicitly labeled estimated/reserved upper-bound usage. No prompt, recap, generated prose or credential is logged. Telemetry persistence failure discards optional model output and preserves manual preparation; budget accounting still finalizes.
- **UI corrections:** stable operation labels after reload, clear preparation receipts, retained add-item input on errors, owner-only confirmation guidance, full-width mobile confirmation controls and dark-theme form tokens.

## Verification

All commands ran in `packages/crm`; logs are in `docs/audits/evidence/2026-09-07-epic10-followup/`.

| Gate | Result |
| --- | --- |
| Full regression | **268 files / 1,336 tests PASS**, `tests-final.txt`. |
| Lint | PASS, zero warnings, `lint.txt`. |
| TypeScript | PASS, `typecheck.txt`. |
| Production build | PASS, `build.txt`; brief, outcome and export routes generated. |
| Native CLI | Brief narration help, capture options/add help and review-export help passed. |
| Independent review | All identified concrete source defects corrected; see `docs/qa/epic-10-followup-review.md`. Full-story verdict remains NEEDS_WORK. |
| SQL/RLS/rollback exercise | **NOT RUN**: Docker Linux engine remains unavailable. SQL tests/containment/forward-repair scripts are authored, not accepted as executed evidence. |

The initial full run had a test-suite loading failure for the server-only gateway import; its action-unit test dependency was isolated appropriately, the focused test passed, and the final full rerun passed. The earlier failed log is retained as `tests.txt`.

The new package source manifest is `source-sha256.json`; it identifies uncommitted source bytes, not a production release manifest.

## Sample browser evidence

Preview `http://127.0.0.1:3218`, explicit sample mode; no authenticated provider/model was invoked.

- Review `e7275085-d909-4e6d-88f0-c567dd54e7bb`: source recap → manually added stage/weekly nurture plan → individual selection → separate confirmation. Receipts: `note:n-s6a6gz5z`, `contact:c-okafor:pipeline:active`, `nurture-plan:nurture-plan-1`. Reopening the review retained the same receipts.
- Its source-inclusive export returned 200, attachment disposition, `no-store, private`, `current-review-only`, sample mode and three operations. This sample export has no durable production receipt.
- After correcting development-only source adapter caching, review `c483dd36-1d75-479e-a939-aa4e1f62cd49` saved a note and weekly follow-up plan. New snapshot `0b194429-51fb-4ff8-ad60-a2a91d7b3aa7` displayed `Nurture: active`, cadence 7 days, next step `2026-09-09T14:00:00.000Z`.
- Explicit AI-highlight request in sample mode returned an unavailable message while retaining the cited brief. Component tests additionally verify no request on mount, cross-snapshot rejection, source disclosure and hiding prior highlights when a snapshot becomes stale.
- Capture was measured at 390/768/1440 viewport widths without horizontal overflow. The updated brief was measured at 390/1440 without overflow and its mobile screenshot inspected. Dark and light surfaces were inspected through browser tool screenshots; no saved screenshot file is claimed.
- New 390-pixel mobile Lighthouse snapshot: accessibility **100**, best practices **100**, SEO **60**, agentic browsing **50**. Full JSON retained as `brief-mobile-lighthouse.json`; these are category scores, not a claim that all audits passed. No production performance or complete WCAG conformance claim follows.
- Native browser 200% zoom was attempted through shortcuts, but viewport/DPR/visual scale did not change; **not verified**. Full keyboard, reduced-motion, physical Safari/PWA and authenticated owner/assistant UAT remain open.

## Remaining implementation and release gates

This is substantial additional Story 10.1/10.2 implementation, not complete Epic 10 delivery. General appointment/provider source aggregation, preference-update/SMS/arbitrary appointment capture adapters, the full money/contradiction/steering/multilingual corpus, full provider lifecycle reconciliation in capture views, and the later roadmap stories remain open.

Raw recap redaction/deletion and automatic retention remain unimplemented. Architecture inspection found no applicable canonical deletion policy; copies span immutable capture versions, child proposals, notes and snapshots. Archiving/rejecting a parent would not erase those copies. The approved addendum records this required policy and coordinated-storage work explicitly; no retention duration or erasure promise was invented.

Actual SQL/RLS/concurrency/rollback acceptance, authenticated owner/assistant UAT and live provider/model verification remain separate mandatory gates. No migration was applied remotely, and no commit, push, merge or deployment occurred. Existing unrelated changes were preserved.
