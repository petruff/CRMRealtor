# Omnix Operations and White-Label Architecture

**Status:** Approved direction for story decomposition
**Date:** 2026-08-24
**Owner:** @architect
**Requirements:** ROS-FR-01, ROS-FR-05, ROS-FR-12, ROS-FR-14; ROS-NFR-01, ROS-NFR-02, ROS-NFR-08, ROS-NFR-09; approved 2026-08-24 white-label commercial direction

## Decision

Omnix will evolve through two independent but compatible control planes:

1. **Operations control plane** — a durable workspace-scoped attention queue, deterministic priority and FIFO tie-breaking, lifecycle controls, automation rules, scheduler receipts, and governed actions.
2. **Commercial control plane** — workspace branding, product entitlements, and later billing-provider bindings. Billing is not required for the Judith workspace and must not appear in her current user experience.

The product remains a modular monolith on the existing Next.js, TypeScript, Supabase and Vercel stack. A service split, generic workflow language, or billing integration is not justified for the current scale.

## Existing foundation to preserve

- `WorkspaceScope`, `workspaces`, `workspace_members`, composite workspace foreign keys and RLS are the canonical tenant authority.
- CRM tasks represent explicit human commitments and remain mutable through their existing state machine.
- CRM activity events remain append-only evidence.
- Omnix alerts remain deterministic projections of authorized CRM facts.
- Provider jobs, receipts and worker authority remain provider-specific; the attention queue observes their truthful status but does not replace them.

## Operations bounded context

### Attention item versus task

An **attention item** is a system-detected obligation such as an unanswered new lead, overdue follow-up, task deadline, missing next touch, provider failure or data-quality problem. A **task** is an explicit human commitment. One attention item may reference a task, but materialization must not create duplicate tasks silently.

### Durable identity

Every attention occurrence has:

- workspace-scoped identity;
- rule and category;
- subject type and subject ID;
- stable occurrence key derived from the authoritative fact that triggered it;
- source fingerprint for reconciliation;
- deterministic priority class;
- due/SLA time when known;
- immutable enqueue sequence;
- owner membership when assigned;
- current lifecycle state and append-only lifecycle events;
- sanitized evidence and safe in-product destination.

Daily wording such as “2 days overdue” must not participate in occurrence identity. Completing an occurrence suppresses the same source fingerprint; a materially changed authoritative fact may create a new occurrence.

### Lifecycle

Allowed states are `open`, `acknowledged`, `snoozed`, `completed`, `dismissed`, and `escalated`.

- `acknowledged` retains the item in the active queue and records ownership awareness.
- `snoozed` requires a future `snoozed_until`; the scheduler returns it to `open` when due.
- `completed` records that the required work was performed; it never fabricates provider activity.
- `dismissed` requires a bounded reason and is available only where the rule permits dismissal.
- `escalated` remains active and records why normal SLA handling was insufficient.

All transitions are idempotent, optimistic-concurrency protected and represented by append-only events.

### Priority and FIFO

The queue is ordered by deterministic keys, never by a generative model:

1. effective priority class (`P0` through `P4`);
2. SLA breach state;
3. due/SLA instant, nulls last;
4. immutable enqueue sequence;
5. stable item ID.

FIFO applies only inside the same effective priority and deadline class. Bounded aging may promote an old item by one class using explicit thresholds; it must never demote a new inbound response, transaction deadline or compliance failure.

Initial classes:

- `P0`: new inbound lead/reply, immediate appointment intent, critical transaction deadline, critical connector/compliance failure;
- `P1`: overdue Hot/active follow-up, overdue task, under-contract record missing a next action;
- `P2`: due-today work and Warm follow-up;
- `P3`: Nurture, past-client, birthday, home anniversary and mailer work;
- `P4`: data quality and non-blocking administration.

### Reconciliation and execution

- A CLI command materializes the authorized deterministic alert projection into durable occurrences before any UI control is added.
- A server-only scheduled route invokes the same application service with bounded workspaces, idempotency, a lease, retry limits and receipts.
- Today, Alerts and Omnix read one ordered projection; they cannot maintain competing priority logic.
- Safe internal actions may acknowledge, snooze, complete, assign or create a draft. Provider sends, bulk changes, merges, deletes, financial mutations and pipeline changes remain approval-gated.
- Every automated intent is allowlisted and validated. Free-form assistant text is never executable authority.

## White-label bounded context

### Commercialization modes

White-label commercialization is progressive rather than a single tenant switch. The same
workspace authority remains canonical in every mode:

1. **Omnix SaaS** — the shared Omnix product identity, platform authentication and managed
   application domain. This is the first commercially supportable mode.
2. **Branded workspace** — workspace-approved business name, logo, constrained palette,
   support identity and communication presentation inside the shared Omnix application.
   Authentication and provider consent continue to identify the trusted platform operator.
3. **Full white-label** — a verified customer-facing application domain and tenant brand.
   Tenant-specific provider consent, sender infrastructure or install identity is a separate
   operational capability, not an automatic consequence of changing UI tokens.

These modes are capability packages, not authorization roles. A workspace cannot gain data,
connector or administrative authority through its brand or hostname.

### Authentication and domain boundary

The standard SaaS and branded-workspace modes use one platform-controlled authentication
domain such as `auth.<platform-domain>`. Google and other identity-provider branding identifies
the platform application and operator consistently; it cannot be dynamically relabeled from an
untrusted request hostname.

An application custom domain resolves to a workspace only after server-side ownership
verification. The resolver returns an immutable workspace binding plus brand-profile version;
it never accepts a browser-supplied workspace ID. Unknown, pending, disabled or conflicting
hosts fail closed to the shared Omnix identity and cannot expose tenant data.

Full tenant-specific OAuth branding requires an explicitly provisioned provider application or
credential set, verified callback domains, revocation ownership and support procedures for that
workspace. Shared Gmail, Calendar, Mailchimp or social connector credentials must not be reused
silently for tenant login branding. Provider consent branding remains truthful even when the CRM
presentation is white-labeled.

Host-derived branding must be included in cache keys or rendered dynamically with private/no-store
semantics. Metadata, manifests, icons, login copy, support links and legal links may be tenant-aware
only after the same verified host resolution; static assets and service-worker caches must not leak
one realtor's identity into another workspace.

### Tenant model

Each realtor organization is one workspace. Every tenant-owned row continues to carry canonical `workspace_id`; branding, entitlement and future billing records are no exception. Custom domains resolve to a workspace only through a server-maintained verified-domain binding.

### Branding

A future `workspace_brand_profiles` aggregate may provide:

- public product name and short name;
- approved logo/icon assets;
- constrained palette tokens with contrast validation;
- sender display identity where provider policy permits it;
- verified custom domain status;
- support contact and legal-document links.

Branding changes presentation only. They cannot alter authorization, OAuth redirect authority, data retention, consent or provider ownership.

### Entitlements before billing

Capability access is governed by workspace entitlements, not direct checks against Stripe or a plan name. Initial grant sources are `early_access`, `manual`, and later `billing`.

Judith's workspace requirements are explicit:

- active `early_access` grant;
- no payment method requirement;
- no trial countdown;
- no billing navigation, price, invoice or upgrade prompt in her current experience;
- no automatic conversion from early access to paid;
- any future commercial migration requires an explicit product decision and notice.

The billing provider is introduced later behind a separate adapter. Provider customer IDs, subscription IDs and webhook receipts do not become tenant authority and do not appear in authorization predicates.

Initial packaging remains provider-neutral. `early_access`, `manual` and future `billing` grants
authorize typed capabilities; product names, prices, trials, annual discounts and usage limits are
not inferred by the application. Judith's non-expiring early-access grant is evaluated before any
paid-plan presentation and is independently regression-tested.

### Commercial isolation gates

Before selling the product to another realtor:

- two-workspace RLS and repository tests cover every tenant-owned domain;
- branding cannot leak between hosts, sessions or cached responses;
- connector credentials, webhooks and OAuth transactions remain workspace-bound;
- usage limits fail closed and are observable without exposing another tenant's counts;
- owner/assistant permissions are configurable through typed capabilities;
- export, retention, support access and account closure are documented and tested;
- billing webhooks are signed, idempotent, replay-safe and reconciled;
- the Judith early-access grant is regression-tested independently of paid plans.

## Delivery sequence

1. Persistent attention lifecycle and deterministic priority queue.
2. Scheduler, preferences, quiet hours and delivery receipts.
3. Governed Omnix action registry and approval center.
4. Workspace brand profiles and verified host resolution.
5. Entitlement registry with Judith early-access seed/operation.
6. Billing-provider adapter, plans and monthly/annual checkout only after commercial requirements and support operations are approved.

### Commercialization sequencing verdict — 2026-08-28

The current workspace/RLS foundation makes the white-label direction feasible, but commercial
implementation is **not yet admitted**. Story 6.1 and the Epic 6 Wave 0 operational/UAT gates still
contain open CLI, persistence, scheduler, second-workspace isolation and authenticated Judith
evidence. Starting billing, custom-domain activation or tenant branding UI before those gates would
create a second release surface on top of unresolved core operations.

The admitted work at this stage is architecture and test-contract preparation only. The first
implementation story for workspace brand profiles, verified host resolution and early-access
entitlements may move from Draft to Ready only when:

- the current Judith owner and assistant journeys pass authenticated production UAT;
- Story 6.1 closes its CLI, persistence, scheduler, repository and two-workspace isolation criteria;
- public homepage, privacy, terms and support links required by identity-provider branding are
  reviewed and available;
- support access, export, retention, closure and recovery ownership are approved; and
- the Product Owner approves the standard SaaS versus branded-workspace packaging boundary.

Billing remains a later story even after that foundation. No checkout, price, trial, invoice or
payment-provider dependency is introduced by the brand-profile/entitlement foundation.

## Explicit non-decisions

- No billing provider is selected or integrated by this architecture decision.
- No price, trial length, plan limit or annual discount is invented.
- No unrestricted service-role or direct database access is granted to Omnix.
- No autonomous client-facing email or text is enabled.
- No claim is made that the application is ready for multi-customer sale until the commercial isolation gates pass.

## Rollback and compatibility

All schema changes are additive. Existing alert projection and task commands remain usable if attention materialization is disabled. New workers are feature-gated and can be stopped without deleting occurrences or lifecycle evidence. Branding defaults to the existing Omnix identity, and absence of an entitlement record must fail closed only for future commercial-only capabilities—not disable Judith's current core CRM during the transition.
