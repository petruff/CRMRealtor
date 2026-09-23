# Sprint 1 Transaction UAT Matrix

**Candidate:** working tree on `codex/story-5-1-governed-ai`
**Scope:** Stories 7.1–7.6
**Evidence rule:** automated local evidence, authenticated UAT, physical-device UAT, deployment, and production smoke are independent states.

| Journey | Canonical facts and expected outcome | Owner | Assistant | Automated local | Authenticated UAT | Physical/PWA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Buyer transaction | Verified kind, title, contact, side, responsibility, parties, status and exact source remain drillable | Allow | Allow within active workspace | Covered by domain/repository/pgTAP | Pending | Pending |
| Seller/listing | Listing and seller are explicit; no stage inferred from missing data | Allow | Allow within active workspace | Covered by transaction authority tests | Pending | Pending |
| Lease/referral | Non-sale transaction kind remains distinct from sale volume and commission truth | Allow | Allow within active workspace | Covered by transaction kind contract | Pending | Pending |
| Critical dates | Exact instant, timezone, source, verification, responsibility and history survive correction | Allow | Allow within active workspace | Covered by milestone tests and pgTAP | Pending | Pending |
| Condo/association/flood | Only reviewed/current workflow pack can start; evidence and acknowledgements fail closed | Allow | Allow within active workspace | Covered by 16 workflow pgTAP assertions | Pending | Pending |
| Financial authority | Verified booked results remain separate from active unweighted forecast and excluded records | Allow | Allow within active workspace | Covered by financial domain/repository/pgTAP | Pending | Pending |
| Affordability | Unknowns remain unknown; exact components and assumptions produce a reproducible scenario revision | Allow | Allow within active workspace | Covered by TypeScript and PostgreSQL engines | Pending | Pending |
| Scenario comparison | Exact differences display without ranking, quote, recommendation, or guarantee | Allow | Allow within active workspace | Covered by domain and route contract tests | Pending | Pending |
| Governed handoff | Exact canonical scenario revision, recipient and consent create `previewed`; no provider send exists | Allow | Allow within active workspace | Covered by canonical-payload and append-only tests | Pending | Pending |
| Stale/duplicate write | Optimistic version mismatch fails; idempotent replay returns the original receipt | Allow | Allow within active workspace | Covered by memory and pgTAP tests | Pending | Pending |
| Cross-workspace attempt | Read returns no row and mutation fails central membership authority | Deny | Deny | Covered by pgTAP | Pending | Pending |
| Missing data | UI says unknown/unavailable and never substitutes zero | Allow | Allow | Covered by calculation and UI contracts | Pending | Pending |
| Offline/reconnect/update | No uncertain mutation is represented as complete; installed PWA recovers navigation/update state | Allow | Allow | Service-worker contract only | Pending | Pending |

## Required device cells

| Width/device | Routes | Required checks | Current state |
| --- | --- | --- | --- |
| 390 px mobile | `/transactions`, `/transactions/scenarios`, `/insights` | No global/element overflow, visible primary actions, touch-safe controls, no error overlay | PASS in local Chromium sample mode |
| 414 px / iPhone 11 geometry | Same | Same plus safe area and Mobile Safari behavior | Geometry PASS in local Chromium; physical Mobile Safari pending |
| 768 px tablet | Same | Reflow, date/currency controls, keyboard order | PASS in local Chromium sample mode |
| 1440 px desktop | Same | Dense information hierarchy, exact contributor access, no excessive line length | PASS in local Chromium sample mode |
| iPhone 11 Safari | Critical create/edit/recovery journey | Browser version, orientation, safe area, theme, logout | Pending external device UAT |
| Installed PWA | Critical create/edit/recovery journey | Standalone mode, offline/reconnect/update, safe area, logout | Pending external device UAT |

## Release block

This matrix cannot produce a release PASS until authenticated owner and clean-assistant cells, physical iPhone 11 Safari, installed PWA, recovery rehearsal, and exact-candidate evidence are recorded. Local sample-mode browser evidence is implementation verification only.
