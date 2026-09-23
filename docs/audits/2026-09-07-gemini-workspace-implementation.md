# Gemini workspace assistant implementation

The assistant now reads client status, tasks, transactions/workflows, properties, follow-up plans, recorded finances and saved action reviews through existing scoped repositories. Workspace overview and organization use bounded projections; they do not claim exhaustive totals. Gemini uses the existing owner-managed credential and budget authority. Public research requires an explicit source choice and a valid public route in both the UI and CLI.

New-intent factual summaries select server-defined fact IDs and reconstruct exact recorded text. Existing legacy prose remains citation-checked. Suggested follow-ups open the existing capture review for an explicit date; saved drafts link to the exact proposal, whose complete payload is visible before approval. Unresolved sender/recipient/audience flags are enforced by both the approval action and lower provider gateway. Note and nurture retries use canonical execution with the saved version and hash.

The shared chat is the primary Omnix surface, supports a selected client for follow-up questions, and preserves canonical identity even when names match or contacts have been merged. Alias-owned historical capture reviews have an explicit reopening limitation and safe canonical-client link; their immutable write guards were preserved. There is no new unrestricted agent loop, arbitrary SQL, persistent transcript or second credential store.

## Initial local validation (8af588f)

- Final package lint, TypeScript and production build passed.
- Full test suite: **274 files, 1,429 tests passed**. Initial UI compatibility failures are retained in `tests.txt`; the passing rerun is `tests-final.txt`.
- Transitive Twilio dependency `qs` updated from 6.15.3 to 6.16.0; final npm audit: **zero vulnerabilities**.
- Independent QA closed three P2 findings: duplicate-name identity, alias-owned source omission and inert note/nurture retries. No known source blocker remained.
- Native CLI tests use the actual Node entrypoint and authenticated adapter imports; provider calls in unit tests are simulated and are not live Gemini proof.
- Local browser evidence covers 390/768/1440 layouts, light/dark states, actual client follow-up and keyboard source selection. Native 200-percent zoom and physical-device UAT remain pending.
- CodeRabbit: NOT RUN, CLI unavailable; the story's independent manual-review fallback was used. No port-denylist script exists in this application package; the framework-publishing check is not applicable to this CRM deployment.

Evidence: `docs/audits/evidence/2026-09-07-gemini-workspace/`. The source manifest binds all 122 changed application files relative to baseline `eedc12eec250535946405671577e356f5f24c8e9`. Story 10.1/10.2 evidence remains in the earlier Epic 10 reports; this increment does not close their open acceptance criteria.

## Release state

The owner configured the canonical Gemini credential during validation. Authenticated Settings now reports it configured, and an existing-Production pipeline query succeeded with a durable usage receipt. This is provider evidence for the existing deployment, not for the new candidate. No secret was requested in chat and no alternate credential was substituted.

Nine migrations remain unapplied in the production database: the baseline reconciliation migration plus eight Epic 10 files. A PR against current main has merge base `334291a76a48a5482089d5b7a62915802205e838`; its candidate migration recovery diff includes the reconciliation file and the eight new migrations. This avoids the omission that a comparison against local baseline HEAD alone would cause. Exact-candidate CI, live catalog/recovery evidence and the project's Production manifest remain distinct gates. Preview publication is not Production promotion.

## Release corrections after candidate 8af588f

The owner configured the canonical Gemini credential during the release. Existing-Production pipeline narration succeeded with a durable redacted usage receipt; attention narration failed response validation and retained verified facts. These observations do not bind to the new candidate. The cause of the rejected model response is not recoverable from its redacted receipt.

Candidate CI 34175991645 caught inherited Supabase default privileges on meeting_brief_snapshots. The migration, containment rollback and forward repair now reset effective table/function permissions before restoring their allowlist. A new 13-assertion SQL suite checks all conversation tables, commands and internal helpers, including deliberately broad privilege containment. Production SQL was not applied.

The narrator now requires a STOP finish, ignores thought parts, uses compact output constraints, and records bounded error categories. Router and narrator share the existing 600-token ceiling, count reported thoughts and preserve conservative labelled usage commitments when counters are absent or invalid. Server and CLI propagate that provenance. Independent QA corrected both rollback containment and usage accounting findings.

Final local correction gates: 274 files / 1,461 tests passed; lint, TypeScript and build passed. The 123-file source manifest is source-sha256-promotion-candidate.json, and final logs use the -promotion-candidate suffix. The initial 8af588f Preview is READY and isolated in sample mode; authenticated health passes, while database readiness is intentionally unavailable. Corrected exact-SHA CI and a replacement Preview remain separately recorded release steps. Native physical-device, remote-equivalent recovery and the Production manifest remain open.

## Captured-schema correction and latest local validation

Candidate a25088c passed CI 34178322000, including complete migration replay, database tests, rollback/forward repair and build. Its isolated Preview passed health and rendered desktop/mobile assistant checks. The corresponding CI and Preview observations are recorded in the release evidence directory.

A separately exported read-only catalog contained 749 verified objects and confirmed all nine Production migrations are still pending. The raw export stays in protected local evidence; tracked receipts contain only redacted diagnostics and checksums. Comparison found an actual Gmail lookup whose single-quoted literal did not match the reconciliation migration's doubled-quote pattern. A fresh database replay did not reproduce that pre-state.

The reconciliation now uses literal quotes correctly, replaces validator assignments before removing their declarations, and supports replay of its temporary helper. An isolated PostgreSQL fixture contains 15 behavioral assertions, with four source-binding tests ensuring it executes the migration's actual transformation blocks. Independent QA approved this bounded source correction. Latest package gates passed: 275 files / 1,465 tests, lint, TypeScript and build. Evidence logs use the -reconciliation-candidate suffix; the matching source receipt is source-sha256-reconciliation-candidate.json.

The corrected candidate still needs its own CI result. Catalog capture is not a customer-data backup or a successful recovery rehearsal. Restoring the captured function definitions, settings and privileges, replaying all nine pending migrations against that pre-state, authenticated new-candidate Gemini/provider acceptance, physical-device UAT and the immutable Production manifest remain open. No Production migration or promotion has been performed.
