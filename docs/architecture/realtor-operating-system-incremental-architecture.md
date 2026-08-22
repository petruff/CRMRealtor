# Omnix Realtor Operating System — Incremental Architecture and Impact Decision

**Date:** 2026-08-20  
**Authority:** @architect (Vega)  
**Decision status:** Proposed architecture; implementation requires approved stories and QA gates  
**Scope:** brownfield evolution from the current relationship CRM into a complete independent-realtor operating system  
**Mutation boundary:** architecture only; no product code, database migration, production configuration, provider account or customer data changed

## 1. Decision

Evolve the existing Next.js/Supabase modular monolith through additive, workspace-scoped domain modules. Do not introduce a second backend or replace the current contact, activity, pipeline, connector, receipt, RLS or CLI patterns.

The system will distinguish four independent authorities:

1. **Relationship authority:** contacts, households, qualification, contact pipeline, tasks, notes and relationship history.
2. **Real-estate operations authority:** properties, listings, showings, deals, transaction milestones and closing evidence.
3. **Financial authority:** commission agreements, commission events, expenses and period summaries derived only from verified operational facts.
4. **Integration authority:** provider connections, jobs, webhook deliveries, normalized provider activities, approvals, reconciliation and immutable receipts.

The current `Contact.pipelineStage` remains a relationship-workflow classification. It must never become the canonical source for listing status, contract state, closing completion, commission earned or cash received.

```text
Authenticated CLI / operational API / server actions
                         |
                 application commands
                         |
   +---------------------+-------------------------+
   |                     |                         |
relationship       real-estate ops          integration jobs
aggregate          aggregate                + normalization
   |                     |                         |
   +---------- immutable domain/activity receipts-+
                         |
              workspace-scoped repositories
                         |
        PostgreSQL + RLS + narrow atomic RPCs
                         |
                projections / observability
                         |
                    responsive UI
```

This preserves the constitutional order `CLI -> observability -> UI` and allows every new UI capability to use the same command, authorization and receipt contracts as automation.

## 2. Current baseline and impact boundary

The existing system already provides useful architectural foundations:

- `WorkspaceScope`, active membership and workspace RLS.
- Canonical contacts, households, relationships, assignments and custom fields.
- Append-oriented notes and activity events.
- Tasks with optimistic concurrency and idempotent commands.
- Relationship pipeline moves with expected-version conflict detection.
- Connector connections, encrypted provider material, action intents, approvals, jobs, webhook deliveries and receipts.
- Mailchimp, Google, Twilio and Meta provider-specific foundations.
- Import provenance, incomplete-record quarantine and reversible-contact-merge foundations.
- Machine-readable CLI envelopes and stable error categories.

The incremental architecture must not bypass or duplicate those authorities. Specifically:

- contact deduplication remains external-ID, canonical-email and canonical-phone aware;
- a merged contact resolves through the canonical alias before any new aggregate links it;
- provider payloads remain private/encrypted where content is sensitive;
- application commands, not pages or route handlers, own mutations;
- public projections contain only allowlisted facts;
- sample/local data never proves live provider or production readiness.

## 3. Bounded contexts

### 3.1 Relationship CRM — preserve

**Owns:** `Contact`, `Household`, `ContactRelationship`, `ContactAssignment`, `Note`, `CrmTask`, qualification, relationship type and contact pipeline.

**Does not own:** properties, listing agreements, purchase contracts, closing, commission or expenses.

**Integration rule:** operational aggregates reference the resolved canonical contact ID. A contact merge changes the resolution layer, not historical receipts.

### 3.2 Property and listing operations — add

Logical aggregates:

- **Property:** workspace-scoped real-world asset with normalized address, optional parcel/external identities and allowlisted characteristics.
- **Listing:** representation agreement for a property, seller parties, list dates, price history and a dedicated lifecycle.
- **Showing:** scheduled property visit linked to a property/listing, participants, calendar binding, outcome and follow-up task.

Recommended listing lifecycle:

```text
draft -> pre-market -> active -> pending -> closed
                     \-> withdrawn | expired | cancelled
```

The lifecycle is a proposed state machine and must be validated in product discovery before physical schema is approved. Imported/provider `status` remains source evidence until explicitly mapped through a reviewed mapping profile.

Key invariants:

- a listing references one property and one workspace;
- seller/buyer parties use canonical contact references and explicit roles;
- price/status changes append events rather than silently replacing history;
- provider IDs are identities, not primary business keys;
- address similarity must not silently merge properties;
- showing time uses an instant plus the originating timezone;
- a Calendar event is a provider binding, not the showing authority.

### 3.3 Deal, transaction and closing — add

Logical aggregates:

- **Deal:** the commercial opportunity connecting parties and property; records representation side without asserting a signed contract.
- **Transaction:** created only when authoritative contract evidence exists; records contract facts, contingencies and closing lifecycle.
- **TransactionMilestone:** named deadline/status with source, confidence authority, responsible membership and completion evidence.
- **TransactionParty:** role-based reference to contact, brokerage or external professional.
- **TransactionDocumentReference:** metadata and provider reference only in the initial slice; no document storage or e-sign promise without a separately approved security architecture.

Recommended separation:

```text
contact pipeline: new -> contacted -> appointment -> active -> under-contract -> closed
deal:             prospecting -> representation -> offer/listing -> won | lost
transaction:      draft -> contract-pending -> under-contract -> closing-ready -> closed
                                                            \-> cancelled
```

The exact labels require product validation. The architectural rule is fixed: transitions across these state machines are never inferred from one another. A transaction transition may emit an advisory suggestion for the contact pipeline, but any resulting pipeline mutation remains an explicit, receipted command.

Milestone requirements:

- source category: `manual`, `contract`, `provider`, or `system-derived`;
- authoritative date and timezone where applicable;
- `pending`, `completed`, `waived`, `missed`, `cancelled` lifecycle;
- append-only transition history;
- expected-version conflict control;
- reminder policy linked by reference, not embedded scheduler state;
- no inferred legal deadline presented as fact.

### 3.4 Financial operations — add after transaction authority

Logical aggregates:

- **CommissionAgreement:** side, calculation basis, percentage/fixed amount, splits, cap/referral deductions and effective version.
- **CommissionEvent:** estimated, earned, received, adjusted or reversed amount tied to authoritative transaction evidence.
- **Expense:** workspace expense with category, incurred/paid dates, optional transaction/deal attribution and receipt reference.
- **FinancialPeriodProjection:** derived read model for GCI, net commission, expenses and operating result.

Financial truth levels:

1. **Projected:** calculation from current agreement and expected transaction value.
2. **Earned:** only after the configured authoritative closing condition.
3. **Received:** only after an explicit receipt/payment fact.

Every amount carries ISO currency and integer minor units. Never use binary floating point. Projection labels must remain visible; projected, earned and received values cannot be summed as if equivalent.

The first financial implementation is an operational ledger, not accounting software or tax advice. Bank reconciliation, trust accounting, payroll and tax filing are out of scope unless later approved.

### 3.5 Alert lifecycle — add persistence without changing source facts

The current alert engine is a deterministic, read-only projection. Preserve it as the **rule evaluator** and add a separate lifecycle:

- **AlertDefinition:** rule version, severity, eligible source type and default channels.
- **AlertOccurrence:** stable rule/source/window identity, first/last observed time and current source snapshot hash.
- **AlertUserState:** per-membership `unseen`, `seen`, `acknowledged`, `snoozed`, or `resolved` state.
- **AlertDeliveryIntent:** immutable requested channel/content-version/recipient authority.
- **AlertDeliveryAttempt/Receipt:** queued, accepted, delivered where provider evidence supports it, failed, suppressed or reconciliation-required.
- **NotificationPreference:** timezone, quiet hours, channel opt-in, digest frequency and severity threshold.

Alert identity must be deterministic, for example:

```text
hash(workspace_id, rule_key, source_type, source_id, evaluation_window)
```

Acknowledging or snoozing an occurrence never mutates the contact, task, deal or milestone. When the source condition disappears, the occurrence can resolve automatically with evidence. If the source condition returns in a new evaluation window, the system creates/reopens according to the versioned rule policy.

External delivery must reuse connector jobs, approval/consent policy and provider receipts. `accepted` is not `delivered`; ambiguous provider outcomes enter reconciliation rather than blind retry.

### 3.6 Provider activity timeline — add canonical normalization

Provider-specific tables remain ingestion and reconciliation authorities. Add a public, redacted **ProviderActivityProjection** for the unified contact/deal timeline:

- workspace, provider and connection references;
- canonical activity kind (`email-sent`, `email-received`, `sms-sent`, `sms-received`, `calendar-created`, `calendar-updated`, `social-inbound`, `audience-status-changed`);
- contact/deal/transaction reference when matched;
- provider occurred time and local ingestion time;
- disposition (`confirmed`, `pending-review`, `suppressed`, `reconciliation-required`, `failed`);
- immutable provider receipt/reference and redacted summary;
- payload/content reference only in the private envelope boundary.

Normalization is idempotent on provider connection plus external event identity. Unmatched inbound events go to review/quarantine; the system must not guess a contact from weak name similarity.

The unified timeline is a projection, not a new mutation authority. Corrections append link/unlink evidence and rebuild the projection.

### 3.7 Onboarding and workspace readiness — add

Model onboarding as a versioned checklist derived from evidence, not a dismissible marketing wizard:

- **OnboardingDefinition:** versioned steps and completion evidence requirements.
- **WorkspaceOnboardingState:** active version, started/completed timestamps and explicit skips.
- **OnboardingStepEvidence:** evidence reference for profile, import reconciliation, first completed follow-up, export/backup and provider UAT.

Suggested first-value sequence:

1. Confirm workspace profile, timezone and working hours.
2. Import and reconcile contacts.
3. Review duplicates and Needs review.
4. Complete a real follow-up.
5. Inspect Today and Alerts.
6. Connect one approved provider and execute its safe UAT.

Completion is calculated server-side from authoritative evidence where possible. A UI checkbox alone cannot mark import reconciliation or provider UAT complete.

### 3.8 Activity mobile reliability — establish a cross-cutting boundary

This is not a new database domain. It is a delivery invariant for every operational command surface:

- 390x844, 768x1024 and 1440x900 reference viewports;
- native 200% zoom/reflow;
- no page-level horizontal overflow;
- primary actions and interactive controls provide at least 44x44 effective mobile targets;
- task tables transform into semantic cards or use an explicitly labelled contained scroller;
- keyboard order, focus return, screen-reader names and reduced motion are tested;
- fixed shell/assistant elements cannot obscure the active control;
- pending mutations disable duplicate submission and announce outcome;
- route errors preserve filters and report what was not changed.

These become release gates for Activities and all later property/deal/financial surfaces.

## 4. Command contracts — CLI first

Every command accepts an authenticated `WorkspaceScope`, correlation ID, idempotency key for mutation, expected version where the aggregate is mutable, and returns the existing machine-readable envelope shape. User commands reject service-role credentials and caller-supplied workspace IDs.

Proposed resource families and minimum commands:

| Resource | Read commands | Mutation commands |
| --- | --- | --- |
| `properties` | list, show, search, history | create, update, archive, restore, link-identity |
| `listings` | list, show, history | create-draft, activate, transition, record-price-change, archive |
| `showings` | list, show, calendar-status | schedule, reschedule, cancel, record-outcome, reconcile-calendar |
| `deals` | list, show, history | create, update-parties, transition, link-property |
| `transactions` | list, show, timeline | create-from-evidence, transition, add/update/complete/waive milestone |
| `finance` | commission-summary, expenses, period-summary | set-agreement-version, record-adjustment, record-receipt, add/archive expense |
| `alerts` | evaluate, list, show, delivery-status | acknowledge, snooze, unsnooze, resolve, dispatch-due, reconcile |
| `provider-activities` | list, show, unmatched | normalize-batch, link, unlink, reconcile |
| `onboarding` | status, evidence | begin, skip-eligible, reconcile, complete-if-proven |
| `workspace-health` | readiness, dependency-health, queue-health | no generic mutation |

Stable error codes extend the current vocabulary:

- `invalid-input`, `forbidden`, `scope-mismatch`, `not-found`, `conflict`;
- `invariant-violation`, `provider-disabled`, `approval-required`;
- `authority-evidence-missing`, `reconciliation-required`, `rate-limited`;
- `legal-deadline-unverified`, `financial-source-unverified`.

CLI smoke tests are required before a route or dashboard is allowed to operate the corresponding capability.

## 5. Event and evidence contract

Extend the existing activity/evidence vocabulary additively. Events use stable type keys, actor membership, occurred/created timestamps, idempotency key, aggregate reference and allowlisted metadata.

Event families:

- `property.*`, `listing.*`, `showing.*`;
- `deal.*`, `transaction.*`, `milestone.*`;
- `commission.*`, `expense.*`;
- `alert.*`, `notification.*`;
- `provider-activity.*`, `onboarding.*`.

Do not place full e-mail bodies, SMS bodies, DM content, documents, bank information, OAuth material or unbounded imported fields in activity metadata. Metadata is an interpretive summary; sensitive content remains behind private encrypted references and retention policies.

Every dashboard number must expose:

- definition/version;
- source aggregate/query;
- as-of time;
- scope/filter;
- drill-through to contributing records;
- `insufficient evidence` rather than an invented zero when the source is absent.

## 6. API and UI projection strategy

The initial product remains a modular monolith. Server components and route handlers call application services; they do not query new tables directly. Repositories expose aggregate-oriented reads and commands. Narrow database RPCs are reserved for multi-record atomic invariants and job claims.

Read models should be purpose-built and bounded:

- Today owner summary;
- attention/alert summary;
- pipeline aging and movement;
- transaction deadline board;
- property/listing/showing schedule;
- financial period summary;
- connector health and provider timeline;
- onboarding readiness.

No dashboard controls a worker or provider directly. UI actions submit application commands, display the resulting receipt, and refresh projections.

## 7. Security, privacy and compliance controls

- Force RLS on every public workspace-owned relation and test two-workspace denial.
- Preserve service-only private schemas for OAuth, provider payloads, documents and sensitive receipts.
- Require owner role for provider administration, financial policy/configuration and irreversible administrative actions.
- Assistant capabilities remain allowlisted; no role may grant itself authority.
- Keep outbound content behind draft/version/approval binding where current connector architecture requires it.
- Require consent/suppression checks before SMS or marketing delivery.
- Treat transaction documents, financial data and identity documents as a new high-sensitivity class with retention, deletion and export policy before storage.
- Log correlation IDs and redacted identifiers only; never raw content or credentials.
- Rate-limit external/API writes and bound all list, export, normalization and worker batches.
- AI access is read-only by default. Any proposed mutation becomes an explicit versioned intent requiring the same authorization and evidence as a human command.
- Automated AI/provider intents must pass injection scanning and budget/routing governance.

## 8. Observability and operational SLO candidates

Product observability and infrastructure observability remain distinct.

### Reliability metrics

- command success/conflict/failure rate by resource;
- p50/p95 application-command latency and bounded projection latency;
- oldest due job, lease expiry, dead-letter and reconciliation-required counts;
- provider ingestion lag and unmatched-activity age;
- alert evaluation lag, delivery queue age and suppression counts;
- onboarding step age without storing sensitive step content;
- route error boundary frequency and client-side exception rate;
- mobile overflow/accessibility regression gate result.

### Business-operational measures

- contacts with and without next step;
- overdue/completed follow-ups;
- pipeline aging and movement;
- active listings and milestone deadlines;
- showings requiring outcome/follow-up;
- projected/earned/received commission shown separately;
- expenses by verified period;
- connector last confirmed success;
- import/review/deduplication backlog.

Initial SLO thresholds must be based on measured production baselines, not invented in architecture. Hard security conditions remain immediate alerts: cross-workspace denial failure, invalid webhook spike, credential/revocation failure and any secret/content logging detection.

## 9. Sequencing and dependency graph

### Gate 0 — restore trust before adding scope

1. Close Activities mobile reflow and accessibility regression.
2. Complete authenticated Judith journey and 144x79 import reconciliation.
3. Complete reversible dedupe/alias resolution before new aggregates reference contacts.
4. Close Today/design evidence gates and route recovery consistency.
5. Complete real Google/Mailchimp UAT; keep Meta/Twilio truthfully blocked until external prerequisites pass.

**Stop condition:** do not start transaction/finance writes while canonical contact resolution or authenticated production persistence is unproven.

### Gate 1 — operational event foundation

1. Approve domain language and state machines with Judith/product.
2. Add domain event registry and aggregate command conventions.
3. Add unified provider activity projection and contact/deal linking review.
4. Add persisted alert occurrence/user state/preferences using the existing rule engine.
5. Add onboarding evidence/readiness projection.

This gate provides shared evidence before property and finance breadth.

### Gate 2 — property/listing/showing vertical slice

1. Property aggregate and canonical address/identity review.
2. Listing lifecycle and party roles.
3. Showing lifecycle with Google Calendar as a reconciled binding.
4. CLI, repositories, RLS/RPCs, receipts and mobile UI.

Pilot with one manually created property/listing/showing flow before any MLS/portal ingestion.

### Gate 3 — deal/transaction/closing vertical slice

1. Deal aggregate without financial claims.
2. Transaction creation from explicit evidence.
3. Milestone lifecycle, reminders and deadline dashboard.
4. Append-only transition timeline and cancellation/reversal behavior.

### Gate 4 — commission, expense and owner dashboard

1. Versioned commission agreement.
2. Projected/earned/received commission events.
3. Expense lifecycle and transaction attribution.
4. Period read models and drill-through dashboard.

No P&L release until currency, reversals, split/referral examples and authoritative closing/receipt evidence pass UAT.

### Gate 5 — ecosystem expansion

Consider MLS/IDX, portal lead intake, document/e-sign and governed AI automation only after the core manual vertical slices are operational and each external provider has a verified security/licensing architecture.

## 10. Story slicing recommendation

Each row is an independent story or epic slice with a CLI-first acceptance boundary:

| Order | Slice | Exit evidence |
| ---: | --- | --- |
| 1 | Activities mobile reliability | 390/768/1440, 200% zoom, keyboard, touch targets and no page overflow |
| 2 | Canonical-contact resolution closure | merge apply/reverse, alias-aware reads/writes and two-workspace tests |
| 3 | Provider activity projection | idempotent normalization, unmatched review, timeline drill-through |
| 4 | Persistent alert lifecycle | occurrence dedupe, ack/snooze/resolve, preferences, receipts |
| 5 | Alert scheduler/delivery | bounded worker, quiet hours, consent, retry/reconciliation and kill switch |
| 6 | Evidence-backed onboarding | derived step completion, recovery and activation observability |
| 7 | Property foundation | create/update/archive/history with canonical identity safeguards |
| 8 | Listing lifecycle | versioned transitions, price history and party roles |
| 9 | Showing + Calendar binding | schedule/outcome/follow-up and provider reconciliation |
| 10 | Deal foundation | explicit parties/property/side and independent lifecycle |
| 11 | Transaction + milestones | contract evidence, deadline authority and transition history |
| 12 | Commission ledger | projected/earned/received separation and reversals |
| 13 | Expense ledger and period projection | verified inputs, drill-through and export |
| 14 | Realtor owner dashboard | only authoritative visualizations with definitions/as-of/drill-through |

Story creation belongs to @sm/@po; physical database design and migration review belong to @data-engineer; implementation belongs to @dev; release verdicts belong to @qa; deployment belongs to @devops.

## 11. Impact and backward compatibility

| Existing capability | Impact | Compatibility rule |
| --- | --- | --- |
| Contact pipeline | High semantic risk | retain existing stages and APIs; never silently map operational states |
| Contacts/import | High referential impact | resolve aliases before linking; preserve source facts and row receipts |
| Activities/tasks | Medium | extend event types additively; old readers ignore unknown families safely |
| Today/Alerts | High projection impact | version projections; preserve current deterministic rule evidence |
| Google Calendar | Medium | resource binding to showing/task; Omnix remains authority, provider is reconciled |
| Provider timeline | High privacy impact | normalize metadata only; content stays private/encrypted |
| Dedupe | Critical | no partial physical reparenting; whole-plan atomic apply/reverse required |
| Insights | High truth risk | withhold finance until transaction/commission sources exist |
| Operational API | Medium | new versioned resources; no breaking changes to current v1 contacts routes |
| Omnix AI | High authorization risk | read-only first; mutations through approved intent/command/receipt path |

Public API expansion should be additive under the existing version until a breaking semantic change requires `/api/v2`. Domain event payloads include their own schema version. Database migrations are forward-only; rollback disables new command entry points and retains audit evidence rather than destructively removing used tables.

## 12. Principal risks and mitigations

| Severity | Risk | Mitigation / gate |
| --- | --- | --- |
| Critical | Pipeline stage is treated as contract/financial truth | separate aggregates/state machines; explicit cross-domain commands only |
| Critical | Duplicate merge leaves dangling or misattributed transactions | finish alias-aware atomic apply/reverse before operational aggregates |
| Critical | Cross-workspace transaction or financial exposure | forced RLS, composite workspace FKs, two-workspace negative tests |
| Critical | Legal deadlines are inferred or stale | source/confidence authority, explicit confirmation, no legal-advice claims |
| Critical | External send is duplicated after ambiguous timeout | idempotency, fencing, receipt and reconciliation before retry |
| High | Scope expansion creates an unusable monolith | bounded contexts, vertical stories, shared command/event conventions |
| High | Provider content leaks into public timeline/logs | allowlisted metadata projection and encrypted private payload reference |
| High | Financial dashboard overstates revenue | projected/earned/received separation, definition/as-of/drill-through |
| High | Alert fatigue | rule versioning, dedupe windows, severity, preferences, quiet hours and digest |
| High | UI again leads implementation | CLI smoke and repository contract required before UI acceptance |
| Medium | Address normalization incorrectly merges properties | exact identities + manual review; no fuzzy automatic merge |
| Medium | Calendar drift causes missed showing | reconciliation job, visible state and manual fallback |
| Medium | Vendor lock-in | provider adapters, normalized projection, canonical Omnix aggregates |

## 13. Quality and release gates

Every slice must pass:

1. Approved story with requirements traceability and explicit out-of-scope.
2. Domain invariants and command contract review.
3. CLI deterministic and live-authenticated smoke before UI control.
4. Unit, repository, database/RLS and idempotency tests.
5. Two-workspace and owner/assistant permission matrix.
6. Concurrency, duplicate request, timeout and partial-failure tests.
7. `npm run lint`, `npm run typecheck`, `npm test`, production build and database tests.
8. 390/768/1440, native 200%, keyboard, screen-reader and reduced-motion checks for UI slices.
9. Populated, empty, loading, error, dense, permission-denied and stale-version states.
10. Production UAT with real account/provider where the capability depends on an external system.
11. Observability, kill switch, reconciliation and recovery runbook.
12. QA verdict PASS; green local tests alone do not prove operational readiness.

Additional finance gate: reconcile representative buyer-side, seller-side, split, referral, adjustment, cancellation and reversal examples to hand-calculated expected results.

Additional alert gate: prove no delivery during quiet hours, no delivery after suppression/revocation and no duplicate delivery under overlapping workers.

## 14. Definition of architectural completion

The system may be described as an operational independent-realtor platform only when:

- the current relationship CRM and import/dedupe foundation have production PASS evidence;
- property, listing, showing, deal, transaction and milestone authorities are operational;
- projected, earned and received financial facts are visibly distinct and reconcilable;
- alerts persist, respect user preferences and expose delivery/reconciliation truth;
- provider interactions appear in a canonical timeline without leaking sensitive content;
- onboarding is evidence-backed and Judith completes the critical journey without developer intervention;
- mobile, accessibility, security, backup/restore, observability and real-provider gates pass;
- unsupported areas such as document custody, e-sign, MLS or accounting are explicitly labelled, not implied.

“Best in market” remains a separate product claim requiring named competitive benchmarking and observed user outcomes; architecture and feature breadth alone cannot prove it.

## 15. Architectural recommendation

**GO, incrementally, with Gate 0 as a hard prerequisite.** The current modular monolith, Postgres/RLS foundation and connector job platform are appropriate for the documented 200–500 contact operating scale. A microservice split would add failure modes and cost without evidence of a scaling need.

The highest-value sequence is not to build every screen simultaneously. First make the existing Judith journey reliable, then establish shared alert/provider/onboarding evidence, then deliver one complete property-to-closing vertical slice, and only then expose commission and P&L. This order converts Omnix into an operating system without sacrificing its strongest differentiator: truthful, explainable relationship intelligence.

## Evidence reviewed

- `docs/audits/2026-08-20-independent-realtor-journey-ui-ux-audit.md`
- `docs/architecture/connector-security-jobs-approvals.md`
- `docs/architecture/data-portability-operational-api.md`
- `packages/crm/lib/domain/contact.ts`
- `packages/crm/lib/domain/activity.ts`
- `packages/crm/lib/data/pipeline-repository.ts`
- `packages/crm/lib/application/workspace-commands.ts`
- `packages/crm/scripts/crm-work-queue-cli.ts`
- `packages/crm/supabase/migrations/0001_init.sql` through `0027_contact_merge_foundation.sql`

