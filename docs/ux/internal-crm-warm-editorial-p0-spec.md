# Omnix Internal CRM — Warm Editorial P0 UX Specification

**Status:** Implementation-ready UX handoff  
**Owner:** @ux-design-expert (Iris)  
**Date:** 2026-08-12  
**Scope:** Authenticated CRM shell and Today experience in `packages/crm`  
**Source boundary:** Existing product behavior, Story 1.1, Story 3.1, Story 3.6, `C:\Users\ppetr\Downloads\claude-design.md`, and the current `packages/crm` implementation  
**Implementation authority:** @dev; this document changes no product code or design-system tokens

## 1. Outcome and constraints

The internal CRM adopts a warm editorial visual language while preserving every current route, capability, authorization boundary, deterministic rule, and semantic destination. The P0 outcome is a faster operational home: Today remains the default route, presents one deterministic Alert Center, and makes the next safe action visually obvious.

This is an adaptation, not a replica of Claude's marketing site. The CRM uses its warm canvas, editorial serif/sans split, coral voltage, quiet hairlines, and rare dark surfaces at operational density.

Non-negotiable constraints:

- Preserve `/`, `/contacts`, `/activities`, `/pipeline`, `/insights`, `/omnix`, `/mailers`, `/connections`, `/data`, `/workspace`, and all current nested routes.
- Preserve CLI-first authority. The UI only renders and invokes already-authorized application behavior.
- Alert Center data must come from the existing deterministic copilot/CRM rules. No generated urgency, random ordering, inferred facts, or silent mutation.
- Do not invent persisted snooze, push notifications, email notifications, autonomous scheduling, or autonomous outreach.
- A navigation action remains a semantic Next.js `Link` or `<a>` even when styled with button affordance. A mutation remains `<button>` inside its existing form/action boundary.
- Do not copy the Anthropic/Claude logo or radial-spike brand mark. Omnix identity remains intact.
- Do not modify global tokens until explicit product approval. Section 3 is the proposed token contract for Dev to map after approval.

## 2. UX principles

1. **Today answers “what needs me now?”** Urgent stored facts precede analytics and configuration.
2. **Evidence travels with urgency.** Every alert exposes why it exists and links to the exact record or safe review surface.
3. **Affordance matches intent.** Primary destinations look tappable without becoming buttons semantically.
4. **Warm, not soft on truth.** Editorial warmth cannot dilute overdue, error, disabled, sample-mode, or provider-status disclosures.
5. **Progressive operational density.** Mobile shows the next action first; wider layouts add context, never hidden capabilities.
6. **Accessible by default.** WCAG 2.2 AA is a release condition in light and dark modes.

## 3. Proposed warm editorial token contract

These values are a specification for implementation review, not authorization to change tokens in this UX pass.

### 3.1 Light mode

| Semantic token | Proposed value | Use |
|---|---:|---|
| `--sk-body-background-color` | `#faf9f5` | Warm page canvas |
| `--sk-body-text-color` | `#141413` | Primary text |
| `--sk-headline-text-color` | `#141413` | Editorial headings |
| `--sk-card-background` | `#fffdf8` | Operational cards above canvas |
| `--sk-fill-color` | `#f5f0e8` | Secondary surface |
| `--sk-fill-secondary-color` | `#efe9de` | Selected/stronger surface |
| `--sk-border-color` | `#ded6ca` | Hairline with stronger UI contrast than the reference |
| `--sk-muted-text-color` | `#5f5d57` | Secondary copy; AA on canvas |
| `--sk-subtle-text-color` | `#6c6a64` | Captions; do not use reference `#8e8b82` for normal text |
| `--sk-body-link-color` | `#9b4f39` | Text links; AA on warm light surfaces |
| `--sk-button-background` | `#a9583e` | Primary control/link-button; white text is 5.06:1 |
| `--sk-button-background-hover` | `#934730` | Pointer emphasis |
| `--sk-button-background-active` | `#7e3b28` | Pressed state |
| `--sk-focus-color` | `#9b4f39` | Focus ring |
| `--sk-card-radius` | `0.75rem` | 12 px editorial card radius |
| `--sk-control-radius` | `0.5rem` | 8 px controls; pills remain explicit |

The source coral `#cc785c` is allowed as a decorative fill or with dark `#141413` text, but not as a white-text primary button because that pair is only 3.28:1. The darker coral above keeps the visual family and AA text contrast.

### 3.2 Dark mode

| Semantic token | Proposed value | Use |
|---|---:|---|
| `--sk-body-background-color` | `#181715` | Warm charcoal canvas |
| `--sk-body-text-color` | `#faf9f5` | Primary text |
| `--sk-headline-text-color` | `#faf9f5` | Editorial headings |
| `--sk-card-background` | `#1f1e1b` | Card surface |
| `--sk-fill-color` | `#252320` | Secondary surface |
| `--sk-fill-secondary-color` | `#302d29` | Selected/stronger surface |
| `--sk-border-color` | `#4b4741` | Visible control/card boundaries |
| `--sk-muted-text-color` | `#c4c0b8` | Secondary copy |
| `--sk-subtle-text-color` | `#a09d96` | Captions; 6.62:1 on canvas |
| `--sk-body-link-color` | `#d99176` | Links; 7.05:1 on canvas |
| `--sk-button-background` | `#b96d54` | Coral CTA with dark `#181715` text, 4.59:1 |
| `--sk-focus-color` | `#d99176` | Focus ring |

Dark mode preserves semantic Hot/Warm/Nurture colors already separated from brand tokens. Dev must remeasure every foreground/background pair actually rendered after implementation.

### 3.3 Typography and spacing

- Display: installed `Cormorant Garamond`, weight 500, tracking `-0.02em`; use for page `h1`, major section `h2`, and large metrics only.
- UI/body: installed `Inter`, weights 400–600. Do not use serif for buttons, field labels, table headers, nav, badges, or dense row content.
- Mobile `h1`: clamp to 36–42 px; desktop `h1`: 52–60 px; line-height 1.04–1.1.
- Body: 16 px minimum for primary narrative; operational metadata may use 13–14 px when contrast passes.
- Base spacing remains 4 px. Page bands use 24/32/48 px at mobile/tablet/desktop. Card padding uses 16/20/24 px.
- Use color-block depth and hairlines. No large Apple-style blur/shadow stack. One rare dark emphasis surface is allowed for the Alert Center summary or evidence drawer, not every card.

## 4. Screen hierarchy

### 4.1 Authenticated shell

```text
RouteChrome
└── AppShell
    ├── Skip link
    ├── Desktop rail (>= 768)
    │   ├── Omnix brand lockup
    │   ├── Global search / command palette
    │   ├── Core: Today, Contacts, Activities
    │   ├── Business: Pipeline, Insights, Omnix AI
    │   ├── Operations: Mailers, Connections, Data & API
    │   └── Attribution + theme toggle
    ├── Mobile header (< 768)
    │   ├── Brand/current route
    │   └── Search + Workspaces + theme
    ├── Main
    │   ├── Demo/sample disclosure
    │   └── Route content
    └── Mobile primary navigation
        └── Today, Contacts, Activities, Mailers, Connections
```

No route or nav group is removed. On mobile, non-tab destinations remain reachable through global search/commands and the workspace surface, as they are now.

### 4.2 Today command center

Order is fixed:

1. **Page header:** date eyebrow, personalized greeting, truthful headline, and compact data-mode disclosure if applicable.
2. **Primary action row:** “Add contact” (`Link` to `/contacts/new`, primary visual affordance) and “Open activities” (`Link` to `/activities`, secondary affordance). These are existing destinations, not new capabilities.
3. **Alert Center:** deterministic alerts for the current day, ordered by the existing `order` contract and deduplicated by existing alert ID.
4. **Operational summary:** Hot needing attention, overdue, due today, celebrations. Tiles are summaries, not controls unless Dev supplies a truthful existing filtered destination.
5. **Triage sections:** needs first contact, overdue, due today, celebrations, coming up.
6. **End state:** a calm completion/next-step message rather than a blank page.

At desktop, use a 12-column layout: main command stream spans 8 columns and Alert Center spans 4 columns, with Alert Center sticky only while its full height fits the viewport. At tablet, use a 7/5 split only above 900 px; otherwise stack Alert Center before summaries. At 390 px, all regions are one column and Alert Center follows the action row.

### 4.3 Alert Center information anatomy

**Header**

- `h2`: “Alert Center”
- Count badge: current deduplicated alert count
- Timestamp: “As of {localized time}” from the deterministic response `asOf`
- Optional data-mode badge: `Sample data` or `Live workspace`, using existing truthful authority

**Alert row**

- Priority icon and text (`Urgent`, `High`, `Normal`, `Low`); never color alone
- Reason, rendered verbatim from the safe deterministic alert contract
- Category + relevant date/context, not raw opaque ID as primary copy
- Evidence disclosure containing rule, source type, timestamp/fact keys, and record ID for audit context
- One destination action rendered as `Link` with a button-like secondary or primary style depending on priority: “Review contact”, “Open task”, “Review pipeline”, or “Review mailer”
- No dismiss/snooze control in P0

**Ordering and truth rules**

- Use `dedupeOmnixCopilotAlerts` ordering: `order`, then stable ID.
- Do not independently rebuild alerts from UI-only `buildTriage` when the deterministic copilot alert contract is available.
- Multiple facts for one record may remain separate only when they produce distinct existing alert IDs/rules; exact IDs are deduplicated.
- The Alert Center never claims that an outbound action was sent, scheduled, or persisted.
- Today and Omnix must render the same alert reason/priority/destination for the same `asOf`, workspace, and stored facts.

## 5. Component inventory

### 5.1 Existing components to adapt

| Atomic level | Existing component | P0 treatment |
|---|---|---|
| Template | `AppShell` | Apply warm tokens, restrained 64 px rail/header rhythm, add Alert Center entry/count only if backed by current loaded deterministic data; preserve nav |
| Organism | `CrmCommandPalette` | Keep search behavior; align trigger/dialog to warm surfaces and shared action classes |
| Organism | `ContactCard` | Preserve detail/phone/SMS/email destinations; make record destination and quick actions visually explicit |
| Molecule | `SectionHeader` | Editorial heading plus compact operational count; tone always has text/icon companion |
| Molecule | `EmptyState` | Replace message-only panel with standardized title, detail, optional existing-route action |
| Molecule | `StatTile` | Keep truthful count; add destination only when backed by existing filter semantics |
| Atom | `IconAction` | Use Next `Link` for internal URLs and `<a>` for `tel:`, `sms:`, `mailto:`; 44 × 44 px minimum |
| Atom | `ThemeToggle` | Preserve preference/system behavior and 44 × 44 target |

### 5.2 New UI components for Dev

| Atomic level | Component | Required props/contract | States |
|---|---|---|---|
| Atom | `ActionLink` | `href`, `variant`, `size`, `icon?`, children; renders `Link` for internal destination or `<a>` for external protocol/download | default, hover, focus-visible, active, aria-disabled only when navigation truly unavailable |
| Atom | `StatusBadge` | `tone`, icon, label | neutral, success, warning, danger, sample/live |
| Molecule | `AlertItem` | existing `OmnixCopilotAlert` view data and citation disclosure | default, focused, evidence expanded |
| Organism | `AlertCenter` | alerts, citations, `asOf`, data mode, error/empty/loading state | populated, empty, unavailable, loading |
| Molecule | `StatePanel` | `kind`, title, detail, action(s), icon | empty, onboarding, error, offline/unavailable, success |
| Molecule | `TodayActionBar` | existing route destinations only | default; horizontal tablet/desktop, stacked 390 px |

Do not add an icon map file solely for this work. The project currently uses `lucide-react` directly and has no `app/components/ui/icons/icon-map.ts`. Reuse already-imported Lucide icons where possible: `CircleAlert`, `ListChecks`, `CalendarHeart`, `ShieldCheck`, `MapPinned`, `ArrowUpRight`, `Plus`, `RotateCcw`. Any new icon choice requires design review; never invent an SVG glyph.

## 6. Action semantics and visual affordance

Visual classes must be unified to remove the current `sk-primary-button` / `sk-button-primary` / `sk-secondary-button` / `sk-button-secondary` drift.

| User intent | HTML/React semantic | Visual variant |
|---|---|---|
| Navigate within CRM | Next.js `Link` | `ActionLink` primary/secondary/text |
| Open phone/SMS/email/download/provider OAuth | `<a href>` | `ActionLink` icon/primary/secondary as appropriate |
| Submit or mutate current state | `<button type="submit">` | shared `ActionButton` class/primitive |
| Open/close local UI | `<button type="button">` | icon/secondary button |

Required behavior:

- Minimum target is 44 × 44 CSS px, including icon-only controls.
- Link-buttons keep destination discoverability and native open-in-new-tab behavior.
- Disabled links are not fake anchors. If a destination is unavailable, render explanatory text/state; do not use `href="#"`.
- Icon-only actions have an accessible name and tooltip/title only as a secondary aid.
- Loading language describes the real operation: “Loading alerts…”, “Preparing…”, “Saving…”.
- Focus rings remain visible on every warm and dark surface.

## 7. Interaction states

### 7.1 Alert Center

- **Loading:** fixed-height skeleton/list placeholder with `role="status"` and a single announced “Loading today’s alerts…”. No repeated live announcements.
- **Populated:** count, `asOf`, ordered items, evidence disclosures, destination links.
- **Empty:** “You’re clear for now.” Detail: “No stored CRM rule produced an alert as of {time}.” Actions: “View coming activities” and “Add contact”, both existing route links.
- **Unavailable/error:** `role="alert"`; “Alerts could not load.” Detail says nothing changed. Primary button retries if an actual reset/refetch exists; secondary Link opens Activities. Never display an empty healthy state on failure.
- **Evidence expanded:** native `<details>`/`<summary>` or accessible disclosure with `aria-expanded`; keyboard operable; source facts remain text, not tooltip-only.
- **Destination activated:** normal navigation. No optimistic completion or alert removal.

### 7.2 Today triage

- **No contacts/onboarding:** show a single onboarding `StatePanel` before empty buckets: “Build your first follow-up list.” Actions: Add contact, Import contacts. Do not imply connection setup is required.
- **Contacts but nothing urgent:** retain celebration/coming-up content; replace urgency headline with “Nothing needs you right now.”
- **Missing communication channel:** omit unavailable call/text/email action and keep contact detail destination. Do not render disabled mystery icons.
- **Repository error:** add `app/error.tsx` for Today or a route-local error boundary; confirm no mutation occurred; expose Retry and Activities/Contacts destinations.
- **Loading:** add `app/loading.tsx` for Today; preserve header and command-center geometry to prevent layout shift.

### 7.3 Global shell

- **Active route:** `aria-current="page"`, stronger surface, icon plus label distinction.
- **Hover:** subtle surface change; no essential information appears only on hover.
- **Keyboard focus:** 3 px visible ring with 3 px offset; not clipped by grouped surfaces.
- **Mobile nav:** label always visible; active state is not color-only.
- **Theme switch:** immediate visible change, no light flash, persists current behavior, announces current action through accessible label.

## 8. Responsive specification

### 8.1 390 px mobile

- Main inline padding: 16 px; no horizontal page overflow at 390 px.
- Sticky header remains; bottom nav reserves safe-area and content bottom padding.
- Today header, action row, Alert Center, summary tiles, and triage stack in that order.
- Actions are full width when paired; icon-only contact actions remain 44 px and wrap without obscuring name/reason.
- Summary grid is 2 columns; each tile supports 200% zoom without clipped labels.
- Alert item has one text column; priority/status precedes reason; destination action spans available width.
- Evidence disclosure wraps record identifiers and fact keys (`overflow-wrap:anywhere`).
- No operational table is introduced on Today. Existing tables elsewhere may horizontally scroll inside their own labeled region.

### 8.2 Tablet 768–1023 px

- Desktop rail remains current behavior from 768 px.
- Content padding 32–40 px.
- Today is one column until 900 px, then 7/5 command-stream/alerts if each column remains at least 320 px.
- Triage contact cards use one column below 900 px and two columns above it.
- Do not make Alert Center sticky when it would trap keyboard focus or exceed viewport height.

### 8.3 Desktop >=1024 px

- Existing 240/256 px rail remains.
- Main content max width stays 1152 px (`max-w-6xl`).
- 8/4 Today layout with 24 px gutter.
- Alert Center may be sticky below the page top/header with `max-height` and an internally labeled scroll region only if more than 8 alerts; otherwise flow normally.
- Primary actions remain near the greeting rather than moving into the rail.

### 8.4 Zoom and reflow

- At 200% browser zoom and 320 CSS px effective width, content reflows without two-dimensional scrolling except existing data tables.
- Text never truncates the alert reason, error detail, or action label. Contact metadata may truncate only when the full contact is reachable by its labeled destination.
- Respect `prefers-reduced-motion`; no alert entrance animation is required.

## 9. Accessibility release contract

WCAG 2.2 AA minimum, validated in both themes:

- Normal text contrast >= 4.5:1; large text and UI boundaries >= 3:1.
- Do not use `#cc785c` with white normal text. Use approved darker coral or dark text.
- Every page has one `h1`; Alert Center and each triage group use hierarchical `h2`/`h3`.
- Shell retains skip link, `nav`, `main`, and `aside` landmarks.
- All interactions work with Tab, Shift+Tab, Enter, Space where applicable, and Escape for modal/search UI.
- Alert priority, lead temperature, selection, error, live/sample, and active route use text/icon/structure in addition to color.
- Dynamic status uses `role="status"`; errors use `role="alert"`; avoid multiple competing live regions.
- Evidence disclosures expose `aria-expanded` through native details or correct button semantics.
- Icon buttons have accessible names; decorative icons are `aria-hidden`.
- Form errors stay programmatically associated through `aria-describedby` and `aria-invalid`.
- Minimum pointer target 44 × 44 px. The 36 px Claude reference icon button is explicitly rejected.
- NVDA + Firefox/Chrome smoke test: shell landmarks, Today headings, Alert Center count/list, evidence disclosure, and destination actions.
- Keyboard-only smoke test at light/dark and 390/tablet/desktop.
- Automated axe/jest-axe is supportive evidence, not a substitute for keyboard/screen-reader review.

## 10. Acceptance evidence matrix

| ID | Acceptance condition | Required evidence |
|---|---|---|
| UX-P0-01 | All current authenticated routes and navigation destinations remain available | Route inventory before/after; source assertion or E2E navigation matrix |
| UX-P0-02 | Warm editorial tokens render in light and dark without unauthorized token mutation in this UX pass | Approved token diff at Dev start; screenshots at 390, 768/820, 1024/1440 |
| UX-P0-03 | Today follows the specified hierarchy and contains existing primary destinations | DOM/heading order assertion plus screenshots |
| UX-P0-04 | Alert Center uses existing deterministic alerts, stable order, dedupe, reason, `asOf`, href, and citations | Unit tests against known alert fixture; UI assertion of exact ordered IDs/destinations |
| UX-P0-05 | Same stored facts and `asOf` yield equivalent alert content in Today and Omnix | Shared view-model/component test; no duplicated independent rule builder |
| UX-P0-06 | Alert Center never exposes snooze/dismiss/push/email behavior or autonomous mutation | Source review and negative UI assertion |
| UX-P0-07 | Navigations remain semantic links despite button styling; mutations remain buttons | DOM role/element assertions; open-in-new-tab behavior for internal links |
| UX-P0-08 | Empty, onboarding, loading, and error states are distinguishable and actionable | Component/route tests for zero contacts, zero alerts, repository failure, loading |
| UX-P0-09 | No healthy-empty state is shown when alerts/repository fail | Error fixture assertion |
| UX-P0-10 | No horizontal page overflow at 390 px; tablet and desktop layouts meet hierarchy | Playwright `scrollWidth === clientWidth` at 390, 768/820, 1024/1440 |
| UX-P0-11 | Light/dark and 200% zoom preserve content/actions | Browser evidence and screenshots |
| UX-P0-12 | WCAG AA target, keyboard path, landmarks, names, target sizes, and live regions pass | axe report + keyboard checklist + NVDA smoke notes + measured contrasts |
| UX-P0-13 | Existing call/SMS/email behavior remains external-protocol links and does not fabricate logging/sending | DOM href assertions and source review |
| UX-P0-14 | Sample/live/demo/provider disclosures remain truthful | State fixtures and copy assertions |
| UX-P0-15 | Mandatory repo gates pass after implementation | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `packages/crm` |

## 11. Files Dev should alter

### Required P0

| File | Change responsibility |
|---|---|
| `packages/crm/app/globals.css` | Approved warm editorial token mapping; shared action-link/button/state styles; dark and reduced-motion parity |
| `packages/crm/app/layout.tsx` | Import installed Inter/Cormorant assets if not already global; update light/dark theme colors to approved warm values |
| `packages/crm/components/ui.tsx` | Add/rework `ActionLink`, `StatusBadge`, `StatePanel`; correct internal `IconAction` semantics; preserve existing exports |
| `packages/crm/components/app-shell.tsx` | Warm shell treatment and accessible active/mobile state; preserve route inventory |
| `packages/crm/app/page.tsx` | Today command-center hierarchy and server data composition for deterministic Alert Center |
| `packages/crm/components/contact-card.tsx` | Shared action affordances, 44 px targets, wrapping/reflow, preserved protocols |
| `packages/crm/components/omnix-copilot.tsx` | Reuse shared `AlertCenter`/`AlertItem` presentation to prevent Today/Omnix drift |
| `packages/crm/components/omnix-copilot-view-model.ts` | Shared UI mapping for alert reason/priority/citations without changing domain rules |
| `packages/crm/app/error.tsx` | Today/root authenticated error state with Retry and safe route links |
| `packages/crm/app/loading.tsx` | Today command-center loading geometry and single status announcement |

### New component files recommended

| File | Responsibility |
|---|---|
| `packages/crm/components/action-link.tsx` | Semantic Link/anchor with shared button affordance |
| `packages/crm/components/alert-center.tsx` | Pure presentation for deterministic alert data and states |
| `packages/crm/components/state-panel.tsx` | Standard empty/onboarding/error/unavailable UI |

### Tests Dev should add or update

| File | Coverage |
|---|---|
| `packages/crm/components/omnix-copilot-view-model.test.ts` or colocated equivalent | Stable alert mapping, priority label, safe destination, evidence |
| `packages/crm/components/alert-center.test.tsx` | Ordered/deduped populated, empty, unavailable, evidence disclosure, semantic links |
| `packages/crm/app/page.test.tsx` or route-level equivalent | Today hierarchy, zero-contact onboarding, deterministic alert data wiring |
| Existing Playwright/browser evidence location | 390, tablet, desktop, dark, 200% zoom, keyboard, overflow, zero console error |

Dev must not change `packages/crm/lib/domain/omnix-copilot.ts`, `packages/crm/lib/application/omnix-copilot-service.ts`, repository contracts, migrations, connector behavior, or notification behavior merely to satisfy the visual redesign. If data composition cannot reuse the existing deterministic service without a product/domain change, stop and request Architect/PO review.

## 12. Delivery sequence

1. Obtain explicit approval for Section 3 token changes.
2. Consolidate action semantics/styles without changing destinations or server actions.
3. Extract shared Alert Center presentation from the existing Omnix alert view.
4. Wire Today to existing deterministic alert output and add loading/error/onboarding states.
5. Apply responsive layout at 390, tablet, and desktop.
6. Validate light/dark contrast, keyboard, screen reader, zoom, and overflow.
7. Run mandatory repo gates and attach the evidence from Section 10 to the implementing story.

## 13. Autonomous decisions

- `[AUTO-DECISION]` Copy Claude marketing navigation/logo → **No** (reason: preserve Omnix identity and operational IA).
- `[AUTO-DECISION]` Use source coral `#cc785c` with white primary-button text → **No** (reason: measured contrast is 3.28:1, below WCAG AA for normal text).
- `[AUTO-DECISION]` Add persisted snooze/dismiss → **No** (reason: explicitly out of scope and no persistence contract exists).
- `[AUTO-DECISION]` Recompute alerts separately inside Today → **No** (reason: the existing deterministic alert contract supplies stable rule/order/citations and must remain authoritative).
- `[AUTO-DECISION]` Replace Links with buttons for stronger visuals → **No** (reason: affordance changes styling, not navigation semantics).
- `[AUTO-DECISION]` Edit an unrelated InProgress/Draft story → **No** (reason: no matching Ready story exists; agent authority and story integrity are preserved).

## 14. UX checklist result

**Specification verdict:** READY FOR DEV after explicit token approval.

- Component inventory: complete
- Screen hierarchy: complete
- Interaction states: complete
- Responsive 390/tablet/desktop: complete
- Dark mode: specified
- WCAG 2.2 AA release contract: specified
- Deterministic Alert Center authority: specified
- Route/capability preservation: specified
- Out-of-scope notification/snooze behavior: explicitly excluded
- Runtime and accessibility evidence: pending implementation, cannot be claimed by a documentation-only pass

