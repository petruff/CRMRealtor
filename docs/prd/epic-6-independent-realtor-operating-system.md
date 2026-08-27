# Epic 6 — Omnix Independent Realtor Operating System

**Date:** 2026-08-20  
**Owner:** @pm (Janus)  
**Status:** Proposed program epic — ready for Architecture impact analysis and SM story breakdown  
**Source of truth:** `docs/audits/2026-08-20-independent-realtor-journey-ui-ux-audit.md`  
**Related roadmaps:** `omnix-product-expansion.md`, `omnix-crm-parity-roadmap.md`, `realtor-requirements-coverage.md`  
**Delivery model:** brownfield, additive, story-driven, evidence-gated

## Product decision

Evolve Omnix from an evidence-led relationship CRM into a complete operating workspace for an independent realtor and authorized assistant. The program must preserve the existing contact, triage, provenance, workspace, RLS and fail-closed connector foundations while adding the missing operational layers in a controlled sequence.

This program does not redefine an unfinished or provider-blocked capability as complete. Existing story and QA statuses remain authoritative. A local implementation, configured credential, deployment, or passing unit suite is not equivalent to real-user/provider UAT.

## Why this program exists

The current product is strong at answering **who needs attention and why**, but it does not yet cover the complete independent-realtor operating loop:

1. activate the realtor and assistant safely;
2. migrate and reconcile the real book of business;
3. work the daily relationship queue from desktop or phone;
4. receive governed notifications before work becomes overdue;
5. communicate and reconcile activity across approved providers;
6. manage properties, showings, offers, contracts and closing milestones;
7. record commission, expenses and business performance from authoritative facts;
8. maintain past-client, referral and post-closing relationships;
9. use AI only with cited context, approval and receipts.

## Target users and jobs

### Primary user

Independent realtor managing approximately 200–500 contacts and working mainly on a laptop with occasional phone use for quick lookup and follow-up.

### Secondary user

Authorized assistant operating inside the same workspace, subject to explicit role and permission boundaries.

### Primary job to be done

> When contacts, appointments, messages and transactions are distributed across tools, help me understand what needs attention, complete the next action, and retain the evidence so I can operate the business without depending on memory.

## Evidence baseline — do not rewrite these statuses

The story files and QA gates remain the status authority. This roadmap only sequences them.

### Existing completed foundation

- Stories 1.1–1.5, 2.1–2.3, 3.0–3.6, 3.8, 3.11 and 3.12 are `Done` in their story files.
- Story 3.20 has a PASS base and visual-remediation gate but remains `InReview` after later amendments.
- Existing strengths include contacts, triage, activities, pipeline, deterministic alerts, mailers, workspace authority, data portability, connector job foundations and grounded deterministic Omnix behavior.

### Existing work that must be closed, not duplicated

| Story | Current story status | Current gate/evidence boundary | Program treatment |
|---|---|---|---|
| 3.7 First-Class Contact Migration | InProgress | Real Judith reconciliation remains open | Finish in Wave 0 |
| 3.10 Today Calm Timeline Studio | InReview | Await final closure | Finish in Wave 0 |
| 3.13 Today Premium Restoration | InProgress | QA gate FAIL | Remediate and re-review in Wave 0 |
| 3.14–3.19 Omnix/AI/Judith controls | InReview | UAT and review boundaries remain | Close without duplicating scope in Waves 0–2 |
| 3.15 Reversible Deduplication | InProgress | Apply/reverse proof incomplete | Finish in Wave 0 before broad imports |
| 3.20 Client Segregation | InReview | Existing gates PASS; story closure pending | Finish in Wave 0 |
| 3.21 Airtable Editorial Product System | InProgress | QA gate FAIL | Remediate keyboard/reflow/state evidence in Wave 0 |
| 3.9 Insights Density | InReview | Review not closed | Close in Wave 0; extend only through later dashboard story |
| 4.1 Mailchimp | InProgress | QA gate FAIL; real lifecycle UAT missing | Finish in Wave 2 |
| 4.2 Google Email/Calendar | InProgress | QA gate FAIL; real lifecycle UAT missing | Finish in Wave 2 |
| 4.3 Compliant Texting | InProgress | External registration/compliance gate | Continue conditionally in Wave 2 |
| 4.4 Meta Intake/Messaging | InProgress | Business/App Review and asset gates | Continue conditionally in Wave 2 |
| 5.1 Governed AI & Nurturing | Draft | Requires approved outbound connector | Sequence after Wave 2 |

## Requirement catalog

Every new story produced from this epic must trace its acceptance criteria to one or more requirements below and to the cited evidence source.

### Functional requirements

| ID | Requirement | Source |
|---|---|---|
| ROS-FR-01 | The realtor and authorized assistant can complete the core workflow in the correct persisted workspace with explicit role boundaries. | RQ-22, RQ-24; audit P0.1 |
| ROS-FR-02 | The real 144-contact, 79-field corpus imports losslessly, preserves source facts, reports existing clients, and supports safe review/recovery. | RQ-01; Stories 3.7, 3.15; audit P0.1–2 |
| ROS-FR-03 | Critical contacts and activity journeys reflow at 390, 768 and 1440 px without page-level overflow or fixed-control collision. | RQ-16; audit P1 mobile findings |
| ROS-FR-04 | A guided activation journey leads from workspace setup through reconciled import, first completed follow-up and first provider connection. | audit P1 onboarding |
| ROS-FR-05 | Alerts support persistent occurrence identity, acknowledgement, snooze, resolution, preferences, timezone, quiet hours and auditable delivery when automatic notification is enabled. | audit P1 alerts |
| ROS-FR-06 | Gmail, Calendar, Mailchimp, SMS and Meta states remain truthful and reconcile approved provider activity onto the canonical contact timeline. | RQ-08–14, RQ-20–21, RQ-26; audit P0.4 |
| ROS-FR-07 | Omnix represents property/listing facts in a domain separate from contact pipeline and records the provenance of licensed or user-entered facts. | product expansion Wave 4; audit P0.5 |
| ROS-FR-08 | Omnix supports the realtor-defined showing/appointment workflow and links it to the relevant people and property without replacing Calendar authority silently. | RQ-21; audit P0.5; requires discovery |
| ROS-FR-09 | Omnix represents deals/transactions separately from relationship stages and supports the confirmed offer, contract and closing milestone workflow. | RQ-18–19; audit P0.5 |
| ROS-FR-10 | Deadline radar uses confirmed transaction facts, identifies missing evidence, and never invents contractual dates or legal obligations. | product expansion differentiation; audit truth boundary |
| ROS-FR-11 | Omnix records the realtor-confirmed commission, split, cap, volume, expenses and P&L definitions from authoritative transaction facts. | RQ-19; requirements analysis §5.4 |
| ROS-FR-12 | The owner dashboard visualizes authoritative daily-work, pipeline-aging, relationship, data-quality, connector and transaction facts with drill-through and as-of time. | audit P1 dashboard |
| ROS-FR-13 | Past-client, anniversary, referral and post-closing workflows preserve relationship continuity without duplicating the contact source of truth. | RQ-17; audit P2 |
| ROS-FR-14 | Omnix AI can retrieve and draft from authorized operating-system facts, but any external write requires explicit approval, policy validation and immutable receipt. | Story 5.1; product expansion AI controls |
| ROS-FR-15 | Critical routes provide contextual failure recovery that states what failed, what was not changed and what safe action is available. | audit P1 recovery |
| ROS-FR-16 | Omnix can present a verified workspace-specific brand, product identity and custom-domain binding without changing tenant authority, provider ownership, consent or audit behavior. | Approved 2026-08-24 white-label commercial direction; architecture decision |
| ROS-FR-17 | Workspace capability access is governed by explicit entitlements that support early-access, manual and future billing grants. Judith's workspace remains active early access with no payment requirement, trial countdown, billing navigation or automatic paid conversion. | Approved 2026-08-24 commercial plan and Judith exception |
| ROS-FR-18 | A later commercial release may offer monthly and annual subscriptions through a separately governed billing adapter with signed, idempotent and reconcilable provider events. Pricing, limits, discounts and provider selection require a later approved commercial story. | Approved 2026-08-24 monthly/annual intent; commercial details intentionally open |

### Non-functional requirements

| ID | Requirement |
|---|---|
| ROS-NFR-01 | Workspace isolation and role behavior pass RLS tests for at least two workspaces and the owner/assistant matrix. |
| ROS-NFR-02 | Every import, merge, provider mutation and AI action is idempotent, auditable and recoverable or explicitly irreversible before confirmation. |
| ROS-NFR-03 | Every release candidate passes lint, typecheck, unit/integration tests, build and applicable browser/accessibility gates without reducing coverage. |
| ROS-NFR-04 | Critical journeys pass keyboard-only operation, visible focus, screen-reader semantics, reduced motion, native 200% zoom and 44×44 effective mobile targets. |
| ROS-NFR-05 | No provider refresh token, model key or consumer password is exposed to the browser or stored in plaintext. |
| ROS-NFR-06 | Provider and transaction readiness is represented as implemented, tested, deployed and operational independently. |
| ROS-NFR-07 | Dashboards and AI responses cite authoritative records and as-of time; unsupported revenue, probability, deadlines and provider-success claims are prohibited. |
| ROS-NFR-08 | Schema evolution is additive/backward-compatible, supports rollback or forward repair, and preserves existing contact and activity histories. |
| ROS-NFR-09 | Background work has bounded concurrency, retry policy, dead-letter/review handling, reconciliation and observable receipts. |
| ROS-NFR-10 | Production readiness includes monitoring, sanitized support references, backup and restore rehearsal, and a documented rollback path. |
| ROS-NFR-11 | Branding, entitlement, usage and future billing data remain workspace-scoped and pass cross-workspace cache, host-resolution, RLS and repository isolation tests. Billing-provider state is never tenant authority. |
| ROS-NFR-12 | Judith's early-access grant is regression-tested independently from paid plans and cannot surface checkout, invoices, pricing or upgrade pressure unless the product owner later approves an explicit migration. |

## Non-objectives

The following are explicitly outside this program unless a later approved requirement changes the boundary:

- unlicensed MLS, portal, listing or lead scraping;
- collecting Gmail, Mailchimp, Twilio, Meta, Claude or Gemini consumer passwords;
- replacing brokerage accounting, tax preparation, escrow or legal advice;
- inventing contract deadlines, commissions, market values or closing probabilities;
- presenting a contact pipeline stage as financial or transaction truth;
- building a generic email-campaign editor when Mailchimp remains the selected campaign authority;
- autonomous client-facing AI actions without approval and receipts;
- copying proprietary reference code, assets, prompts, trade dress or branding;
- claiming “best-in-class” before comparative benchmark and observed user-outcome evidence;
- making Meta, SMS, MLS, e-sign or provider verification a hidden prerequisite for safe use of the core CRM.
- selecting a billing provider, price, trial period, plan limits or annual discount before a separately approved commercial-requirements story;
- charging, requesting payment details from or automatically converting Judith's early-access workspace.

## Story-driven execution roadmap

### Wave 0 — Trust and release closure

**Outcome:** Judith can complete the current core journey safely before new domain expansion begins.

1. Finish, remediate and independently re-review existing Stories 3.7, 3.9, 3.10, 3.13–3.21 as applicable.
2. Fix Activities mobile reflow, touch targets, launcher/header collisions and critical-route recovery through an SM-created remediation story or approved amendment to the owning story.
3. Execute authorized Judith UAT: login, 144×79 import, row/field reconciliation, duplicate review, representative contacts, task completion, pipeline move, note archive/restore, mobile action, export and persistence after re-login.
4. Keep merge apply disabled until whole-plan reverse, backup and re-audit evidence pass.
5. Preserve the current QA verdicts until @qa issues replacements.

**Exit gate:** all Wave 0 P0 stories are `Done`, applicable QA gates are PASS, and the real-user UAT receipt is saved. No open P1 mobile break remains on the core follow-up path.

### Wave 1 — Activation and notification operations

**Outcome:** a new realtor reaches first value deliberately and receives governed attention outside a long read-only list.

SM should create bounded stories for:

1. **Guided activation and workspace readiness** — ROS-FR-01, 04, 15.
2. **Persistent alert lifecycle and preferences** — ROS-FR-05.
3. **Notification scheduler, delivery receipts and reconciliation** — ROS-FR-05 plus ROS-NFR-02, 05, 09.
4. **Connections and Settings information architecture** — user status/action first; technical receipts under Advanced; profile, timezone, working hours, alert preferences, privacy/export and AI settings.

**Exit gate:** first-value journey passes with a clean workspace; alert lifecycle passes deterministic time-zone/quiet-hours/idempotency tests; no channel is described as delivering until a real delivery receipt exists.

### Wave 2 — Connected daily work

**Outcome:** approved communications and calendar operations reconcile into one evidence-backed contact history.

1. Finish existing Story 4.1 Mailchimp real lifecycle UAT.
2. Finish existing Story 4.2 Google incremental consent, send, activity and Calendar create/update/delete/revoke UAT.
3. Continue Story 4.3 only after sender registration, consent and STOP/HELP prerequisites pass.
4. Continue Story 4.4 only after Business Verification, App Review, eligible asset and webhook prerequisites pass.
5. Create a unified communication timeline/reconciliation story only after Architect confirms authority and conflict-resolution contracts; trace to ROS-FR-06.

**Exit gate:** each enabled provider passes authorization, token lifecycle, signed webhook/callback where applicable, mutation, negative path, reconciliation and disconnect/revoke. Blocked providers remain visibly blocked and do not block safe core CRM use.

### Wave 3 — Real-estate domain foundation

**Outcome:** establish authoritative property and transaction boundaries without contaminating contact/pipeline truth.

This wave is **Architect-first and discovery-gated**. No implementation story becomes Ready before the following questions are answered with Judith's real process/artifacts:

- What spreadsheet or system currently tracks deals, volume, commissions and expenses?
- Which property/listing facts are manually owned versus supplied by a licensed source?
- What are the actual showing, offer, contract, inspection, financing and closing milestones?
- Which dates are contractual, informational or reminders?
- What must the assistant see or edit?
- Are document storage and e-sign required, or are links/metadata sufficient?

After discovery and architecture approval, SM should create stories for:

1. **Property/listing bounded context** — ROS-FR-07.
2. **Showing/appointment workflow** — ROS-FR-08.
3. **Transaction/offer/contract/closing bounded context** — ROS-FR-09.
4. **Confirmed deadline radar and evidence model** — ROS-FR-10.
5. **Transaction document metadata/links** only if discovery confirms the need; file storage/e-sign remain separately scoped.

**Exit gate:** additive schemas, RLS, CLI operations, APIs, UI, migration/rollback, two-workspace tests and real representative-transaction UAT pass. Relationship stage and transaction state remain separate.

### Wave 4 — Business performance and owner cockpit

**Outcome:** the realtor can understand business performance from confirmed transaction facts, not speculative dashboard numbers.

Discovery and Architecture must define authoritative calculations before SM creates implementation stories for:

1. **Commission, split, cap, GCI, volume and closed-unit facts** — ROS-FR-11.
2. **Expense categorization and P&L view** — only the realtor-approved workflow; no tax/accounting claim.
3. **Owner dashboard** — ROS-FR-12, including daily work, pipeline aging, data quality, connector health and transaction drill-through.
4. **Export/reconciliation for financial facts** with explicit as-of time and source evidence.

**Exit gate:** calculation definitions are approved, fixtures match real examples, totals reconcile to the authoritative source, every metric drills through, and no estimate is presented as booked/closed truth.

### Wave 5 — Relationship growth and governed intelligence

**Outcome:** extend the operating system into post-closing continuity and safe assisted execution.

1. Validate and implement past-client, referral, anniversary and reactivation journeys — ROS-FR-13.
2. Move Story 5.1 from Draft only after at least one outbound provider is operational and policy/evaluation requirements are explicit.
3. Add source-cited summaries and drafts over contact, property and transaction facts — ROS-FR-14.
4. Require human approval, Fair Housing/compliance checks where applicable, immutable receipts and negative-path evaluation before any outbound action.
5. Treat licensed MLS/portal intake, client transparency views, PWA/offline and e-sign as separately approved conditional epics, not automatic scope.

**Exit gate:** governed AI evaluation, approval, provider receipt, audit and rollback/recovery behavior pass with authorized data. Relationship automation has opt-out and pause controls.

### Wave 6 — White-label commercialization

**Outcome:** onboard additional independent realtors into isolated branded workspaces and govern paid access without coupling product authorization to a billing provider.

This wave begins only after the core Judith workflow and commercial support model are operational. PM must obtain explicit decisions for pricing, plan limits, trial policy, taxes, refunds, failed-payment handling, support expectations and legal documents before billing implementation becomes Ready.

1. Implement constrained workspace brand profiles, verified asset handling and server-side host resolution — ROS-FR-16.
2. Implement the entitlement registry and seed Judith's non-expiring early-access grant without exposing billing UI — ROS-FR-17 and ROS-NFR-12.
3. Validate provisioning, owner invitation, assistant permissions, data export, retention, closure and support-access workflows for at least two independent realtor workspaces.
4. Select and integrate a billing provider only after commercial requirements are approved; support monthly and annual products behind an adapter — ROS-FR-18.
5. Add signed webhook handling, replay protection, reconciliation, grace-state policy and owner-facing billing surfaces for paid workspaces only.
6. Run adversarial host/cache/RLS/provider isolation, checkout, renewal, cancellation, failed-payment and Judith early-access regression matrices.

**Exit gate:** multiple realtor workspaces pass tenant and branding isolation; paid entitlement transitions reconcile to provider receipts; Judith retains uninterrupted early access with no billing surface; support, legal and recovery procedures are approved. Only then may Omnix be described as commercially ready.

## Dependencies and external gates

| Dependency | Owner / authority | Blocks | Safe behavior while blocked |
|---|---|---|---|
| Judith and assistant authorized UAT | Product owner/client | Wave 0 operational claim | Keep feature state local/tested, not operational |
| Google Cloud test users/verification and consent | Google/project administrator | Gmail/Calendar UAT | Show Action required/UAT pending |
| Mailchimp real audience and webhook configuration | Mailchimp account owner | Mailchimp completion | Preserve import/manual operation |
| Twilio sender and A2P/consent prerequisites | Account owner/provider/compliance | SMS delivery | Retain device SMS fallback and label provider blocked |
| Meta Business Verification/App Review/assets | Meta/account owner | Social intake/messaging | Preserve manual lead-source capture |
| Licensed listing/MLS/portal agreement | Data owner/vendor | Automated listing/lead intake | Allow only explicit user-entered facts |
| Current deal/P&L artifacts and calculation decisions | Judith/Paulo | Wave 3–4 scope | Do not invent finance domain rules |
| Architecture decisions for new bounded contexts | @architect | Wave 3 implementation stories | Stories remain Draft |
| Independent quality verdicts | @qa | Every wave exit | No production-ready claim |
| Push, release and deployment | @devops | Production publication | Local/tested state remains separate |
| Commercial pricing, plan limits, tax/refund and legal decisions | Product owner / commercial counsel | Wave 6 paid launch | Keep entitlement and branding foundations provider-neutral; Judith remains early access |

## Cross-wave compatibility requirements

- Existing contact APIs, import presets, source facts and workspace behavior remain backward compatible.
- All new tenant-owned data uses the canonical workspace authority and RLS pattern.
- Existing Done stories are protected by regression tests; this epic does not silently reopen them.
- New property, showing, transaction and finance entities link to contacts but do not duplicate the contact source of truth.
- Provider activity never becomes transaction truth unless an explicit confirmed business command records it.
- Every new UI capability has a CLI/application-service operation first, observability second and UI third.
- High-risk schema/provider/financial changes require feature flags or fail-closed activation where feasible and documented rollback/forward repair.
- Branding is presentation data, entitlements are product authorization, and billing is external commercial evidence; these concerns remain separate in code, persistence and operations.

## Program risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Scope turns into a generic real-estate suite | High | Enforce wave gates, traceability and explicit conditional epics |
| Financial calculations are wrong or misleading | Critical | Discovery with real artifacts, approved definitions, reconciliation and drill-through |
| Contact pipeline and transaction states become conflated | Critical | Separate bounded contexts and Architect contract gate |
| Provider UI claims completion without real operation | High | Four-state evidence model and real lifecycle UAT |
| Import/merge damages the book of business | Critical | Preview, idempotency, backup, reversible whole-plan merge and reconciliation |
| Mobile complexity grows with new modules | High | Mobile-first critical-path ACs and fixed-control collision tests in every UI story |
| Alert fatigue or unwanted messages | High | Preferences, quiet hours, acknowledgement/snooze, frequency controls and consent |
| AI exposes or acts on unauthorized data | Critical | Workspace scoping, prompt/intent safeguards, citations, approval and immutable receipts |
| External approvals delay delivery | Medium | Keep core workflow operational and represent providers truthfully as blocked |
| Existing mixed work is overwritten | High | Story file lists, scoped ownership and no destructive Git/worktree operations |

## Definition of complete

Omnix may be called a **complete independent-realtor operating system** only when all conditions below are true:

1. Waves 0–4 have met their exit gates; Wave 5 capabilities may be separately labelled if explicitly excluded from the launch position.
2. All owning stories are `Done` and their current independent QA verdicts are PASS or an explicitly approved external blocker is visible and non-deceptive.
3. Judith and the authorized assistant complete the end-to-end production journey without developer intervention.
4. The 144×79 import is reconciled, recoverable and persists after re-login; duplicates are prevented or resolved reversibly.
5. Critical desktop/mobile journeys pass responsive, keyboard, screen-reader, reduced-motion, native 200% and error/empty/dense-state evidence.
6. Enabled provider integrations pass real authorization, mutation, receipt, reconciliation, negative-path and disconnect/revoke UAT.
7. Properties, showings, transactions, milestones and business-performance facts use approved, separate sources of truth with two-workspace isolation.
8. Financial totals reconcile to the realtor-approved authoritative examples and are not represented as accounting or tax advice.
9. Alerts have governed lifecycle/delivery semantics and do not silently mutate source records.
10. AI remains grounded, permission-aware and approval-gated for external actions.
11. Monitoring, incident response, sanitized errors, backup/restore and rollback/forward-repair rehearsals are documented and exercised.
12. There are no open P0/P1 defects in the realtor's core operating journey.

This definition permits an externally blocked provider to remain optional and honestly unavailable; it does not permit a required core workflow to be simulated.

## Product success evidence

The following are discovery/operational measures, not marketing promises. Baselines must be collected before targets are approved:

- time to first reconciled import;
- time to first completed follow-up;
- percentage of active contacts with a next step;
- overdue-work aging and completion trend;
- import exception and duplicate-review rates;
- provider reconciliation failures and recovery time;
- transaction milestone completeness;
- percentage of displayed metrics with successful drill-through;
- user-reported ability to complete the core journey without developer help.

## Required handoff to @architect

> Perform an Architecture impact analysis for Epic 6 before any Wave 3 or Wave 4 story becomes Ready. Define bounded contexts and authority for Contact/Relationship, Property/Listing, Showing/Appointment, Transaction/Offer/Contract/Closing, Document Metadata and Finance/Commission. Specify identifiers, state machines, workspace/RLS contracts, audit/idempotency, migration/rollback, provider/calendar authority, deadline provenance, financial calculation versioning and observability. Preserve existing contact/pipeline APIs and prohibit transaction or finance truth from being inferred from relationship stages. Return ADRs, dependency graph, threat model and story sequencing constraints to @pm/@sm. Do not select MLS, e-sign or finance vendors without approved discovery evidence.

## Required handoff to @sm

> Use Epic 6 and the 2026-08-20 audit to create detailed, independently reviewable stories in the exact wave order. First create only Wave 0 remediation/amendment stories and Wave 1 activation/notification stories. Reference existing Stories 3.7, 3.9, 3.10, 3.13–3.21, 4.1–4.4 and 5.1 instead of duplicating their scope. Every new story must trace acceptance criteria to ROS-FR/ROS-NFR IDs, include current dependencies, CLI-first behavior, workspace/RLS security, idempotency/recovery, responsive/accessibility states, tests, observability, rollout/rollback and an accurate File List. Keep Wave 3–4 stories Draft until @architect returns the bounded-context design and Judith's actual property/deal/P&L workflow is documented. Assign implementation to the appropriate specialist and independent quality review to @qa; @devops exclusively owns push, release and production deployment.

## Autonomous decisions

- [AUTO-DECISION] Use the small brownfield epic workflow → No (reason: the program requires many coordinated stories, new architecture and high-risk integrations; a full program epic with Architecture/SM gates is required).
- [AUTO-DECISION] Reopen or rewrite existing story statuses → No (reason: story files and QA gates remain authoritative).
- [AUTO-DECISION] Treat every common real-estate feature as a requirement → No (reason: Article IV requires traceability; unconfirmed MLS, e-sign, PWA/offline and client portal work remain conditional).
- [AUTO-DECISION] Implement financial calculations before observing the current process → No (reason: RQ-19 and the requirements analysis require spreadsheet/process discovery).
- [AUTO-DECISION] Block the safe core CRM on external providers → No (reason: providers must fail closed and remain truthfully optional until operational).

## Traceability sources

- `docs/audits/2026-08-20-independent-realtor-journey-ui-ux-audit.md`
- `docs/prd/client-questionnaire.md`
- `docs/prd/discovery-requirements-analysis.md`
- `docs/prd/requirements-analysis-v2.md`
- `docs/prd/realtor-requirements-coverage.md`
- `docs/prd/omnix-product-expansion.md`
- `docs/prd/omnix-crm-parity-roadmap.md`
- `docs/architecture/recommended-approach.md`
- `docs/architecture/connector-security-jobs-approvals.md`
- `docs/architecture/data-portability-operational-api.md`
- existing story and QA-gate files listed in the evidence baseline
