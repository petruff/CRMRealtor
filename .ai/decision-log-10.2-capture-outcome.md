# Story 10.2 implementation log — 2026-09-07

## Scope and decisions

- [AUTO-DECISION] Deliver executable note/task loop first, while retaining the broader acceptance criteria as open. Preferences, consent, lifecycle facts and client commitments are source-linked review information; they do not mutate CRM truth or authorize outreach.
- [AUTO-DECISION] Preserve accepted recap as a workspace record; reject guarded input before persistence or model calls. No rejected-source logs, browser localStorage recap, audio, model tools, or provider send. Dedicated raw-recap redaction/export/deletion and approved retention duration remain open; this is not full retention acceptance.
- [AUTO-DECISION] Use a separate versioned extraction policy for bounded JSON (one call, 2,400 output tokens, 60,000 response bytes); retain existing paid-private credentials, timeout, reservation and daily/run ceilings. Reserve failure, provider failure and invalid output fall back to manual note/tasks.

## IDS search and file decisions

Searched `packages/crm/lib` for capture/proposal/guard/repository patterns, existing Omnix commands and executor, canonical contact notes, task commands, budget/router, CLI context, migration and rollback patterns before edits.

- **ADAPT** `lib/domain/omnix-operational-brain.ts`, `lib/application/omnix-proposal-executor.ts`: add `note-append` to the existing governed authority; preserve approved note bytes exactly. Canonical task command and its idempotency remain reused.
- **CREATE** `lib/domain/capture-outcome.ts`: no prior capture domain; browser-safe types, bounded text and calendar/timezone validators.
- **CREATE** `lib/application/capture-outcome-service.ts`: parent review orchestration, exact content versions, CAS revisions, selection, partial receipts, expiry, stale target checks and recovery. Reuses canonical proposal creation, approval and execution; no parallel tool executor.
- **CREATE** `lib/application/capture-outcome-extraction.ts`: strict schema with extra-field rejection, exact UTF-16 spans and verbatim factual wording. Reuses Unicode/injection guard and budget types. Relative/ambiguous task dates require an explicit edit; client/unknown ownership is flagged.
- **CREATE** `lib/data/capture-outcome-repository.ts`, `memory-capture-outcome-repository.ts`, `supabase-capture-outcome-repository.ts`: existing proposal persistence cannot represent independent parent selection/version receipts. Memory mode stays explicit; live writes use guarded SQL RPCs.
- **CREATE** `scripts/capture-outcome.ts`, `scripts/capture-outcome.test.ts`: reuse authenticated CLI context and JSON envelopes; bounded stdin avoids putting recap in command-line arguments. Real Node strip-types help smoke included.
- **CREATE** `lib/application/capture-outcome-service.test.ts`, `capture-outcome-extraction.test.ts`: scoped adversarial, immutable approval, cross-workspace, concurrency, partial failure and mutation-before-receipt retry coverage. Domain validation tested through extraction suite.
- **CREATE** migrations `20260907121000_capture_note_kind.sql`, `20260907122000_capture_outcome.sql`: separate enum commit; additive parent/version persistence and atomic canonical note/activity/receipt. Workspace composite FKs/RLS, immutable versions, CAS, canonical child payload/provenance/receipt validation, and null-safe validation.
- **CREATE** matching `supabase/rollbacks` containment/forward-repair scripts and `supabase/tests/20260907122000_capture_outcome_test.sql`: follow existing data-preserving rollback and transactional TAP conventions. These have not been applied to a database.
- **ADAPT** `docs/stories/10.2.typed-capture-outcome.story.md`: checklist/file list/implementation evidence only. Broad acceptance remains open.
- **CREATE** this implementation log: follows existing `.ai/decision-log-*.md` pattern.
- **CREATE** `plan/self-critique-10.2-backend.json`: adapts the established Story 10.1 backend self-critique evidence format for local implementation only.

## Self-critique 5.5 and 6.5

- Predicted and fixed: whitespace changed approved note payload; SQL null values could forge completion; failed post-mutation acknowledgement could duplicate task; concurrent confirmation could bypass an exact review; caller-supplied child references could bind a different proposal.
- Edge cases verified: input guard before provider call, provider unavailable/manual workflow, negation/ownership, calendar rollover, unknown selection, stale version, cross-workspace reads, changed contact, post-expiry completed receipt replay, note+event dedupe.
- Independent QA feedback incorporated: canonical child kind/contact/version/payload/hash and provenance binding; canonical receipt validation; atomic note/activity/receipt; Node strip-only compatibility. No secrets or full recap in logs.
- Local code verdict: focused checks pass. Full-story verdict: **INCOMPLETE**; release evidence and remaining adapters/policies are still required.

## Verification

- `npm run lint` in `packages/crm`: PASS.
- `npm run typecheck` in `packages/crm`: PASS.
- Capture service/extraction/CLI plus canonical executor tests: **29/29 PASS** (7 service, 17 extraction, 3 CLI, 2 executor).
- `npm run omnix:capture -- --help`: PASS under actual Node strip-types runtime.
- Docker SQL gate: **NOT RUN**. `docker ps` reports Docker Desktop Linux engine pipe unavailable. Migrations, transactional SQL tests and rollback/repair require a migrated local instance and exact candidate review before any remote adoption.
- Full regression/build/browser/owner-assistant UAT are owned by the lead and must be appended with fresh evidence. No commit, push or remote migration performed by this agent.

## Remaining requirements

Full structured contradiction and before/after field comparison; deterministic money/domain validators; comprehensive Fair Housing and mixed-language corpus; appointment/preference/pipeline/nurture/Gmail/SMS operation adapters; detailed per-run model route/token/cost/latency persistence (budget authority records reservation totals only); in-progress extraction run discovery; explicit retention duration/redaction/export/deletion; verified live RLS/migration/rollback and authenticated UAT. The broad Story 10.2 is not Done.

## Authorized adapter expansion (2026-09-07)

[AUTO-DECISION] Reuse canonical lifecycle and connector authorities. Manual addition first exposes existing scoped targets and their actual before/after values; AI extraction remains facts/tasks and cannot invent operational IDs.

IDS decisions (searched existing implementations before changes):
- ADAPT `application/capture-outcome-service.ts`, `domain/capture-outcome.ts`: immutable reviewed operation content, scoped options/add/edit, narrow target snapshots, per-operation staleness, owner-only provider preparation, truthful awaiting-provider receipts. Existing note/task flow retained.
- CREATE `application/capture-outcome-operations.ts`: no reusable capture-specific typed operation assembler existed; reuses pipeline labels, nurture transition validator, prompt guard, outbound guard and repository reads.
- ADAPT `application/omnix-proposal-executor.ts`, `domain/omnix-operational-brain.ts`, `data/memory-nurture-plan-repository.ts`: canonical nurture-transition kind, exact-version idempotent transition. Receipt binds the approved plan and original resulting version even if SQL replay returns a later mutable plan.
- ADAPT `application/omnix-provider-server-gateway.ts`; CREATE `application/omnix-provider-gateway.ts`: extracted existing gateway core so CLI can load it without Next server-only. Existing Google draft/calendar handoff is reused; deterministic draft IDs, exact recipient/sender/task snapshots, receipt-first recovery and guarded Calendar idempotency wrapper added. No connector approval or dispatch is added.
- ADAPT `scripts/capture-outcome.ts`: options/add/edit and live authority dependencies, observed extraction and canonical contact telemetry binding. No separate CLI authority.
- ADAPT service/CLI tests; CREATE capture provider and gateway tests: covers real adapter orchestration, exact review, permission failures, lost acknowledgements, mutable SQL replay response, suppression and original receipt recovery after send/task changes.
- CREATE SQL migrations130000/131000/132000/133000 and matching rollback/forward-repair files. REUSE existing save-capture guard and transition lifecycle SQL; additive enum, exact child payload helper, Calendar receipt ledger/hash attestation and nurture replay request evidence. Rollbacks contain writes and preserve records.
- ADAPT existing capture SQL tests from8 to10; CREATE adapter SQL TAP4: privileges, canonical JavaScript/SQL calendar hash parity, altered-time hash, exact lifecycle payload binding and immutable request evidence.
- ADAPT this log and `plan/self-critique-10.2-backend.json` for actual expanded scope and evidence.

Self-critique 5.5/6.5: independent QA defects addressed: Unicode/newline/gerund opt-out, SQL awaiting-provider spoof, normalized extracted dates, provider envelope substitution, mutable nurture replay receipt, replay key substitution, loss of provider acknowledgement followed by target change/send. New nurture request metadata is additive; legacy snooze/stop event replays without sufficient evidence fail closed.

Verification for expansion:
- Focused tests:48/48 PASS (service11, provider service2, gateway13, extraction17, executor2, CLI3).
- `npm run typecheck`: PASS.
- `npm run omnix:capture -- --help`: PASS with actual Node strip-types runtime.
- SQL TAP and migrations: AUTHORED, NOT RUN. Docker engine unavailable. No remote writes, migrations, commits or push performed.
- Parent owns complete regression/build/browser evidence, UI and story status.

Executable scope now: append note, create task, relationship pipeline move, start/pause/resume/snooze/stop nurture, exact Gmail draft and task-backed Google Calendar **preparation** through owner-approved child authority. Provider results remain awaiting-provider; existing connector authority handles later decisions/dispatch. Preference mutations, SMS preparation and arbitrary appointments remain unsupported; no fake operational adapters. New lifecycle/provider operations require explicit manual selection and validated actual target options. Comprehensive multilingual policy evaluation, retention/deletion operations and live database/provider release acceptance remain incomplete. Root separately owns telemetry/export enhancements. Prior note/task-only scope above records the initial slice, not the expanded final scope.
