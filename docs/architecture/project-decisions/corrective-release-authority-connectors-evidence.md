# Corrective Release Architecture Decision: Authority, Connector Truth, and Release Evidence

**Status:** Proposed; release-blocking
**Decision date:** 2026-08-25
**Inspected snapshot:** `3b4a8ffeeea090738d4b7bd5c104bd5552856867` on `codex/story-3-29-production-hardening`
**Scope:** Corrective release only; no connector expansion or ownership-transfer feature

## Decision Summary

The corrective release must make three boundaries canonical:

1. A workspace has one canonical owner identity. An administrative support grant is a separate, explicit capability and never changes an assistant membership into an owner membership.
2. Every connector UI surface consumes one server-built, fail-closed lifecycle projection. UI components do not independently infer health from connection rows, provider mode, capabilities, baseline, webhook, or caught errors.
3. Production promotion is authorized only by one immutable evidence manifest bound to the candidate Git SHA, application deployment, migration checksums and observed versions, rollback rehearsal, provider lifecycle receipts, and authenticated UAT.

No new technology is required. The design remains Next.js, TypeScript, Supabase/PostgreSQL, provider adapters, Vitest, and pgTAP.

## Current-State Findings

- `workspace_members` correctly preserves one active `owner`, and `WorkspaceScope.ownerUserId` records that canonical identity.
- `20260821155317_workspace_admin_multi_membership.sql` changes `public.is_workspace_owner()` to return true for either the canonical owner or an active row in `private.workspace_admin_grants`.
- `resolveSupabaseWorkspaceScope()` calls that predicate and rewrites an assistant's role to `owner`. Application checks such as `scope.role === 'owner'` consequently authorize the administrator as an owner.
- Google and Mailchimp OAuth services, connector disconnect/approval paths, and workspace AI key mutation all trust that rewritten role. Database connector functions also call `connector_current_membership(..., true)`, which currently delegates to the broadened owner predicate.
- The Connections page derives status from several sources and helpers: `ConnectorConnection.status`, provider runtime mode, Google capability reads, Mailchimp audience binding, baseline/reconciliation, webhook flags, and presentation-time error classification. The overview card and detailed panel can therefore describe different lifecycle states.
- Story 3.31 and its QA gate list migration replay, rollback rehearsal, authenticated smoke, and owner provider UAT separately. There is no executable release manifest or CI workflow binding those receipts to one candidate SHA and deployment.
- The inspected SHA is evidence for this analysis, not an approved release candidate. The worktree contains pre-existing user changes and untracked audit artifacts.

## AD-1: Separate Canonical Ownership from Support Administration

### Contract

Replace effective-role elevation with an immutable actor authority object:

```ts
interface WorkspaceAuthority {
  actorUserId: string;
  workspaceId: string;
  membershipId: string;
  membershipRole: 'owner' | 'assistant';
  canonicalOwnerUserId: string;
  supportGrant: { grantId: string; active: true } | null;
}

const isCanonicalOwner = (authority: WorkspaceAuthority) =>
  authority.membershipRole === 'owner'
  && authority.actorUserId === authority.canonicalOwnerUserId;
```

`membershipRole` is never rewritten. Support authorization uses a separate predicate and a deny-by-default allowlist. Existing support workflows may opt into that predicate only after they are named and tested. The following operations are always canonical-owner-only:

- begin, complete, reconnect, disconnect, or revoke Google/Mailchimp identity bindings;
- select or replace the Mailchimp account/audience and approve provider-bound outbound work;
- mutate provider secrets, OAuth transactions, account hashes, granted scopes, or revocation state;
- save, rotate, remove, enable, or disable workspace AI providers, models, or API keys.

Database authority must mirror the application contract:

- restore `public.is_workspace_owner(workspace_id)` to canonical membership semantics;
- add a distinctly named `public.has_workspace_support_grant(workspace_id)` predicate;
- make owner-only security-definer functions call an assertion that verifies `auth.uid()`, active owner membership, canonical owner identity, and actor membership ID in one transaction;
- preserve support grant and audit rows, but never use them as owner identity evidence;
- add a forward corrective migration. Do not rewrite applied migration files.

This is defense in depth: hiding controls in the UI is insufficient; server actions, application services, repositories, RLS/security-definer functions, OAuth transaction consumption, and AI mutation RPCs must each reject a support administrator.

### Compatibility and trade-off

Existing assistants keep read access and explicitly approved support operations. Code that currently relies on the synthetic `owner` role will fail closed until migrated to either `isCanonicalOwner()` or an explicit support capability. This may temporarily reduce administrator convenience, but it prevents identity takeover and secret mutation while preserving the canonical owner and audit history.

## AD-2: One Fail-Closed Connector Lifecycle Projection

### Contract

Add a server-side application projection returned by the connector query boundary:

```ts
type ConnectorLifecycleState =
  | 'not-configured' | 'disconnected' | 'disconnect-pending'
  | 'owner-consent-pending' | 'reconnect-required' | 'scope-pending'
  | 'webhook-pending' | 'baseline-pending' | 'baseline-running'
  | 'review-required' | 'degraded' | 'ready';

interface ConnectorLifecycleProjection {
  provider: 'google' | 'mailchimp' | 'twilio' | 'meta';
  connectionId?: string;
  state: ConnectorLifecycleState;
  grantedScopes: readonly string[];
  missingScopes: readonly string[];
  baseline: 'not-applicable' | 'pending' | 'running' | 'review' | 'complete' | 'unknown';
  webhook: 'not-applicable' | 'pending' | 'active' | 'unknown';
  providerEvidence: 'missing' | 'stale' | 'current';
  ownerAction: 'none' | 'connect' | 'finish-consent' | 'reconnect' | 'review';
  safeSummary: string;
  observedAt: string;
}
```

Provider-specific readers supply facts; one pure reducer applies this precedence:

1. disconnected or revoking;
2. missing configuration;
3. reconnect required or revoked authorization;
4. owner consent pending;
5. required scope pending;
6. signed webhook pending;
7. baseline pending, running, or review;
8. unavailable, stale, contradictory, or failed required reads become `degraded`;
9. `ready` only when every provider-required fact and receipt is affirmative and current.

Unknown is never converted to connected or ready. Mailchimp requires account authorization, selected audience, signed webhook, completed baseline, and no blocking reconciliation state. Google requires the owner-bound account, the relevant exact scopes, usable refresh authority, and healthy required capability reads. Provider runtime mode is a release prerequisite, not proof that an individual connection is ready.

All overview cards, detailed panels, badges, action labels, and API/readiness surfaces consume the same projection object from the same request. Presentation modules map canonical states to calm user language but cannot alter lifecycle meaning.

### Compatibility and trade-off

The underlying normalized provider tables and repositories remain unchanged initially; the projection is additive. It adds one orchestration read and reducer, but removes duplicated inference and prevents false-green UI. Reads should run concurrently and remain bounded; a failed required read produces `degraded`, avoiding provider retries from the render path.

## AD-3: SHA-Bound Release Evidence Manifest

### Contract

Generate one immutable JSON artifact at `docs/qa/releases/<candidate-sha>/release-manifest.json`. It is append-only after candidate creation and contains:

- full candidate SHA, clean-worktree assertion, branch, build artifact/deployment ID, and artifact digest;
- ordered migration filenames and SHA-256 checksums, clean replay result, observed target migration versions, and post-apply schema checks;
- rollback target plus application rollback and database rollback/forward-recovery rehearsal receipts;
- per-provider lifecycle projection, redacted receipt IDs/hashes, actor classification `canonical-owner`, safe operation proof, and Mailchimp baseline/webhook or Google scope evidence as applicable;
- authenticated UAT matrix for the exact deployment at 390, 768, and 1440 widths, including workspace ID hash, tested routes, health/readiness, and tester role;
- gate results for dependency audit, secret scan, lint, typecheck, full tests, build, and manifest validation.

Promotion fails if any required field is absent, any SHA/checksum/deployment differs, an owner-only provider receipt was produced by a non-owner actor, or UAT targeted another deployment. Provider UAT may remain `blocked-external`; that state is honest but blocks claims that the provider is live.

Rollback must never restore the broadened owner predicate. If application rollback would reintroduce administrator-as-owner behavior, use a safe corrective build or disable affected entry points while rolling forward. Historical receipts and provider grants are retained; rollback blocks new work rather than deleting evidence or silently revoking external identities.

### Compatibility and trade-off

Existing story notes and screenshots remain supporting evidence, but only manifest-linked receipts can authorize promotion. This adds release ceremony and storage, but eliminates the current ambiguity where passing local gates, applied migrations, Production smoke, and provider consent refer to different revisions or moments.

## File Impact

| Area | Expected impact |
|---|---|
| `packages/crm/lib/domain/workspace.ts` | Replace role elevation assumptions with explicit canonical-owner and support-grant authority contracts. |
| `packages/crm/lib/data/supabase-workspace-scope.ts` | Stop rewriting assistant to owner; resolve canonical owner and support grant separately. |
| `packages/crm/lib/data/supabase-workspace-repository.ts` | Split owner-only authorization from support-administration authorization. |
| `packages/crm/supabase/migrations/<new>_canonical_owner_authority.sql` | Forward-fix predicates and owner-only connector/AI RPC assertions; preserve existing grants and audit rows. |
| Google/Mailchimp OAuth services, routes, repositories, connector commands, and workspace AI settings | Require canonical-owner assertion at every mutation boundary. |
| `packages/crm/lib/domain/connector.ts` and a new application projection module | Define lifecycle projection, provider fact readers, reducer, and freshness rules. |
| `packages/crm/app/connections/page.tsx`, `connection-status.ts`, `mailchimp-presentation.ts`, and connector readiness APIs | Consume the canonical projection; remove independent lifecycle inference. |
| `packages/crm/scripts/` and `packages/crm/package.json` | Add release-manifest create/validate commands and exact-SHA gate orchestration. |
| `docs/qa/releases/` and Story 6.8 gate artifacts | Store immutable candidate evidence and link the release verdict to it. |

Before implementation, search every current use of `is_workspace_owner`, `connector_current_membership(..., true)`, and `scope.role === 'owner'`; classify it as canonical-owner-only, explicit support, or ordinary membership. Unclassified uses fail the corrective gate.

## Required Tests

1. **Authority unit/integration:** owner remains owner; support administrator remains assistant; revoked/stale grant fails; ambiguous owner fails; no client-supplied role or owner ID can elevate authority.
2. **Database pgTAP:** direct RPC attempts by support administrator cannot start/finish/revoke Google or Mailchimp OAuth, disconnect identities, mutate scopes/secrets, or save/remove/toggle AI settings. The canonical owner succeeds. Audit rows identify the real actor and owner separately.
3. **OAuth transaction binding:** callback consumption requires the same canonical owner, membership, workspace, state/session binding, and connection account hash; administrator-created or replayed transactions fail.
4. **Lifecycle reducer:** table-driven tests cover every state and precedence, including failed reads, stale evidence, partial Google scopes, Mailchimp webhook pending, baseline pending/running/review, reconnect, and contradictory facts. No unknown combination returns `ready`.
5. **UI contract:** overview card, detail panel, controls, and readiness response render the same projection state. Administrators see status but no owner mutation controls; forged server-action requests are denied.
6. **Release manifest:** wrong SHA, dirty candidate, migration checksum drift, missing replay/rollback, mismatched deployment, non-owner provider UAT, stale lifecycle evidence, or unauthenticated/wrong-width smoke each fail validation.
7. **Regression:** run focused suites plus `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from `packages/crm`; then run authenticated responsive UAT against the exact deployed candidate.

## Rollout Sequence

1. Ship and verify the additive authority correction before allowing any owner-only connector or AI mutation.
2. Introduce the lifecycle projection behind tests, then migrate every UI/readiness consumer in one release; do not leave mixed status authorities.
3. Create a clean immutable candidate, generate the manifest, replay migrations, rehearse rollback, deploy that SHA, and append deployment-bound evidence.
4. Have the canonical owner complete provider consent/UAT. Promote provider state to `ready` only from persisted, redacted lifecycle evidence.

## Autonomous Decisions

- `[AUTO-DECISION] Is a brownfield architecture artifact appropriate? -> Yes (reason: the correction crosses database authority, application services, UI projection, provider lifecycle, and release governance).`
- `[AUTO-DECISION] Should applied migrations be edited? -> No (reason: forward-only correction preserves migration history and reproducibility).`
- `[AUTO-DECISION] Can current Story 6.8 evidence authorize release? -> No (reason: it is not bound to one immutable SHA, migration set, deployment, rollback rehearsal, and canonical-owner provider UAT).`
