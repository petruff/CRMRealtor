# Tech Stack — Omnix

**Owner:** @architect (Vega) · **Date:** 2026-08-10
**Basis:** `requirements-analysis-v2.md` phase 1 boundary (approved 2026-08-10)

---

## Constraints driving the decision

| Constraint | Source | Consequence |
|---|---|---|
| 200–500 contacts | Client §1 | **No scaling architecture.** Rules out queues, caching layers, sharding. Any "web scale" design here is waste. |
| Single user ("personal app for now") | Paulo 2026-08-10 | Google OAuth stays in **Testing mode** — no paid security assessment for Gmail in phase 2. Roles still modelled, not enforced. |
| Mobile-first, stunning desktop, premium design | Paulo 2026-08-10 | Design system is a first-class deliverable, not a CSS afterthought. |
| One-click sign-in | Client §8 grievance | Google sign-in only. No password, no email confirmation, no MFA prompts. |
| Gmail + Calendar in phase 2 | Phase plan | Auth provider must be Google and must retain a refresh token with incremental scope. |
| Mailchimp sync, SMS later | Phase plan | Needs server-side scheduled jobs and webhook endpoints. |
| "As soon as possible" | Client §8 | Boring, well-trodden stack. Zero novel infrastructure. |

## Decision

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | Server components keep the client bundle small on mobile; route handlers give us the webhook endpoints Mailchimp and SMS need later without a second service. |
| Styling | **Tailwind CSS v4** | Mobile-first by default (unprefixed = smallest breakpoint). Design tokens live in CSS custom properties, which is how the premium look stays consistent. |
| Database + Auth | **Supabase** (Postgres + Auth) | Google sign-in is native — directly answers the sign-in grievance. Postgres gives real dates and constraints, which a birthday/anniversary/cadence engine needs. RLS is ready when the assistant returns. |
| Scheduled work | **Vercel Cron** → route handlers | Nightly touch-date recalculation and Mailchimp sync. No worker service to run. |
| Hosting | **Vercel** | One-command deploy, preview URLs, cron included. |
| Icons | **Lucide** | Consistent stroke weight; matters for a premium feel. |

**Deliberately excluded from phase 1:** component libraries with a recognisable default look (a stock shadcn install reads as a template, and "premium design" is an explicit requirement), state managers (server components + URL state suffice at this size), ORMs (typed Supabase client is enough), and test infrastructure beyond what the cadence logic needs — the pure functions get unit tests, the UI does not yet.

## Data-layer approach for phase 1

The schema is authored as SQL migrations from day one. The UI is built against a **typed repository interface** with a seeded in-memory implementation, so the app runs and looks finished before any cloud project exists.

This is not scaffolding-for-its-own-sake: it means the design work — the part Paulo asked to be stunning — proceeds without waiting on credentials, and swapping to the Supabase implementation touches one module.

## Phase 2+ implications to keep in mind now

- **Google OAuth incremental scope.** Phase 1 requests only `openid email profile`. Phase 2 adds `gmail.send`, `gmail.readonly`, `calendar.events`. Requesting them early would show her a frightening consent screen for features that do not exist yet.
- **Testing mode holds only while it is genuinely one user.** When the assistant arrives, re-verify before promising Gmail.
- **Mailchimp:** one-way (CRM → Mailchimp) plus an inbound unsubscribe webhook. Two-way on a single shared list needs loop prevention and is deferred deliberately.
- **SMS:** 10DLC registration is a weeks-long external dependency. Nothing in the codebase blocks on it; start the paperwork in parallel.

## Source tree

```
packages/crm/
├── app/                  # routes; (app) group = authenticated shell
├── components/           # UI primitives + feature components
├── lib/
│   ├── domain/           # contact model, cadence + triage logic (pure, tested)
│   ├── data/             # repository interface + implementations
│   └── design/           # tokens
└── supabase/migrations/  # SQL
```
