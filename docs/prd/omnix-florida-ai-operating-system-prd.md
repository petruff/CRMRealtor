# Omnix Florida AI Operating System PRD

**Version:** 1.0.0
**Date:** 2026-08-31
**Status:** Ready for story breakdown — approved four-sprint scope
**Product owner:** @pm (Janus)
**Required reviewers:** @architect (Vega), @data-engineer, @ux-design-expert, @qa (Argus), @devops
**Delivery constraint:** Four controlled sprints; no big-bang release
**Product:** Omnix — Powered by Cyryx Labs

## 1. Executive decision

Omnix will evolve from a relationship CRM with governed AI into an **AI operating system for independent Florida realtors and their authorized assistants**. The product will combine relationship memory, deterministic priority, governed automation, Florida-specific transaction operations, property and lead intelligence, and referral lifecycle automation.

The program will be delivered in four controlled sprints. Each sprint must produce an independently testable and reversible increment. “Implemented” means code and local evidence exist; “integrated” means an external provider is connected; “operational” requires real-account reconciliation; and “released” requires authenticated user, device, recovery, and production evidence. These states must never be collapsed into one status.

External decisions that Omnix cannot control — including MLS data licensing, IDX vendor provisioning, Google scope verification, Meta App Review, carrier registration, e-sign provider approval, and legal review — are parallel gates. A blocked provider must fail closed and must not prevent safe operation of the CRM core.

## 2. Problem statement

Independent Florida realtors operate contacts, messages, follow-ups, property interests, transactions, deadlines, marketing, and financial outcomes across disconnected systems. Generic CRMs create excessive configuration and administrative work while still requiring the agent to remember who needs attention, why they matter, what was promised, and which transaction or compliance deadline is at risk.

Omnix must reduce that cognitive burden without becoming an opaque autonomous agent. It should continuously organize authorized facts, explain priority, prepare the next action, retain evidence, and require the appropriate human approval before material external or financial actions.

## 3. Users and jobs to be done

### 3.1 Primary user — independent Florida realtor

Manages a relationship book, inbound leads, active buyers and sellers, transactions, past clients, referrals, marketing, and business performance. Works mainly on desktop and occasionally from a mobile browser or installed PWA.

### 3.2 Secondary user — authorized assistant

Supports contact maintenance, task execution, follow-up preparation, transaction administration, and approved campaigns within explicit workspace capabilities. The assistant cannot inherit owner authority through the UI, connector access, AI prompts, or direct database calls.

### 3.3 Primary job

> When relationships, messages, property interests, deadlines, and transactions are distributed across tools, show me what matters now, explain why, prepare the safest next action, and preserve the evidence so I can grow the business without relying on memory.

## 4. Existing project context

### 4.1 Analysis source

- IDE-based inspection of the current Next.js/TypeScript/Supabase/Vercel repository.
- `docs/prd/epic-6-independent-realtor-operating-system.md`.
- `docs/prd/realtor-requirements-coverage.md`.
- `docs/prd/requirements-analysis-v2.md`.
- `docs/prd/omnix-product-expansion.md`.
- Stories 4.1–4.4, 5.1, 5.2, and 6.1 plus their recorded QA and UAT boundaries.
- Florida Realtors, NAR, RESO, HUD, FTC, and official provider documentation cited in the product research.

### 4.2 Current product foundation to preserve

- Workspace-scoped owner/assistant authority and RLS.
- Contact import, identity resolution, deduplication, classification, notes, important dates, pipeline, and follow-up cadence.
- Today, Alerts, Activities, Approvals, Nurture, Transactions, Insights, Mailers, Data tools, Connections, and Omnix surfaces.
- Deterministic attention ordering and governed proposal/approval seams.
- Connector jobs, receipts, reconciliation, secret isolation, and provider-specific authority.
- Transaction, milestone, commission, expense, and operational-signal foundations.
- Gemini routing with minimized context, prompt-injection scanning, bounded budgets, citations, and human-confirmation boundaries.
- Responsive web and PWA foundations.

### 4.3 Current capability gaps

- Authenticated owner/assistant/mobile/PWA release evidence is incomplete.
- Provider connection health and reconciliation must be proven on real accounts rather than inferred from configuration.
- Omnix does not yet provide a complete Florida transaction and compliance cockpit.
- There is no production IDX/MLS/RESO property-data integration, saved-search behavior engine, or grounded CMA workflow.
- Affordability, insurance, tax, HOA, assessment, and monthly ownership scenarios are not modeled as a client-facing decision workflow.

## 5. Enhancement scope

### 5.1 Enhancement types

- New feature addition.
- Major feature modification.
- Integration with new systems.
- Reliability and production-readiness closure.
- Premium mobile-first UI/UX expansion.
- Governed AI and automation expansion.

### 5.2 Impact assessment

**Major impact.** The program adds property, Florida transaction guidance, affordability, and lead behavior while extending existing AI, connector, transaction, UX, data, and operational domains. The existing modular monolith remains the baseline; a service split is not part of this PRD.

## 6. Product goals

1. Make the daily priority and next action immediately understandable.
2. Preserve a cited and recoverable operational memory for every relationship.
3. Reduce manual lead handling, follow-up administration, and transaction deadline risk.
4. Support Florida-specific buyer, seller, condo, flood, affordability, and closing workflows without presenting legal, tax, insurance, lending, or appraisal advice.
5. Turn past clients and sphere relationships into a governed referral and retention engine.
6. Connect property interest and licensed listing data to people, actions, and transactions.
7. Provide premium desktop, mobile Safari, and installed-PWA experiences without feature loss.
8. Keep Judith as the canonical owner and preserve her current data and workflows throughout the rollout.
9. Preserve human control, evidence, privacy, Fair Housing safeguards, and recoverability for every AI-assisted action.

## 7. Outcome metrics

Sprint 0 must establish the production baseline and measurement contract before targets are approved. The product must observe at least:

- Time from new lead receipt to first recorded response.
- Percentage of active relationships with a valid next action.
- Overdue follow-up count and age.
- Appointment conversion by source.
- Stage conversion and stage aging.
- Transaction milestones due, completed, waived, overdue, and missing evidence.
- Closed volume, verified GCI, net commission, tracked expenses, and net income by authoritative source.
- Repeat-client and referral contribution.
- Approval acceptance, edit, rejection, expiration, and execution-failure rates.
- Provider reconciliation lag and unresolved connector incidents.
- Import reconciliation, duplicate, quarantine, and correction rates.
- Mobile/PWA task-completion and recovery success.
- AI citation, grounding, injection-resistance, timeout, budget, and deterministic-fallback results.

No numerical improvement target may be invented without a measured baseline and product-owner approval.

## 8. Functional requirements

These requirements are based on the approved four-sprint direction and the current repository authority. Each implementation story must trace to one or more requirements below.

### 8.1 Trust, identity, data, and operations

- **FR-01 — Canonical workspace authority:** Judith must be the canonical owner of her workspace; assistants and time-bounded developer support must receive only explicit capabilities. Every new workspace-owned record must remain workspace-scoped and RLS-protected.
- **FR-02 — Release truth:** Each capability must expose independent implemented, configured, connected, reconciled, UAT, and released states where applicable.
- **FR-03 — Reliable import:** Supported files must import without arbitrary row caps, preserve source facts and long-cell evidence safely, classify relationship type, lead temperature, pipeline stage, next follow-up, dates, tags, source, and review state deterministically, and produce a recoverable summary.
- **FR-04 — Identity and duplicate safety:** Import and provider intake must resolve canonical email, phone, provider ID, and external ID; ambiguous matches must enter a bounded review queue; destructive merges require preview, backup, approval, immutable receipt, and whole-plan recovery.
- **FR-05 — Persistent attention queue:** Today, Alerts, Omnix, and Approval Inbox must use one durable priority projection with explicit P0–P4 classes, SLA state, due time, aging, and FIFO tie-breaking inside equivalent priority classes.
- **FR-06 — Lifecycle control:** Authorized users must acknowledge, assign, snooze, complete, dismiss where permitted, and escalate attention items with optimistic concurrency and append-only events.
- **FR-07 — Governed scheduler:** Scheduled work must use bounded batches, leases, fencing, idempotency, retries, terminal review, receipts, quiet hours, timezone, and deterministic replay protection.
- **FR-08 — Provider health:** Google, Mailchimp, SMS, and Meta integrations must present a user-facing status, next safe action, last successful evidence, and support reference without exposing tokens, internal event names, UUIDs, raw provider payloads, or implementation jargon.

### 8.2 Omnix AI second brain

- **FR-09 — Relationship memory:** Omnix must maintain a versioned, cited, source-hashed summary of relationship facts, preferences, important dates, open commitments, inbound signals, property interests, transaction state, nurture state, and explicit unknowns.
- **FR-10 — Next Best Action:** Each active relationship may receive one current persisted recommendation with deterministic priority inputs, explanation, citations, confidence boundary, expiry, and recovery history.
- **FR-11 — Proactive daily briefing:** Omnix must proactively summarize prioritized relationships, inbound replies, overdue work, transaction risk, provider degradation, data-quality issues, and recommended drafts, with direct drill-through to exact contributing records.
- **FR-12 — Natural-language understanding:** Supported natural-language questions must route to authorized deterministic retrieval or bounded Gemini interpretation without requiring a hidden command grammar.
- **FR-13 — Governed action registry:** Omnix may propose creating tasks, changing relationship pipeline state, transitioning nurture, preparing Gmail or SMS messages, creating Calendar intents, and preparing Mailchimp campaigns only through allowlisted typed tools.
- **FR-14 — Approval authority:** External sends, bulk changes, merges, deletions, pipeline mutations, financial changes, and compliance-sensitive actions require the configured authority and an exact preview. Free-form model text is never execution authority.
- **FR-15 — Inbound communication intelligence:** With explicit provider scope and consent, Omnix may classify bounded inbound email, text, or message content for intent, urgency, sentiment category, objections, commitments, and required follow-up. Unavailable content must preserve deterministic metadata and an explicit unknown state.
- **FR-16 — AI content studio:** Omnix may prepare individualized follow-ups, listing descriptions, newsletters, social posts, postcards, market updates, review requests, and referral requests using authorized facts, brand voice, citations, Fair Housing lint, and human approval.
- **FR-17 — AI evaluation and cost control:** Every enabled model/version must pass the approved grounding, citation, privacy, temporal, injection, budget, timeout, refusal, and deterministic-fallback corpus before generative recommendations are enabled for a workspace.

### 8.3 Florida transaction operating system

- **FR-18 — Transaction cockpit:** Omnix must represent buyer, seller, listing, lease, and referral transactions separately from relationship pipeline stages and show party, property, side, status, source, responsibility, dates, documents, milestones, commission facts, and next action.
- **FR-19 — Critical dates:** Inspection, financing, appraisal, title, contingency, association, closing, and custom deadlines must originate from verified user/provider facts, retain source/version/history, and never be invented by AI.
- **FR-20 — Transaction risk:** Omnix must elevate overdue, approaching, missing-evidence, contradictory, or unassigned transaction milestones into the attention and approval systems with an explanation and safe destination.
- **FR-21 — Commission intelligence:** Verified transactions must support sale price, volume, gross commission, brokerage split, referral fee, net commission, marketing cost, other expense, and profitability fields without presenting tax or accounting conclusions.
- **FR-22 — Florida workflow packs:** Versioned, configurable checklists must support approved Florida buyer agreement, brokerage relationship, compensation, flood disclosure, condo/co-op document review, milestone inspection, SIRS/reserve, special-assessment, and closing workflows. Omnix stores status, evidence, link, version, responsible person, and acknowledgement; it does not reproduce restricted forms or provide legal advice.
- **FR-23 — Document evidence:** Transactions must support secure document metadata, provider link, required/received/reviewed status, responsible person, version, and retention evidence. Full storage and e-sign are conditional on an approved provider and architecture story.

### 8.4 Affordability and client decision support

- **FR-24 — Cost-of-ownership scenario:** Authorized users must be able to compare mortgage assumptions, estimated property taxes, homeowners/wind/flood insurance inputs, HOA/condo dues, special assessments, closing-cost inputs, maintenance assumptions, and estimated monthly ownership cost.
- **FR-25 — Explanation boundary:** Every affordability value must identify whether it is user-entered, provider-supplied, calculated, estimated, stale, or unknown. Omnix must not label estimates as lender quotes, insurance quotes, appraisals, tax advice, or guaranteed costs.
- **FR-26 — Partner handoff:** The realtor may prepare a governed referral or information request for an approved lender, insurance professional, title provider, inspector, or other vendor with client consent and an immutable receipt.

### 8.5 Property, lead acquisition, and conversion

- **FR-27 — Property domain:** Omnix must represent property/listing facts separately from contacts and transactions, including provenance, license boundary, freshness, and permitted use.
- **FR-28 — Website intake:** A workspace-bound, signed, idempotent website form must create or update the appropriate contact, record consent/source/campaign, classify the intake, and start the applicable response SLA.
- **FR-29 — MLS/IDX integration:** Omnix must support an adapter for licensed MLS/IDX data through an approved RESO-compatible or vendor API. RESO conformance does not itself grant data rights; no MLS data may be scraped or displayed without authorization.
- **FR-30 — Search behavior:** Authorized property-search events such as inquiry, repeat visit, saved search, favorite, viewed property, and requested showing may update explainable engagement signals and propose a next action without silently changing lead temperature or transaction state.
- **FR-31 — CMA workflow:** Omnix may prepare a seller/CMA intake, collect property facts, retrieve licensed comparable data where authorized, and assemble a cited draft. It must not invent comparable sales, market values, condition facts, or appraisal conclusions.
- **FR-32 — Lead attribution:** Every lead and transaction must retain source, campaign, medium, landing page/form where available, first-touch, last-touch, and conversion evidence without overwriting imported source history.
- **FR-33 — Omnichannel communication:** Contact history must reconcile approved Gmail, Calendar, SMS, Mailchimp, Meta, phone/call, note, and manual interaction evidence into a human-readable timeline with channel-specific consent and provider boundaries.
- **FR-34 — Response operations:** New leads and replies must produce an observable response timer, missed-response alert, safe communication action, ownership assignment, and reconciliation receipt.

### 8.6 Relationship growth

- **FR-35 — Nurture lifecycle:** Relationship plans must support start, pause, resume, snooze, stop, opt-out, next due step, channel, owner, citations, and versioned transitions.
- **FR-36 — Past-client lifecycle:** Omnix must support birthday, home anniversary, annual equity/CMA check-in, market update, review request, referral request, and configurable homeowner touchpoints without implying legal, tax, insurance, or maintenance advice.
- **FR-37 — Household and referral graph:** Contacts may be linked through household, spouse/partner, referrer, referred person, vendor, and transaction relationships with explicit labels and no automatic identity merge.
- **FR-38 — Consent and suppression:** Email, text, campaign, and other outreach eligibility must respect channel-specific consent, unsubscribe, STOP, suppression, quiet hours, and owner-visible evidence.

### 8.7 Premium experience and owner data controls

- **FR-39 — Premium command center:** Today must provide a high-signal visual summary, prioritized work, business pulse, transaction risk, relationship growth, connector degradation, and progressive disclosure without decorative or unsupported metrics.
- **FR-40 — Progressive disclosure:** Long lists, receipts, contributors, review queues, and technical evidence must default to compact summaries, search/filter/grouping, meaningful names, and user-safe language while preserving access to exact evidence under Advanced or Support views.
- **FR-41 — Mobile parity:** Core create, read, update, approval, recovery, communication, transaction, and search journeys must remain usable on iPhone 11 Safari and the installed PWA without layout collision, page overflow, obscured controls, or desktop-only functionality.
- **FR-42 — Owner data lifecycle:** Judith must have governed export, retention, connector revocation, recovery, and support-escalation paths. Any developer support access must be time-bounded, least-privileged, justified, and audited.

## 9. Non-functional requirements

- **NFR-01 — Security:** Secrets, refresh tokens, API keys, provider payloads, and restricted content must remain server-only, encrypted where persisted, redacted from logs and receipts, and unavailable to AI prompts except through explicit minimized adapters.
- **NFR-02 — Workspace isolation:** Every workspace-owned domain, provider transaction, webhook, AI run, export, and support operation must pass cross-workspace isolation tests for at least two workspaces.
- **NFR-03 — Authorization:** Owner, assistant, service worker, developer support, webhook, scheduler, and anonymous/public intake capabilities must be explicit, least-privileged, and tested through repository, RLS, API, and UI boundaries.
- **NFR-04 — Idempotency and concurrency:** Imports, webhooks, provider jobs, scheduler work, approvals, and transactions must be idempotent, concurrency-safe, replay-safe, and observable.
- **NFR-05 — Recoverability:** Every migration and material bulk operation must include rollback or forward repair, backup authority, rehearsal evidence, and a documented recovery decision. No destructive reset is used as a production recovery strategy.
- **NFR-06 — Reliability:** Provider and scheduler jobs require bounded retries, leases/fencing where applicable, dead-letter or review handling, reconciliation, and sanitized support references.
- **NFR-07 — Performance:** The target 200–500-contact workspace must remain responsive without unnecessary distributed infrastructure. Large lists must be server-bounded or progressively disclosed; performance baselines and budgets are recorded during Sprint 0.
- **NFR-08 — Accessibility:** Critical journeys must pass keyboard-only navigation, visible focus, semantic labeling, reduced motion, 200% zoom, screen-reader checks, safe-area handling, and effective 44×44 mobile targets.
- **NFR-09 — Responsive design:** Authenticated routes must be validated at 390, 768, and 1440 CSS pixels. iPhone 11 Safari and installed-PWA UAT are mandatory release evidence.
- **NFR-10 — Premium UX:** New surfaces must use the existing Omnix design tokens, restrained motion, meaningful visual hierarchy, clear feedback, skeleton/empty/error/recovery states, and user-facing language. Internal identifiers and raw technical state remain outside ordinary user views.
- **NFR-11 — AI governance:** Model calls require minimized context, prompt-injection scanning, allowlisted tools, hard run and cost limits, versioned policy/model metadata, citations, uncertainty, deterministic fallback, and redacted observability.
- **NFR-12 — Fair Housing and communications compliance:** AI, search, segmentation, advertising, and outreach must include policy controls for Fair Housing, consent, suppression, CAN-SPAM, DNC/TCPA-related operating rules where applicable, and qualified legal review before production activation.
- **NFR-13 — Data provenance:** Market, property, transaction, financial, client, and AI-derived facts must retain authority, source, observed-at/as-of time, freshness, and confidence or explicit unknown state.
- **NFR-14 — Provider truth:** A configured credential or successful OAuth callback is not proof of complete capability. Real-account mutation, negative path, reconciliation, disconnect/revocation, and receipt evidence are required for operational status.
- **NFR-15 — Observability:** Production must provide redacted structured logs, correlation/support references, health summaries, job and reconciliation metrics, error categories, runbooks, and alert ownership without exposing PII or secrets.
- **NFR-16 — Quality gates:** Each sprint release candidate must pass lint, typecheck, unit/integration tests, build, migration replay, applicable SQL/RLS tests, browser/accessibility checks, authenticated role UAT, provider evidence, and rollback validation.
- **NFR-17 — Backward compatibility:** Schema changes must be additive or migration-backed; current Judith contacts, history, approvals, provider evidence, and supported routes must remain intact.
- **NFR-18 — Privacy:** Data collection, retention, export, AI processing, communication analysis, and vendor subprocessors require documented purpose, minimum necessary data, owner controls, and reviewed public disclosures.
- **NFR-19 — English repository standard:** Product code, migrations, comments, tests, commit messages, PR content, and repository documentation created by this program must be written in English.

## 10. Compatibility requirements

- **CR-01 — API compatibility:** Existing authenticated routes, connector callbacks, worker routes, intake contracts, and CLI operations must remain compatible or receive an explicit versioned migration path.
- **CR-02 — Database compatibility:** Existing workspace, contact, activity, task, connector, approval, nurture, transaction, and evidence records must remain valid after additive migrations.
- **CR-03 — UX consistency:** New screens must use the existing Omnix navigation, design tokens, responsive patterns, user-friendly terminology, and progressive-disclosure conventions.
- **CR-04 — Integration compatibility:** Existing Google, Mailchimp, Twilio, Meta, Supabase, Vercel, and Gemini configurations must fail closed when incomplete and must not be silently replaced by a new provider.
- **CR-05 — Judith continuity:** Judith remains the canonical owner; her current CRM data and supported workflows must remain usable throughout staged rollout and rollback.
- **CR-06 — Assistant continuity:** Assistant access must remain explicitly scoped and must never gain connector-secret, ownership-transfer, or unrestricted AI authority through a migration or UI regression.
- **CR-07 — PWA compatibility:** Updates must not create a stale service-worker shell, blocked sign-in, missing recovery path, or an unrecoverable installed application.
- **CR-08 — Evidence compatibility:** Existing append-only activity, receipt, approval, and migration evidence must remain queryable and must not be rewritten to claim a stronger state than was originally proven.

## 11. Scope boundaries

### 11.1 Included in the four-sprint program

- Current production-readiness and UAT closure.
- Governed AI second-brain completion.
- Florida transaction, deadline, affordability, and relationship-growth workflows.
- Property-domain and licensed IDX/RESO adapter foundation.
- Premium desktop/mobile/PWA UX for all added workflows.

### 11.2 Conditional on external authority

- Live MLS/IDX data and display rights.
- Google restricted-scope verification.
- SMS sender/carrier registration and legal review.
- Meta Business Verification and App Review.
- E-sign, showing, insurance, lender, title, and other provider partnerships.

### 11.3 Explicitly out of scope

- Unlicensed MLS, portal, social, public-record, or competitor scraping.
- Autonomous client-facing sends or financial mutations without approval.
- Legal, tax, insurance, mortgage, appraisal, escrow, or accounting advice.
- Reproducing copyrighted or licensed real-estate forms without permission.
- Invented market values, comparables, insurance costs, tax amounts, deadlines, commissions, probabilities, testimonials, or performance claims.
- White-label branding, custom domains, commercial tenant onboarding, entitlements, subscriptions, billing, pricing, checkout, invoices, trials, and paid-plan enforcement. These belong to a future project created from a separate copy of Omnix.
- A microservice rewrite, generic workflow language, native iOS application, or replacement of authorized specialist provider systems within this four-sprint program.

## 12. User interface enhancement goals

### 12.1 Integration with the existing UI

New workflows must extend the current Omnix shell and design-token system. The product must preserve recognizable navigation, typography, color semantics, responsive behavior, and action patterns while replacing technical or developer-oriented language with realtor-oriented outcomes. New information density must use hierarchy and progressive disclosure rather than smaller text or unbounded lists.

### 12.2 Modified and new views

- **Today:** proactive briefing, business pulse, prioritized relationships, transaction risk, relationship growth, and connector degradation.
- **Omnix:** natural-language workspace, cited answers, recommendation detail, action preview, and recovery states.
- **Approvals:** grouped priority inbox with exact impact, evidence, edit, approve, reject, expiry, and execution result.
- **Contacts:** relationship memory, property interests, household/referral links, inbound intelligence, consent, and next-best action.
- **Transactions:** deal cockpit, critical dates, document evidence, Florida workflow packs, commission intelligence, and affordability scenarios.
- **Properties:** licensed property facts, provenance, search behavior, saved interest, showing intent, and CMA intake.
- **Connections:** user-facing status and recovery first; technical receipts only under Advanced or Support.
- **Insights:** source conversion, relationship growth, transaction performance, operational health, and drill-through contributors.
- **Settings:** AI privacy/capability controls, communication policies, timezone, quiet hours, data export, and recovery.

### 12.3 UX consistency requirements

- Every primary task must provide a clear starting point, progress state, success state, failure explanation, and safe recovery action.
- Cards, charts, animations, and premium visual treatments must communicate authoritative information rather than decorate empty states.
- Long lists require grouping, totals, search/filter, progressive disclosure, and meaningful entity names.
- Dates, currency, addresses, names, status labels, and provider health must reflow without overlap at 390, 768, and 1440 CSS pixels.
- Motion must be restrained, interruptible, and disabled by `prefers-reduced-motion`.
- Ordinary users must not see UUIDs, raw event keys, database columns, connector grammar, or internal deployment terminology.
- Desktop and mobile must preserve functional parity for the critical journey, while allowing different information density.

## 13. Technical constraints and integration requirements

### 13.1 Existing stack

**Languages:** TypeScript and SQL.
**Frameworks:** Next.js 15 App Router, React, Tailwind CSS v4.
**Database and auth:** Supabase Postgres, Auth, RLS, SQL migrations, typed repository boundaries.
**Infrastructure:** Vercel application hosting and bounded scheduled route wake-ups.
**External dependencies:** Google Workspace, Mailchimp, Gemini, optional Twilio, optional Meta, and a future licensed IDX/MLS provider.

### 13.2 Integration approach

- **CLI first:** every new domain operation, migration, reconciliation, evaluation, and recovery command must be executable and testable before its UI control is considered complete.
- **Database:** additive workspace-scoped schemas, composite authority, RLS, append-only evidence where required, idempotent RPCs, paired rollback/forward repair, and transactional SQL tests.
- **Application:** extend current domain/application/repository seams; free-form assistant output cannot bypass typed commands.
- **Providers:** fixed allowlisted endpoints and capabilities, encrypted server-only credentials, signed callbacks/webhooks, durable jobs, receipts, reconciliation, and explicit disconnect/revocation behavior.
- **Frontend:** server-rendered read surfaces where practical, URL-backed filters, bounded result sets, reusable Omnix design primitives, accessible forms, and no new global state framework without demonstrated need.
- **Testing:** pure domain tests, application/repository tests, SQL/RLS tests, route/component tests, browser/accessibility checks, authenticated UAT, provider negative paths, and recovery rehearsal.

### 13.3 Deployment and operations

- Preserve the modular monolith; no service split is admitted by this PRD.
- Deploy one sprint increment at a time behind additive schema and capability gates.
- Do not promote a sprint when its exit gate is incomplete; later sprint code may remain disabled in Preview.
- Production configuration changes, migration promotion, push, release, and rollback remain under @devops authority.
- Redacted observability must identify failing capability, affected workspace, correlation/support reference, retry/review state, and responsible runbook.

### 13.4 Architecture risk controls

- Provider availability cannot become CRM availability.
- MLS/IDX data is not ingested or displayed before data rights and retention/display rules are recorded.
- Florida workflows require version, effective date, source link, and owner acknowledgement.
- AI output remains a proposal or cited answer, never an untyped command.
- Import, financial, transaction, and provider mutations require exact authority and recovery behavior.
- Sprint capacity must include remediation discovered through authenticated UAT.

## 14. Four-sprint delivery plan and proposed story structure

Each work item is classified as:

- **Committed:** fully controlled by the project and required for the sprint exit gate.
- **Conditional:** implementation can be completed, but live activation depends on external authority.
- **Deferred activation:** intentionally disabled until a later external decision or approval; it cannot block the committed core.

### Sprint 0 — Production trust and operational closure

**Goal:** Judith and the assistant can use the current CRM safely before scope expands.

1. **S0.1 — Migration and release authority closure (Committed):** reconcile local/remote migrations, preserve rollback/forward repair, verify production configuration, and record deployment truth.
2. **S0.2 — Import, classification, and duplicate recovery (Committed):** validate representative CSV/XLSX/Numbers-derived data, long cells, automatic stage/temperature/follow-up mapping, summary discovery, quarantine, merge preview, and restoration.
3. **S0.3 — Google and Mailchimp operational reconciliation (Committed/Conditional):** prove authorized Gmail draft/send and Calendar lifecycle, Mailchimp baseline/webhook/reconciliation, negative paths, disconnect, and user-safe health. Provider verification outside project control remains Conditional.
4. **S0.4 — Owner/assistant authority UAT (Committed):** verify Judith as owner, assistant capability matrix, settings authority, AI capability controls, and cross-workspace isolation.
5. **S0.5 — Premium mobile/PWA closure (Committed):** validate critical routes at 390/768/1440, iPhone 11 Safari, installed PWA, safe areas, theme controls, overlays, search, forms, and recovery states.
6. **S0.6 — Production observability and recovery (Committed):** finalize redacted support references, runbooks, backup/restore evidence, rollback decision, and incident ownership.

**Exit gate:** no open P0 defect on authentication, import, contacts, tasks, pipeline, Google, Mailchimp, owner/assistant authority, mobile critical path, persistence, or recovery. All mandatory quality commands and authenticated UAT pass.

### Sprint 1 — Florida transaction and affordability operating system

**Goal:** manage a Florida deal and its client decision context from verified facts.

1. **S1.1 — Transaction cockpit expansion (Committed):** buyer, seller, listing, lease, and referral transaction views with parties, property, responsibility, stage, next action, and evidence.
2. **S1.2 — Critical dates and transaction risk (Committed):** inspection, financing, appraisal, title, contingency, association, closing, and custom milestone lifecycle with priority integration.
3. **S1.3 — Commission and profitability intelligence (Committed):** verified volume, GCI, split, referral fee, net commission, marketing cost, other expense, forecast, and drill-through reconciliation.
4. **S1.4 — Florida workflow packs (Committed):** versioned buyer-agreement, brokerage/compensation, flood, condo/co-op, milestone inspection, SIRS/reserve, special-assessment, and closing checklists with legal boundaries.
5. **S1.5 — Affordability studio (Committed):** user/provider/calculated input classification, mortgage/tax/insurance/HOA/assessment scenarios, property comparison, and governed partner handoff.
6. **S1.6 — Transaction UX and UAT (Committed):** premium responsive views, compact mobile action model, accessibility, representative buyer/seller/condo scenarios, error recovery, and no invented facts.

**Exit gate:** representative Florida transaction scenarios reconcile from exact facts; every deadline and financial metric drills through; workflow packs identify source/version; affordability labels estimates; desktop/mobile/PWA tests pass.

### Sprint 2 — Omnix second brain and relationship growth

**Goal:** Omnix proactively organizes relationships and prepares governed work.

1. **S2.1 — Relationship memory and Next Best Action (Committed):** versioned cited memory, one current recommendation, deterministic priority inputs, expiry, history, and explicit unknowns.
2. **S2.2 — Natural-language Omnix and model evaluation (Committed):** conversational routing, grounded answers, exact-model corpus, cost/run limits, prompt guard, citations, deterministic fallback, and owner capability controls.
3. **S2.3 — Inbound response intelligence (Committed/Conditional):** classify authorized bounded email/message content, preserve metadata fallback, create reply urgency signals, and respect provider scopes.
4. **S2.4 — Governed action and Approval Inbox completion (Committed):** typed task, pipeline, nurture, Gmail, Calendar, SMS, and Mailchimp proposals with preview, authority, receipts, edit/reject/expiry, and recovery.
5. **S2.5 — Nurture, homeowner, household, and referral lifecycle (Committed):** start/pause/resume/snooze/stop, birthdays, home anniversaries, reviews, referrals, annual check-ins, consent, and suppression.
6. **S2.6 — Proactive Today command center (Committed):** prioritized briefing, transaction risk, inbound replies, relationship growth, connection degradation, business pulse, contributor drill-through, and restrained motion.

**Exit gate:** model evaluation and injection corpus pass; no model can execute untyped authority; all recommendations cite records; owner and assistant UAT pass; provider-dependent content gracefully degrades; critical journeys pass mobile/PWA and accessibility gates.

### Sprint 3 — Property intelligence, lead conversion, and final premium release

**Goal:** connect people, property interest, lead acquisition, and response operations without unlicensed data use.

1. **S3.1 — Property and listing bounded context (Committed):** provenance-aware property facts, contact interests, transaction links, freshness, permitted-use state, and workspace authority.
2. **S3.2 — Website lead intake and attribution (Committed):** signed idempotent forms, consent/source/campaign capture, automatic classification, duplicate resolution, response SLA, and recovery.
3. **S3.3 — Licensed IDX/RESO adapter (Committed foundation; Conditional live data):** provider-neutral contract, cursor/reconciliation behavior, display/retention rules, freshness, attribution, and fail-closed disabled state until licensed credentials exist.
4. **S3.4 — Property behavior and grounded CMA workflow (Committed foundation; Conditional comparables):** inquiries, repeat visits, saved interests, favorites, showing intent, seller intake, authorized comparable retrieval, citations, and no invented valuation.
5. **S3.5 — Omnichannel timeline and conversion intelligence (Committed/Conditional):** human-readable communication evidence, response timers, source conversion, stage aging, and provider-aware consent across enabled channels.
6. **S3.6 — Final premium system audit and release UAT (Committed):** route-by-route desktop/mobile/PWA UX, accessibility, performance, security, data provenance, rollback, owner/assistant, provider truth, and production smoke evidence.

**Exit gate:** property and intake foundations operate without licensed data; live IDX/CMA activates only with recorded authority; no critical UX/security/data defect remains; the complete Judith and assistant journey passes production UAT and recovery rehearsal.

## 15. Story acceptance contracts

The Scrum Master must preserve these minimum contracts when creating executable story files. Story acceptance criteria may become more specific but may not weaken these outcomes, remove recovery evidence, or redefine a Conditional capability as operational.

### 15.1 Sprint 0 acceptance contracts

| Work item | Minimum acceptance criteria | Integration verification |
|---|---|---|
| S0.1 Migration and release authority | Local and remote migration histories reconcile; every new migration has replay, rollback or forward repair, and SQL/RLS evidence; production configuration is validated without exposing secrets; deployment state is recorded separately from test state. | Existing contacts, history, tasks, approvals, transactions, and connector evidence remain queryable after migration and recovery rehearsal. |
| S0.2 Import and duplicate recovery | Representative CSV, XLSX, vCard, and supported workbook paths parse within documented safety limits; long cells are preserved or quarantined with a user-safe explanation; relationship, lead type, pipeline, dates, source, tags, and next action map deterministically; summary, review queue, duplicate preview, and whole-plan recovery are discoverable. | Reimport and overlapping provider intake are idempotent; manually edited contacts are not silently overwritten; pipeline and Today use the imported canonical values. |
| S0.3 Google and Mailchimp reconciliation | Gmail draft/send and Calendar create/update/delete paths either produce provider receipts or an exact user-safe recovery state; Mailchimp baseline, selected audience, tag parity, unsubscribe protection, signed webhook, bounded reconciliation, and disconnect evidence are verified where provider authority exists. | A successful OAuth callback alone cannot show operational status; revoked, expired, insufficient-scope, duplicate-webhook, stale-event, and provider-timeout paths preserve CRM data and surface the next safe action. |
| S0.4 Owner/assistant UAT | Judith is the canonical owner; the assistant can perform only approved work; protected settings, connector administration, ownership, AI capabilities, and sensitive recovery remain owner-only; cross-workspace reads and writes fail closed. | Repository, RLS, API, UI, and authenticated browser evidence agree on the same role matrix; re-login preserves authority and persisted state. |
| S0.5 Mobile/PWA closure | Critical routes pass at 390, 768, and 1440 CSS pixels; iPhone 11 Safari and installed PWA support sign-in, search, contact lookup, task completion, approval, transaction review, communication preparation, offline/reconnect recovery, theme controls, and logout without collision or page overflow. | Desktop and mobile use the same application commands and persisted facts; service-worker updates cannot trap the user on an obsolete or broken shell. |
| S0.6 Observability and recovery | Redacted logs and health surfaces expose category, time, capability, support reference, retry/review state, and runbook ownership; backup and restore are rehearsed; rollback decisions and uncertain provider outcomes are documented. | No receipt, log, alert, support view, or browser error exposes tokens, secrets, raw restricted content, or unnecessary PII. |

### 15.2 Sprint 1 acceptance contracts

| Work item | Minimum acceptance criteria | Integration verification |
|---|---|---|
| S1.1 Transaction cockpit | Buyer, seller, listing, lease, and referral transactions remain separate from contact pipeline stages; parties, side, property, owner, status, source, next action, documents, milestones, and history are visible and editable through authorized commands. | Existing transaction and contact records remain valid; a transaction change cannot silently rewrite relationship status or financial truth. |
| S1.2 Critical dates and risk | Verified inspection, financing, appraisal, title, contingency, association, closing, and custom dates retain source, version, responsibility, state, and history; approaching, overdue, contradictory, and unassigned dates create explainable attention items. | Today, Alerts, Approvals, contact, and transaction views resolve to the same canonical milestone and lifecycle state without duplicate obligations. |
| S1.3 Commission intelligence | Sale price, volume, gross commission, split, referral fee, net commission, marketing cost, other expense, and profitability accept only bounded non-negative authoritative inputs; metrics identify period and source and drill through to exact transactions. | Closed, active, cancelled, and missing-data scenarios reconcile; forecasts are visually and semantically distinct from closed/booked amounts. |
| S1.4 Florida workflow packs | Each workflow pack identifies version, effective date, source link, responsible person, required evidence, acknowledgement, completion state, and legal boundary; outdated or unreviewed packs cannot present as current. | Buyer, seller, condo/co-op, flood, association, and closing scenarios retain history across updates; no restricted form is copied into Omnix without documented permission. |
| S1.5 Affordability studio | Mortgage, tax, insurance, HOA/condo, assessment, maintenance, and closing-cost inputs identify authority and freshness; scenarios calculate reproducibly; unknowns remain unknown; comparisons never present estimates as quotes or guarantees. | Property, contact, and transaction links are optional and authorized; partner handoffs require consent, exact preview, and receipt. |
| S1.6 Transaction UX and UAT | Representative buyer, seller, condo, and failed/missing-data journeys pass desktop, mobile, PWA, keyboard, zoom, screen-reader, reduced-motion, and recovery checks; financial and deadline contributors remain understandable without opening raw evidence. | No P0/P1 transaction, accessibility, layout, data-integrity, or recovery defect remains at sprint exit. |

### 15.3 Sprint 2 acceptance contracts

| Work item | Minimum acceptance criteria | Integration verification |
|---|---|---|
| S2.1 Relationship memory and NBA | Memory is versioned, source-hashed, cited, recoverable, and explicit about unknowns; each active contact has at most one current Next Best Action with deterministic priority inputs, explanation, expiry, and history. | Changed source facts invalidate or refresh stale memory and recommendations; manual edits are retained as evidence and are not overwritten by model output. |
| S2.2 Natural-language Omnix and evaluation | Natural-language requests route to authorized retrieval or bounded model interpretation; outputs cite records and as-of time; exact configured model/version passes grounding, temporal, privacy, injection, budget, timeout, refusal, and fallback cases before activation. | Model failure, missing configuration, budget exhaustion, and unsafe prompts retain deterministic CRM functionality and cannot execute actions. |
| S2.3 Inbound response intelligence | Only explicitly authorized bounded content is processed; untrusted content is guard-scanned; intent, urgency, sentiment category, objection, commitment, summary, citations, model/policy version, and unknown state are bounded and recoverable. | Missing or revoked provider scope degrades to metadata without losing the inbound event; attachments and unnecessary raw content never enter the model by default. |
| S2.4 Governed actions and approvals | Typed task, pipeline, nurture, Gmail, Calendar, SMS, and Mailchimp proposals persist exact input, impact, citations, version, authority, expiry, and recovery state; owner/assistant permissions govern edit, approve, reject, and execute. | Replay, concurrent approval, provider uncertainty, expired proposal, stale source, failed execution, and reconciliation paths cannot duplicate or mislabel an action. |
| S2.5 Relationship growth lifecycle | Nurture supports start, pause, resume, snooze, stop, opt-out, exact next step, channel, owner, and history; birthdays, anniversaries, reviews, referrals, annual check-ins, household links, and channel suppression remain explicit. | Scheduler materialization is idempotent and proposal-only; unsubscribe, STOP, quiet hours, and manual pause prevent prohibited outreach. |
| S2.6 Proactive Today command center | Today shows prioritized relationships, approvals, replies, deadlines, relationship growth, provider degradation, business pulse, unknowns, and exact contributors through bounded progressive disclosure and safe actions. | Counts, charts, labels, and recommendations resolve to authoritative records; motion is restrained and reduced-motion safe; no decorative or invented business metric appears. |

### 15.4 Sprint 3 acceptance contracts

| Work item | Minimum acceptance criteria | Integration verification |
|---|---|---|
| S3.1 Property and listing domain | Property facts retain workspace, provenance, license/permitted-use state, freshness, address identity, contact interests, and transaction links without becoming contact identity or transaction authority. | Manual and licensed-provider facts coexist through explicit authority rules; stale or revoked licensed data stops displaying where required without deleting CRM relationship history. |
| S3.2 Website intake and attribution | Signed, rate-bounded, workspace-bound, idempotent forms validate and normalize data, capture consent/source/campaign, resolve identity, classify the lead, create response attention, and return safe outcomes without leaking internal authority. | Duplicate submissions, replay, invalid signature, oversized payload, conflicting identity, and unavailable downstream provider paths preserve evidence and avoid duplicate contacts. |
| S3.3 Licensed IDX/RESO adapter | Provider contract defines authorization, schema mapping, pagination/cursor, freshness, attribution, display, retention, deletion, reconciliation, and disabled behavior; no live data is fetched or displayed before rights are recorded. | Adapter fixtures and negative paths pass without credentials; live UAT is Conditional and cannot block property/manual CRM operation. |
| S3.4 Property behavior and CMA | Authorized inquiries, saved interests, favorites, repeat views, and showing requests produce cited engagement signals and proposed actions; CMA intake and comparable retrieval identify data source, time, selection criteria, and uncertainty. | Behavior does not silently change lead temperature, pipeline, or transaction state; unavailable licensed comparables produce an explicit blocked/unknown result, never an invented valuation. |
| S3.5 Omnichannel and conversion intelligence | Enabled channel evidence appears in a human-readable timeline with consent and provider state; response timers, source attribution, conversion, and stage aging link to exact events and contacts. | Disabled or blocked channels remain absent or visibly unavailable without reducing core timeline integrity; provider duplicates reconcile once. |
| S3.6 Final premium audit and release UAT | Every authenticated route passes owner/assistant, desktop/mobile/PWA, accessibility, console, performance-budget, security, privacy, provenance, error/recovery, and production-smoke matrices; external capability states match evidence. | Final release is blocked by any open P0/P1 core defect, failed recovery rehearsal, unresolved cross-workspace exposure, unsupported readiness claim, or broken Judith critical journey. |

## 16. Sprint governance and Definition of Done

### 16.1 Sprint operating rules

- A sprint may contain parallel stories, but its exit gate is serial and cannot be waived by starting the next sprint.
- Sprint planning must reserve explicit capacity for authenticated UAT findings, regression repair, migration recovery, and provider negative paths; the sprint cannot be planned entirely with net-new feature work.
- Conditional provider work must have a complete disabled/fail-closed state and fixture evidence before it can be considered code-complete.
- A story is not implementation-ready until @sm creates it, @po validates traceability and scope, @architect reviews cross-cutting impact where required, and @qa confirms testability.
- Schema/data stories require @data-engineer review; release, migration promotion, push, rollback, and production configuration remain @devops authority.
- Existing dirty-worktree changes and open stories must be reconciled rather than overwritten or silently absorbed into this program.

### 16.2 Story Definition of Done

Every implementation story must satisfy all applicable items:

1. Traces to PRD FR/NFR/CR identifiers and one sprint exit gate.
2. Provides CLI/application-service proof before UI completion.
3. Includes explicit authority, privacy, error, empty, loading, stale, conflict, retry, and recovery behavior.
4. Uses additive migrations with replay, RLS, rollback or forward repair, and transactional SQL tests where data changes.
5. Passes `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from `packages/crm`.
6. Passes focused unit, application, repository, route, component, and regression tests proportional to risk.
7. Passes applicable 390/768/1440, iPhone 11 Safari, installed-PWA, keyboard, zoom, screen-reader, reduced-motion, and browser-console evidence.
8. Preserves Judith owner and assistant boundaries and includes cross-workspace negative tests where workspace data changes.
9. Produces redacted observability, support reference, and runbook/recovery evidence for background/provider operations.
10. Updates the story checklist, Dev Agent Record, File List, QA Results, architecture/operations documentation, and release evidence without overstating status.
11. Leaves no open CRITICAL/HIGH security or data-integrity finding and no P0/P1 defect on the story's critical path.
12. Receives an independent @qa verdict before sprint exit and a @devops release decision before production promotion.

### 16.3 Sprint release evidence package

Each sprint must preserve:

- Exact commit and deployment identifiers.
- Migration list and remote adoption evidence.
- Rollback/forward-repair and recovery rehearsal result.
- Quality-command outputs and focused test inventory.
- Owner/assistant authenticated UAT matrix.
- Desktop/mobile/PWA/accessibility evidence.
- Provider capability and negative-path evidence.
- Open-risk and Conditional dependency register.
- Sanitized production smoke and observability references.
- Final release decision stating what is implemented, operational, Conditional, and not released.

## 17. Risk register

| Risk | Severity | Control | Release consequence |
|---|---|---|---|
| Current operational defects contaminate expansion | Critical | Sprint 0 exit gate and regression matrix | Sprint 1 promotion blocked. |
| Four-sprint scope exceeds available capacity | High | Story sizing, explicit remediation capacity, Conditional boundaries, no added white-label scope | Lower-priority story remains disabled; exit gate is not weakened. |
| Provider approval or credential delay | High | Parallel dependency owner, fixtures, fail-closed state, reconciliation contract | Capability remains Conditional; core release may continue if unaffected. |
| Unlicensed or misused MLS data | Critical | Recorded license/permitted-use authority, adapter gate, retention/display controls | Live IDX/CMA activation blocked. |
| Outdated Florida workflow guidance | Critical | Source, version, effective date, legal review, expiry/disable control | Affected workflow pack remains disabled. |
| AI hallucination, injection, or unauthorized action | Critical | Minimized context, prompt guard, citations, typed tools, approval, model corpus, fallback | Generative capability disabled; deterministic core continues. |
| Cross-workspace or role data exposure | Critical | RLS/repository/API/UI negative tests and least privilege | Production promotion blocked. |
| Financial or affordability estimate presented as fact | High | Authority labels, source drill-through, forecast/estimate semantics, fixtures | Affected metric/workflow blocked. |
| Mobile/PWA regression blocks Judith | High | Physical-device UAT, service-worker recovery, viewport matrix | Sprint exit blocked for affected critical journey. |
| UAT reveals late defects | High | Reserved remediation capacity and no feature-only sprint planning | Sprint remains open until critical findings close. |
| Background jobs duplicate or lose work | High | Idempotency, leases/fencing, retries, reconciliation, receipts | Automation remains disabled until recovery proof passes. |
| Sensitive content enters logs or model context | Critical | Data minimization, redaction, retention control, security tests | AI/provider capability and release blocked. |

## 18. Product validation summary

### 18.1 PM checklist result

| Category | Status | Remaining boundary |
|---|---|---|
| Problem definition and context | PASS | None. |
| Scope and prioritization | PASS | Execution sizing belongs to story planning. |
| User experience requirements | PASS | Detailed wireframes are story-level artifacts, not a PRD blocker. |
| Functional requirements | PASS | Each story must retain traceability. |
| Non-functional requirements | PASS | Performance baselines are established in Sprint 0 rather than invented. |
| Epic and story structure | PASS | @sm must produce executable story files. |
| Technical guidance | PASS | Detailed schema design remains @data-engineer authority. |
| Cross-functional requirements | PASS | External dependencies remain Conditional. |
| Clarity and communication | PASS | Repository artifact is English-only and versioned. |

### 18.2 QA advisory review

**Verdict:** PASS FOR STORY BREAKDOWN, NOT YET READY FOR IMPLEMENTATION.

The PRD is testable, evidence-bounded, incremental, recoverable, and explicit about external dependencies. Implementation remains blocked until executable stories contain exact acceptance criteria, owners, dependencies, file plans, migration plans, test designs, and rollback obligations derived from this document.

### 18.3 Architecture review

The four-sprint program is compatible with the existing modular monolith when delivered additively through current domain/application/repository, connector-job, approval, scheduler, and Supabase authority seams. No microservice split, native application, unlicensed data path, or generic autonomous-agent executor is admitted.

## 19. External dependency register

| Dependency | Program treatment | Safe state while unavailable |
|---|---|---|
| Google restricted scopes or verification | Conditional | Deterministic CRM and already authorized capabilities remain available; status shows exact owner action. |
| Mailchimp real audience lifecycle | Conditional but required for Mailchimp operational claim | CRM data remains canonical; no false sync-complete status. |
| SMS sender/carrier registration | Conditional | Device/manual actions and consent records remain available; automated send stays disabled. |
| Meta Business/App Review | Conditional | Social source and manual intake remain available; messaging stays disabled. |
| MLS/IDX license and vendor | Conditional | Property domain and manual facts remain available; licensed search/display stays disabled. |
| Legal review of Florida workflow packs | Required before production workflow activation | Draft packs remain disabled and clearly non-authoritative. |
| Lender, insurance, title, showing, or e-sign provider | Deferred activation | Store governed metadata/link/manual handoff only. |

## 20. Change log

| Date | Version | Change | Author |
|---|---:|---|---|
| 2026-08-31 | 0.1.0 | Created the approved four-sprint brownfield PRD context, functional requirements, non-functional requirements, compatibility requirements, and scope boundaries. | @pm |
| 2026-08-31 | 0.2.0 | Removed white-label, custom-domain, entitlement, billing, and commercial-onboarding scope; added premium UI goals, technical constraints, external dependency controls, and a four-sprint story structure focused on the Judith Omnix product. | @pm + @architect |
| 2026-08-31 | 1.0.0 | Added story-level acceptance contracts, sprint governance, Definition of Done, release evidence, risk register, PM validation, QA advisory review, and architecture review; marked the PRD ready for story breakdown. | @pm + @architect + @qa |
