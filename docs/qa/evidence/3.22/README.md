# Story 3.22 responsive evidence index

Generated on 2026-08-20 against the local sample-data runtime at `http://127.0.0.1:3214/activities` after the Story 3.22 source freeze.

## Machine-readable evidence

- `responsive-receipts.json` — 390/768/1440 light/dark geometry, target minima, fixed-element intersections, console state and the compact More disclosure check.
- `implementation-log.md` — IDS decisions and preservation boundaries for every modified implementation surface.

## Automated evidence

- `npm test -- --run app/activities/route-states.test.ts components/activity-workspace.test.tsx components/app-shell.test.tsx components/omnix-assistant-launcher.test.tsx` — 4 files, 17 tests, PASS.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — final shared-worktree rerun: 733 passed, 2 failed in `lib/data/supabase-rich-contact-repository.test.ts` because a concurrent repository change added `.in(...)` while its mock was not updated. These failures are outside Story 3.22 ownership; the Story 3.22 focused suite remained 17/17 PASS.
- `npm run build` — PASS after the final source adjustment.

The dense populated fixture is mounted by `components/activity-workspace.test.tsx`. The browser runtime uses the truthful empty sample-data state, so no real workspace mutation was performed to fabricate a populated screenshot.

## Evidence boundary

- Browser viewport override proved page reflow at 390, 768 and 1440 CSS-pixel viewports. Vertical scrollbars reduce the measured `clientWidth` to 375, 753 and 1425 respectively; every matching `scrollWidth` remained equal to `clientWidth`.
- A 225 CSS-pixel viewport was used as a conservative 200%-reflow geometry equivalent. The in-app browser did not expose or honor native page-zoom shortcuts, so this receipt is explicitly **not** a substitute for the independent native-200% check.
- The browser console contained no warning or error entries during the saved route matrix.
- Screenshots are not asserted as evidence in this developer index. Independent UX/QA visual receipts remain the authority for native zoom, keyboard-only visual focus, reduced motion and the final light/dark screenshot matrix.
- The final full regression is not green in the shared worktree. Story 3.22 must remain InProgress until the owning data story repairs and reruns the two unrelated Supabase repository tests.
