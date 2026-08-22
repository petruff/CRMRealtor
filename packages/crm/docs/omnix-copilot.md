# Omnix deterministic copilot

Omnix is a read-only organizational copilot powered by Cyryx Labs. This Story 3.6 surface uses a closed, deterministic grammar over authorized CRM records. It does not use a language model, infer synonyms, browse the web, call providers, or execute a CRM mutation.

## CLI

```powershell
npm run omnix:copilot -- brief
npm run omnix:copilot -- brief --today 2026-08-12
npm run omnix:copilot -- alerts --today 2026-08-12
npm run omnix:copilot -- ask --question "show pipeline"
npm run omnix:copilot -- ask --question "find contact Alicia"
npm run omnix:copilot -- help
```

The default is explicit, non-durable `sample` mode. Add `--live` to `brief`, `ask`, or `alerts` to read the authenticated workspace. Live mode requires:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` containing the public project key
- `OMNIX_SUPABASE_ACCESS_TOKEN` containing a current end-user access token

The CLI derives workspace authority from that active end-user membership. It rejects service-role/secret keys and does not accept a caller-selected workspace or owner ID. A live failure never falls back to sample data.

`OMNIX_TIME_ZONE`, when present, must be a valid IANA time-zone name such as `America/New_York`. It defines the CRM calendar day. If omitted, Omnix retains the documented local-process calendar behavior. `--today` accepts only a real `YYYY-MM-DD` calendar date.

`npm run omnix:brief` remains available. Both brief surfaces preserve the same pure `buildWorkspaceSnapshot` baseline and deterministic triage rules; `omnix:copilot` adds task groups, citations, alerts, correlation IDs, and the versioned response envelope.

## Closed question grammar

`ask` accepts exactly one `--question` value containing 1–200 printable characters. Matching ignores case, collapses whitespace, and tolerates terminal `.`, `!`, or `?`. It supports only:

| Canonical form | Result |
|---|---|
| `brief [today\|YYYY-MM-DD]` | Daily deterministic organization brief |
| `alerts [today\|YYYY-MM-DD]` | Explainable internal alerts |
| `find contact <query>` | Bounded authorized contact search |
| `pipeline` | Current contact `pipelineStage` counts |
| `tasks overdue\|today\|upcoming` | Open tasks in one documented window |
| `tasks from <YYYY-MM-DD> to <YYYY-MM-DD>` | Inclusive, ordered task date range |
| `dates today\|upcoming` | Birthdays and home-purchase anniversaries in the fixed reminder windows |
| `mailers [<campaign-id>]` | Physical postcard/letter campaign facts |
| `activity <contact-id>` | Recent authorized activity for one contact |
| `connections` | Honest connector-capability disclosure |
| `help` | Supported examples |

Exact aliases are:

| Alias | Canonical form |
|---|---|
| `what should I do today` | `brief today` |
| `who needs attention` | `alerts today` |
| `show overdue follow-ups` | `tasks overdue` |
| `show today's tasks` | `tasks today` |
| `show upcoming dates` | `dates upcoming` |
| `show pipeline` | `pipeline` |
| `show mailers` | `mailers` |
| `show recent activity for <contact-id>` | `activity <contact-id>` |
| `connection status` | `connections` |

Everything else returns `unsupported-intent`, includes supported examples, emits no CRM data, and exits non-zero. HTML, SQL-looking, path-like, and stored text remain inert data; they cannot select an intent or execute a command.

## Response contract

Every invocation emits exactly one `omnix-copilot.v1` JSON document on stdout. Redacted `omnix-copilot-telemetry.v1` events use stderr as a separate JSONL observability stream, so automation can parse stdout without mixing schemas. Success includes:

```json
{
  "ok": true,
  "schemaVersion": "omnix-copilot.v1",
  "command": "ask",
  "resolvedIntent": { "kind": "pipeline" },
  "correlationId": "...",
  "dataMode": "sample",
  "asOf": "2026-08-11T14:30:00.000Z",
  "answerBlocks": [],
  "citations": [],
  "suggestions": [],
  "warnings": [],
  "alerts": []
}
```

Failure preserves the same schema, command/correlation/mode/as-of metadata and adds `code`, a safe message, supported examples, and warnings. Unexpected errors are redacted.

Exit codes are stable: `0` success, `1` internal error, `2` invalid or unsupported input, `3` forbidden, `4` not found, `5` conflict, and `6` capability unavailable.

## Evidence and action boundary

Factual response items use `citation.v1`. Each citation identifies an allowlisted entity (`contact`, `task`, `activity`, `mailer`, or `mailer-send`), the authorized record ID, exact fact keys, available source timestamp, response clock, deterministic rule, and a safe in-product target.

Alert IDs derive from rule, source record, and as-of date and deduplicate deterministically. The alert catalog is fixed to first-contact, follow-up, birthday, homeaversary, pipeline-next-touch, physical-mailer-address, and task-due rules documented in Story 3.6.

Suggestions are explicitly `readOnly: true`. A link or copyable preview is not an action receipt. The copilot never creates or transitions a task, changes a contact or pipeline, sends or schedules a message, marks a physical mailer sent, or treats conversational text as confirmation.
