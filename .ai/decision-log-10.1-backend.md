# Story 10.1 backend implementation decisions

2026-09-07 · Vulcan · lead-authorized deterministic meeting preparation slice.

[AUTO-DECISION] Optional narration now? → Defer; no new model route or authority is required for a usable evidence-backed brief. Report `not-requested` and zero model tokens/cost.

[AUTO-DECISION] Snapshot authority? → CREATE immutable meeting-brief storage under existing membership RLS, as requested by the architecture review. Existing Omnix relationship-memory upsert is mutable and cannot preserve prior evidence. SQL does not attest model authenticity; records retain authenticated membership authorship.

IDS search used `rg --files` and inspected copilot service/citations, repository factory, ContactIdentityMap, activity/transaction/nurture/rich-contact repositories, authenticated CLI, prompt guard and prior migration/RLS/rollback patterns before implementation.

| Files | IDS decision and rationale |
| --- | --- |
| `lib/domain/meeting-brief.ts` | CREATE focused versioned contract; existing copilot response does not model immutable preparation snapshots. |
| `lib/application/meeting-brief-service.ts` | ADAPT copilot contact display/guard/hash patterns; REUSE canonical contact get and existing membership scope. |
| `lib/data/meeting-brief-repository.ts` | CREATE bounded minimal source/snapshot boundary, without provider raw-payload fields. |
| `lib/data/memory-meeting-brief-repository.ts` | ADAPT process sample repository pattern and canonical activity/transaction/nurture interfaces; restrict known sample membership pairs. |
| `lib/data/supabase-meeting-brief-repository.ts` | ADAPT existing tenant-filtered Supabase repositories with strict projections, 20-record windows, canonical alias-group lookup and source validation. |
| `lib/application/meeting-brief-service.test.ts` | ADAPT local Vitest repository fixture conventions; add independent grounding, isolation, immutable history and CLI behavior checks. |
| `lib/data/supabase-meeting-brief-repository.test.ts` | ADAPT fluent-client spies; assert query projection/limits and canonical donor preservation, not implementation string snapshots. |
| `scripts/meeting-brief.ts` | ADAPT authenticated CLI dependency-injection and JSON-error conventions; native Node strip-types compatibility verified. |
| migration `20260907120000_meeting_brief_snapshots.sql` | ADAPT composite workspace FKs, membership actor RPC and immutable-evidence trigger patterns. |
| matching rollback and forward-repair SQL | ADAPT reversible capability disable/restore; prior evidence remains stored. |
| matching pgTAP SQL test | ADAPT existing owner/assistant/second-workspace fixtures with RLS, direct mutation denial and unsafe/unrelated citation rejection. |
| story record, this log and `plan/self-critique-10.1-backend.json` | ADAPT existing story task/file-list and self-critique formats; preserve unfinished acceptance gates. |

Post-code critique caught native Node parameter-property incompatibility, potential saved unsafe hrefs, dropped donor source history and incomplete contradiction propagation. Those were corrected before handoff. Service/adapter tests 13/13, TypeScript, lint and CLI help pass. Database tests and live UAT are authored/pending, not claimed as passed. Source families without safe bounded implementation remain unavailable.

## Authorized continuation — optional narration and property context

The lead authorized remaining implementation after the deterministic slice. The earlier defer decision is superseded by an explicit opt-in, independent narration command. `meeting-brief-narration.rules.v1` allows one provider call, 18 existing facts, up to 3 talking points, and 180 output tokens under unchanged `omnix-ai-policy.v1` global budget and timeout ceilings. The model returns existing item IDs only; the application reconstructs exact recorded text and citations. Unsupported IDs, additional prose, duplicates, changed sources, unsafe facts and invalid usage fail closed. The sidecar is response-only; existing budget-ledger reservation/correlation and terminal usage persist. Saved deterministic snapshots are not rewritten, and no provider availability claim is made.

Additional IDS decisions after searching the existing narrator, budget/credential services, property repositories, Google connector repositories and migration patterns:

- CREATE `lib/application/meeting-brief-narration.ts` and its focused test: existing narrator allows freeform text with valid IDs, which does not meet this story's strict extractive grounding. REUSE existing paid-private workspace credential type/allowlist, budget authority, guard, token/cost estimator and global ceilings.
- ADAPT `scripts/meeting-brief.ts` with a separate `narrate --id ID --live` operation; deterministic commands do not load model credentials.
- ADAPT `lib/domain/meeting-brief.ts`, service, source adapters and corresponding tests with `property-behavior` evidence. Live reads request only permitted, canonical-subject event metadata, capped at 20; no licensed descriptions, raw payload, valuation or behavioral intent inference is retrieved.
- ADAPT the owned unapplied snapshot migration and pgTAP test: enforce allowed property permission and canonical subject on each property citation; add allowed/restricted/revoked cases. The suite now contains 15 authored SQL cases, still not executed here.
- REUSE this log and the existing backend critique to record continuation. Story/UI/factory integration is owned by the lead and was not edited in this continuation.

There is no canonical general appointment repository. Google storage covers managed task projection lifecycle, not general client appointments; representing it as appointment truth would be unsupported. That source remains unavailable.

Independent review caught two resource/freshness gaps in the optional sidecar: reading an unbounded provider envelope before validating extracted text, and source edits during budget finalization. The implementation now streams at most 16 KiB before JSON parsing and rechecks freshness after finalization. Oversized envelopes are canceled and rejected; provider-reported usage outside the existing ledger constraints is rejected without increasing ceilings. Final focused coverage is 33 passing tests across service (11), bounded adapter (4), and narration (18). Native CLI help passes; package TypeScript/lint checks are repeated after final changes. SQL tests remain authored, not executed, and no real model request is used as acceptance evidence.
