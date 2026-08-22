# Definition of Done — Story 3.6 Deterministic Organizational Copilot

Date: 2026-08-11

## Delivered

- Closed provider-free conversational grammar with exact aliases, date and identifier validation, and unsupported-intent failure.
- Stable `omnix-copilot.v1` responses with `citation.v1` record evidence, ten deterministic alert rules, read-only suggestions and explicit warnings.
- Exact per-rule/per-intent fact-key provenance, collision-resistant SHA-256 mailer-send contributor IDs and a centralized allowlist for telemetry error categories.
- Workspace-scoped read service over current contacts, Story 3.1 tasks/activities and physical-mailer campaigns.
- `omnix:copilot` CLI with sample/live disclosure, authenticated end-user live mode, fail-closed configuration and separate redacted telemetry.
- Additive `/omnix` conversation preserving the current daily brief and no-model/no-autonomous-action operating contract.
- Page-session-only transcript, safe in-product links, pending/empty/unsupported/unavailable/error states and no copilot mutation endpoint.

## Verified locally

- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — PASS, 48 files / 296 tests.
- `npm run build` — PASS; `/omnix` optimized route built at 5.33 kB / 111 kB first load.
- `npm run omnix:copilot -- brief --today 2026-08-11` — PASS with stable success envelope, alerts and record citations.
- `npm run omnix:copilot -- ask --question "Who needs attention?"` — PASS and resolves the fixed `alerts today` alias.
- Unsupported mutation-like chat — correctly exits 2 with `unsupported-intent`; raw question is absent from telemetry.
- `omnix:copilot --live` without public configuration/user token — correctly fails closed with exit 2 and no sample fallback.
- `npm run omnix:brief -- --today 2026-08-11` — PASS with the backwards-compatible Omnix/Cyryx Labs snapshot.
- Local production preview `http://127.0.0.1:3200/omnix` — HTTP 200; existing brief, no-model disclosure and Ask Omnix markers present.
- Independent architecture recheck — GO; citation, aggregate-contributor, mailer-send collision and telemetry-redaction blockers resolved.

## Safety and evidence boundary

- Tests cover two workspaces, revoked authority, forbidden IDs, 500-record bounds, invalid timezone, all fixed intents, exact citation contributors, derived next-touch inputs, long composite mailer-send keys, telemetry redaction and no-write spies.
- No LLM SDK, provider/model secret, external lookup, arbitrary query, background scheduler, hidden prompt or mutation endpoint was added.
- Browser/accessibility matrix remains `NOT_RUN`: no Playwright or browser automation was authorized. Responsive/theme/keyboard/screen-reader/overflow/console behavior is not claimed as visually verified.
- No hosted provider UAT, commit, push, deployment or production-readiness claim is made.
