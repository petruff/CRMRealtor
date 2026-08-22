# CRM work queue CLI foundation

Story 3.1 exposes Smart Lists, incomplete-record review and the activity/task queue before UI wiring. All commands are non-interactive, use application services and require a verified `WorkspaceScope` at the repository boundary.

## Modes and output

- The default is `sample-process-only`: seeded, deterministic and explicitly non-durable.
- `--live` is fail-closed. It never falls back to sample data after a configuration or persistence failure. The Story 3.1 composition root must inject the authenticated Supabase repositories before live use.
- Success and failure each emit one JSON document with `schemaVersion: "crm-work-queue-cli.v1"`, mode, durability, resource and command/result or error.
- Smart List apply returns contact IDs, never contact PII.
- Incomplete-record list and ordinary show return identity-signal booleans and reason codes. Only `show --detail` returns the normalized allowlisted candidate fields.

Stable exit codes:

| Code | Meaning |
|---:|---|
| 0 | Success, including an explicit no-op |
| 1 | Unexpected internal or persistence failure |
| 2 | Invalid command, option, field or bounded input |
| 3 | Forbidden, revoked membership or workspace-scope mismatch |
| 4 | Record not found in the verified workspace |
| 5 | State or idempotency conflict |

## Smart Lists

```powershell
npm run smart-lists -- list
npm run smart-lists -- show --id smart-list-sample-hot
npm run smart-lists -- apply --id smart-list-sample-hot
npm run smart-lists -- create --name "Miami hot buyers" --definition-json '{"schemaVersion":"smart-list-filter.v1","criteria":[{"field":"leadType","operator":"eq","value":"hot"},{"field":"city","operator":"eq","value":"Miami"}]}'
npm run smart-lists -- update --id smart-list-sample-hot --name "Priority leads"
npm run smart-lists -- archive --id smart-list-sample-hot --reason "Temporarily retired"
npm run smart-lists -- restore --id smart-list-sample-hot
```

The persisted definition is data, never SQL or executable code:

```json
{
  "schemaVersion": "smart-list-filter.v1",
  "criteria": [],
  "sort": { "field": "priority", "direction": "asc" }
}
```

Allowlisted criteria:

- `query`: `contains` or `eq`, maximum 200 characters.
- `leadType`, `relationship`, `intent`, `source`, `pipelineStage`: `eq` or `in` with existing domain enum values.
- `city`, `state`, `postalCode`, `buyer.timeline`, `seller.timeline`: `contains` or `eq`.
- `buyer.priceMin`, `buyer.priceMax`: `min` or `max` with a non-negative finite number.
- `tags`: `any` or `all` with a non-empty bounded string array.
- `nextTouchAt`: `before`, `on`, `after` with `YYYY-MM-DD`, or `empty` without a value.
- Optional sort fields: `priority`, `name`, `nextTouchAt`, `createdAt`; directions: `asc`, `desc`.

Names are at most 80 characters, definitions at most 20 criteria and results at most 500 contacts. Default ordering is deterministic Hot, Warm, Nurture with stable tie-breaking. Archived lists remain persisted and cannot be applied until restored. The apply result includes `activeCriteria` and a `clear` descriptor.

## Incomplete records

```powershell
npm run incomplete-records -- list --status pending --limit 100
npm run incomplete-records -- show --id incomplete-sample-1
npm run incomplete-records -- show --id incomplete-sample-1 --detail
npm run incomplete-records -- convert --id incomplete-sample-1 --idempotency-key review-2026-08-11 --correction-json '{"email":"sample@example.com"}'
npm run incomplete-records -- archive --id incomplete-sample-1 --reason "Duplicate intake"
npm run incomplete-records -- restore --id incomplete-sample-1
```

Only normalized contact candidate fields are persistable. Raw bodies, headers, authorization values, tokens, notes and unmapped columns have no repository input path. A name, phone, email or provider external ID is required to enter quarantine. Conversion uses the existing conservative import identity decision in the application layer, then one repository transaction creates/updates/links the same-workspace contact, marks the record converted and appends `incomplete-record-converted`. A replay returns the original contact receipt; the same idempotency key with different data fails closed.

## Activities and tasks

```powershell
npm run activities -- tasks --status open --from 2026-08-11T00:00:00Z --to 2026-08-12T23:59:59Z
npm run activities -- events --contact-id contact-sample-1 --limit 100
npm run activities -- create --title "Call seller" --due-at 2026-08-12T14:00:00Z --idempotency-key call-seller-2026-08-12
npm run activities -- complete --id task-sample-1
npm run activities -- reopen --id task-sample-1
npm run activities -- archive --id task-sample-1
npm run activities -- bulk-complete --ids task-1,task-2
npm run activities -- bulk-archive --ids task-1,task-2
```

Search is bounded to 200 characters; lists are bounded to 500 rows. Bulk operations require 1–100 unique explicit IDs and validate every workspace-scoped target before mutating any. Open tasks sort overdue first, then due time, creation time and ID. Repeating a transition returns a clear no-op. Activity events expose append/list only, carry a workspace-unique idempotency key and cannot be edited or deleted through product commands.

Initial event types are `contact-created`, `contact-updated`, `contact-imported`, `note-added`, `touch-recorded`, `incomplete-record-converted`, `task-created`, `task-completed` and `task-archived`. No provider communication event is fabricated.

## Repository integration contracts

- `SmartListRepository`: scoped CRUD/archive/restore; `SmartListContactSource.list(scope)` supplies the same contacts used by CLI/UI.
- `IncompleteRecordRepository`: scoped list/get/create/archive/restore, conservative `previewConversion`, and transactional `convertAtomically` with an application-validated plan. Workspace and legacy owner authority are derived server-side.
- `ActivityRepository`: append-only events plus atomic task/create-event and bulk task-transition/event operations.

All in-memory factories reset their deterministic sequences per factory and use the same required workspace scope. They are sample/test adapters, not a live-write fallback.

## IDS implementation log

Searches covered existing contact query/import boundaries, `WorkspaceScope`, repository factories, `manage-workspace.ts`, CLI envelope/exit handling and memory adapter tests. Decisions:

| File(s) | Decision | Reused/adapted source |
|---|---|---|
| `lib/domain/smart-list.ts`, `.test.ts` | CREATE | ADAPT bounded query normalization and Hot/Warm/Nurture priority from `contact-query.ts`; no raw expression engine |
| `lib/domain/incomplete-record.ts`, `.test.ts` | CREATE | ADAPT import allowlist/normalization; deliberately omit raw/note/unmapped data |
| `lib/domain/activity.ts`, `.test.ts` | CREATE | ADAPT append-only note evidence and existing contact timestamp conventions |
| `lib/application/smart-list-commands.ts`, `.test.ts` | CREATE | ADAPT command validation/repository injection from contact/workspace commands |
| `lib/application/incomplete-record-commands.ts`, `.test.ts` | CREATE | ADAPT conservative import preview boundary; keep fuzzy decision outside SQL |
| `lib/application/activity-commands.ts`, `.test.ts` | CREATE | ADAPT typed command/state patterns; bulk validation is new because no reusable bulk seam existed |
| `lib/data/smart-list-repository.ts` | CREATE | ADAPT dedicated typed repository pattern; do not widen `ContactRepository` |
| `lib/data/incomplete-record-repository.ts` | CREATE | ADAPT import gateway idempotency and add required atomic conversion unit of work |
| `lib/data/activity-repository.ts` | CREATE | ADAPT typed repository pattern; omit event mutation/deletion methods |
| `lib/data/memory-smart-list-repository.ts`, `.test.ts` | CREATE | ADAPT memory factory/seed pattern with reset-safe deterministic IDs |
| `lib/data/memory-incomplete-record-repository.ts`, `.test.ts` | CREATE | ADAPT memory import identity matching with transaction-before-commit behavior |
| `lib/data/memory-activity-repository.ts`, `.test.ts` | CREATE | ADAPT memory repository pattern; task/event mutations share one state boundary |
| `scripts/crm-work-queue-cli.ts` | CREATE | ADAPT stable JSON envelope and exit map from `manage-workspace.ts` |
| `scripts/manage-smart-lists.ts` | CREATE | ADAPT dependency-injected CLI entrypoint and explicit sample/live modes |
| `scripts/manage-incomplete-records.ts` | CREATE | ADAPT CLI pattern with additive detail/PII gate |
| `scripts/manage-activities.ts` | CREATE | ADAPT CLI pattern with explicit bounded bulk IDs |
| `lib/application/crm-work-queue-cli.test.ts` | CREATE | ADAPT `workspace-cli.test.ts` output harness and live-no-fallback assertions |
| `package.json` | ADAPT | REUSE existing Node type-stripping script convention |
| `docs/crm-work-queue.md` | CREATE | No equivalent Story 3.1 CLI contract existed |
| `plan/self-critique-3.1-domain-cli.json` | CREATE | AEXOS mandatory Step 5.5/6.5 evidence for this owned slice |
