# Sprint 1 Transaction UX Audit

**Scope:** `/transactions`, `/transactions/scenarios`, `/insights` and Stories 7.1–7.5
**Method:** source review, local sample-mode Chromium at 390/414/768/1440, accessibility-tree inspection, console/error-overlay inspection, Lighthouse snapshot, and focused automated tests.

## Findings and disposition

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| S1UX-01 | P1 | Insights operating-current stages extended beyond the visible 390/414 viewport inside a horizontal rail, leaving contributors undiscoverable without lateral scrolling. | Fixed: narrow containers now reflow into a two-column card grid; verified with zero overflowing elements. |
| S1UX-02 | P1 | Affordability preview RPC originally trusted browser-provided preview JSON instead of proving it matched the immutable scenario revision. | Fixed: server derives and compares the canonical exact payload before storing the preview. |
| S1UX-03 | P2 | Affordability checkbox graphics were 13 px and their label rows only 32 px high. | Fixed: each label provides a minimum 44 px activation area. |
| S1UX-04 | P2 | A verified affordability input with an empty source could receive a generic fallback in the server action. | Fixed: no source is invented; domain and RPC fail closed when verification/provider provenance requires one. |
| S1UX-05 | P2 | Scenario code created during an interrupted patch was compressed and difficult to audit. | Fixed: domain contracts and calculations were normalized and independently tested. |
| S1UX-06 | Blocker | Authenticated owner/assistant browser proof is absent for this candidate. | Open; blocks release PASS. |
| S1UX-07 | Blocker | Physical iPhone 11 Safari and installed-PWA proof is absent. | Open; blocks release PASS. |
| S1UX-08 | Blocker | Exact-candidate backup/read-back, rollback/forward-repair rehearsal and production smoke are not yet recorded. | Open; blocks release PASS. |

## Local evidence

- `/transactions`, `/transactions/scenarios`, and `/insights` produced meaningful main content and no Next.js error overlay.
- 390, 414, 768, and 1440 px checks returned document width equal to viewport width and no element beyond the viewport after S1UX-01.
- Browser console returned no errors, warnings, or issues on the affordability route.
- Lighthouse mobile snapshots returned Accessibility 100 and Best Practices 100 for affordability and Insights. SEO was 75 on authenticated application routes and is not used as the internal workflow accessibility gate.
- The affordability route exposes named form controls, fieldsets/legends, skip navigation inherited from the shell, explicit unknown/source/date/verification/assumption labels, consent language, and a no-send boundary.

## Residual conclusion

Local implementation state is **CONCERNS**, not release PASS. No open local P0/P1 found after corrections, but the authenticated, physical-device, PWA, recovery, and exact-candidate gates remain unexecuted.
