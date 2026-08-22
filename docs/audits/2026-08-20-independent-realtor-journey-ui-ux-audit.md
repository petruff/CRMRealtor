# Omnix — Independent Realtor Journey, Product and UI/UX Audit

**Date:** 2026-08-20  
**Audit authority:** AEXOS Master with independent Product, UX and QA reviews  
**Scope:** user journey, information architecture, design system, responsive behavior, accessibility, Today, Contacts, Activities, Pipeline, Alerts, Insights, Connections, Settings, Omnix AI, import/deduplication and provider readiness  
**Method:** source and story inspection, current QA-gate review, local sample-mode browser inspection, automated quality gates and production health/readiness inspection  
**Mutation boundary:** read-only product audit; no product code, production data, provider configuration or deployment changed

## Executive verdict

Omnix already has a substantive and differentiated relationship-CRM core. It is especially strong at turning contact facts into a prioritized, explainable daily workflow while refusing to invent revenue, transaction or provider outcomes.

It does **not yet satisfy every essential need of an independent realtor**, is **not yet operationally complete**, and there is not enough comparative or longitudinal evidence to claim that it is the best platform in the market.

Two measurements must remain separate:

- **Functional coverage:** approximately **75%** of the identified macro-jobs have substantive implementation.
- **Operational readiness:** **24/48 points (50%)** on the audit scale `0 absent → 4 live with real UAT`.

This is an audit score, not a commercial product metric.

The honest positioning today is:

> **A strong, evidence-led relationship CRM in active completion — not yet a complete realtor operating system.**

## Evidence boundary

The audit distinguishes four states:

1. **Implemented:** source exists.
2. **Tested:** automated/local evidence exists.
3. **Deployed:** a production artifact or endpoint exists.
4. **Operational:** the complete journey has passed authorized real-user/provider UAT.

Green unit tests do not prove a live integration. A local sample-mode screenshot does not prove Judith's authenticated workspace. Provider credentials do not prove consent, approval, reconciliation or disconnect.

Current evidence reviewed:

- ESLint: PASS.
- TypeScript: PASS.
- Vitest: 160 files / 718 tests PASS in the independent readiness audit.
- Local browser: ten desktop routes and eight mobile routes; zero local console warnings/errors.
- Production `/api/health`: HTTP 200.
- Production `/api/readiness`: HTTP 200 with database configured/available.
- Current local preview is sample/read-only and therefore does not certify Judith's production journey.
- The checkout has no usable Git metadata, so revision/commit/deploy equivalence was not asserted.

## Primary job to be done

> When I have hundreds of contacts, appointments and channels distributed across tools, I want to know who needs me now, understand why, and complete the next contact without losing context, so relationships and opportunities continue moving without depending on my memory.

Supporting jobs:

1. Import a book of business without loss or invented reclassification.
2. Separate leads, clients and people who still need review.
3. Convert intent into an achievable daily routine.
4. Preserve history and correct mistakes reversibly.
5. Communicate through the right channel without duplicate work.
6. Find and act on a contact quickly from a phone.
7. Receive attention before a relationship goes cold.
8. Understand business health without fabricated metrics.

## Journey scorecard

| Journey stage | User outcome | Current truth | Readiness |
|---|---|---|---:|
| Sign in and trust | Recognize the correct user/workspace and recover safely from auth errors | Workspace authority, personalization and OAuth boundaries exist; current Judith + assistant UAT remains incomplete | 2/4 |
| Migrate the book of business | Import the real KvCore/First Class files without loss or duplication | Parser proves 144/144 and 79/79 plus large/range-amplified workbook safety; Story 3.7 and final Judith reconciliation remain open | 2/4 |
| Organize people | Separate Leads, Clients, Needs review and Active/Past clients | Canonical scopes, search, filters and Smart Lists are implemented and tested | 3/4 |
| Understand today | See the most important work and why | Today has a truthful focus timeline and queue; Story 3.13 gate remains FAIL | 2/4 |
| Execute follow-up | Call, message, create/complete tasks and retain the next step | Contacts, activities, cadences and next-touch behavior are substantive; Activities breaks mobile reflow | 3/4 |
| Advance opportunities | See stage, evidence and next action | Relationship pipeline is persistent and evidence-backed; it is not a transaction ledger | 3/4 |
| Maintain relationships | Remember birthdays, home anniversaries, past clients and mailers | Relationship moments and physical mailer readiness are implemented | 3/4 |
| Communicate across channels | Use Gmail, Calendar, Mailchimp, SMS and social without duplicated work | Local provider implementations are advanced; real UAT/approvals remain incomplete | 1/4 |
| Use Omnix AI | Ask grounded questions and reach the cited record | Deterministic assistant is strong; provider routing stories remain InReview and nurturing is Draft | 2/4 |
| Correct and recover | Archive/restore notes, resolve duplicates and recover failures | Note controls are InReview; dedupe audit exists but apply/reverse is incomplete | 1/4 |
| Work in the field | Find and act on people efficiently from a phone | Most routes reflow; Activities, launcher collisions and target sizes still impair mobile work | 2/4 |
| Run the business | Track deals, properties, closings, commission, expenses and P&L | No canonical transaction/deal/property/commission domain exists | 0/4 |

**Total: 24/48 — 50% operational readiness.**

## What is already strong

### Contact and data foundation

- Rich contact profile, buyer/seller facts, referral, dates, address, tags and provenance.
- Leads, Clients, Needs review, All contacts and Active/Past clients remain orthogonal to Hot/Warm/Nurture.
- KvCore recognition tolerates removed/reordered columns.
- Generic `Status` and `Rating` are preserved as source facts and are not silently mapped to Omnix pipeline or temperature.
- Duplicate identity checks use external ID, canonical email and canonical phone.
- Import parser no longer has a direct business row limit; safety remains bounded by bytes, populated cells, columns, cell length, workbook structure, worker time/memory and concurrency.

### Daily work

- Today prioritizes stored facts rather than predictive fiction.
- Activities, tasks, next touch and cadence rules provide a useful operational backbone.
- Pipeline shows stage, evidence, activity and next step and offers an accessible select alternative to drag-and-drop.
- Contact detail puts Call, Text, Email and Edit within the first mobile viewport.

### Alerts and explainability

- Canonical alerts are deterministic, deduplicated, ordered and cited.
- Alerts supports search, filters, summary counts, accordion groups and bounded 12-item progressive disclosure.
- Omnix AI is read-only by default, cites its evidence and exposes safe navigation rather than autonomous writes.

### Trust engineering

- Workspace authority, RLS, service boundaries, immutable evidence, fail-closed provider behavior and honest sample/live states are unusually strong for this stage.
- Insights explicitly withholds revenue, conversion and market metrics until a real transaction source exists.
- Current provider gates correctly refuse to treat local implementation as completed real-world integration.

## Blocking findings

### P0 — required before “complete” or “best platform” claims

#### 1. Complete the real Judith journey

Run and preserve an authorized end-to-end UAT:

1. Sign in to the correct workspace.
2. Import the real 144-contact files.
3. Reconcile all 144 rows and all 79 source fields.
4. Open and validate representative imported contacts.
5. Create and complete a task.
6. Move a contact through pipeline with evidence.
7. Archive and restore a note.
8. Search and act from a real phone.
9. Export a recoverable copy.
10. Sign out, sign back in and prove persistence.

#### 2. Close import and deduplication, not only their previews

- Story 3.7 remains InProgress until production/workspace reconciliation and final browser evidence are complete.
- Story 3.15 must remain review-only until alias-aware repositories, import and outbound guards, apply, reverse, backup and re-audit are complete.
- Never activate a partial physical reparent/merge across the existing dependency graph.

#### 3. Close the current UI certification gates

- Story 3.13 Today: gate FAIL because authenticated true-zero and native 200% reflow evidence remain incomplete.
- Story 3.21 design system: gate FAIL because keyboard, native 200%, populated/empty/loading/error/dense states and saved light/dark viewport receipts remain incomplete.

These are certification gaps, not proof that every visual surface is defective.

#### 4. Complete real provider lifecycles

- Mailchimp: OAuth, audience selection, real tag update, signed unsubscribe, reconciliation and disconnect.
- Gmail/Calendar: incremental consent, send, matched activity, Calendar create/update/delete, failures and revoke for realtor/assistant.
- Meta: Business Verification, App Review, eligible Page/Instagram assets, webhook and real UAT.
- Twilio: approved sender/A2P, consent/policy, signed callbacks, STOP behavior and real-number UAT.

Until these pass, capabilities must remain visibly `UAT pending`, `Action required` or `Blocked`, never `Connected` based only on code or environment variables.

#### 5. Decide whether Omnix is a relationship CRM or a complete realtor operating system

The current domain has contact pipeline facts but no canonical entities for:

- deals/transactions;
- property/listing lifecycle;
- showing/appointment lifecycle;
- offer/contract/closing milestones and deadlines;
- transaction documents or e-sign;
- commission, split, cap, GCI, expenses or P&L.

If the product promises to operate the whole independent-realtor business, these require discovery, architecture and authoritative data sources. Contact pipeline stages must not be reused as financial or transaction truth.

## P1 — important experience and product gaps

### Mobile Activities breaks reflow

At 390 px, `/activities` measured `scrollWidth 554` versus `clientWidth 375`; at 768 px, `818` versus `753`. The task table uses a `min-w-[38rem]`, and its select-all checkbox measured only 13×13.

Required outcome:

- no page-level horizontal scroll at 390/768;
- mobile task cards or a deliberately contained internal table scroller;
- effective touch targets of at least 44×44;
- automated reflow regression.

### Mobile shell and Omnix launcher compete with work

- The header exposes too many simultaneous actions at narrow widths.
- The fixed 84×84 Omnix launcher overlaps priority content and controls on several routes.

Required outcome:

- preserve logo and page identity;
- keep two or three primary actions and move the rest behind a clear More menu;
- make the assistant launcher smaller/dockable/minimizable on mobile;
- add fixed-UI collision tests.

### Alerts is an attention dashboard, not an automatic notification system

Current Alerts is explicitly read-only and recalculated from current facts. It does not dismiss, snooze, send or schedule.

If “automatic alerts” means delivery outside the open page, the product still needs:

- persistent alert occurrence/dedupe state;
- acknowledge, snooze and resolved semantics without mutating the source fact;
- per-user preferences, timezone, quiet hours and frequency;
- scheduler/background jobs;
- optional in-app, email, push or SMS delivery;
- receipts, retry/reconciliation and opt-in governance.

### Dashboard visibility is truthful but incomplete

Today and Pipeline are visual and evidence-led, but Today spends substantial space on one focus item and Insights remains mostly numeric/textual.

The next dashboard should visualize only authoritative operational facts:

- overdue versus completed follow-ups over time;
- contacts with/without a next step;
- pipeline aging and movement;
- client/lead/needs-review distribution;
- import/data-quality backlog;
- connector health and last successful sync;
- relationship moments and post-closing follow-up.

Do not show revenue, conversion probability or closing forecast without a real transaction source and an approved definition.

### Long mobile pages delay action

- Alerts measured roughly 4,168 px high at 390 px, with the first actionable alert too far below introduction and summaries.
- Pipeline measured roughly 5,519 px high at 390 px.
- Connections measured roughly 4,418 px and leads with technical architecture rather than user status.

Required outcome:

- compact summary followed by the first action within the first viewport;
- collapsible/jumpable pipeline stages and an actionable filter;
- Connections begins with provider, status, last success, issue and next-action button; technical receipts live in Advanced.

### Onboarding is not yet a first-value journey

Good empty states exist, but there is no single guided activation path.

Recommended activation sequence:

1. Complete profile/workspace.
2. Import contacts.
3. Reconcile duplicates and Needs review.
4. View Today.
5. Complete the first follow-up.
6. Connect the first real provider.

Track time-to-first-reconciled-import and time-to-first-completed-follow-up as discovery metrics, not marketing claims.

### Settings is too narrow

Settings currently centers on AI provider configuration. Either rename it `AI settings` or add clear product sections for:

- profile/workspace;
- timezone and working hours;
- alerts and digests;
- privacy/data/export;
- integrations and permissions;
- AI models, limits and data handling.

### Omnix provider-state copy must be dynamic

`/omnix` says no generative model is connected while Settings and Gemini/Claude routing exist. The UI must communicate one of:

- deterministic only;
- provider configured;
- provider unavailable/action required.

### Recovery is inconsistent

Today, Contacts, Activities and Alerts have route-specific recovery. Pipeline, Mailers, Connections, Settings and Omnix rely more heavily on the global fallback.

Every critical read should preserve context and say:

- what could not load;
- what was not changed;
- safe retry/alternative action;
- sanitized support reference when appropriate.

## P2 — refinement and differentiation

- Add route-specific browser metadata for contact create/detail pages.
- Keep only Essentials open by default for rapid open-house entry.
- Improve the affordance that horizontal contact-view rails contain more options.
- Add automated axe/E2E coverage; current manual gate dependence is too high.
- Add a design-token lint/contract to prevent new one-off colors/radii.
- Validate post-closing, referral, anniversary and reactivation journeys with Judith.
- Add governed AI drafting/nurturing only after real outbound channels and grounding evaluations pass.
- Explore MLS/portal intake, document workflow and PWA/offline only after field research confirms priority.

## User-experience acceptance matrix

A complete experience must pass all of the following:

### Responsive and accessibility

- 390×844, 768×1024 and 1440×900.
- Light and dark.
- Native 200% zoom/reflow.
- Keyboard-only journey and visible focus.
- No page overflow, fixed-element collisions or hidden actions.
- Minimum effective touch target 44×44 for primary mobile actions.
- Populated, empty, loading, error, dense and permission-denied states.
- Reduced motion and screen-reader labels/live regions.

### Truth and safety

- Every dashboard metric links to its authoritative records and as-of time.
- Every alert contains rule, source record and safe destination.
- No inferred transaction deadline, revenue, probability or provider success.
- Every import/merge/provider mutation has idempotency, audit evidence and recovery.

### Real-user/provider UAT

- Judith and assistant roles.
- Real 144×79 import and reconciliation.
- Real mobile follow-up loop.
- Google and Mailchimp complete lifecycles.
- Meta/Twilio only after external approval prerequisites.
- Production monitoring and backup/restore rehearsal.

## Prioritized roadmap

### Wave 1 — trust closure

1. Fix Activities mobile reflow, targets, launcher and header collisions.
2. Close Stories 3.13 and 3.21 evidence matrices.
3. Complete Judith auth/import/reconciliation/mobile UAT.
4. Finish note/client controls and contextual error recovery.
5. Keep dedupe apply disabled until whole-plan reverse is proven.

### Wave 2 — connected daily work

1. Complete Google and Mailchimp real UAT.
2. Unify provider activity into the contact timeline.
3. Implement the approved alert lifecycle and user preferences if automatic delivery is a confirmed need.
4. Redesign Connections around user status/action.
5. Add adoption and reliability observability.

### Wave 3 — realtor operating-system differentiation

1. Discover and model transaction, property, showing, closing and commission workflows.
2. Build a compact, authoritative owner dashboard.
3. Validate post-closing and referral automation.
4. Add governed Omnix drafts/actions with approval and receipts.
5. Benchmark against named competitors and measure real outcomes before using a best-in-class claim.

## Definition of ready

The CRM can be called operationally ready for Judith when:

- every Wave 1 gate is PASS;
- her real import is reconciled and recoverable;
- no P1 mobile break remains in the critical follow-up journey;
- provider status is truthful;
- production errors, backup and restore have runbooks;
- she completes the core journey without developer intervention.

It can be called a complete independent-realtor platform only after the transaction/business-administration scope is either implemented or explicitly excluded from positioning.

It can be called best-in-class only after competitive benchmark and observed user-outcome evidence exist.

## Source evidence

- `docs/prd/client-questionnaire.md`
- `docs/prd/realtor-requirements-coverage.md`
- `docs/prd/omnix-crm-parity-roadmap.md`
- `docs/stories/3.7.first-class-contact-migration.story.md`
- `docs/stories/3.12.alerts-progressive-disclosure-dashboard.story.md`
- `docs/stories/3.13.today-premium-restoration-route-integrity.story.md`
- `docs/stories/3.14.omnix-global-conversational-assistant.story.md`
- `docs/stories/3.15.exact-contact-deduplication-and-reversible-merge.story.md`
- `docs/stories/3.19.judith-workflow-controls-and-claude-routing.story.md`
- `docs/stories/3.20.client-segregation-and-needs-review-views.story.md`
- `docs/stories/3.21.airtable-editorial-product-system.story.md`
- `docs/stories/4.1.mailchimp-audience-synchronization.story.md`
- `docs/stories/4.2.google-email-calendar-operations.story.md`
- `docs/stories/4.3.compliant-texting.story.md`
- `docs/stories/4.4.meta-business-intake-messaging.story.md`
- `docs/stories/5.1.governed-ai-nurturing.story.md`
- `docs/qa/gates/3.13-today-premium-restoration-route-integrity.yml`
- `docs/qa/gates/3.21-airtable-editorial-product-system.yml`
- `docs/qa/gates/4.1-mailchimp-audience-synchronization.yml`
- `docs/qa/gates/4.2-google-email-calendar-operations.yml`
- `packages/crm/app/alerts/page.tsx`
- `packages/crm/components/alert-center.tsx`
- `packages/crm/components/activity-workspace.tsx`
- `packages/crm/app/insights/page.tsx`
- `packages/crm/app/settings/page.tsx`
- `packages/crm/app/omnix/page.tsx`
- `packages/crm/lib/application/omnix-copilot-service.ts`

