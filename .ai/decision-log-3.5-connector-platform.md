# Decision Log 3.5 — Connector platform execution architecture

Date: 2026-08-11  
Status: Accepted for implementation after Story 3.5 dependency correction  
Owners: Architecture, Product, Security, Platform  
Related: `docs/stories/3.5.connector-security-jobs-approvals.story.md`

## Context

Omnix needs a shared, secure foundation for Gmail, Google Calendar, Mailchimp, Twilio texting, and Meta Instagram/Facebook. The current product has workspace authority and an internal CRM work queue but no provider token vault, provider durable queue, execution approvals, signed webhook ingress, or provider adapter layer.

The product stack is Next.js 15 on Vercel with Supabase Postgres/Auth. Current scale is approximately 200–500 contacts, but provider calls still require durable execution because cron delivery, function execution, networks, and provider callbacks can duplicate, overlap, fail, or return ambiguous outcomes.

## Dependency decision

Story 3.5 depends on Stories 3.0 and 3.1, not the full Story 3.2:

- 3.0 owns `WorkspaceScope`, workspace membership, owner/assistant roles, and RLS.
- 3.1 owns the relevant idempotency, immutable evidence, task, atomic operation, and CLI-first patterns.
- 3.2's rich contact lifecycle is orthogonal to connector security and durable execution.

The Story 3.5 dependency must be corrected before Draft-to-Ready transition. This decision is also approved by the product-owner validation at `.ai/product-owner-connector-validation-2026-08-11.md`.

## Options

### A. Supabase durable queue + Vercel Cron + Next.js worker

Use Postgres as the durable state authority. Vercel Cron wakes a protected, bounded worker route. Jobs are claimed atomically with `FOR UPDATE SKIP LOCKED`, a lease, and a monotonically increasing fencing token.

- Advantages: approved stack; transactional intent/approval/job/receipt writes; CLI-visible; no second queue vendor; proportionate to current scale.
- Disadvantages: polling latency; Vercel plan/frequency/function-duration dependency; strict service-role isolation; long work must be decomposed.

### B. Supabase scheduling + Edge Functions

Use `pg_cron`/`pg_net` and Supabase Edge Functions.

- Advantages: database-adjacent scheduling.
- Disadvantages: second application runtime and secret path; greater local/production divergence; still needs durable database state.

### C. External workflow/queue platform

Use a managed workflow engine or cloud queue.

- Advantages: richer orchestration, scheduling, and operations.
- Disadvantages: new vendor/cost/data boundary; requires an outbox to retain transactional integrity; unjustified at current scale.

## Decision

Choose Option A.

Vercel Cron is only a wake-up mechanism. Supabase Postgres owns jobs, approvals, leases, fencing, attempts, reconciliation, and append-only receipts. Duplicate cron invocations and worker crashes are expected operating conditions.

Connector OAuth remains separate from Supabase sign-in. Secrets use AES-256-GCM envelope encryption with a per-secret DEK and versioned server-only KEK. External writes bind owner approval to an immutable intent version and payload hash. Provider adapters receive ephemeral decrypted values but no repositories or caller-selected workspace. Signed webhooks are verified from raw bytes and deduplicated before asynchronous processing.

The platform promises exactly one durable approval-to-job insertion and at-least-once job pickup, not exactly-once remote delivery. Ambiguous, non-idempotent provider outcomes enter reconciliation instead of blind retry.

## Consequences

Positive:

- Keeps authorization and audit state in one transactional authority.
- Preserves the approved Next.js/Supabase/Vercel deployment model.
- Gives every provider a consistent security, approval, receipt, and failure contract.
- Supports provider-disabled development and deterministic tests before credentials exist.

Negative:

- Requires private schemas, narrow service-role repositories, crypto/key-rotation operations, queue sweeps, and operational alerts.
- Provider-specific reconciliation remains necessary.
- Provider verification, Meta review, Twilio compliance, and live-account tests remain external blockers.

## Revisit triggers

Re-evaluate Option C when measured evidence shows one or more of:

- Queue SLO cannot be met within Vercel cron/function limits.
- Sustained concurrency or throughput makes Postgres polling operationally costly.
- Workflows require long-running orchestration that cannot be safely decomposed.
- Dead-letter/reconciliation operations exceed the team's supported burden.

Do not switch based only on anticipated growth.

## Backward compatibility and rollback

The change is additive. Existing sign-in, workspace, activity/task, sample-data, and connection-placeholder behavior remains. Providers default disabled.

Rollback disables provider flags and new enqueue first, preserves durable evidence, reconciles uncertain jobs, and uses forward-only database corrections. Old KEKs remain available until every envelope is rewrapped and verified. Application rollback requires an explicit cron configuration check.

## Required implementation references

- `docs/architecture/connector-security-jobs-approvals.md`
- `docs/architecture/config/connector-platform.example.yaml`
- `docs/qa/gates/3.5-connector-security-jobs-approvals-architecture.yml`
