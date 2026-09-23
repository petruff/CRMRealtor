# Omnix AI and UX System Audit — 2026-08-30

## Decision

**Release status: BLOCKED.** The application foundation is strong, Judith's canonical owner membership and the remote Story 5.1 migration are verified, and the corrected local quality gates pass. Production still cannot be described as fully ready until the provider, authenticated-device, and deployment gates below have current evidence.

This audit is bounded to the current repository, the authenticated production session available to the developer account, current production screenshots, CLI execution, and local automated gates. It does not substitute for Judith's owner-authorized provider consent or physical iPhone 11 testing.

## Evidence reviewed

- Authenticated production routes at 1440px and 390px: Today, Omnix AI, Contacts, Pipeline, Insights, Connections, and Settings.
- Current screenshots in `docs/audits/evidence/2026-08-30-ai-ux-system-audit/`.
- Story 5.1 architecture, policy, budget, prompt guard, Gemini routing, grounded narration, workspace AI configuration, and approval boundaries.
- CLI entrypoints for Omnix, imports/data, and connectors.
- Local lint, typecheck, targeted tests, full tests, and production build attempt.

## Corrected in this audit

1. **P0 — Omnix CLI was not executable.** `omnix:copilot` failed while resolving `next/headers`; `omnix:ai` failed on TypeScript module resolution and its help path loaded runtime authority. Imports and the help contract were corrected. Both commands now start without loading browser authority.
2. **P0 — Connector CLI was not executable.** Native Node TypeScript stripping rejected constructor parameter properties in Google, Mailchimp, and Twilio adapters. The adapters now use explicit fields and constructors; connector help executes.
3. **P1 — Data CLI failed before reaching its usage contract.** A runtime path alias in contact import classification was replaced with an explicit TypeScript-relative import. The command now reaches its documented usage response.
4. **P1 — Omnix displayed a false static AI state.** The page always said that no generative model was connected. It now reads a safe member-facing workspace capability projection and independently reports `Gemini ready`, `AI setup available`, or `AI needs attention` without returning the secret or its fingerprint.
5. **P1 — Mobile navigation hid core business surfaces.** Pipeline, Insights, Mailers, Campaigns, and Data tools were not reachable from the mobile shell. Omnix is now thumb-reachable in the primary mobile navigation and every omitted business route is available under More.
6. **P1 — Floating Omnix control covered mobile content.** The floating assistant launcher is now desktop-only; mobile uses the primary navigation destination. The assistant dialog itself remains available from the dedicated Omnix route.
7. **P1 — Today used conflicting alert language.** Immediate attention could correctly be zero while the seven-day planning horizon contained hundreds of future alerts, but the page called both values “current.” The interface now distinguishes immediate attention from the full alert planning horizon.
8. **P1 — AI privacy copy was inaccurate.** Settings claimed only the question left Omnix, while grounded narration intentionally sends a minimized cited fact projection. The copy now states that the question and minimized cited facts are sent, and explicitly excludes email addresses, phone numbers, provider credentials, and raw authorization data.
9. **P2 — AI setup deep link had no target.** The owner setup surface now has a stable `#ai` anchor and scroll offset.
10. **P0 — AI capability checked the wrong membership table.** The assistant-safe capability projection queried the nonexistent `workspace_memberships` relation. It now verifies the active, workspace-bound membership against `workspace_members`, with focused regression coverage.
11. **P1 — AI runs had no owner-facing operational projection.** Settings now presents redacted daily run, committed-cost, completed, and attention totals from the Story 5.1 ledger. It never queries or renders prompts, generated responses, contact facts, or credentials and fails closed if the ledger becomes unavailable.
12. **P0 — Judith's canonical owner authority is verified.** A read-only production database audit confirmed Judith as the active owner of the canonical production workspace. Paulo is an assistant in that workspace and correctly receives read-only AI Settings access; his separate owner workspace does not alter Judith's authority.
13. **P0 — Google OAuth stopped before health verification.** A complete authorization previously saved scopes and tokens but never invoked the implemented Google probe service. Complete OAuth now runs the real redacted account probe automatically, and existing authorized connections expose a dedicated owner-only connection check without forcing unnecessary consent.
14. **P0 — Story 5.1 migration is active remotely.** The exact local migration (SHA-256 `5BA2F92EEC7BD7FB029EC98118015297412864ECACC784F4C54CE187AF697FB4`) was applied to Omnix CRM production. Both tables exist with forced RLS, two member-select policies, anonymous table access is denied, authenticated reserve/finalize execution is granted, and the protected runtime-envelope function remains executable only by `service_role`.

## Open release blockers

### P0 — Must close before production AI activation

1. **Gemini is not proven configured for Judith's workspace.** The repository contains encrypted, owner-managed Gemini configuration and safe runtime routing, but the production Omnix screenshot reported no active model. Judith must save and validate the paid Google AI Studio key as owner. Preserve provider/model, policy version, budget reservation, groundedness, and failure evidence.
2. **Google owner UAT remains required.** The persisted connection has Judith's account, all required scopes, active capability rows, and a refresh token, and the repaired flow now probes automatically. Judith must run the owner-only connection check on the deployed build, then complete Gmail draft/create/approve/send negative and controlled-positive paths, calendar create/update/cancel paths, revocation, reconciliation, and receipt checks.
3. **Mailchimp setup is incomplete.** The persisted Judith audience binding still requires both baseline and webhook registration, and no baseline run belongs to Judith's workspace. Complete real audience baseline, signed webhook verification, inbound reconciliation, unsubscribe propagation, deduplication, and a draft-only campaign test.

### P1 — Must close before “launch ready” language

7. **Authenticated iPhone 11 Safari and installed-PWA UAT is still missing.** The current 390px browser audit found no horizontal overflow on sampled routes after prior changes, but it is not physical-device Safari or installed-PWA evidence. Validate safe areas, keyboard viewport, install/update/offline shell, sign-in, navigation, Contacts, Pipeline, Omnix, Connections, and owner approval journeys.
8. **Pipeline movement requires authenticated production proof.** Component coverage passes, but drag-and-drop and the accessible move fallback must be exercised against Judith's actual live contacts and verified after refresh.
9. **Contacts remains too dense on a phone.** The 308-contact production page is functionally responsive but extremely long. Add a mobile compact/list mode, sticky filter summary, saved views, and virtualization or cursor-backed incremental loading before claiming premium high-volume mobile UX.
10. **Connections exposes contradictory lifecycle layers.** Account authorization, capability health, setup completion, reconciliation, and receipts need a single user-facing status hierarchy. Technical receipts should remain progressively disclosed and translated into member actions.
11. **Omnix proposals are previews, not durable governed actions.** Generated follow-up, email, and campaign suggestions do not yet complete the persisted Story 3.5 version/hash/expiry/confirm handoff. Do not label proposals as automated work until that lifecycle exists and is tested.
12. **Nurture-plan lifecycle is incomplete.** Preview, start, pause, resume, snooze, and stop remain open under Story 5.1. Provider-facing steps must continue to require exact human approval and consent checks.
13. **Model-specific run observability is partial.** The migration and owner-facing redacted daily projection cover reservations, terminal state, run count, and committed cost. Route/narration state, policy version, citation IDs, latency, proposal IDs, and safe error categories still require durable completion without retaining raw prompts or secrets.

### P2 — Product quality improvements

14. **Insights is visually strong but cognitively dense.** Preserve exact contributors as progressive disclosure, keep the transaction form responsive, and add role-appropriate defaults instead of showing every analytical layer at once.
15. **Today needs count semantics in every downstream view.** Immediate, overdue, due-today, upcoming, and data-readiness totals must use the same named horizon in Today, Alerts, Omnix, and Insights.
16. **Accessibility needs interaction evidence, not screenshot inference.** Run keyboard-only navigation, focus order, dialog trapping, reduced motion, zoom/reflow, target sizing, status announcements, and screen-reader spot checks on the final build.

## AI product scope that is implemented

- Deterministic CRM brief and natural-language routing to an allowlisted question grammar.
- Gemini routing and grounded narration over a minimized cited CRM projection.
- Prompt-injection scanning, context/output limits, model allowlisting, paid-private policy, hard per-run/daily budget reservation, safe failure states, and deterministic fallback.
- Safe preview proposals for follow-up, email draft, and campaign draft; no silent write, send, schedule, or pipeline move.
- Owner-managed encrypted API key and active-member runtime access without exposing the key to assistants.
- Source links, explicit unknowns, redacted direct contact points, and model/data/connector state separation.

## Recommended realtor automation sequence

1. **Finish trustworthy foundations:** owner authority, Gemini configuration, migrations, provider probes, and receipts.
2. **Persist Next Best Action proposals:** turn each cited recommendation into a versioned Story 3.5 intent with target, rationale, preview, expiry, content hash, and explicit owner confirmation.
3. **Add an approval inbox:** one prioritized FIFO queue for overdue personal follow-up, hot leads, reply-required conversations, transaction deadlines once a real transaction source exists, relationship moments, and data repair.
4. **Add governed communication assistance:** cited one-to-one drafts first, then segmented Mailchimp campaign drafts. Exclude unsubscribed contacts and require preview/approval before provider dispatch.
5. **Add nurture orchestration:** template-based plans with reviewable steps and pause/resume/snooze/stop. Keep inbound reply analysis unavailable until a real authorized inbound event exists.
6. **Add business intelligence only from canonical facts:** response latency, appointment conversion, pipeline aging, source performance, volume, GCI, net commission, and expenses. Never infer transaction facts from contact stage alone.

## Verification results

- `npm run omnix:copilot -- --help` — PASS.
- `npm run omnix:ai -- --help` — PASS.
- `npm run connectors -- --help` — PASS.
- `npm run data -- --help` — reaches documented usage contract.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npx vitest run --maxWorkers=2` — PASS, 213 files and 1,100 tests.
- `npm run build` — PASS after C: capacity was restored; Next.js compiled, type-checked, generated all static pages, and collected build traces.
- Remote migrations, real provider UAT, owner/assistant UAT, iPhone 11 Safari, and installed PWA — NOT PROVEN in this audit.

## Release gate

Do not publish “fully operational” or “AI ready” claims yet. The next valid release gate is: deploy the verified application build, configure Gemini as Judith, then run the real Google/Mailchimp, owner/assistant, and iPhone/PWA matrices. Only evidence from those exact states can move this audit from BLOCKED to GO.
