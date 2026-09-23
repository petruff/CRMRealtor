# Epic 10 meeting preparation and outcome capture architecture

Date: 2026-09-07. Architecture authority: Vega (@architect).
Scope: Stories 10.1 and 10.2 from PR #4. Baseline reviewed: `eedc12e`.
Disposition: approved for implementation subject to the invariants and verification below; this is not a release approval.

## Scope and decisions

The first complete vertical slice is a cited meeting brief followed by typed recap, editable selected operations, explicit confirmation, canonical receipts, and refreshed next action. The PR's concierge, predictive radar, document brain, licensed property matching, campaign studio, audio, and approved autonomous playbooks remain roadmap capabilities. They are not implicit dependencies for this slice.

[AUTO-DECISION] Persistence or cache only? → Add durable scoped snapshot/capture persistence (reason: existing relationship memory is mutable and cannot preserve historical snapshots; a browser cache cannot satisfy resumable review, immutable edits, or auditability).

[AUTO-DECISION] New execution engine or existing Omnix? → Extend existing Omnix proposal authority (reason: it already owns approvals, payload hashes, transitions, and provider handoffs). New capture records describe grouped evidence and selections; they never grant mutation authority.

[AUTO-DECISION] Model required? → Deterministic briefing and manual recap/note/task preparation remain available without a model (reason: daily work must survive unconfigured credentials, denied budgets, invalid model output, and provider failure).

[AUTO-DECISION] Physical schema owner? → Architecture specifies invariants and integration contracts below; implementation must include database/RLS acceptance. No live migration is authorized merely by this document.

## Verified existing seams

| Concern | Existing authority | Integration |
| --- | --- | --- |
| Session, membership, sample/live distinction | `lib/data/index.ts`, `RepositoryContext`, `getRepository()` | Server actions obtain scope here; UI supplies subject IDs only. CLI uses authenticated CLI context. |
| Contact and notes | `lib/data/repository.ts`, `ContactRepository` | Read subject before dependent reads; repository is scope-bound. `notesFor` supplies canonical note evidence. |
| Tasks and activity | `ActivityRepository`, `activity-commands.ts` | Scoped bounded queries; task creation already accepts idempotency. |
| Rich relationship details | `RichContactRepository` | Missing adapter means unavailable, not empty confirmed facts. |
| Transaction/property/nurture/signals | Corresponding repositories on `RepositoryContext` | Join only records related to the authorized subject; explicit optional transaction must contain that contact. |
| Current memory | `OmnixProposalRepository.getRelationshipMemory` | Supplemental cited context, never supersedes canonical source facts. |
| Proposal creation/approval | `omnix-proposal-commands.ts` | Reuse payload hashing, exact version, role rules, and idempotency. |
| Internal execution | `omnix-proposal-executor.ts` | Existing task, pipeline, and nurture handlers remain the mutation path. |
| Provider execution | `omnix-provider-proposal-handoff.ts` | Existing connector intent/job/receipt/reconciliation remains authoritative. |
| AI | `workspace-ai-settings.ts`, `omnix-ai-budget.ts`, `omnix-prompt-guard.ts`, `omnix-generative-narrator.ts` | Existing credential policy, durable budget reservation/finalization, guard and timeout apply. |

## Shared application boundary

Domain and application modules have no React, FormData, browser storage, or cookie dependency. An explicit validated `WorkspaceScope`, repositories, injected clock, and optional governed model adapter are their inputs. UI and CLI call those same services.

Return a versioned envelope containing schema version, correlation ID, data mode, subject ID, as-of time, operation state, domain result, and redacted warnings. Never serialize credentials or repository contexts.

The public service operations are build/get/refresh meeting brief; analyze/get outcome; edit operation; set selection; confirm current selection; reject/defer; and retry a failed operation. Mutating requests include stable idempotency keys. Edit/selection/confirmation require expected version; confirmation additionally requires current content hash. IDs alone do not confer authority.

## Meeting brief

`MeetingBriefRepository` stores immutable snapshots with create, get, and bounded list-for-contact operations. Scope is an explicit argument to every persistence method. A refresh writes a new snapshot linked to its predecessor, preserving old source evidence. Snapshot identity or monotonically increasing version identifies the exact content.

Persist the story's subject/workspace/membership references, structured deterministic brief, citations, source hashes, rule version, as-of, expiry, generation state, and optional model/policy metadata. Snapshot references use workspace-composite foreign keys. Source hashes derive from minimized canonical values and timestamps with stable ordering. Include query coverage/truncation in the source signature so incomplete projections cannot appear exhaustive.

On retrieval or refresh, compare fresh source hashes with the snapshot and evaluate expiry. A changed source produces stale state and a visible refresh action. Do not rewrite the old snapshot's facts. Unavailable data is distinguished from a confirmed empty result. Historical snapshots retain their original as-of time.

Read the contact first. Fetch independent subject-filtered sources concurrently with bounded limits. Never send a workspace-wide transaction/contact/property list to the model. If a repository lacks a subject-filtered query, filter through authorized subject relationships before projection and report truncation; a bounded data seam is preferable to loading the entire workspace.

Every factual item binds to a source record, fact key/label, source timestamp when known, snapshot as-of time, and server-generated internal route. Stored recap text and preferences are evidence about what was recorded, not proof of external truth. Unknown financing, budget, intent, preferences, or deadlines remain unknown. Suggestions carry their own label and never substitute for facts.

Facts render before optional narration. A model summary uses only minimized cited evidence and cannot create actions. Unknown citation IDs invalidate generated output. Merely returning a valid citation ID is insufficient to prove a novel claim: omit unsupported claims or render extractive statements. The deterministic view survives all model failures.

## Capture outcome and immutable review

Persist a `CaptureOutcomeRun` with source hash, author, subject, source type, guard/model/retention state, timing/cost metadata, and correlation. Persist a parent review identifier with immutable versions containing ordered operation IDs, typed targets, before/after values, source spans, preconditions, authority, selection, and content hash. Link children to their exact existing Omnix proposal ID/version and receipt.

The capture storage is a typed evidence/grouping extension of Omnix. It cannot execute arbitrary payloads or treat its own status as proof that a canonical mutation occurred. The existing proposal store remains the approval and execution authority. If a capture parent is represented by a new Omnix proposal kind rather than a separate header, the same invariants apply and it must never reach a generic domain executor.

Editing and selection append versions atomically with compare-and-swap on the current version. Old versions remain readable. Once confirmation claims a version, its selection and payload cannot change. Later revisions must not replay already completed operation IDs. Parent completion is derived from individual receipts; partially completed means exactly that.

At confirmation, validate parent version/hash/expiry, membership role, source/target preconditions, selected operation allowlist, and current channel suppression. Create or resolve deterministic child proposal IDs/keys, decide the exact child version, and route through existing executors. Repeated confirmation returns existing receipts. An ambiguous provider result must enter reconciliation, not automatic resend.

| Operation | Required adapter and boundary |
| --- | --- |
| Append note | Add `note-append` to Omnix kind/domain/SQL validation and an idempotent canonical note adapter. |
| Create task | Existing `task-create` with explicit validated due instant and contact ID. Never silently infer a deadline. |
| Pipeline move | Existing `pipeline-move`, current stage and `expectedUpdatedAt` precondition. |
| Nurture | Existing validated nurture authority; show lifecycle consequences and current state. |
| Calendar intent | Existing `google-calendar-event` handoff, exact timezone/recipient/provider requirements. |
| Gmail draft | Existing `google-email-draft`, owner-only provider approval and authoritative eligibility. Draft is not sent. |
| Preference update | Reviewable proposal unless a field-specific canonical validator, exact before-value check, and executor are implemented and tested. No generic arbitrary contact patch. |
| SMS draft | Preparation only unless eligible canonical channel adapter is proven. No new send authority. |

`ContactRepository.addNote(contactId, body)` and `addContactNoteCommand` currently lack idempotency input. An outer proposal claim cannot prevent duplicate notes after a process crash. Add a backward-compatible idempotent note seam or atomic RPC that records note, activity event, and execution receipt under the operation key. Enforce unique workspace/operation identity in storage; the memory adapter must emulate atomicity. Existing task idempotency uses `omnix:<proposalId>:<version>` and should be preserved.

Do not call unsupported items completed. Review-only intents must be clearly marked and excluded from executable selection. A release claiming all Story 10.2 operations must implement their adapters; partial implementation retains explicit unchecked story acceptance criteria.

## Model, extraction and retention

Use a versioned strict extraction schema; reject extra keys, unsupported operations, mismatched span offsets/text, invalid dates, unsupported targets, and excessive arrays/strings. Span offsets refer to the preserved normalized source; retain the exact normalization rule/version. Resolve entity IDs server-side, never accept model-generated workspace authority or arbitrary CRM IDs.

The existing global policy permits two calls per run, 12,000 context characters, 600 output tokens, 7-second requests, 15-second runs, 10,000 microusd per run, and 1,000,000 microusd per workspace/day. A richer extraction response may need a separate versioned bounded policy; changing global routing or ceilings silently is not acceptable. Reserve before dispatch, finalize even after failure, and preserve fallback when reservation storage is unavailable. Do not call a model on every keystroke.

Negation, uncertain timelines, client versus realtor commitments, and explicit opt-out are retained with exact source spans. Relative dates stay unresolved until timezone and date interpretation are explicitly confirmed. Consent extraction never grants permission. Inferred follow-up prose is labeled suggested. Protected-class or steering requests cannot become targeting, recommendation, or outreach criteria.

Raw recap is confidential workspace evidence. Persist only the accepted bounded source required for review, protected by membership/RLS. Rejected unsafe input is not copied into ordinary telemetry; store redacted category and hash. Use the existing canonical retention/export/deletion policy where applicable. A new independent raw-source retention duration, automated purge policy, or claim of legal compliance requires a documented product/data policy; this review does not invent one. Historical hashes/receipts must remain interpretable after authorized redaction without exposing deleted text.

## Data security and compatibility

Additive migrations must preserve all existing proposal values, permissions, and clients. Coordinate enum additions and dependent SQL in migration order. New tables require RLS, explicit grants, owner/assistant tests, composite workspace references, bounded JSON validation, and immutable version/event protection. RPCs validate active membership, expected version, approved payload, and subject relationship inside the transaction. Service role is never exposed to browser code.

Live persistence failures fail closed. Never switch an authenticated live operation to process memory on missing schema. Demo mode is explicitly labeled and has no provider side effects. Optional new repository capabilities should not break old consumers; required feature paths return unavailable when capability is absent.

No new production provider, secret store, orchestration plane, dependency, or model permission is introduced. Persisted rich text is rendered as text; citation routes are constructed from known route templates. Diagnostic logging contains IDs, source counts, version, timings, guard/fallback states and receipt categories, not full recap/model prompts/provider bodies.

## Impact, trade-offs and acceptance

Impact is localized to domain/application services, repository factory/adapters, additive schema, shared UI/CLI surfaces, and existing Omnix kind/executor extensions. Proposal execution is the highest-risk boundary; provider ambiguity, stale targets, unauthorized IDs, and crash retries are the principal failure modes.

Durable typed snapshots and capture versions add storage/RPC complexity, but supply recoverability and evidence. Reusing mutable memory is cheaper but fails historical truth. Reusing existing child proposals avoids a second control plane but requires explicit per-item receipts and grouped presentation. Deterministic fallback improves reliability but cannot promise human-level extraction; the UI must distinguish manual preparation from model interpretation.

Architecture review covered requirements, component boundaries, existing stack, frontend integration, resilience, security, implementation guidance, dependencies, agent suitability, and accessibility. Design is implementation-ready; executable data guarantees, visual acceptance, model evaluation and live rollout remain verification work, not assumed passes.

Required checks:

- Unit/integration: source minimization, unknown/stale/conflicting facts, evidence routes, unauthorized IDs, strict extraction, negation/ownership, explicit dates, guard/budget/failure fallback.
- Persistence: owner/assistant/cross-workspace RLS, immutable revisions, version/hash conflicts, duplicate source/key, concurrent confirmation, note/task crash replay, mixed child failure, provider reconciliation, revoked consent.
- CLI and UI parity: same schema and authority; Today, Contact 360, Transaction and Brief navigation; resumable selection/edit/review; truthful draft/receipt states.
- Browser: authenticated owner and assistant, 390/768/1440 widths, keyboard/focus and announcements, 44px targets, 200% zoom, reduced motion, no horizontal overflow.
- Package gates from `packages/crm`: lint, typecheck, tests and production build. Migration/RLS acceptance and authenticated/provider UAT are separate gates bound to the exact candidate.

Release remains unapproved until evidence is recorded. Local tests or a demo cannot establish that production schema, provider credentials, model budget authority, or authenticated live behavior are operational.

## Remaining implementation addendum — 2026-09-07

This addendum records an inspection of the current local Story 10.2 implementation. It authorizes compatible implementation contracts, not production data changes or a new retention policy.

### Export and confidential source lifecycle

The existing portability seam is `lib/application/governed-export.ts` plus `app/api/data/exports/contacts/route.ts`. It produces allowlisted CSV/XLSX, neutralizes spreadsheet formulas, obtains authenticated repository scope, and records `record_data_export_receipt` before releasing bytes with `cache-control: no-store`. Migration `0023_data_portability_operational_api.sql` restricts receipt entity types to contacts/tasks/activities/incomplete-records and formats to CSV/XLSX. Capture export therefore needs an additive entity-type constraint extension; passing a new string to the unchanged schema would fail.

[AUTO-DECISION] Export format and authority → The root implementation chooses one current review as JSON, with active owner/assistant membership and `capture-outcomes` as an additional receipt entity (reason: preserve the typed review structure without implying complete-history portability). Extend the format constraint to allow JSON only for `capture-outcomes`; preserve all existing CSV/XLSX combinations and the existing receipt RPC signature.

Approved application seam: a single-review JSON builder returns bytes, row count, a selection hash, and a redacted selection descriptor. Allowlist all exported fields. Default export contains metadata only and excludes source, summary, facts, evidence quotes and free-text operation payloads. Require explicit `includeSource=true` to include those confidential review fields; the UI labels that action **Export this review with recap**. The authenticated transport obtains the exact record from `CaptureOutcomeRepository.get`, validates workspace/canonical-contact binding, and records the receipt before sending the file. Receipt selection contains field names and exact capture/version/content-hash references only, never source, summary, fact quotes, or provider bodies. If receipt persistence fails, return an error without file bytes. Do not change the existing contacts export behavior. If CSV/XLSX is added later, reuse `spreadsheetSafe` for every text cell, including IDs.

The current Supabase `list(scope, contactId?)` returns at most 50 recent parents. An export using it must say **recent capture reviews, up to 50**, or accept one exact capture ID and export that record. It must not advertise a complete workspace/history export. A complete export requires a separately bounded paginated seam including immutable versions. A read export can bind the receipt to the exact bytes/versions read even if a concurrent revision appears later; it must not silently substitute newer content after recording the receipt.

Inspection found no generic approved recap retention duration, physical workspace deletion service, or canonical confidential-content redaction service. `ContactRepository.delete` explicitly refuses permanent deletion; the current lifecycle is archive/restore. Provider-specific Meta/Twilio/listing retention authorities do not apply to typed recaps. Proposal expiry is review freshness, not source deletion.

Source copies currently exist in `capture_outcomes.document`, every `capture_outcome_versions.document`, note child proposal payloads, canonical notes after execution, and any later meeting snapshot that cites those notes. The immutable version and proposal-event guards and restrictive foreign keys make parent deletion alone both incomplete and structurally incompatible. Hiding a source behind a flag is access redaction, not erasure; rejecting/defering a proposal does not delete its data.

[AUTO-DECISION] Implement an arbitrary purge period or disable immutable guards? → No (reason: neither is an approved data policy, and either would create misleading audit/deletion semantics). Implement governed export and explicit retained-record status now. Keep Story 10.2 retention/redaction/deletion acceptance open.

For a future approved deletion implementation, separate confidential content references from immutable metadata and define the exact policy authority, authorized actor, scope, legal/operational holds, backup handling, and derivative-copy behavior. Preserve minimal operation IDs, original hashes, timestamps and authorized deletion receipts; return an explicit unavailable/redacted evidence state instead of fabricating replacement facts. Any migration of existing JSON copies must include capture versions, child payloads, canonical notes and snapshot projections, with scoped tests proving that raw text cannot be retrieved from alternate paths. This is a coordinated data-policy change, not an ordinary UI delete button.

### Redacted extraction and outcome observability

Reuse the explicit-field builder and best-effort sink pattern from `lib/observability/omnix-copilot-telemetry.ts`; never spread a proposal, HTTP request, exception, model response or credentials into an event. Durable accounting remains `createSupabaseOmnixAiBudgetAuthority` and its reserve/finalize RPCs. Capture observability must not replace that authority or dispatch when reservation fails.

The proposed versioned telemetry projection includes correlation ID, capture ID when allocated, workspace/member ID, data mode, action enum, guard/fallback/error category enums, model route/policy version when configured, elapsed milliseconds, proposal version, operation type counts, selected/completed/failed/awaiting-provider counts, and budget reservation reference. Counters and durations must be finite bounded nonnegative integers. Error categories are allowlisted and must not be derived from arbitrary exception messages. No contact names, email addresses, task titles, recap/summary/facts, evidence quotes, provider content or hidden prompts belong in telemetry.

Extraction result metadata can carry that same correlation and accounting link into the persisted capture document. Root chooses an additive immutable extraction telemetry table, keyed to contact/correlation/source hash, with state/reason enums, policy/model and estimated tokens/reserved upper-bound cost. This is approved as the durable minimized record; enforce active membership and workspace/contact references, RLS, narrow grants, immutable guards and allowlisted size/type checks in migration `20260907140000`. Neither contact ID nor a source hash authorizes access to the raw recap.

Distinguish `estimatedInputTokens`, `reservedOutputTokens`, and `accountedCostMicrousd` from provider-reported token usage. The current extraction charges its reserved upper bound even after failure; that is conservative accounting, not measured provider cost. Missing usage is unavailable, not zero. Use one caller-generated correlation through capture analysis, reservation, extraction result and terminal event. Persist the minimized model-run record before using optional extracted content. A failure there may discard optional extraction and retain manual preparation, but must not create a second model call, erase the budget reservation, fail a separately successful note, or mask an execution error. A failed optional logging sink remains best-effort; a failed budget finalize remains a governed model failure.

### Expanded operations and optional brief narration

Pipeline changes must bind canonical contact identity, current stage and update version; nurture changes must bind the exact plan/enrollment and current lifecycle state. Confirmations recheck those preconditions, with unaffected operations permitted only where independent validation is explicit. Consequences must be visible in the review. Neither path may mutate transaction state/deadlines or infer consent.

Google draft and calendar preparation may use the existing provider handoff, but the approved immutable payload must include exact recipient, connection, timezone and task/appointment values needed by its canonical validator. Do not reload mutable task fields as an implicit replacement for approved appointment content. The gateway's local draft/intent identity must derive from the canonical proposal ID and version, not a fresh random identity on retry. A crash after local handoff must resolve the same intent; ambiguous external execution must use existing reconciliation. Existing external approval and suppression checks remain mandatory.

The existing provider command marks its Omnix proposal executed after **handoff**. Capture must interpret the execution-reference category and present draft/intent preparation or awaiting-provider state; an intent receipt does not prove that Gmail/Calendar completed a remote action. Do not broaden the meaning of existing executed records or claim a message was sent.

An explicitly requested `narrateMeetingBrief(context, snapshotId, options, clock)` sidecar is compatible with immutable deterministic snapshots if the model selects existing fact IDs only and the server reconstructs the exact facts/citations. Bind the result to snapshot ID, source hash, rule version, generation time and the governed budget correlation. Recheck authorization and freshness before dispatch and before returning; stale results offer refresh rather than silently modifying the source snapshot. Keep deterministic facts usable on every failure.

[AUTO-DECISION] Persist sidecar narration? → Response-only narration is acceptable for this bounded addition when the existing model ledger persists accounting and the response clearly identifies its snapshot (reason: it adds no new factual content or execution authority). Do not change the original snapshot's `modelState` or suggest that narration survives reload. Durable/resumable narration would require a separate immutable sidecar record, not mutation of prior snapshots. Model calls remain explicit opt-in actions, not route-read side effects.

Trade-offs: receipt-first export adds one write to a read workflow but preserves accountability; bounded exports avoid unbounded confidential payloads but require honest coverage labels. Separate metadata and content enable future erasure while retaining interpretable receipts, at the cost of coordinated migration. Explicit provider preparation and opt-in narration add review steps but prevent accidental spend, duplicates and unsupported completion claims. Release acceptance still requires the new schema/RLS tests, race/replay tests, redaction tests and authenticated owner/assistant evidence.
