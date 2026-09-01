# Omnix Florida AI Operating System — Implementation Map

**Source PRD:** `docs/prd/omnix-florida-ai-operating-system-prd.md`
**Execution model:** four gated sprints, with Sprint 0 completing production trust before additive product scope
**Scope boundary:** this project remains Judith's Omnix CRM. White-label, billing, tenant self-provisioning, custom domains, and reseller controls are deferred to a future repository copy.

## 1. Delivery principles

1. Reuse and complete existing stories before creating overlapping work.
2. Keep implementation, integration, automated verification, provider UAT, and production release as separate evidence states.
3. Preserve one canonical workspace owner, bounded assistant authority, workspace RLS, immutable receipts, idempotency, and explicit recovery.
4. AI may retrieve, explain, prioritize, and propose. Any external send or material CRM mutation remains governed by typed authority and approval contracts.
5. User-facing records use realtor language. Technical diagnostics remain redacted and progressively disclosed to authorized support.
6. Every sprint exits only after lint, typecheck, focused tests, full tests, build, migration replay, security checks, accessibility/responsive verification, and applicable authenticated/provider UAT.

## 2. System ownership boundaries

| Boundary | Canonical authority | Invariants |
| --- | --- | --- |
| Identity and workspace | Workspace membership plus canonical-owner and explicit support-grant contracts | Support never becomes owner; cross-workspace access fails closed. |
| Contact relationship | Contact, source facts, consent, contact points, household links, memory, and lifecycle history | Provider records enrich but do not replace canonical identity. |
| Lead and relationship priority | Lead type, pipeline stage, attention projection, Next Best Action, and history | Model output cannot silently rewrite source truth. |
| Transactions | Transaction, parties, property reference, milestones, financial ledger, and transaction history | Contact pipeline and transaction status remain separate concepts. |
| Providers | Connector account, capability grants, selected resources, checkpoints, jobs, receipts, and lifecycle projection | OAuth success alone never means operational readiness. |
| AI | Bounded retrieval, prompt guard, model run, evaluation, cited output, proposal, approval, execution, and reconciliation | No uncited claim, silent write, unbounded content access, or provider action. |
| Release | Exact Git revision, migration manifest, test evidence, deployment receipt, smoke evidence, and recovery decision | Local success never proves production or provider readiness. |

## 3. PRD-to-story reconciliation

### Sprint 0 — Production trust and operational closure

| Work item | Existing ownership | Current evidence state | Required action before exit |
| --- | --- | --- | --- |
| S0.1 Migration and release authority | Stories 3.29, 6.8, 6.9, 6.11, 6.12 | Application and SQL hardening exist; an uncommitted Google-insights ACL migration and paired recovery/test artifacts are present. | Reconcile migration history, inspect the pending migration, run isolated replay and SQL/RLS tests, bind release evidence to one clean SHA, and preserve rollback/forward-repair receipts. |
| S0.2 Import and duplicate recovery | Stories 3.7, 3.15, 3.31, 6.7, 6.11, 6.12 | Atomic import and classification contracts exist; real-file parity, duplicate merge completion, and authenticated post-import UAT remain incomplete. | Complete real-format fixtures and long-cell behavior, deterministic status/pipeline mapping, import summary/review navigation, reversible duplicate handling, and whole-plan recovery evidence. |
| S0.3 Google and Mailchimp reconciliation | Stories 3.31, 4.1, 4.2, 4.5, 5.2, 6.10 | Connector implementation and canonical lifecycle projection exist; real-account Mailchimp baseline/webhook/reconciliation, Gmail restricted-scope consent, and end-to-end provider receipts remain open. | Prove capability-by-capability readiness, execute provider UAT with owner authority, retain deterministic degraded states, and close contradictory lifecycle evidence. |
| S0.4 Owner/assistant UAT | Stories 6.8, 6.9, 6.12 | Canonical owner and support contracts are implemented; live redacted authority and clean-assistant journey remain open. | Verify Judith as canonical owner after migration, verify assistant allow/deny matrix across UI/API/RPC, re-login persistence, and cross-workspace failure. |
| S0.5 Mobile/PWA closure | Stories 3.22, 6.4, 6.5, 6.6, 6.7, 6.12 | PWA and broad responsive work exist; exact-candidate authenticated regression and physical iPhone 11/PWA UAT remain open. | Run the critical route matrix at 390/768/1440, iPhone 11 Safari, installed PWA, offline/reconnect/update, keyboard, zoom, and reduced-motion states. |
| S0.6 Observability and recovery | Stories 3.29, 3.31, 6.3, 6.8, 6.10–6.12 | Redacted support references, release manifest, and recovery design exist. | Verify no PII/secret leakage, provider uncertainty handling, backup/read-back, app rollback, database forward repair, and runbook ownership on the exact candidate. |

**Sprint 0 disposition:** amend and close the listed stories; do not create duplicate feature stories. A Sprint 0 release decision is a QA/DevOps evidence package, not a new product implementation.

### Sprint 1 — Florida transaction and affordability operating system

| Work item | Existing ownership | Gap classification | Story action |
| --- | --- | --- | --- |
| S1.1 Transaction cockpit | Story 6.2 plus current transaction domain/routes | Extend | Create Story 7.1 for multi-transaction types, parties, listing/lease/referral fields, documents, history, and explicit separation from contact pipeline. |
| S1.2 Critical dates and risk | Story 5.2 transaction deadlines plus attention foundations | Extend | Create Story 7.2 for canonical Florida milestone catalog, responsibility, source/version history, contradiction handling, and unified attention materialization. |
| S1.3 Commission intelligence | Story 6.2 and Insights | Extend | Create Story 7.3 for splits, referral fees, booked-versus-forecast semantics, profitability, period/source drill-through, and missing-data states. |
| S1.4 Florida workflow packs | No complete existing owner | New | Create Story 7.4 for versioned buyer/seller/condo/flood/association/closing packs, source links, acknowledgement, evidence, and legal boundaries. |
| S1.5 Affordability studio | No complete existing owner | New | Create Story 7.5 for reproducible scenarios covering mortgage, tax, insurance, HOA/condo, assessments, maintenance, closing costs, provenance, freshness, and consented handoff. |
| S1.6 Transaction UX and UAT | Stories 6.3–6.6 patterns | New release story | Create Story 7.6 for premium transaction UX, accessibility, mobile/PWA, recovery, and representative buyer/seller/condo journey evidence. |

### Sprint 2 — Governed AI second brain and relationship growth

| Work item | Existing ownership | Gap classification | Story action |
| --- | --- | --- | --- |
| S2.1 Relationship memory and NBA | Stories 5.2 and 6.1 | Complete and harden | Amend Story 5.2 to finish source-hashed memory invalidation, one-current-NBA constraints, manual evidence preservation, and prioritized inbox integration. |
| S2.2 Natural-language Omnix and evaluation | Stories 5.1 and 5.2 | Complete provider evaluation | Finish exact Judith-configured Gemini corpus, budget/fallback evidence, cited as-of responses, and activation decision without weakening deterministic routing. |
| S2.3 Inbound response intelligence | Story 5.2 Gmail insights | Complete owner consent and UAT | Finish restricted-scope consent, bounded content retrieval, guard/eval evidence, metadata fallback, revocation, and retention/deletion verification. |
| S2.4 Governed actions and approvals | Stories 3.5, 4.2–4.5, 5.1, 5.2 | Extend typed workflow coverage | Complete persistent proposal versioning, stale/expiry/concurrency checks, recovery, and governed task/pipeline/nurture/Gmail/Calendar/SMS/Mailchimp actions. |
| S2.5 Relationship growth lifecycle | Story 5.2 nurture model and scheduler | Complete lifecycle/UAT | Finish start/pause/resume/snooze/stop/opt-out behavior, birthday/anniversary/review/referral/annual-check-in materialization, quiet hours, suppression, and scheduler recovery. |
| S2.6 Proactive Today command center | Stories 3.13, 5.2, 6.1, 6.3 | Extend | Create Story 8.1 for one prioritized Today projection spanning replies, deadlines, approvals, relationships, provider degradation, business pulse, unknowns, and exact contributors. |

### Sprint 3 — Property intelligence, lead conversion, and final premium release

| Work item | Existing ownership | Gap classification | Story action |
| --- | --- | --- | --- |
| S3.1 Property and listing domain | No complete existing owner | New | Create Story 9.1 for property identity, provenance, licensing state, freshness, contact interests, transaction links, RLS, and retention. |
| S3.2 Website intake and attribution | Story 4.4 intake patterns; no first-party web intake owner | New | Create Story 9.2 for signed/idempotent forms, consent, attribution, identity resolution, classification, response attention, replay/rate/size protection, and safe outcomes. |
| S3.3 Licensed IDX/RESO adapter | No authorized provider contract | Conditional new | Create Story 9.3 for provider-neutral adapter contracts, fixtures, licensing evidence, disabled behavior, reconciliation, and conditional live UAT. |
| S3.4 Property behavior and CMA | No complete existing owner | New | Create Story 9.4 for authorized engagement signals, proposed actions, CMA intake, licensed comparable provenance, uncertainty, and explicit blocked states. |
| S3.5 Omnichannel and conversion intelligence | Stories 4.1–4.4, 5.2 | Extend | Create Story 9.5 for one consent-aware timeline, response timers, source attribution, conversion/stage aging, provider deduplication, and channel-disabled behavior. |
| S3.6 Final premium audit and release UAT | Stories 6.3–6.12 patterns | New release story | Create Story 9.6 for exact-candidate owner/assistant/device/PWA/accessibility/performance/security/privacy/provider/recovery matrices and final release disposition. |

## 4. Ordered dependency graph

1. Sprint 0 authority, migration history, import integrity, connector truth, and recovery evidence.
2. Sprint 1 canonical transaction/property-reference and milestone/financial truth.
3. Sprint 2 memory, attention, proposal, scheduler, and governed AI operating loop.
4. Sprint 3 property/licensed-data boundaries, first-party intake, engagement, omnichannel analytics, and final release.

No later sprint may bypass a failed earlier invariant. Conditional provider work remains disabled without credentials, contractual rights, approved scope, and owner UAT.

## 5. Required evidence package per story

- Validated story with explicit dependencies, acceptance criteria, tasks, file plan, rollback, and test plan.
- Architecture and schema decisions where boundaries or authoritative entities change.
- Focused unit/contract/integration tests plus negative, replay, concurrency, revocation, and cross-workspace tests where applicable.
- Migration, rollback or forward-repair artifact, clean replay, and RLS evidence for every schema/authority change.
- Responsive/accessibility evidence for every new read and mutation surface.
- Redacted observability and a user-safe failure/recovery state.
- Updated story checklist, file list, implementation record, QA verdict, and release disposition.
- Exact-candidate lint, typecheck, full test, build, secret/dependency scan, migration validation, and deployment smoke before release.

## 6. Immediate execution gate

Sprint 0 begins with the current dirty working tree preserved. The pending Story 5.2 and Google-insights ACL artifacts must be reviewed as existing work, not silently replaced. The first implementation slice is complete only when:

1. all pending migration artifacts are internally consistent and replay-tested;
2. Stories 6.9–6.12 have evidence-backed QA dispositions;
3. Story 5.2 accurately separates locally implemented capabilities from live provider/model/device evidence;
4. the exact candidate passes mandatory local gates; and
5. remaining owner/provider/device actions are listed as external UAT steps rather than reported as completed.
