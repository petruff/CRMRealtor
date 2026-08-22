# Implementation log — Story 3.1 Supabase work queue

Date: 2026-08-11  
Agent: @dev (Vulcan)  
Mode: autonomous scoped implementation

## IDS decisions

| File(s) | Search evidence | Decision | Rationale |
|---|---|---|---|
| `lib/data/supabase-smart-list-repository.ts` + test | Memory Smart List repository and migration 0005 existed; no durable adapter existed. | ADAPT/CREATE | Reuse the repository contract and domain parsers while binding all operations to `workspace_id`. |
| `lib/data/supabase-incomplete-record-repository.ts` + test | Memory quarantine/conversion implementation and atomic SQL RPC existed; no Supabase adapter existed. | ADAPT/CREATE | Preserve preview parity and delegate conversion to one atomic, replay-safe RPC envelope. |
| `lib/data/supabase-activity-repository.ts` + test | Memory activity repository defined event/task semantics; migration exposed atomic event/task RPCs. | ADAPT/CREATE | Map rows explicitly and never emulate atomic bulk changes with client-side loops. |
| `lib/data/authenticated-cli-context.ts` + test | `manage-workspace.ts` already had the authenticated end-user CLI security pattern. | ADAPT/CREATE | Centralize public-key/token authentication for the three new CLIs, rejecting service-role credentials. |
| `lib/data/index.ts` + test | RepositoryContext already composed sample/live Story 3.0 repositories. | ADAPT | Expose the three Story 3.1 repositories in both modes without silent live fallback. |
| `lib/data/automation-context.ts` + test | Privileged automation context already composed contact/import repositories. | ADAPT | Add the same named Story 3.1 repositories under the already resolved workspace scope. |
| `lib/data/supabase-repository.ts` + test | Canonical contact list was the contact source reused by Smart List apply and duplicate preview. | ADAPT | Bound the canonical query to 500 while preserving workspace filter, ordering and mapping. |
| `scripts/manage-smart-lists.ts` | Sample CLI and injection seam existed; live path was deliberately unwired. | ADAPT | Compose the authenticated Supabase Smart List and bounded contact repositories. |
| `scripts/manage-incomplete-records.ts` | Sample CLI and injection seam existed; live path was deliberately unwired. | ADAPT | Compose the authenticated Supabase quarantine repository without sample fallback. |
| `scripts/manage-activities.ts` | Sample CLI and injection seam existed; live path was deliberately unwired. | ADAPT | Compose the authenticated Supabase activity repository using atomic SQL RPCs. |

## Autonomous decisions

- `[AUTO-DECISION]` Live CLI credentials → require HTTPS/loopback URL, public Supabase key and end-user access token; reject service-role/secret keys before client creation.
- `[AUTO-DECISION]` Smart List apply and duplicate preview bound → reuse the canonical contact repository capped at 500.
- `[AUTO-DECISION]` Task search → apply indexed workspace/status/date filters in SQL, fetch at most 500, then perform bounded case-insensitive text matching and domain ordering.
- `[AUTO-DECISION]` Task create/transition and event append → require the migration 0005 JSON envelopes; never fall back to multiple non-atomic writes.
- `[AUTO-DECISION]` Provider errors → map authorization, conflict and validation codes without returning provider error text or secrets.

