# Definition of Done — Story 3.1 CRM Work Queue Foundation

Date: 2026-08-11

## Delivered

- CLI-first Smart List, incomplete-record and task/activity workflows use shared application commands and `WorkspaceScope`.
- Persisted Smart Lists use a validated, versioned allowlist and deterministic bounded contact evaluation.
- Import and intake quarantine safe identifiable invalid records without storing raw payloads, headers, secrets or unmapped columns.
- Incomplete records support correction, preview, atomic idempotent conversion, archive and restore.
- Immutable CRM activity events and mutable follow-up tasks are available in CLI, `/activities` and contact detail.
- `/contacts` preserves URL-backed search while adding Smart List controls; `/contacts/incomplete` and `/activities` are additive routes with loading/error states.
- Supabase migration `0005_crm_work_queue.sql` uses canonical `workspace_id`, membership-derived RLS, composite workspace foreign keys and atomic replay-safe RPCs.

## Verified locally

- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — PASS, 43 files / 215 tests.
- `npm run build` — PASS, optimized Next.js build.
- `supabase test db supabase/tests/0005_crm_work_queue_test.sql --local` — PASS, 16/16 pgTAP cases.
- Sample Smart List creation with a validated definition — PASS.
- Sample incomplete-record conversion without correcting `needs-correction@` — correctly rejected with `invalid-input`; corrected conversion — PASS.
- Sample task assignment to `revoked-member` — correctly rejected with `forbidden`; assignment to the active sample membership — PASS.
- Live CLI without authenticated public configuration — fail-closed with exit code 2 and no secret output.
- Local production HTTP smoke — PASS (200) for `/welcome`, `/contacts`, `/contacts/incomplete`, `/activities` and `/contacts/c-monroe`.

## QA remediation

- Application conversion plans and SQL validation now share the `changes` contract and exact create/update payload shape.
- Direct RPC conversion binds `contactInput`/`contactPatch` exactly to the corrected candidate and locked contact; divergent or semantically invalid plans fail without mutation.
- Incomplete-record conversion applies full contact validation before any create/update operation.
- Memory/sample activity assignment is fail-closed against the authenticated active membership.
- SQL rejects empty/control Smart List text, negative price bounds, oversized or malformed candidates, non-normalized contact points, excessive tags and divergent conversion changes.
- pgTAP covers invalid plan email, candidate-divergent create and update, exact application-shaped create/update, idempotent replay and rollback-safe failure.
- The realtor-facing Smart List editor now persists the full v1 definition with 0–20 criteria, type-appropriate operators, enum multi-select, dates, prices, tags, optional sort and field-level errors.

## Review boundary

- Browser/accessibility QA remains NOT_RUN: direct Playwright automation was not authorized under the user's selected-browser constraint.
- No hosted separate-account Google/Supabase UAT was available.
- CodeRabbit was not executed because this workspace is not a Git repository and the configured review boundary is unavailable.
- No commit, push, deployment or production-readiness claim is made.
- External Gmail, Calendar, Mailchimp, Twilio and Meta provider execution remains assigned to later roadmap stories.
