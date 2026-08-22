# Decision Log: Story 1.1 Apple-inspired UI hardening

**Generated:** 2026-08-10T22:59:00Z  
**Agent:** @dev (Vulcan)  
**Mode:** YOLO  
**Story:** `docs/stories/1.1.contact-triage-foundation.story.md`  
**Rollback:** No Git repository is present; use the before screenshots and file-level backups outside this workspace if rollback is required.

## Context

The client requested the strongest practical UI/UX implementation using the supplied Apple design contract. Story 1.1 AC5 already required a premium mobile-first interface, but its original implementation had never been visually verified.

## Decisions

1. **Adopt the supplied `--sk-*` namespace as the visual source of truth.**
   - Reason: preserves the referenced system semantics and prevents a value-only imitation.
   - Alternative: remap everything to generic Tailwind defaults; rejected because it would lose token lineage.

2. **Keep CRM temperature colors separate from brand interaction colors.**
   - Reason: Hot, Warm, and Nurture are required operational signals, while Apple blue owns interaction.
   - Alternative: force a single-blue palette; rejected because it would weaken triage comprehension.

3. **Use grouped surfaces instead of repeated standalone cards.**
   - Reason: improves scan speed, reduces chrome, and brings the hierarchy closer to Apple's typography-and-space model.
   - Alternative: restyle every existing card; rejected because card density was the main visual conflict.

4. **Use the SF/system stack without shipping proprietary Apple font files.**
   - Reason: correct on Apple platforms, lawful and resilient elsewhere, with explicit Helvetica/Arial fallbacks.
   - Alternative: retain Fraunces + Inter; rejected because it contradicted the supplied contract.

5. **Migrate lint from deprecated interactive `next lint` to ESLint CLI.**
   - Reason: makes the mandatory quality gate deterministic and CI-safe without adding dependencies.

## Files and artifacts

- UI foundation and routes: `packages/crm/app/**`, `packages/crm/components/**`
- Quality configuration: `packages/crm/eslint.config.mjs`, `packages/crm/package.json`, `packages/crm/next.config.ts`
- Audit and screenshots: `outputs/design-system/CRMRealtor/**`
- Self-critique: `plan/self-critique-1.1-design.json`

## Verification

- `npm run lint` — passed with zero warnings
- `npm run typecheck` — passed
- `npm test` — 29/29 passed
- `npm run build` — passed; 9 application routes including the new icon asset
- Playwright — all six screens inspected at desktop and mobile; light/dark; first keyboard focus exposes Skip to main content
- Contrast calculation — light semantic/text pairs: 4.55:1–5.07:1; dark pairs: 5.80:1–9.45:1

## Known environment notes

- CodeRabbit could not run because the configured WSL distribution `Ubuntu` is not installed (`WSL_E_DISTRO_NOT_FOUND`). Manual review and all local gates were used instead.
- The pre-existing dev server on port 3000 was not terminated. Running `next build` invalidated its cached chunks; restart that process before using port 3000 again.
