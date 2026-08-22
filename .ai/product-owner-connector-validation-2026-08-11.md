# Product Owner Validation — Connector Program

**Date:** 2026-08-11  
**Reviewer:** @po (Themis)  
**Scope:** Story 3.5 and planned Stories 4.1–4.4  
**Decision:** **CONDITIONAL GO for architect-first design; NO-GO for provider implementation until provider stories exist and their prerequisites are explicit.**

## Product decision

The user's direction is accepted: Gmail, Google Calendar, Mailchimp, provider-backed texting, and eligible Instagram/Facebook business connections are all in the target scope. "Build all" does not mean presenting unavailable providers as connected. Each connector is complete only after real account authorization, workspace/account binding, token lifecycle, signed webhooks or reconciliation where applicable, immutable/redacted receipts, disconnect/revocation proof, negative-path tests, and real-account UAT.

Omnix never captures a Gmail, Google, Mailchimp, Twilio, Instagram, or Facebook password. Provider authentication stays on the provider surface. Twilio uses Omnix-owned service credentials rather than a consumer-login capture.

## Business priority and first vertical slice

1. **P0 — Story 3.5 connector foundation.** Build the workspace-scoped token boundary, durable jobs, idempotency, receipts, reconciliation, action approval, redaction, and disconnect/revocation contracts. It may prove behavior with a deterministic contract-test adapter, but that adapter must never appear as a live provider.
2. **P0 customer slice — Mailchimp.** This remains launch-closure work because the realtor already uses one combined audience and needs Hot/Warm/Nurture tags out plus signups/unsubscribes in.
3. **P1 — Gmail and Google Calendar.** Deliver incremental Google consent, contact-linked email activity/send, and follow-up-task event reconciliation. Gmail lead parsing remains deferred unless a real email lead stream is evidenced.
4. **P1/P2 — Compliant texting.** Build consent, STOP, quiet-hours, receipts, and conversation history while carrier registration proceeds; do not enable outbound provider messaging before approval.
5. **P2 — Meta business intake.** The user's latest direction confirms inbound social enquiries are desired. The first Meta outcome is governed intake from eligible business assets into Omnix with source/context and human review. Lead Ads and outbound DM automation are not implicitly approved by that request and need separate acceptance criteria.

**First real end-to-end slice:** one owner connects a real Mailchimp test/production account through OAuth, selects one audience, queues one idempotent contact-tag update, receives a persisted provider receipt, processes one verified unsubscribe webhook against the same contact, reconciles the result, and disconnects/revokes without deleting CRM history. Bulk backfill, signup intake, and scheduled drift repair can follow on the same contracts. This slice proves value and validates every essential Story 3.5 seam without pretending all providers are already operational.

## Non-negotiable user outcomes

- The realtor sees the exact connected account/asset/audience, granted scopes, connection health, last reconciliation, and an honest blocked/degraded state.
- The owner controls connections and protected policies. An assistant may use explicitly allowed operations but cannot read tokens/secrets or silently broaden scopes.
- Outbound operations produce a provider or reconciliation receipt; a local status change alone cannot be called success.
- Duplicate delivery, worker restart, webhook replay, stale approval, and retry cannot duplicate an external action.
- Contact/activity history remains after disconnect; provider access and local tokens are revoked/removed where supported.
- Mailchimp uses the existing audience rather than becoming a generic campaign builder: temperature tags go out, signups and unsubscribes come in, and loop prevention is mandatory.
- Gmail sent/received activity is linked conservatively to contacts; compose/send is available inside Omnix; Calendar follows Omnix task authority and reconciles create/update/delete failures.
- Texting records consent, opt-out, quiet-hours decisions, delivery state, and conversation history. No carrier approval means no outbound production activation.
- Meta only connects eligible business assets through Meta authorization. Inbound enquiries preserve provenance and require a safe review/merge path; unsupported personal-account access and password capture are forbidden.

## Dependency ruling

**Story 3.5 should depend on Story 3.0, not the full Story 3.2.** Story 3.0 is Done and already owns canonical `WorkspaceScope`, owner/assistant membership, membership-derived RLS, revocation, and cross-workspace isolation. Story 3.2 is the rich-contact lifecycle and is not the authority source.

Provider stories may have additional data dependencies:

- Story 4.1 should consume Story 3.2's canonical email/contact-point and subscription facts if those records are its source of truth; otherwise the story must explicitly define a temporary compatibility projection and its removal.
- Story 4.2 depends on Story 3.1 tasks/activities plus Story 3.5. It should consume Story 3.2 contact points for conservative email-to-contact matching once 3.2 is complete.
- Story 4.3 depends on Story 3.5 and the consent/contact-point model needed for phone identity; production activation additionally depends on registration/compliance approval.
- Story 4.4 depends on Story 3.5 and the existing idempotent intake/incomplete-record review path; provider activation additionally depends on approved Meta assets, permissions, webhooks, and the finalized JTBD.

## External blockers that must remain visible

| Connector/platform | Buildable now | Cannot be claimed live until |
|---|---|---|
| Platform base | Domain/contracts, migrations, CLI, test adapters, failure tests | Live Supabase/Auth, production environment, secrets/key-management, migrations, monitoring/rollback, realtor + assistant accounts, and real-data UAT exist. The current product is running sample data when Supabase is unconfigured. |
| Google identity/Gmail/Calendar | Incremental-consent flow, token contracts, Gmail/Calendar adapters and tests | Google project/client credentials, authorized redirects, consent/privacy configuration, required provider verification, real account scopes, and owner/assistant access behavior are verified. Current sign-in requests only `openid email profile`. |
| Mailchimp | OAuth/audience, tag jobs, signed webhook/reconciliation implementation and contract tests | Real Mailchimp app credentials, selected audience access, webhook configuration, source-of-truth rules, disconnect/revocation, and real-account UAT pass. Today only CSV import is real. |
| Twilio/texting | Consent/STOP/quiet-hours domain, job/receipt flows, provider adapter and sandbox tests | Service credentials/number and required US carrier registration/approval are complete; consent and compliance evidence is accepted. Device `sms:` handoff is not provider messaging. |
| Meta | Business Login, verified-webhook intake, asset selection, review queue and contract tests | Eligible business assets, app review/approved permissions, verified webhooks, conversation-window/human-escalation rules, privacy configuration, and the exact inbound/outbound JTBD are approved. Today no Meta connector exists. |

## Current product truth

- `/connections` is disclosure-only for these five connectors. It contains no Connect action, provider callback, stored provider account, scope inspection, job processor, webhook reconciliation, provider receipt, or disconnect/revocation operation.
- Google sign-in exists as a client flow but requests identity scopes only, and the current login explicitly reports that the database is not configured. It is not Gmail or Calendar authorization.
- Mailchimp support is CSV import/preset handling only; no live API synchronization exists.
- Texting is a device handoff; Instagram/Facebook provider ingestion is absent.
- Story 3.0 and Story 3.1 are Done locally, establishing canonical workspace authority and the task/activity substrate. Local completion is not production/provider readiness.

## Story readiness findings

### Story 3.5

**Readiness: 6/10 — architect-first only; keep Draft.**

Must fix before development:

1. Replace the incorrect dependency text `Story 3.2 workspace roles/RLS` with Story 3.0 canonical workspace authority. Do not wait for all of Story 3.2 to design/build the provider-neutral substrate.
2. Resolve executor ambiguity. The story assigns `@architect` but T2–T6 include schema and product implementation. Architect should own the threat model/ADRs and hand off an implementation-ready story to `@dev`/`@data-engineer`; QA retains the verdict.
3. Record the architect-approved token encryption/key rotation boundary, durable scheduler/lease mechanism, webhook verification boundary, and service-role constraints before implementation begins.
4. Define exact first-slice operational success/failure receipts and the rollout/rollback strategy. The initial file plan is currently too broad to be an implementation file list.
5. Reconcile the story's `Draft` status with its text saying `READY`; no lifecycle transition should occur until the architecture prerequisite and story revision are complete.

### Stories 4.1–4.4

**Readiness: 0/10 — missing story artifacts.** The roadmap links four files that do not exist under `docs/stories/`. No provider code should begin without SM-authored stories containing testable AC, external prerequisite states, provider/account ownership, exact scopes/permissions after official-source validation, data authority/matching, replay/loop behavior, receipts, disconnect/revocation, costs/approval disclosure, real-account UAT, and safe disabled/degraded UX.

Story-specific refinement required:

- **4.1 Mailchimp:** selected-audience authority, tag mapping, signup/unsubscribe identity rules, loop prevention, backfill/reconciliation, conflict policy, campaign-builder non-target.
- **4.2 Google:** split identity OAuth from incremental Gmail/Calendar scopes; define send/draft/history matching, task/event ownership, assistant behavior, privacy/retention, reconciliation and disconnect.
- **4.3 Texting/voice:** confirm whether voice is truly in scope; define consent evidence, STOP/HELP, quiet hours/time zone, number ownership, delivery webhook verification, carrier-blocked activation, and emergency/non-consumer-message non-targets.
- **4.4 Meta:** treat inbound DM enquiries as confirmed; separately decide Lead Ads and outbound messaging. Define eligible assets, provenance, dedupe/incomplete-record review, webhook replay, permitted response window, human escalation, retention, and app-review-blocked states.

## Checklist conclusion

- **Brownfield/UI project:** existing workflows and honest sample/live disclosure must be preserved.
- **Critical blockers:** missing provider stories; incorrect 3.5 dependency; unresolved architecture decisions; missing production credentials/approvals/UAT.
- **Risk:** High for external integrations, privacy, replay/idempotency, cross-workspace authorization, and misleading activation states.
- **Recommended path:** Direct adjustment to the existing roadmap. No rollback and no scope cancellation are needed. Start Story 3.5 architect-first against Story 3.0, draft/validate 4.1–4.4, then deliver Mailchimp as the first real provider vertical slice.

## Evidence reviewed

- `docs/prd/omnix-crm-parity-roadmap.md`
- `docs/prd/omnix-product-expansion.md`
- `docs/prd/realtor-requirements-coverage.md`
- `docs/prd/requirements-analysis-v2.md`
- `docs/architecture/tech-stack.md`
- `docs/stories/3.0.shared-workspace-authority.story.md`
- `docs/stories/3.1.crm-work-queue-foundation.story.md`
- `docs/stories/3.2.rich-contact-lifecycle.story.md`
- `docs/stories/3.5.connector-security-jobs-approvals.story.md`
- `packages/crm/app/connections/page.tsx`
- `packages/crm/components/google-sign-in.tsx`
- `packages/crm/lib/data/index.ts`
- `packages/crm/docs/google-sign-in.md`

