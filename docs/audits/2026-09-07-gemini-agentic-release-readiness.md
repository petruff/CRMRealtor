# Gemini assistant release readiness

Observed: 2026-09-08 00:30 UTC (2026-09-07 America/New_York).

Status: investigation complete; implementation candidate is not frozen. No commit, push, application deployment, migration, provider configuration change, or customer-data write was performed by this investigation.

## Candidate and GitHub

- Working branch: `codex/epic-10-meeting-outcomes`.
- Baseline HEAD: `eedc12eec250535946405671577e356f5f24c8e9`.
- Remote main: `3e828d9f3c3fd17673415ca6cbc1937a4895082e`.
- Merge base: `334291a76a48a5482089d5b7a62915802205e838`.
- Compared with remote main, the working branch has 21 unique commits; main has two unique merge commits. No branch reconciliation has been performed. Existing production comes from the feature branch lineage, so a main-only deployment would regress delivered work.
- GitHub CLI is authenticated as `petruff`. PR #4 remains open against `codex/story-5-1-governed-ai`, head `121a8f9367c25533f25d213c4315be1e9c3c9f46`.
- The latest observed candidate workflow, run `34167959748`, succeeded for PR #4's documentation commit. This is current evidence of an available CI route, not acceptance of the uncommitted implementation.
- `.github/workflows/ci.yml` checks out the exact candidate and runs dependency audit, pinned Gitleaks, lint, TypeScript, full tests, complete Supabase migration replay, pgTAP, candidate rollback and forward-repair recovery, tracked-manifest validation, build, and clean-tree assertions.
- A frozen candidate must receive its own CI run. Existing feature, story, and release artifacts will be staged selectively. Pre-existing project status, attachment folders, old browser captures, and unrelated audit evidence remain excluded.

## Hosting

- Vercel CLI is authenticated to the existing `contact-70575058s-projects` account. The connector is linked to a different account and returned 404; the CLI recovered the correct project without modifying authentication.
- Project: `prj_yRO5wtPmqAIMiQsLquShv0rXoeaP`, team `team_1NR9qkt0OKOKkYGuRciHrbMf`, name `crm`, Next.js, Node 24.x.
- Project Git integration is absent (`link: null`), so pushing a candidate does not automatically deploy it.
- Current production: `dpl_GDHBv2TMX3ZB1B5dFFaeCyUvVU5r`, READY, `https://crm-chi-teal-22.vercel.app`.
- Deployment metadata names baseline SHA `eedc12eec250535946405671577e356f5f24c8e9`, but also records `gitDirty: 1`. This legacy metadata alone does not prove byte-for-byte equality to that commit. The new deployment must use an isolated clean candidate.
- Anonymous `/api/health` and `/api/readiness` returned HTTP 200. Readiness reported the configured database available.
- Current plan is active Hobby. The deployed schedule is `0 6 * * *`; no plan, schedule, or live-provider eligibility was changed.

## Database access and AI configuration

- Linked production project: `kpcqcrskqygkthrcmamd` (`Omnix CRM`), organization `asxfllyqjevdhipjpsmq`.
- Supabase CLI and connector use an account without this project. `supabase migration list --linked` returned HTTP 403. No local database password is configured, and the cached pooler URL contains no password.
- The existing Chrome session is authenticated to the correct Supabase organization. The project dashboard reported Healthy, Free/Nano, no branches and no scheduled backups. The official SQL Editor can execute bounded read-only queries; this provides a possible migration route after candidate validation. No session cookie, bearer token, or secret was extracted from the browser.
- Production has 62 applied migration versions, ending at `20260901010000` (`sql_lint_warning_cleanup`). Baseline HEAD has 63: `20260901180000_remote_lint_definition_reconciliation.sql` is also absent remotely. The current candidate contains that existing pending reconciliation plus eight new Epic 10 migrations. `public.meeting_brief_snapshots` and `public.capture_outcomes` are absent. Full observed versions are recorded in `evidence/2026-09-07-gemini-release/readiness.json`.
- A direct read of `public.workspace_ai_configurations` returned zero rows. The authenticated CRM Settings screen independently reported `Key: Not configured` and `Routing: Disabled`. Therefore the intended previously registered Gemini key is not present in this deployed workspace's canonical configuration. No key was added, substituted, exposed, or silently enabled.
- The Vercel environment inventory contains service-role and encryption-key variable names, but no Gemini deployment fallback. A normal `vercel env pull` into an ignored, access-restricted task file returned redacted placeholders for sensitive values. Nonempty placeholders do not establish usable credentials. The temporary download was removed after inspection. No secret values are included in this report.

## Remaining executable gates

1. Complete the bounded assistant implementation, story traceability, architecture acceptance and independent QA; freeze one candidate and run local pre-push gates.
2. Push only the validated candidate through DevOps and obtain its exact-SHA CI result. The existing GitHub workflow supplies a disposable Linux/Supabase test route even while local Docker is unavailable.
3. Confirm the complete remote migration history and candidate recovery plan. Apply only the reviewed, CI-tested additive migrations through an authenticated administrative path; verify history, canonical tables, functions and access policies afterward. Do not run experimental schema changes or test fixtures in production.
4. Publish the clean, tested application candidate to the existing project, then verify deployment metadata, health/readiness, authentication boundaries and real responsive journeys.
5. Configure or recover the intended Gemini credential through the canonical workspace-owner flow before claiming live Gemini acceptance. Settings currently has no saved configuration. Preserve provider budgets, minimized CRM context, authority checks and explicit action approval.

The broader release-manifest contract in `docs/qa/releases/README.md` additionally requires provider lifecycle evidence and physical iPhone Safari/PWA acceptance. Those remain separate, unfulfilled gates; application CI or a browser-emulated check cannot substitute for them.

## Release-policy boundary requiring architecture adjudication

`packages/crm/scripts/release-manifest-supabase-ci.test.ts` explicitly tests that ordinary candidate CI does not require an in-tree exact-SHA manifest, avoiding a self-reference problem. The separate release-evidence workflow validates the complete manifest from a second checkout. There is currently no narrower application-update manifest schema. The README and Story 6.12 still describe the complete manifest as a Production-promotion prerequisite. Story 9.7 records a later application deployment without closing the full provider/physical-device program, but that precedent alone is not a policy exemption.

Architecture must explicitly document the authorized application-update boundary before deployment, while preserving actual CI, SQL/recovery, authentication and provider-authority gates. This investigation does not reinterpret a successful zero-manifest candidate check as full operational promotion.

## Pre-migration recovery preparation

The authenticated dashboard permits read-only catalog export, so the next operator can capture the current migration rows, enum labels, affected function definitions/owners/ACLs, and affected table/policy/grant definitions before applying the reviewed SQL. This is a targeted schema recovery snapshot, not a complete database backup. No such export has yet been produced. A complete `pg_dump` still needs database connection credentials; no scheduled backup or usable database password was observed.

After candidate CI and architecture acceptance, any dashboard migration application must preserve file order, keep enum additions committed before functions use the new labels, apply each reviewed transaction atomically where supported, record the matching migration history only with successful application, and verify actual catalog state afterward. The pending reconciliation migration precedes the eight new Epic 10 migrations. Production must not be used to rehearse rollback or run synthetic pgTAP fixtures; that work belongs in disposable CI.

## Decisions

- `[AUTO-DECISION] Does existing deployment authorization require another generic confirmation? -> No (reason: the user explicitly requested implementation and deployment; the next step is a concrete validated candidate).`
- `[AUTO-DECISION] Can the previous Docker error end release investigation? -> No (reason: an existing disposable GitHub CI route and an authenticated Supabase dashboard are available).`
- `[AUTO-DECISION] Can a nonempty downloaded environment value be treated as a usable secret? -> No (reason: the provider returns redacted placeholders for sensitive values).`
- `[AUTO-DECISION] Can the user's expectation of a registered Gemini key override observed configuration? -> No (reason: both canonical database metadata and Settings show no saved configuration; preserve the intended existing credential while reporting the discrepancy).`
