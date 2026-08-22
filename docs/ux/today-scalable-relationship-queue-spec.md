# Today — Scalable Relationship Queue UX Specification

**Status:** Implementation-ready UX handoff  
**Owner:** @ux-design-expert (Iris)  
**Date:** 2026-08-13  
**Scope:** The relationship queue inside `packages/crm/components/today-command-center.tsx`  
**Source boundary:** Current `TodayCommandCenter`, `ContactCard`, `buildTriage`, `summarise`, and `queryContacts` behavior plus the available current-state desktop/mobile screenshots  
**Implementation authority:** @dev; this document changes no product code, stories, routes, or design-system tokens

## 1. Outcome

Replace the five simultaneously expanded queue sections with one focused relationship group at a time. The user can switch among **Now**, **Moments**, and **Next 7 days**, narrow the active group with contextual subfilters, search with the existing contact-query contract, and progressively reveal every matching entry in batches of 12.

The queue remains a view over stored CRM facts. It does not change cadence, priority, eligibility, contact state, or communication behavior.

### Non-negotiable constraints

- `buildTriage(contacts, now)` remains the authority for membership, reason text, score, and ordering.
- `ensureNextTouch` continues to run before triage, as it does today.
- Every entry returned by the current triage buckets remains reachable; grouping and batching may not silently drop or permanently cap results.
- A contact remains in at most one follow-up bucket. A relationship moment remains an independent axis, so the same contact may correctly appear in both Now/Next and Moments.
- Search must reuse `queryContacts`; do not create a second normalization or matching algorithm.
- Preserve the contact-detail destination and all available **Call**, **Text**, and **Email** actions.
- Do not add, imply, or reserve UI for **Mark as contacted** in this story.
- Do not introduce prediction, inferred urgency, random order, manual drag order, or UI-only scoring.
- Do not modify global design-system tokens as part of this story.

## 2. Information architecture

The existing **Full relationship queue** region becomes one queue organism:

```text
RelationshipQueue
├── Header
│   ├── Eyebrow: Relationship queue
│   ├── Heading: Who needs your attention
│   └── Result summary: Showing n of N
├── Search
├── Scope tabs
│   ├── Now
│   ├── Moments
│   └── Next 7 days
├── Shared lead subfilter
│   ├── All leads
│   ├── Hot
│   ├── Warm
│   └── Nurture
├── Contextual subfilter, when applicable
│   ├── Now: All / First contact / Overdue / Due today
│   └── Moments: All moments / Birthdays / Homeaversaries
├── Active group description
├── Contact entries, initial batch of 12
└── Load 12 more / terminal count
```

Only one scope panel is active and visible at a time. Scope tabs always remain visible, preserve their stable order, and expose the full filtered count for each scope.

## 3. Deterministic scope mapping

| Scope | Existing source buckets | Scope order | Contextual subfilter |
|---|---|---|---|
| **Now** | `needs-first-contact`, `overdue`, `due-today` | Bucket order above; existing score order inside each bucket | All, First contact, Overdue, Due today |
| **Moments** | `celebrations` | Existing celebration score order | All moments, Birthdays, Homeaversaries |
| **Next 7 days** | `coming-up` | Existing score order | None in P0 |

### Ordering contract

1. Build triage once for the same `contacts` and `now` inputs used by Today.
2. Compose a scope by concatenating its source buckets in the table order.
3. Apply search and subfilter membership without sorting the surviving entries again.
4. Render the first 12 surviving entries.
5. Each activation of **Load 12 more** exposes the next 12 in the same stable sequence.

This preserves Speed to Lead: a never-contacted lead stays ahead of overdue and due-today follow-ups in Now. Search relevance must not override triage priority.

For Moments, birthday and homeaversary are separate eligible entries. If one contact has both moments in range, both entries remain visible and count separately. Implementation must use structured source facts for the moment-type subfilter; it must not parse rendered emoji or English reason copy.

## 4. Search and filtering behavior

### 4.1 Search contract

- Present a labeled search field with visible text such as **Search this queue** and a semantic search submit action.
- Apply `queryContacts(allContacts, { query, leadType })` to obtain matching contacts.
- Convert its result to a set of contact IDs, then filter the already ordered triage entries by membership in that set. Do not render the order returned by `queryContacts`, because its lead-type sort would replace triage priority.
- Match the same fields already supported by `contact-query.ts`: display/name fields, email, phone, secondary phone, city, postal code, and tags.
- Preserve existing case/accent normalization, multi-term AND matching, digit matching, and the 200-character maximum.
- Surface `ContactQueryError` beside the search field; preserve the last valid queue state until the query is valid.
- Search spans all three scopes. Scope counts update so a user can see matching entries outside the active scope.
- Search text and the shared lead subfilter persist when switching scopes. The contextual subfilter resets to the destination scope's **All** value.
- A standard form submit must work without timing-dependent behavior. An optional debounced enhancement may update results while typing, but cannot replace the submit path.

### 4.2 Subfilters

The shared lead subfilter maps exactly to the existing `LeadType` values: `hot`, `warm`, and `nurture`. **All leads** passes no `leadType` option.

Contextual subfilters only narrow existing scope membership:

- Now status values map directly to the three existing bucket IDs.
- Moment type maps to the underlying birthday or home-purchase anniversary fact that produced the celebration entry.
- Next 7 days has no contextual status row in P0; omit the row instead of showing one disabled option.

Filter controls display text labels and selected state; color is supplementary. Counts are allowed only when they reflect the complete filtered set, not the currently rendered batch.

### 4.3 Batch behavior

- `BATCH_SIZE = 12` for every scope.
- On first load, scope switch, valid search change, lead-filter change, or contextual-filter change, reset the active scope to 12 visible entries.
- **Load 12 more** appends the next batch without changing scroll position or moving already visible entries.
- Label the control with remaining context, for example `Load 12 more (28 remaining)`; if fewer than 12 remain, use the actual number.
- When all results are visible, remove the load control and show `All N shown` as quiet status text.
- Batching is progressive disclosure, not pagination authority. There is no hidden terminal cap, and all matching triage entries must be reachable in the current session.

## 5. Visual hierarchy

The queue should read as one calm workspace instead of five competing sections.

1. **Heading and result truth:** section title, concise description, and `Showing n of N` establish scope.
2. **Search:** full-width within the queue container; it is the first control for a known person.
3. **Scope tabs:** strongest local navigation. The active scope uses surface, text weight, and an indicator—not color alone.
4. **Subfilters:** visually quieter chips or segmented controls below the scope row.
5. **Active-group explanation:** one sentence reusing existing bucket intent, for example “First contact, overdue, and due-today follow-ups in deterministic priority order.”
6. **Contact list:** reuse the current `ContactCard` information hierarchy and grouped surface. Name and reason lead; lead type and metadata support; communication actions remain immediately available.
7. **Progressive disclosure:** a single secondary **Load 12 more** control follows the list.

Do not repeat a large section header for each source bucket inside Now. Each row's existing reason communicates why it is present. If product validation later shows that bucket transitions need stronger scanning, use a small semantic text divider that does not alter order or create multiple expanded groups.

### Desktop composition

- Keep the queue within the current Today content measure.
- Search and scope controls share the queue header region; contact rows may retain the existing two-column grid at `lg` when row reading order remains DOM-first, left-to-right, top-to-bottom.
- Avoid sticky filter chrome unless runtime testing proves it does not obscure the Today header or focus target.

### 390 px composition

```text
Relationship queue
Who needs your attention
Showing 12 of 37
[ Search this queue       ][Search]
[ Now 18 ][ Moments 7 ][ Next 7 days 12 ]  <- horizontally scrollable if needed
[ All leads ][ Hot ][ Warm ][ Nurture ]     <- wraps as complete controls
[ All ][ First contact ][ Overdue ][ Due today ]
Active-group explanation
┌ Contact card ───────────────────────────┐
│ Avatar  Name · Lead badge              │
│         Deterministic reason           │
│         Supporting metadata            │
│         [Call] [Text] [Email]           │
└─────────────────────────────────────────┘
… up to 12
[ Load 12 more (25 remaining) ]
```

- No horizontal page overflow at 390 CSS px. Only the scope tab list may scroll horizontally, with visible continuation and keyboard reachability.
- Contact cards are one column. Long names, emails, cities, tags, and localized counts must not overlap actions.
- Call/Text/Email targets are at least 44 × 44 CSS px with 8 px minimum separation where their target boxes touch visually.
- The mobile bottom navigation must not cover the last row or **Load 12 more**; include the existing safe-area/bottom-nav clearance.
- Do not make the entire contact card a competing nested link. Keep the name/detail link distinct from protocol actions.

## 6. States and feedback

| State | Required behavior and copy direction |
|---|---|
| Initial populated | Default to **Now**, **All leads**, **All**, first 12 entries. Announce the complete result count in the heading region. |
| Active scope empty | Keep all controls visible. Use the existing encouraging empty message for the relevant source or a scope-level synthesis. Do not imply data failure. |
| No contacts | Preserve the current onboarding state: add the first contact or import contacts. Do not render three empty panels. |
| Nothing in any scope | Show “Nothing needs you right now” and retain Contacts/Add contact destinations already present on Today. |
| Search has no matches | “No queue matches for ‘{query}’.” Offer **Clear search**. Scope counts show zero. Do not say the CRM has no contacts. |
| Current scope has no matches, other scopes do | State “No matches in {scope}” while the other scope tab counts expose where matches exist. Do not auto-switch the user's scope. |
| Invalid/too-long query | Inline `role="alert"` error associated to the field; retain the last valid result set. |
| Missing phone | Omit Call and Text; preserve Email if available and always preserve contact detail. |
| Missing email | Omit Email; preserve Call/Text if available and always preserve contact detail. |
| Loading/refetching | Preserve control dimensions and current results when safe; expose one `role="status"` update. Do not use a healthy empty state as loading. |
| Repository/error boundary | State that the queue could not load and that nothing changed. Expose Retry plus existing Contacts/Activities destinations. |
| Final batch | Remove the load action and show `All N shown`; do not disable an unexplained button. |

No state contains Mark as contacted, completion checkboxes, optimistic removal, or automatic communication logging.

## 7. Accessibility requirements

WCAG 2.2 AA is the minimum in light and dark modes.

- Use a section heading (`h2`) for the queue and preserve the page's existing heading hierarchy.
- Implement scopes as a single `tablist` with three `tab` controls and one active `tabpanel`. Supply `aria-selected`, `aria-controls`, and stable IDs. Arrow Left/Right changes tab focus; Home/End reaches first/last; Enter/Space activates if selection does not follow focus.
- Give the tablist an accessible label such as **Relationship queue timeframe**. Include the count in accessible tab text, not as an unlabeled visual badge.
- Subfilters are buttons or radio groups with an accessible group label. Expose selected state with `aria-pressed` or native radio semantics consistently.
- Associate the search label, description, and error through `label`, `aria-describedby`, and `aria-invalid` as appropriate.
- After a scope/filter/search change, keep focus on the initiating control and announce one concise polite update such as “Now, 18 results, showing 12.” Do not move focus to the first card.
- After **Load 12 more**, keep focus on that control (or its replacement status when exhausted) and announce the new visible count. Newly appended rows must not trigger one announcement per row.
- All interactive elements work with keyboard only; tab order follows visual/DOM order and contains no traps.
- Visible focus must meet 3:1 non-text contrast on every surface. Normal text contrast is at least 4.5:1; large text and UI boundaries are at least 3:1.
- Urgency, scope, lead type, validation, and selection are never communicated by color alone.
- Icon-only Call/Text/Email actions retain specific accessible names: `Call {name}`, `Text {name}`, and `Email {name}`. Decorative icons are hidden from assistive technology.
- Respect `prefers-reduced-motion`; filtering, tab changes, and batch expansion require no motion to understand state.
- Test at 200% browser zoom and 320 CSS px reflow in addition to the required 390 px viewport.

## 8. Component handoff

Reuse before creating:

- `ContactCard` for each triage entry.
- `GroupedSurface` for the visible entry collection.
- Existing action/link primitives and current Lucide icons. This repository has no project `icon-map.ts`; do not invent SVGs or add an icon registry solely for this queue.
- `queryContacts`, `normalizeContactQuery`, `parseLeadType`, and `ContactQueryError` from `contact-query.ts`.
- `buildTriage` and its existing bucket IDs from `triage.ts`.

Suggested organism boundary: `RelationshipQueue` receives the already prepared contacts, triage buckets, and `now` reference. UI state may include `scope`, `leadType`, `contextFilter`, `query`, and `visibleCount`. It must not own cadence or priority calculations.

## 9. Testable acceptance criteria

1. **Default group:** Given at least one entry in each bucket, when Today loads, then only the Now panel is active and it contains first-contact entries followed by overdue entries followed by due-today entries.
2. **Existing order:** Given a fixed contact set and `asOf`, when the queue renders without filters, then entry order within each source bucket exactly matches `buildTriage` output.
3. **Scope mapping:** Switching to Moments shows only celebration entries; switching to Next 7 days shows only coming-up entries; no other bucket is rendered in either panel.
4. **Independent moment axis:** A contact eligible for overdue and a birthday appears once in Now and once in Moments, with the appropriate existing reason in each.
5. **All entries reachable:** Given 37 matching Now entries, the initial render shows 12, two load activations show 24 then 36, and the final activation shows all 37 with `All 37 shown`.
6. **No terminal cap:** A fixture with more than 100 matching entries can reveal every entry in stable 12-entry increments.
7. **Batch reset:** After more than 12 entries are visible, changing scope, valid search, lead type, or contextual status resets the destination result view to at most 12.
8. **Search reuse:** Name, accent-insensitive name, email, phone digits, city, postal code, and tag queries produce the same contact membership as `queryContacts` for the same inputs.
9. **Search preserves priority:** Search results retain their relative order from triage; they are not re-sorted by `queryContacts` lead rank or textual relevance.
10. **Search spans scopes:** A search matching entries in multiple scopes updates every scope count while rendering only the active panel.
11. **Invalid search:** A query over 200 characters exposes the `ContactQueryError`, marks the field invalid, and leaves the last valid result set rendered.
12. **Lead subfilter:** Hot, Warm, and Nurture each map exactly to the existing lead type, persist across scope switches, and never alter triage ordering.
13. **Context subfilter:** Each Now filter maps to its bucket ID; Birthday/Homeaversary use structured source facts and do not parse UI copy.
14. **No forced scope switch:** When the active scope has zero matches but another scope has matches, focus and selection remain on the user's chosen scope and the other count remains visible.
15. **Communication actions:** Every contact with a phone exposes Call and Text using the existing `tel:` and `sms:` destinations; every contact with email exposes Email using `mailto:`; missing channels are omitted.
16. **Excluded action:** No queue row, toolbar, menu, empty state, or batch state contains Mark as contacted or an equivalent completion mutation.
17. **Keyboard tabs:** The scope tablist supports Tab, Arrow Left/Right, Home, End, Enter, and Space according to the specified interaction model, with one selected tab and one associated panel.
18. **Focus and announcements:** Search/filter/scope changes do not move focus into the list; one concise result update is announced. Loading more does not announce every appended row.
19. **390 px:** At a 390 × 844 viewport, there is no horizontal page overflow, no clipped text/action collision, no bottom-nav obstruction, and every protocol action has a 44 × 44 CSS px target.
20. **Zoom/reflow:** At 200% zoom and at 320 CSS px, controls and content reflow without loss of functionality or two-dimensional page scrolling.
21. **Contrast and non-color cues:** Light and dark modes pass WCAG AA contrast checks; selected, urgent, invalid, and lead-type states remain understandable without color.
22. **Regression:** Contact detail, Call, Text, Email, empty/onboarding behavior, deterministic headline counts, and current Today routes remain available after the queue change.

## 10. Autonomous decisions

- `[AUTO-DECISION] Which group opens first? → Now (reason: it preserves the product's “who needs me today?” and Speed to Lead priority).`
- `[AUTO-DECISION] Does search replace triage sort? → No; queryContacts supplies membership only (reason: lead-rank sorting would violate deterministic urgency order).`
- `[AUTO-DECISION] How does batching scale without hiding contacts? → Progressive batches of 12 with an explicit complete count and no terminal cap (reason: keeps the opening calm while guaranteeing reachability).`
- `[AUTO-DECISION] What is a count in Moments? → Eligible moment entries, not unique contacts (reason: birthday and homeaversary are separate stored reasons to reach out).`
- `[AUTO-DECISION] Is Mark as contacted represented as future UI? → No (reason: it is explicitly outside this story and a placeholder would imply unauthorized scope).`

## 11. Validation evidence required from implementation

- Focused unit tests for scope composition, membership intersection, ordering, filters, and 12-entry batching.
- Component/integration tests for accessible names, selected states, search errors, preserved protocol links, and exclusion of Mark as contacted.
- Keyboard-only pass and screen-reader smoke pass for tab/filter/search/load announcements.
- Browser evidence at 390 px, 320 px reflow, desktop, 200% zoom, light mode, and dark mode.
- Automated axe or equivalent scan plus manual contrast/focus verification; a zero-violation scan alone is not full WCAG certification.

