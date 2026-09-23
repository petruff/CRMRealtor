# Epic 11 — Realtor WOW: premium, focused, compliant

**Branch:** `codex/epic-11-realtor-wow` (local commits per phase, no push/deploy without authorization)
**Source:** System evaluation of 2026-09-23 (design, UX, innovation, security) for an independent Florida realtor.
**Quality bar (non-negotiable):** premium agency-grade UI, realtor-native language, accessible (WCAG 2.2 AA), responsive 375–1440+, light/dark, every phase closes with typecheck, lint, full tests, build and browser validation in demo mode.

## Decisions (approved 2026-09-23)
- New branch with one local commit per phase.
- Navigation restructured into five hubs (Today · People · Deals · Inbox · Omnix) plus More; every existing URL keeps working.
- Next.js → 15.5.24+, sharp → 0.35.4+ (critical RCE advisories).
- Features that need external accounts (Gemini audio, Web Push, 10DLC SMS, Gmail) ship complete behind flags with demo fallbacks; activation with the realtor's real accounts is a documented follow-up.

## Phases

| # | Phase | Outcome | Status |
|---|---|---|---|
| 1 | Security hardening | Next 15.5.26 + sharp 0.35.4 (npm audit: 0 vulnerabilities); CSP + HSTS + frame/sniff/referrer/permissions headers; optimizer limited to WebP; sign out of all devices; incident response + restore runbook. Server Action body limit kept at 15 MB (only authenticated, same-origin actions reach it; moving workbook upload to a route handler is tracked as follow-up) | Done |
| 2 | Premium design foundation + navigation | `premium.css` layer (elevation, rhythm, rail, sheets, lists) on the approved palette; five hubs (Today · People · Deals · Inbox · Omnix) + More; hub tabs; Inbox hub (replies, approvals, tasks, grouped deal/mailer alerts, never duplicating Today); raised Capture button + quick-capture sheet; `/capture` person picker; US date language | Done |
| 3 | Today reimagined + Power Hour | One ordered "Reach out now" queue with names, plain-language reasons and one-tap Call/Text/Brief/Log; Waiting on you, Moments, Business pulse; five redundant Today panels removed; `/power-hour` focus mode (URL-held session, note + follow-up in one tap, skip, completion summary) | Done |
| 4 | Voice capture | On-device dictation (browser speech recognition: no audio upload, no key, no cost) in capture recap, Power Hour, new note and note editing; hides itself where unsupported. Server-side Gemini audio transcription remains optional follow-up | Done |
| 5 | Morning brief notifications | Opt-in Web Push per device (Settings → Morning brief), names off the lock screen by default, local preview; RLS-scoped `push_subscriptions` (pgTAP 8/8 on stub schema); daily cron `/api/internal/push/morning-brief` at 11:00 UTC (≈7 AM ET), once per device per local day, silent on quiet days, dead endpoints revoked. Activation: VAPID keys + CRON_SECRET + migration | Done (activation pending) |
| 6 | Open House kiosk | `/open-house` setup (property from listings, optional staff PIN) → chrome-less `/open-house/kiosk` tablet sign-in: opt-in text/email consent stored with exact wording + version (TCPA), "working with an agent?" tagged `has-agent` and kept out of hot follow-up (NAR Art. 16), honeypot, returning visitors merged without downgrading consent, auto-reset thank-you, PIN-guarded exit; today's visitors list → Power Hour | Done |
| 7 | Florida deal compliance | "Florida readiness" on every active deal: written buyer agreement (buyer/dual side) and seller flood disclosure (Fla. Stat. § 689.302) derived from sourced milestones; missing items are attention before contract and urgent once under contract; one-step "Record it" saves a verified, audited milestone (or "doesn't apply" with a reason); gaps flow into Inbox. New milestone kind `buyer-agreement` (additive enum migration, pgTAP 2/2 on stub). Operational reminder, not legal advice | Done (migration pending) |
| 8 | Client portal | Per-deal private link (30/60/90 days, max 180 enforced in DB) shown once — only a SHA-256 hash is stored; copy / text / email share; view count and last opened; turn off anytime. Public `/portal/[token]`: property, status, countdown, what's next, timeline — never commission, notes or contact data; noindex + no-referrer. Anonymous access only through allowlisted `get_client_portal` RPC; RLS table (pgTAP 10/10 on stub) | Done (migration pending) |
| 9 | Referral engine | `/sphere`: sphere pulse (size, % touched in 90 days, referrals received), home anniversaries and birthdays in the next 30 days, past clients quiet for 90+ days, top referrers (from Referred by) — each with a personal EN/ES draft, open in Messages/Mail, copy, and "Mark sent" that logs the touch; Today's Moments links to the drafts | Done |
| 10 | AI guardrails + bilingual | Fair Housing linter (federal FHA § 3604(c), Fla. Stat. § 760.23, local source-of-income): live check in campaign composer and edit forms, server-side block on "must change" phrases before any campaign draft, findings shown on AI proposals in Approvals. English/Spanish drafts in the referral engine | Done |

## Definition of done per phase
1. Implementation through existing layers (UI → Server Action → command → repository → DB).
2. Additive migrations with pgTAP tests; no data loss; RLS preserved.
3. Unit/integration/interaction tests for behavior; full suite green.
4. Visual validation desktop + mobile, light + dark.
5. Plan table updated and phase committed locally.

## Activation checklist (nothing below has been done in any live environment)
1. Apply migrations in staging, run the full Supabase pgTAP suite, then production — in order:
   `20260923120000_editable_contact_notes`, `20260923130000_push_morning_brief`,
   `20260923140000_florida_deal_readiness`, `20260923150000_client_portal_links`.
   Each has a rollback/containment script in `supabase/rollbacks/`.
2. Morning brief: generate VAPID keys (`npx web-push generate-vapid-keys`) and set
   `NEXT_PUBLIC_OMNIX_PUSH_PUBLIC_KEY`, `OMNIX_PUSH_PRIVATE_KEY`, `OMNIX_PUSH_SUBJECT`; set `CRON_SECRET` in Vercel.
3. Client portal: set `NEXT_PUBLIC_SITE_URL` to the production origin so shared links never point at a preview URL.
4. Time zone: set `OMNIX_TIME_ZONE` (defaults to `America/New_York`).
5. Brokerage review: confirm the Florida readiness wording and Fair Housing phrase list with the broker of record.
