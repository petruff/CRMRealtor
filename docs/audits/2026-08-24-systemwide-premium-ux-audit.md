# Omnix Systemwide Premium UX Audit — 2026-08-24

## Audit Scope

Combined UX and accessibility-risk review of the authenticated Omnix CRM at the current production URL. The audit covered Today, Contacts, Activities, Alerts, Pipeline, Insights, Exact Contributors, transaction intelligence, Omnix AI, Mailers, Connections, Data & API, Settings, contact import and duplicate review.

The primary user goal is to complete daily real-estate relationship work with minimal interpretation, no internal implementation language and no broken responsive geometry. The accessibility target is practical WCAG 2.2 AA-aligned behavior; this audit does not claim certification.

## Evidence Method

- Authenticated in-app browser captures at a narrow phone viewport and a 1277–1292 px desktop viewport.
- DOM geometry checks for page overflow, controls outside their parents, missing accessible names and sub-40 px interactive targets.
- Current-run screenshots only. Loading captures were rejected and repeated after the route reached its usable state.
- Read-only route navigation. No contact, task, deal, pipeline or connector data was changed.
- Local code review, focused component tests, complete regression tests, lint, typecheck and production build.

Local private screenshots are retained under `docs/audits/evidence/2026-08-24-premium-ux-system-audit/` and are intentionally excluded from Git because they render production customer data.

## Numbered Experience Review

1. **Today — healthy with a minor floating-control caveat.** The command center has clear hierarchy, live evidence language, premium editorial typography and a useful mobile metric summary. The assistant launcher can visually cover a small region while content scrolls behind it; increased bottom clearance protects terminal actions, but the launcher remains an intentional floating control.
2. **Contacts — healthy.** Primary create/import/hygiene actions are visible, the lead/client scope is clear and phone reflow has no page-level overflow. The horizontal scope rail is intentionally scrollable.
3. **Activities — healthy after control hardening.** Search, status, contact and date filters reflow cleanly. The shared input contract now prevents native date controls from escaping narrow columns.
4. **Alerts — healthy but information-dense.** Priority totals, evidence boundaries and filters are clear. Progressive disclosure keeps the canonical 334-alert set from becoming one unbounded page.
5. **Pipeline — healthy with an intentional horizontal board.** Desktop drag and drop is supplemented by a move selector. The board is contained in its own horizontal region. Thirty-eight drag/evidence controls were below 40 px in the measured view; the affected controls now use a 44 px target contract.
6. **Insights overview — visually strong.** Command metrics, stage current, temperature, work, source and readiness sections have coherent hierarchy, truthful zero/withheld states and real contributor drilldowns.
7. **Exact Contributors — healthy after responsive refinement.** The experience is bounded to 12 records per page with search, record type, ordering and canonical pagination. At the measured 843 px content width, the four filters were needlessly compressed because their breakpoint followed the browser viewport. They now reflow to two columns from the actual Insights container while preserving an efficient two-column record list until that list itself becomes narrow.
8. **Transaction intelligence — confirmed high-impact defect, corrected and verified in production.** At a 1277 px browser width, the right form column was only 320 px. Each date label received 132 px while Chromium required a 172 px native date input, so both controls exceeded their parents by about 40 px and collided. A first unnamed-container correction did not activate in the deployed browser and was rejected during same-state verification. The final named-container contract moves the form below the ledger at the measured 843 px content width; both date inputs now measure exactly 393 px inside 393 px parents with no collision. The phone state also has no input or page-level overflow.
9. **Omnix AI — healthy with corrected assistive text.** The prioritized brief and bounded copilot are understandable. A visual line break concatenated the heading as `business,already` in the accessibility tree; an explicit whitespace node corrects it.
10. **Mailers — healthy.** Printed-mailer completion remains task-oriented, dated and responsive.
11. **Connections — visually healthy; provider state still governs functionality.** Google remains presented as incomplete while Mailchimp is presented as connected. No visual audit can prove provider synchronization or user authorization health.
12. **Data & API — visually healthy after language correction.** The prior page exposed `npm run` commands to a realtor. The revised copy describes secure developer-managed keys and incoming automations without asking the user to understand a terminal.
13. **Settings — healthy.** Workspace controls reflow without page overflow and retain visible focus behavior.
14. **Contact import — healthy after accessible-name correction.** The visible upload action was understandable, but its hidden file input had no programmatic name. It now has an explicit accessible name while preserving the drag/drop and Numbers/XLSX/CSV flow.
15. **Duplicate review — healthy.** The page clearly limits automatic comparison to canonical contact points and does not imply automatic merges.

## Confirmed Corrections

1. Added `min-width: 0` and `max-width: 100%` to the shared input primitive.
2. Removed native date/time intrinsic-width pressure from shared inputs.
3. Replaced viewport-only Insights transaction breakpoints with container queries.
4. Reflowed financial metrics and the transaction ledger/form from the actual content width.
5. Replaced viewport-only Exact Contributors control breakpoints with container queries and preserved two-column result efficiency where appropriate.
6. Increased contributor metadata size for legibility.
7. Increased Pipeline drag and evidence target heights to 44 px.
8. Added bottom clearance around persistent navigation and the assistant launcher.
9. Added an accessible name to the contact import file input.
10. Removed developer terminal instructions from the realtor-facing Data & API page.
11. Corrected the Omnix heading whitespace exposed to assistive technology.

## Strengths Preserved

- The existing blue, graphite, white and operational Hot/Warm/Nurture palette remains authoritative.
- The design continues to use the existing Inter/Cormorant typography contract and shared radius/tokens.
- Current animations already honor `prefers-reduced-motion` globally and in the major animated surfaces.
- Exact Contributors, Alerts and Contacts remain bounded instead of mounting hundreds of records at once.
- Pipeline retains keyboard-usable move selectors in addition to drag and drop.
- Browser consoles remained free of errors during the authenticated route audit.

## Remaining Risks and Verification Gaps

1. A physical 768 px authenticated viewport was not available in this audit session. Container contracts and tests cover the expected transition, but a real 768 px post-release capture remains required before claiming the full device matrix.
2. Screenshots and DOM checks do not prove complete keyboard traversal, screen-reader output or contrast compliance across every state.
3. The floating Omnix launcher remains an overlay by design. It is a valid 56 px target and terminal content has extra clearance, but a future user test should determine whether an auto-minimize-on-scroll behavior is preferable.
4. Google and Mailchimp provider health, token refresh, webhook delivery and calendar/Gmail authorization require connector receipts and live provider checks; visual state alone is insufficient.
5. Connector availability and production UX readiness remain different claims. The visual release is verified, while end-to-end provider synchronization remains governed by connector-specific evidence.

## Quality Evidence

- Focused UX/component suite: 23 tests passed.
- Complete regression suite: 189 files and 880 tests passed.
- ESLint: passed with zero warnings.
- TypeScript: passed.
- Next.js production build: passed.
- Browser console logs during desktop and phone route audits: no errors observed.
- Production deployment: `dpl_DP8g4QT9Pa4EutHEXDPwmswt2Egz` (`READY`, target `production`).
- Production health endpoint: `ok`; readiness endpoint: database configured and available.
- Authenticated post-release geometry: 1292 px desktop and 390 px phone passed with no page-level overflow; both date controls remained inside their parents.
- Exact Contributors post-release geometry: controls reflowed to a 2 × 2 grid; the bounded 12-record view retained a readable two-column list.
- Pipeline phone geometry: the board overflow remained inside its 375 px scroller and the drag target measured 44 × 44 px.

## Current Decision

**PRODUCTION PASS WITH DOCUMENTED VERIFICATION GAPS.** The confirmed system-owned visual defects are corrected and the production alias was revalidated in the same authenticated states. This is not a claim of complete WCAG certification or provider-backed connector health; the remaining gaps above stay open.
