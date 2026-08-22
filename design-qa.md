# Design QA — Today Calm Timeline Studio

- Source visual truth: `C:\Users\ppetr\.codex\generated_images\019fedcc-f121-75e0-a2ad-d42c08ea780d\exec-352b1154-477a-4a0b-a0cf-46c0a34c6006.png`
- Browser-rendered implementation: `C:\Users\ppetr\AppData\Local\Temp\omnix-today-option3-1491x1055.png`
- Live empty-state evidence: `C:\Users\ppetr\AppData\Local\Temp\omnix-today-option3-final-2.png`
- Responsive evidence: `C:\Users\ppetr\AppData\Local\Temp\omnix-today-option3-mobile-390.png`, `C:\Users\ppetr\AppData\Local\Temp\omnix-today-option3-tablet-768.png`
- Route: `http://127.0.0.1:3202/` (live workspace) and isolated sample-state preview on port 3203
- Primary comparison viewport: 1491 × 1055 CSS px at device scale 1
- Source pixels: 1491 × 1055; implementation pixels: 1491 × 1055; no density normalization required
- Additional viewports: 390 × 844 and 768 × 1024 CSS px
- State: light main canvas with warm-dark desktop rail. The source contains illustrative people, events and connector states; the implementation comparison uses explicitly labeled sample CRM records. The live workspace empty state was checked separately and does not fabricate those source values.

## Full-view comparison evidence

The source and final browser capture were opened together at equal pixel dimensions. The implementation preserves the selected composition: dark vertical rail, warm editorial canvas, large serif greeting, evidence marker, bounded three-stop horizontal timeline, large focused detail surface, attention balance and relationship-moment panels. The operational connector strip in the concept was intentionally replaced by an evidence/status strip sourced from authorized Today data; unverified connector health is not presented.

No additional focused crop was required because typography, controls, timeline stops, evidence line, rail and primary panels are legible in the equal-size full-view comparison. The 390 px and 768 px captures were reviewed separately for breakpoint behavior.

## Required fidelity surfaces

- Fonts and typography: Cormorant Garamond remains the display face and Inter the UI face. Serif scale, editorial hierarchy, UI weights and line wrapping align with the concept. Small evidence text remains readable and is not used as the only action cue.
- Spacing and layout rhythm: the rail/main proportion, compact greeting, timeline hierarchy, warm detail panel and two-column supporting grid follow the concept. At 390 px the timeline becomes a vertical ordered sequence; at 768 px it uses the same compact sequence without horizontal overflow.
- Colors and tokens: warm canvas, ink, coral action, muted cream panels and dark rail use existing Omnix tokens. Semantic red/amber/green facts retain text labels, so meaning is not color-only.
- Image and asset fidelity: the concept's person photographs and provider marks are illustrative data that are not authorized assets in the product. They were not replaced with fake photos, SVG art, gradients, emoji or placeholder imagery. Existing Lucide icons and stored-contact avatars remain authoritative.
- Copy and content: concept labels were adapted to current product vocabulary. Reasons, counts, source facts, timestamps, workspace mode and destinations come from existing alert/triage authorities. No mock time, revenue, probability, deadline or connection claim was introduced.

## Interaction and accessibility evidence

- Pause was activated and the selected first priority remained stable for more than the 10-second rotation interval.
- A timeline stop was selected directly and `aria-current="step"` plus the focused evidence content updated together.
- Play/pause exposes pressed state; hover/focus pauses rotation; global reduced-motion CSS disables transitions and the controller suppresses automatic rotation under `prefers-reduced-motion`.
- Controls retain 44 px minimum targets, semantic buttons/links, visible focus and named landmarks.
- Browser console checked after live and sample interactions: zero error-level entries.
- Live unavailable/empty data remains fail-closed and actionable.

## Comparison history

### Iteration 1 — blocked

- [P1] The initial light-theme capture kept the desktop rail cream, losing the concept's strongest wayfinding contrast.
- [P1] The first-run card appeared before the focus timeline and pushed the selected primary composition below the fold.
- [P2] The initial comparison was captured in dark mode and at the default 1265 × 712 viewport, so color and layout precision were not normalized.

Fixes: introduced a scoped warm-dark desktop rail without changing navigation semantics; moved first-run help below the primary evidence/status composition; switched the main canvas to light; used the in-app Browser viewport capability for an exact 1491 × 1055 comparison.

### Iteration 2 — passed

Post-fix evidence: `omnix-today-option3-1491x1055.png` matches the source dimensions and visual hierarchy. The remaining content differences are intentional truth-preserving product constraints, not actionable visual defects. Responsive captures show no clipped persistent controls or horizontal page overflow.

## Findings

No actionable P0, P1 or P2 findings remain.

## Follow-up polish

- [P3] When the live workspace gains authorized priorities and relationship dates, repeat a production-data capture to review real-name wrapping and density. This is not a blocker; the explicitly labeled sample state already exercises the populated composition.

final result: passed

---

# Story 3.13 premium visual command-center iteration

**Date:** 2026-08-21 (America/New_York)  
**Verdict:** **CONCERNS — implementation and populated sample matrix pass; authenticated true-zero and native 200% evidence remain open**

## Implemented visual system

- A continuous metric ledger surfaces stored relationships, people needing attention, Hot relationships and active pipeline records without decorative or predictive KPIs.
- Relationship Orbit maps the stored Hot/Warm/Nurture composition; Pipeline Panorama maps all seven stored pipeline stages.
- The editorial focus stage remains the primary decision surface, with compact relationship-moment cards preserving names, reasons and phone/text/email actions in the supporting rail.
- Motion is restrained to entrance, selection, orbit glint and pipeline growth; `prefers-reduced-motion` suppresses all new nonessential animation and transitions.
- Sample mode is now explicitly labeled `Sample CRM view` with preview-only explanation; live mode retains the saved-details label.

## Current evidence

- In-app sample rendering at 1440x1000, 768x1024 and 390x844: PASS; actual horizontal scroll remained zero at every viewport.
- Priority selection: PASS; selecting Alicia Monroe replaced the active focus without automatic rotation.
- Queue Explorer open/close: PASS; the populated panel remained reachable with zero horizontal scroll.
- Browser console warnings/errors: zero during the exercised sample flow.
- Automated gates: lint PASS; typecheck PASS; optimized production build PASS; full Vitest PASS (`170` files / `772` tests).
- Truthfulness tests verify stored contact/triage counts and explicitly reject revenue, forecast and conversion copy.

## Remaining release evidence

This review does not replace the authenticated authorized-workspace populated/true-zero matrix, both themes, native 200% zoom or a current browser-level reduced-motion receipt required by Story 3.13 AC12. The implementation is locally verified, but this evidence set alone does not authorize or prove a production release.

final result: concerns

---

# Design QA — Story 3.13 Today Premium Restoration

- Selected visual authority remains the Story 3.10 Calm Timeline Studio image above.
- Local reviewed build: `http://127.0.0.1:3211/` using isolated Next output `.next-story-3-13`.
- Reviewed state: authenticated live workspace with zero stored contacts, in light and dark themes.
- Review date: 2026-08-13 (America/New_York).

## Regression and restoration comparison

The Story 3.11 Queue Explorer had become a competing full-width dashboard and the live zero-contact state repeated multiple empty panels. Story 3.13 restores the approved editorial greeting and one dominant Today composition. In the truthful zero-contact state it now presents one bounded onboarding surface with Import contacts, Add one contact and Review connections, followed by a compact Queue Explorer disclosure. The disclosure is closed by default and mounts no queue cards until explicitly opened.

The populated Today blocks remain the Story 3.10 focus timeline, attention balance, relationship moments and evidence strip; no alert, cadence, queue filter, contact action or route was removed. Personalization now shows a safely resolved first name, while canonical full-name precedence is covered independently in the repository resolver.

## Browser evidence completed locally

- Desktop light theme: warm editorial canvas, dark rail, one focal empty-state surface and clear primary/secondary action hierarchy.
- Desktop dark theme: the same hierarchy and content remain legible without color-only meaning.
- Queue disclosure: closed state mounted zero tab panels; opening mounted exactly one active queue panel; closing removed it again.
- Client route integrity: semantic navigation from Today to Alerts and back to Today completed without reload; the Alerts heading unmounted and the current Today greeting appeared after the root loading state settled.
- Console/hydration: zero browser log entries after theme, disclosure and route-transition interactions.
- Date authority: Thursday, August 13 rendered from the configured `America/New_York` timezone instead of the deployment server timezone.

## Evidence still assigned to independent UX/QA

The in-app browser session provided desktop light/dark evidence but did not expose a supported viewport-resize control. The independent quality gate must still record 390 px, 768 px, 1440 px, 200% zoom, reduced-motion and populated-fixture evidence before changing this Story 3.13 result to passed or authorizing deployment.

final result: pending independent UX/QA matrix

---

# Independent UX Quality Gate — Story 3.13

**Date:** 2026-08-13 (America/New_York)  
**Scope:** read-only inspection of the selected Story 3.10 visual target, Story 3.13 implementation/source/tests, and the isolated runtime at `http://127.0.0.1:3211/`  
**Verdict:** **FAIL — not eligible for QA/deploy promotion**

## Evidence obtained

- The selected Calm Timeline Studio target and the current source preserve the intended hierarchy: contextual greeting, one dominant focus timeline, compact attention/moment/status support, then a secondary Queue Explorer.
- Focused verification passed: `5` test files / `14` tests covering populated and truthful zero states, semantic block order, collapsed/open Queue Explorer behavior, queue progression/filter/search/keyboard behavior, and CRM identity precedence.
- Source inspection confirms the product route inventory remains present: Today, Contacts, Activities, Alerts, Pipeline, Insights, Omnix AI, Mailers, Connections, and Data/API.
- The isolated runtime redirected the available browser session to `/welcome` and then `/login?next=%2F`; therefore no independent authenticated evidence was obtained for the current Story 3.13 UI. Existing Story 3.10 screenshots do not prove the restored Story 3.13 implementation.
- Focused command: `npm test -- --run components/today-command-center.test.tsx components/today-queue-disclosure.test.tsx components/relationship-queue.interaction.test.tsx components/route-chrome.test.tsx lib/data/index.test.ts` — PASS.

## Passing observations

- **Hierarchy:** source ordering matches the selected target's focus-first composition; Queue Explorer follows the command-center content.
- **Truthful populated/zero behavior:** populated source data renders focus, attention, moments, and status; an empty aggregate renders onboarding actions instead of fabricated CRM activity.
- **Queue Explorer:** collapsed by default, queue cards are unmounted while closed, one disclosure opens the explorer, and the existing relationship-queue capabilities remain reachable when open.
- **Reduced-motion implementation intent:** the timeline hook suppresses rotation when `prefers-reduced-motion` is active and global CSS removes nonessential transition/animation duration. This is source evidence only, not closure of the required automated/runtime matrix.

## Blocking findings

### UX-3.13-001 — Required authenticated browser matrix is incomplete (AC12)

The current build still lacks independent evidence for both populated and true-zero datasets at `390px`, `768px`, and `1440px`, in light and dark themes, including `200%` zoom, reduced motion, client transitions from `/omnix`, `/alerts`, and `/activities`, URL/active-navigation/heading correctness, and zero relevant console errors. The prior Story 3.10 captures cannot substitute for current Story 3.13 evidence. Re-run the matrix with an authorized authenticated session and attach named receipts before promotion.

### UX-3.13-002 — Route-integrity regression test does not exercise navigation (AC7, AC11)

`components/route-chrome.test.tsx` mocks a pathname and manually rerenders children; it does not activate a semantic Link/App Router transition, and it covers neither `/alerts` nor `/activities` nor a fourth non-Today route. Add a router-integrated test or authenticated browser evidence that proves each required transition occurs without reload, updates URL/active navigation/Today heading, unmounts the prior route, and leaves the console clean.

### UX-3.13-003 — Collapsed disclosure exposes an unresolved ARIA relationship (AC3, AC9)

`TodayQueueDisclosure` leaves `aria-controls={panelId}` on the trigger while the controlled element is absent when collapsed. Queue cards may remain unmounted, but the referenced panel target must remain resolvable (for example, a stable hidden/empty panel shell), or the control relationship must be represented without a dangling ID. Add a focused accessibility assertion for both closed and open states.

### UX-3.13-004 — Interactive component boundaries miss WCAG 2.2 AA non-text contrast (AC9)

The shared 1px boundary token measures approximately `1.42:1` against the light card surface and `1.81:1` against the dark card surface. This token identifies bordered secondary actions/disclosure controls, so it does not meet the `3:1` non-text contrast requirement where that boundary is necessary to perceive the control. Adjust the relevant interactive boundary treatment without changing semantic colors, then remeasure both themes and capture the result.

### UX-3.13-005 — Reduced-motion behavior lacks executable closure (AC8, AC11)

The source contains the intended guard, but the focused suite does not emulate `matchMedia('(prefers-reduced-motion: reduce)')` to prove no auto-rotation/timer behavior, no unnecessary pause control, and stable ordered content. Add that automated case and include a current-build reduced-motion browser receipt.

## Required re-gate evidence

1. Current-build authenticated screenshots/recordings for populated and true-zero data across the complete viewport/theme/zoom/motion matrix.
2. Router-integrated transition evidence for all AC7 paths and at least one fourth route.
3. Closed/open accessibility proof showing a resolvable disclosure relationship, keyboard operability, visible focus, and no relevant automated violations.
4. Measured light/dark non-text contrast at or above `3:1` for boundaries needed to identify interactive controls.
5. Clean relevant browser console for the matrix.

final result: failed

---

# Independent UX Final Re-gate — Story 3.13 Compensation Iteration 2

**Date:** 2026-08-13 (America/New_York)  
**Authority:** selected Story 3.10 Calm Timeline Studio image and the exact remediation contract recorded above  
**Verdict:** **CONCERNS — source fidelity PASS; authenticated visual-environment evidence remains unavailable and release-blocking**

## Independent checks

- Reinspected `components/today-command-center.tsx`, `components/today-focus-timeline.tsx`, their focused tests and all Today-scoped responsive CSS against the `1491×1055` selected image.
- `npm test -- --run components/today-command-center.test.tsx components/today-focus-timeline.test.tsx components/today-focus-timeline.interaction.test.tsx components/today-queue-disclosure.test.tsx` — PASS (`4` files / `8` tests).
- `npm run typecheck` — PASS.
- `npm run lint -- --quiet` — PASS.
- No authenticated current-build browser/fixture matrix was available to this reviewer. The source result below is not presented as runtime, production or same-viewport evidence.

## Iteration-2 finding reassessment

### UX-3.13-C01 — RESOLVED in source

`.today-focus-shell` is now an open stage (`overflow: visible`, no border, transparent background, no shadow). Elevation, boundary, fill and rounded shape are confined to `.today-focus-detail`. Attention and relationship-moment rails use transparent supporting surfaces. This restores the selected image's single central focal card instead of enclosing the whole composition in a competing dashboard card.

### UX-3.13-C02 — RESOLVED in source

The active focus article is first in `.today-command-grid` DOM order, followed by attention and moments. Named grid areas place those elements as attention → focus → moments at desktop while narrow reflow remains focus → attention → moments without CSS `order`. Visual, reading and keyboard order therefore remain deterministic at mobile/zoom widths.

### UX-3.13-C03 — RESOLVED in source

`.today-moments-list` now uses `overflow: visible` with no fixed maximum height. The three authorized `ContactCard` rows and their available call/text/email actions are no longer intentionally clipped. The localized compact padding does not remove content or capability.

### UX-3.13-C04 — RESOLVED in source

The intermediate container rule at `48rem–61.99rem` implements the contracted composition: focus spans the first row and attention/moments share the second row. Below `47.99rem`, the source uses a single focus-first column; above the intermediate range it uses the approved three-part desktop stage.

## Source-fidelity result

The populated source now expresses the approved hierarchy: editorial greeting and evidence mark → open bounded timeline rail → one dominant elevated focus card with quiet supporting attention/moment rails → truthful evidence/actions strip → collapsed Queue Explorer. The Queue Explorer remains outside the primary composition and no provider status, score, opportunity, deadline or data authority was invented. Zero/unavailable states, pause/play, reduced-motion guard, deterministic three-alert bound, evidence text and all inspected destinations remain present.

The new source regression asserts the focus-first DOM order, open-stage shell, focus-only elevation, desktop/mobile/intermediate grid areas and absence of moment clipping. The focused state/disclosure tests remain green.

## Remaining concern — environment evidence only

### UX-3.13-C05 — CONCERN, release-blocking under AC12/AC13

No current authenticated screenshots or interaction receipts were available for populated and true-zero fixtures at `390px`, `768px` and `1440px`, light/dark themes, `200%` zoom, keyboard/focus and reduced motion. Consequently, computed overflow, actual card heights, focus-ring visibility, bottom-navigation collision, dark-theme rendering, real contact-card fit and same-viewport parity with the selected image have not been independently observed. This is missing evidence, not a source defect found in iteration 2.

## Evidence required to convert to PASS

1. Current authenticated populated and true-zero captures at 390/768/1440 in light and dark themes.
2. Keyboard/focus and 200% zoom/reflow receipts with zero clipping, horizontal overflow or unreachable action.
3. Reduced-motion browser receipt confirming stable focus and absent automatic-motion control.
4. Clean console/hydration evidence across the matrix.
5. Final `1491×1055` same-viewport comparison against the selected Story 3.10 target.

final result: concerns

---

# Story 3.20 unified contact navigation — final compensation pass

**Source visual truth:** `C:\Users\ppetr\AppData\Local\Temp\codex-clipboard-1b2f9210-aea3-44d2-9106-d75c75cc8076.png`  
**Rendered implementation:** `C:\Projetos\CRMRealtor\docs\qa\evidence\3.20-client-subnav-unified-final.png`  
**390px implementation:** `C:\Projetos\CRMRealtor\docs\qa\evidence\3.20-client-subnav-unified-390.png`  
**Combined focused comparison:** `C:\Projetos\CRMRealtor\docs\qa\evidence\3.20-client-subnav-unified-comparison.png`

## State and normalization

- Source: 735×187 dark-theme crop of `/contacts?scope=clients`, provided by the user after the first remediation.
- Desktop implementation: 1265×712 CSS-pixel in-app Browser capture in the same dark theme and client scope; the matching region was cropped to the same comparison width.
- Mobile implementation: 390×844 explicit in-app Browser viewport capture, then viewport override reset.
- Dynamic counts differ because local verification uses sample data; labels, selected states, control geometry and hierarchy are directly comparable.

## Comparison history

1. **P1 found after the first pass:** the secondary row still used an enclosing rounded frame around three independently bordered buttons. It read as a cropped capsule and introduced a second, conflicting geometry.
2. **Fix:** removed the secondary container border, background, radius and padding. Both levels now use the same independent primary/secondary controls, 44px height, nowrap labels, identical badges and 8px gaps. Four pixels of navigation padding preserve focus outlines.
3. **Post-fix desktop evidence:** the two levels align to one left edge, every control has complete boundaries, and the client subviews read as a clear second level rather than a broken panel.
4. **Post-fix 390px evidence:** each semantic navigation remains one horizontal scroll region, labels and badges stay intact, focus space is retained, the page shell remains usable and no runtime error appears.

## Required fidelity surfaces

- **Typography:** unchanged product font, weight and hierarchy; all labels remain centered and untruncated.
- **Spacing/layout:** passed; 12px inter-level rhythm, 8px control gaps, aligned left edges, no enclosing frame and no accidental wrapping.
- **Colors/tokens:** passed; existing warm dark-theme tokens and coral selected state are reused consistently.
- **Images/assets:** no raster assets belong to this control; existing Lucide icons are preserved.
- **Copy/content:** all seven view labels and their truthful counts remain intact.
- **Interaction/accessibility:** semantic navs and `aria-current` preserved, 44px targets, focus outline clearance, bounded horizontal scroll at 390px, no data or route behavior changed.

## Findings

No actionable P0, P1 or P2 mismatch remains for the reported navigation defect. The partial next control at the 390px edge is the intentional affordance of a contained horizontal navigation region, not page clipping; every option remains reachable without wrapping or changing the surrounding layout.

final result: passed

---

# Story 3.20 production client-subnavigation visual regression

**Source visual truth:** `C:\Users\ppetr\AppData\Local\Temp\codex-clipboard-0d46cee8-0c9c-43a3-8858-9640ae911840.png`  
**Rendered implementation:** `C:\Projetos\CRMRealtor\docs\qa\evidence\3.20-client-subnav-fixed.png`  
**Combined focused comparison:** `C:\Projetos\CRMRealtor\docs\qa\evidence\3.20-client-subnav-comparison.png`

## Capture normalization

- Source: user-provided 789×189 dark-theme crop of `/contacts?scope=clients`; full CSS viewport and density were not embedded in the crop.
- Implementation: in-app Browser capture at 1265×712 CSS pixels in dark theme, device-density screenshot; the matching navigation region was cropped and normalized to a 789px-wide comparison canvas.
- State: Clients selected with the All clients subview selected. Dynamic counts differ because the source is the authorized production workspace while the local capture uses sample data; those counts are not a layout or copy mismatch.
- Full-view evidence confirms the corrected bar remains aligned with the Contacts content column and does not affect the surrounding page hierarchy.
- Focused evidence was required because the source itself is a focused crop; it clearly shows the before/after container boundary, control heights, spacing and selected states.

## Comparison history

1. **Earlier P1 — stretched and visibly clipped secondary bar.** The source shows a block-width filled strip extending beyond the three client controls and terminating at the crop edge. This made the subnavigation look detached and broken.
2. **Fix applied.** `Client views` now owns `max-w-full overflow-x-auto`; its list is an intrinsic-width `inline-flex min-w-max` group instead of a wrapping block. All three links now use the same button affordance, `whitespace-nowrap`, and a 44px minimum target.
3. **Post-fix evidence.** The implementation capture shows a compact, fully bounded three-control group with even padding, consistent borders and no cut edge. The primary and secondary selection hierarchy remains clear.

## Required fidelity surfaces

- **Fonts and typography:** unchanged existing Omnix typography; labels remain single-line and visually centered.
- **Spacing and layout:** corrected; intrinsic group width, even 8px gap/padding, complete rounded border and no accidental full-width strip.
- **Colors and tokens:** unchanged warm-editorial dark-theme tokens; selected coral and neutral controls remain consistent with the primary navigation.
- **Image quality and assets:** no image assets are part of this component; existing Lucide icons remain unchanged.
- **Copy/content:** Leads, Clients, Needs review, All contacts and the three client subviews are preserved verbatim.
- **Accessibility/responsiveness:** semantic navigation and `aria-current` are preserved; controls meet 44px minimum height; nowrap plus contained horizontal overflow prevents clipping on narrow widths.

## Findings

No actionable P0, P1 or P2 visual mismatch remains for the reported regression. Full authenticated production counts were not reproduced locally, but the corrected layout is count-agnostic and the screenshot comparison plus focused regression test cover the affected structure.

final result: passed

---

# Independent UX Re-gate — Story 3.13 Remediation

**Date:** 2026-08-13 (America/New_York)  
**Verdict:** **CONCERNS — remediation accepted; complete AC12 visual matrix still required before deployment**

## Re-gate evidence

- Independent focused rerun: `npm test -- --run components/today-queue-disclosure.test.tsx components/today-focus-timeline.interaction.test.tsx components/route-chrome.test.tsx` — PASS (`3` files / `6` tests).
- Reported complete gates for the stable rebuilt source: lint PASS, typecheck PASS, full suite PASS (`145` files / `662` tests), isolated production build PASS.
- Reported authenticated in-app browser navigation exercised `/omnix`, `/alerts`, `/activities`, and `/pipeline` to Today through semantic navigation. Each prior heading unmounted and the browser console recorded zero logs.
- The source still preserves the selected Calm Timeline Studio hierarchy, truthful populated/zero-state branching, the collapsed-first Queue Explorer, and the authenticated route inventory.

## Finding reassessment

### UX-3.13-001 — CONCERN, still release-blocking under AC12/AC13

The complete current-build authenticated visual matrix is still not attached for both populated and true-zero fixtures at `390px`, `768px`, and `1440px`, across light/dark, `200%` zoom, keyboard/focus, and reduced-motion conditions. Older Story 3.10 responsive captures remain useful design references but are not receipts for the remediated Story 3.13 build. This is no longer evidence of a known implementation defect, but AC12 and AC13 explicitly make the missing matrix a deployment blocker. QA may execute the matrix; deployment may not begin until it passes and this report is re-gated to PASS.

### UX-3.13-002 — RESOLVED

The mounted regression now covers all four required origins and proves the RouteChrome pathname/RSC-child boundary replaces each prior heading with Today. The separately executed authenticated semantic-navigation run supplies the missing real App Router interaction evidence, including prior-heading unmount and a clean console. Together these close the stale-route risk without a forced reload or speculative route-boundary change.

### UX-3.13-003 — RESOLVED

The collapsed disclosure now keeps the referenced panel element mounted with matching `id`/`aria-labelledby` and `hidden`, while `RelationshipQueue` and its cards remain unmounted. The focused test resolves `aria-controls` in the closed state and continues to prove deterministic open/close behavior.

### UX-3.13-004 — RESOLVED

Dedicated `--sk-control-border-color` tokens are applied to the reviewed evidence, disclosure-action, secondary-action, text-action, and input boundaries. Independent calculation confirms approximately `3.50:1` against the light card surface and `3.45:1` against the dark card surface, meeting the WCAG 2.2 AA `3:1` non-text contrast threshold for those control boundaries.

### UX-3.13-005 — RESOLVED

The new jsdom test emulates `prefers-reduced-motion: reduce`, advances fake time by 30 seconds, and proves the first authorized priority remains current while the automatic-motion Pause control is absent. Global reduced-motion CSS continues to suppress nonessential transitions without hiding content.

## Remaining evidence required for PASS

1. Current Story 3.13 populated and true-zero captures at `390px`, `768px`, and `1440px` in light and dark themes.
2. Keyboard/focus and `200%` zoom/reflow receipts showing no overflow, clipping, bottom-navigation collision, or unreachable action.
3. Current-build reduced-motion browser receipt confirming the automated behavior in the rendered application.
4. Zero unexpected console/hydration errors across that matrix.
5. Final same-viewport comparison to the selected Story 3.10 target, followed by an independent PASS entry.

final result: concerns

---

# Independent UX Re-gate — Story 3.13 Compensation Remediation

**Date:** 2026-08-13 (America/New_York)  
**Authority:** Story 3.10 selected Calm Timeline Studio image plus the component-level UX contract issued for this remediation  
**Verdict:** **FAIL — the unified stage is materially closer, but the frozen source still does not reproduce the approved focal hierarchy and contains responsive/accessibility risks**

## Evidence reviewed

- Selected target: `C:\Users\ppetr\.codex\generated_images\019fedcc-f121-75e0-a2ad-d42c08ea780d\exec-352b1154-477a-4a0b-a0cf-46c0a34c6006.png` (`1491×1055`).
- Source: `components/today-command-center.tsx`, `components/today-focus-timeline.tsx`, Today-scoped rules in `app/globals.css`, and focused Today/disclosure interaction tests.
- Independent focused rerun: `npm test -- --run components/today-command-center.test.tsx components/today-focus-timeline.test.tsx components/today-focus-timeline.interaction.test.tsx components/today-queue-disclosure.test.tsx` — PASS (`4` files / `7` tests).
- Independent `npm run typecheck` — PASS.
- Independent `npm run lint -- --quiet` — PASS.
- No authenticated current-build browser was available to this reviewer. No 390/768/1440 light/dark/zoom/keyboard/reduced-motion visual result is inferred from source or automated markup tests.

## Accepted remediation

- `TodayCommandCenter` now supplies attention and relationship-moment slots to `TodayFocusTimeline`, and `.today-command-grid` places attention, active focus and moments in one desktop organism. This corrects the previous pair of unrelated panels below the focus card.
- The active detail remains centered at desktop, the evidence/status strip follows the main composition, and Queue Explorer remains after it, collapsed by default.
- Deterministic alert bounding, stored evidence, truthful zero/unavailable states, pause/reduced-motion logic, existing destinations and Queue Explorer behavior remain present. Focused automation is green.

## Blocking findings

### UX-3.13-C01 — The selected open-stage hierarchy is still enclosed as a large dashboard card

The approved target uses an open timeline rail with one elevated central focus card and quiet side rails. The remediation keeps `.today-focus-shell` as a single `overflow: hidden` bordered container with a filled card background and `0 24px 80px` shadow. Its heading, three text-heavy timeline stops, three-column body and footer therefore read as one large dashboard panel. This directly conflicts with the issued selector contract (`border: 0`, transparent shell, no shell shadow) and preserves the visual condition behind the user's complaint. Remove the outer card treatment; retain elevation only on `.today-focus-detail`, with the attention/moment rails visually quiet.

### UX-3.13-C02 — Mobile/zoom visual order diverges from DOM and focus order

The DOM order in `.today-command-grid` is attention → active detail → moments. Under the `max-width: 47.99rem` container rule, `.today-focus-detail { order: -1; }` changes only the visual order to focus → attention → moments. Keyboard and assistive-technology reading order therefore disagrees with the displayed order at narrow widths and 200% reflow. The current component test explicitly asserts attention before detail in markup, so it does not protect the required responsive order. Render the active focus first in DOM and use named grid areas at desktop to position attention left, focus center and moments right without changing semantic/focus order.

### UX-3.13-C03 — Relationship-moment actions can be visually clipped

`.today-moments-list` applies `overflow: hidden` and `max-height: 13.25rem` to as many as three full `ContactCard` instances. `ContactCard` is not a compact moment row: it includes avatar, metadata and call/text/email controls with responsive padding. The fixed maximum can partially hide later content or actions with no scroll or disclosure mechanism. Remove the clipping, or introduce a truthful compact variant that preserves every rendered action and lets the side rail grow without concealing content.

### UX-3.13-C04 — The contracted intermediate responsive composition is absent

Only a single breakpoint exists: three columns above `47.99rem`, one column below it. The agreed `48–61.99rem` composition — focus first with attention and moments as two supporting columns — is not implemented. This increases the likelihood of a cramped three-column stage before the abrupt single-column switch. Add the intermediate grid and prove it at actual container widths, not viewport assumptions.

### UX-3.13-C05 — Required visual matrix and same-viewport comparison remain unavailable

There is still no current authenticated evidence for populated and true-zero data at 390/768/1440, both themes, 200% zoom, keyboard/focus and reduced motion. The focused tests prove markup strings and state behavior, not computed layout, clipping, overflow, visual focus order or parity with the selected image. AC12/AC13 remain release-blocking independently of C01–C04.

## Required PASS evidence

1. Open-stage shell matching the target hierarchy: open rail, central elevated detail, quiet side rails, no competing outer dashboard card.
2. Focus-first DOM order with desktop visual placement achieved through grid areas, plus keyboard proof after 200% reflow.
3. Three relationship moments and all available contact actions visible/reachable without clipping.
4. Intermediate two-supporting-column composition between 48rem and 61.99rem container widths.
5. Named authenticated receipts for populated and true-zero 390/768/1440 light/dark, keyboard, 200%, reduced motion, zero overflow and clean console.
6. Final 1491×1055 same-viewport comparison against the selected Story 3.10 image.

final result: failed

---

# Independent UX Browser Re-gate — Story 3.13 Final Sample Matrix

**Date:** 2026-08-13 (America/New_York)  
**Authority:** selected Story 3.10 Calm Timeline Studio image, iteration-2 source contract and the isolated Playwright sample-build receipts  
**Verdict:** **CONCERNS — populated sample browser fidelity PASS; AC12 authenticated true-zero and native 200% evidence remain incomplete**

## Evidence inspected

- Full-page visual receipts: `story-3.13-today-1440-dark-final.png`, `story-3.13-today-768-dark-final.png`, `story-3.13-today-390-light-final.png`, `story-3.13-today-390-dark-final.png`, and `story-3.13-today-390-reduced-motion-final.png`.
- Reported isolated sample-build runs at viewport configurations 1440×900, 768×1024 and 390×844 in light and dark themes: horizontal overflow false at every size.
- Computed populated-state evidence: outer focus shell has no shadow; only the central detail is elevated; Queue Explorer is collapsed and outside the initial 1440 viewport.
- 390px interaction evidence: all inspected Today main buttons/links have at least 44px hit areas after the scoped contact-name fix; keyboard proceeds timeline controls → active focus actions → attention action → moment contacts/actions; queue open/close changes one tabpanel to zero with no overflow.
- Reduced-motion emulation at 390px: `matchMedia('(prefers-reduced-motion: reduce)')` true, active detail stable after 11 seconds, no Pause control, no overflow.
- Console evidence: zero errors and zero warnings for the reported populated sample matrix.
- Independent focused rerun: Today source/interaction/disclosure suite PASS (`4` files / `8` tests); typecheck PASS; lint PASS.

## Browser/source assessment

The populated sample build now visibly restores the approved hierarchy. At desktop the timeline is open, the active detail is the single elevated focal surface, attention and relationship moments remain quieter supporting rails, the evidence/action strip follows the composition, and the collapsed Queue Explorer no longer competes in the first viewport. At 768px and 390px the focus-first reflow is preserved, contact actions remain exposed, both themes retain the warm-editorial hierarchy, and the mobile layout has no horizontal overflow. The screenshots and computed styles corroborate the iteration-2 source fixes C01–C04.

The 44px scoped rule for moment contact-name links closes the previously observed undersized main-action target in the 390px sample. Reduced-motion and queue disclosure behavior are now supported by both focused automation and rendered-browser receipts.

## Remaining AC12/AC13 concern

The browser run is an isolated **sample-data** build, not an authenticated authorized-workspace run. The true-zero state is covered by mounted component/source tests but was not exercised as a browser fixture. Native 200% zoom/reflow was also not recorded. The saved images are full-page receipts at the configured viewport widths; they do not constitute the exact `1491×1055` same-viewport overlay/comparison requested against the selected target. Therefore the available evidence materially reduces visual risk but does not satisfy the explicit complete authenticated populated-and-zero browser matrix in AC12, and AC13 still prohibits production deployment on this UX evidence alone.

## Required evidence for unconditional PASS

1. Authenticated authorized-workspace populated and true-zero runs at 390/768/1440 in both themes.
2. Native 200% zoom/reflow with keyboard/focus, no clipping, no unreachable action and no bottom-navigation collision.
3. Exact same-viewport comparison against the selected `1491×1055` Story 3.10 target.
4. Zero unexpected console/hydration errors for those authenticated/zero/zoom runs.

final result: concerns

---

## Active final result — Story 3.20 contact navigation

The current build evaluated in this turn is the Story 3.20 unified contact navigation documented above. The later Story 3.13 historical sections remain preserved for their own audit trail and do not supersede this component-scoped result.

final result: passed

---

## Active final result — Story 3.13 premium visual command center

The 2026-08-21 implementation and populated sample browser matrix pass at 390, 768 and 1440 px, including truthful sample/live labeling, real CRM-derived visuals, priority selection, Queue Explorer disclosure, zero actual horizontal scroll and a clean console. Lint, typecheck, optimized build and all 772 tests pass. Authenticated true-zero, both themes, native 200% zoom and current browser reduced-motion evidence remain required before AC12 can receive an unconditional PASS.

final result: concerns
