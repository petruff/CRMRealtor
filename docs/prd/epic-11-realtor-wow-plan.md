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
| 2 | Premium design foundation + navigation | Refined tokens (type scale, elevation, warm neutrals), redesigned shell, five hubs, Inbox hub, mobile tab bar with central Capture, US date/time formatting, realtor language | Planned |
| 3 | Today reimagined + Power Hour | One ordered focus queue with names and plain reasons, actionable first fold on mobile, no duplicated panels; Power Hour mode (one person at a time, call, capture, auto-next) | Planned |
| 4 | Voice capture | Record after a call/showing → transcript → notes, tasks, next date and draft follow-up through the existing governed capture pipeline | Planned |
| 5 | Morning brief notifications | Opt-in Web Push "3 calls + today's deadlines" at the realtor's local morning, VAPID keys server-only | Planned |
| 6 | Open House kiosk | QR/tablet sign-in with TCPA-grade consent record, instant thank-you, lead routed and classified | Planned |
| 7 | Florida deal compliance | Buyer agreement before touring (NAR settlement), seller flood disclosure (Fla. law eff. 2025-10-01) tracked on deals with warnings | Planned |
| 8 | Client portal | Private, expiring, read-only link per buyer/seller: timeline, next steps, key dates | Planned |
| 9 | Referral engine | Past-client moments (homeaversary, birthday, market update) with ready-to-send drafts | Planned |
| 10 | AI guardrails + bilingual | Fair Housing linter on generated marketing copy; EN/ES drafting for client messages | Planned |

## Definition of done per phase
1. Implementation through existing layers (UI → Server Action → command → repository → DB).
2. Additive migrations with pgTAP tests; no data loss; RLS preserved.
3. Unit/integration/interaction tests for behavior; full suite green.
4. Visual validation desktop + mobile, light + dark.
5. Plan table updated and phase committed locally.
