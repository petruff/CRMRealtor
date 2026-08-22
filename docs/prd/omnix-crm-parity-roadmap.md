# Omnix Operational CRM Parity Roadmap

**Date:** 2026-08-11  
**Owner:** @sm (Chronos), derived from the PM-owned clean-room inventory  
**Status:** Active backlog map  
**Reference boundary:** `AnilBotta/realtorspal-ai` revision `c7ca185fe6ce3ec4cfa87f18ae398ad382715c82`

## Outcome

This roadmap converts every useful, independently observed CRM gap in the clean-room parity matrix into an implementable Omnix story. It does not claim that backlog scope is already shipped. A capability becomes **Real** only after its story passes persistence, security, CLI, automated-test and runtime evidence gates.

No reference code, asset, copy, prompt, CSS, secret-handling pattern or trade dress may be copied. Static, simulated or unsafe controls are excluded as implementations; where they represent a legitimate user outcome, the roadmap replaces them with a real, governed equivalent.

## Sequence and traceability

| Priority | Story | Operational outcome | Matrix coverage | Dependency |
|---|---|---|---|---|
| P0 prerequisite | [3.0 Shared Workspace Authority](../stories/3.0.shared-workspace-authority.story.md) | Canonical workspace authority, owner/assistant membership, forward-only tenant backfill, RLS, intake binding and health evidence | C-07 foundation; Realtor RQ-22; prerequisite for every new tenant table | Stories 1.1–1.5 are Done |
| P0 | [3.1 CRM Work Queue Foundation](../stories/3.1.crm-work-queue-foundation.story.md) | Persisted Smart Lists, incomplete-record review and unified activities/tasks | C-04; D-14, D-16; L-02–L-10; P-01–P-05; A-08 (CRM events only); B-14 foundation | 3.0 Workspace Authority |
| P0 | [3.2 Rich Contact Lifecycle](../stories/3.2.rich-contact-lifecycle.story.md) | Richer household/contact data, assignments and safe archive/restore | D-08; L-12, L-23–L-27; I-06 | 3.0 and 3.1 schema contracts |
| P1 | [3.3 CRM Navigation, Pipeline & Truthful Analytics](../stories/3.3.crm-navigation-pipeline-truthful-analytics.story.md) | Cross-app search/actions, persisted pipeline movement, activity counters and event-backed funnel insights | C-02, C-03; D-02, D-06; L-10, L-13; N-04, N-06 | 3.1, 3.2 |
| P1 | [3.4 Data Portability & Operational API](../stories/3.4.data-portability-operational-api.story.md) | XLSX/mapping/history/export, scoped external CRUD, webhook operations and health/readiness | L-17–L-19; I-03, I-10; S-05, S-06, S-10, S-11; B-03, B-04 | 3.1, 3.2 |
| P0 platform | [3.5 Connector Security, Durable Jobs & Approvals](../stories/3.5.connector-security-jobs-approvals.story.md) | Encrypted token boundary, durable jobs, receipts, reconciliation and approvals that execute real operations | A-08, A-09, A-11, A-13, A-14; S-01, S-12; B-17 | 3.0 workspace authority and 3.1 evidence/idempotency patterns |
| P1 | [3.6 Deterministic Organizational Copilot](../stories/3.6.deterministic-organizational-copilot.story.md) | Provider-free workspace brief, bounded conversational retrieval, explainable alerts/deadlines, record citations and read-only suggestions | D-12, L-16, A-02, B-06 deterministic foundation only | 3.1 |
| P0 migration | [3.7 First-Class Contact Migration](../stories/3.7.first-class-contact-migration.story.md) | Lossless governed migration of the realtor's 79-field 1st Class Real Estate export into canonical contact data plus typed source provenance | User-supplied migration corpus; extends L-17–L-19 and I-06 | 3.2 and 3.4 |
| P1 experience | [3.8 Warm Editorial Internal CRM & Persistent Alert Center](../stories/3.8.warm-editorial-internal-command-center.story.md) | Coherent authenticated warm-editorial workspace, semantic visual actions, persistent deterministic alert center, daily command center, actionable empty states and evidence-led pipeline cards | User-requested internal CRM redesign; additive composition of C-02/C-03, D-02/D-06/D-12, L-10/L-16 and A-02 outcomes | 2.3, 3.1, 3.3 and 3.6 |
| P1 experience | [3.10 Today Calm Timeline Studio](../stories/3.10.today-calm-timeline-studio.story.md) | Premium visual Today hierarchy with deterministic focus timeline, reduced-motion-safe slow focus, attention balance and truthful operational availability | User-selected Product Design option 3; additive refinement of Story 3.8 | 3.8 |
| P1 experience | [3.11 Today Queue Explorer](../stories/3.11.today-queue-explorer.story.md) | Bounded exploration of the Today relationship queue for 85+ contacts with deterministic scopes, shared search, progressive 12-card rendering and preserved actions | Approved correction to the extensive Full relationship queue; additive refinement of Story 3.10 | 3.10 |
| P0 operations | [3.19 Judith Workflow Controls & Claude Routing](../stories/3.19.judith-workflow-controls-and-claude-routing.story.md) | Reversible note archive/restore, separate Figure out qualification queue, governed Gemini/Claude provider choice and verified-workspace migration closure | Judith operational feedback; extends migration and Omnix AI settings without changing Hot/Warm/Nurture | 3.7, 3.14–3.17 |
| P0 operations | [3.20 Client Segregation & Needs Review Views](../stories/3.20.client-segregation-and-needs-review-views.story.md) | Leads/Clients/Needs review/All retrieval over one canonical contact source, with Active/Past client subviews and composable search/Smart Lists | Judith client-organization feedback; UI terminology refinement over Story 3.19 without changing stored qualification or lead temperature | 3.1, 3.2, 3.7, 3.19 |
| P1 | [4.1 Mailchimp Audience Synchronization](../stories/4.1.mailchimp-audience-synchronization.story.md) | OAuth audience selection, tags out, signups/unsubscribes in and loop-safe reconciliation | Realtor RQ-11–RQ-14; connector parity beyond the reference's static settings | 3.5 plus 3.2 canonical email/subscription facts |
| P1 | [4.2 Google Email & Calendar Operations](../stories/4.2.google-email-calendar-operations.story.md) | Incremental Google OAuth, minimized Gmail activity/send and Omnix-owned Calendar task reconciliation | D-11; L-15, L-28, L-29; B-08, B-14; Realtor RQ-08, RQ-09, RQ-21 | 3.1, 3.2 and 3.5 |
| P2 | [4.3 Compliant Texting](../stories/4.3.compliant-texting.story.md) | Provider-backed SMS with consent, STOP/HELP, quiet hours, delivery receipts and reconciliation; voice remains deferred without evidence | D-09, D-10; S-07; B-07 | 3.5 plus 3.2 phone/consent facts and registration/compliance gates |
| P2 | [4.4 Meta Business Intake & Messaging](../stories/4.4.meta-business-intake-messaging.story.md) | Meta Business Login and verified inbound business-message intake with provenance and human review; Lead Ads/outbound remain separately gated | S-02–S-04; B-09; Realtor RQ-02, RQ-26 | 3.5 plus eligible Meta assets, pinned approved version/permissions, App Review and inbound JTBD |
| P2 | [5.1 Governed AI & Nurturing](../stories/5.1.governed-ai-nurturing.story.md) | Source-cited AI assistance, real drafts, controlled nurture sequences and human-approved provider actions | D-12, D-15, D-18; L-16, L-29, L-30; A-02, A-04, A-10–A-12; B-06, B-12, B-13, B-15 | 3.6, 3.5 and at least one outbound connector |
| Conditional | [5.2 Licensed Lead Acquisition](../stories/5.2.licensed-lead-acquisition.story.md) | Provenance-controlled lead acquisition with progress, retry, dedupe and audit | A-03, A-15; B-11, B-16 | Approved vendor, data rights, geography and budget |

## Existing real coverage retained

Stories 1.1–1.5 and 2.1 already provide the current contact repository, cadence/triage, notes, import/intake, physical mail, responsive shell, pipeline, insights and explainable Omnix workspace described as **Real** in the parity matrix. Story 2.2 owns the public landing, basic Google identity, safe redirects and clean-room audit. None of the stories above may remove or silently replace those capabilities.

## Explicit non-targets

The following observed reference behavior is not an implementation target:

- fixed revenue, conversion, response-time, visitor, uptime or agent-performance numbers without source events (D-03; N-02, N-03, N-05);
- alert badges, agent catalogs, streams, approvals, logs, tests or configuration controls that are decorative, random, local-only or have no effective processor (C-05; A-01, A-05–A-07; G-01–G-07);
- shared demo credentials or provider passwords/app-passwords (B-02; S-09);
- plaintext provider/model secrets, unsigned webhooks or browser-exposed refresh tokens;
- an activity “send” action that only changes local status (D-19);
- ungoverned scraping or lead generation without licensed provenance and terms approval;
- a duplicate “dashboard subset” data silo. If that user outcome is needed, it is represented by a system Smart List backed by the same contact source of truth (L-13).

## Definition of parity complete

Operational CRM parity is complete only when:

1. every row mapped to a story above is either proven **Real** or has an explicit approved external blocker;
2. owner/workspace isolation, CLI operation, observability, error paths and browser behavior have passed their story gates;
3. provider stories include real account authorization, token lifecycle, webhook/reconciliation evidence, receipts and disconnect/revocation proof;
4. no simulated/static reference control is presented as a live Omnix capability;
5. real-data UAT with the realtor and assistant has passed.

## Autonomous decisions

- [AUTO-DECISION] Proceed while Story 2.2 is still InProgress → Yes, for backlog preparation only (reason: the parent explicitly requested complete parity stories; no implementation or active-story status was changed).
- [AUTO-DECISION] Persist work-queue tables before shared workspace authority → No; Story 3.0 is a hard prerequisite (reason: the architect gate requires one canonical tenant authority and two-workspace RLS proof before new persistence).
- [AUTO-DECISION] Treat simulated reference UI as required parity → No (reason: the clean-room matrix defines operational evidence, not visual presence, as the parity boundary).
- [AUTO-DECISION] Recreate unsafe scraping and password capture → No; specify governed licensed/provider outcomes instead (reason: security, consent, terms and product governance requirements).
- [AUTO-DECISION] Keep deterministic internal copilot behavior blocked inside Story 5.1 → No; add Story 3.6 as its provider-free prerequisite (reason: the user explicitly requested an implementable read-only organizational copilot over existing Omnix/work-queue facts, while 5.1 retains governed generative/outbound scope).
- [AUTO-DECISION] Cross-story accumulated context source → `docs/accumulated-context.md` was not present; coherence was derived from Stories 1.1–2.2, `omnix-product-expansion.md`, `realtor-requirements-coverage.md`, `tech-stack.md` and the parity matrix.
