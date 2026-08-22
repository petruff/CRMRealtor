# Definition of Done — Story 3.0

## Delivered

- [x] One canonical `workspace_id` authority and owner/assistant memberships.
- [x] Forward-only backfill with count, null and referential assertions.
- [x] Membership-derived RLS and cross-workspace relationship constraints.
- [x] Required `WorkspaceScope` across live/sample repositories and intake.
- [x] CLI-first bootstrap, show, member management and redacted health.
- [x] Owner-only live membership mutations and structured authority audit.
- [x] Authenticated live CLI refuses secret/service-role credentials.

## Verified locally

- [x] `supabase db reset --local --yes` replays migrations `0001`–`0004`.
- [x] SQL/TAP isolation matrix passes 11/11 and rolls back fixtures.
- [x] `npm run lint` passes with zero warnings.
- [x] `npm run typecheck` passes.
- [x] `npm test` passes: 27 files, 157 tests.
- [x] Independent architecture gate is GO with zero unresolved findings.
- [x] `npm run build` passes on Next.js 15.5.23.
- [x] Production preview listens on `http://127.0.0.1:3200` and `/welcome` returns HTTP 200.

## Review boundary

- [ ] Separate owner/assistant browser smoke using real Google/Supabase sessions on a migrated hosted project.
- [ ] Architect/QA verdict and story closure.
- [ ] Production deployment, secrets provisioning and real-account UAT remain outside this story.
