# Production Security, Schema and API Hardening

**Story:** 3.29
**Decision owner:** @architect (Vega)
**Database design:** @data-engineer (Ceres)
**Date:** 2026-08-23
**Status:** Approved for local implementation; remote mutation requires backup gate

## Context

The current brownfield release has three coupled failures:

1. privileged connector-worker functions are executable by end-user database roles;
2. the deployed application expects contact-merge capabilities absent from Production and hides that drift during reads;
3. browser-session middleware intercepts operational API routes before their route-owned authorization can run.

The same audit also found an N+1 duplicate-read path and technical identifiers in action-oriented UI. The correction must preserve the modular Next.js/Supabase monolith, existing RLS boundaries and all current contact data.

## Trust Boundaries

| Boundary | Caller | Authentication owner | Allowed authority |
|---|---|---|---|
| Browser CRM | Judith or assistant | Supabase session middleware + RLS | Workspace-scoped user actions |
| Operational API `/api/v1/*` | Explicit API client | Route handler through hashed API-key authority | Granted scopes only |
| Provider webhooks | Mailchimp, Google, Meta, Twilio | Route-specific signature/token verification | Ingest one provider event |
| Connector worker | Server runtime | Service-role credential plus worker lease | Claim jobs and read/write encrypted connector envelopes |
| Migration/recovery | Developer release process | Direct database operator credential | Versioned DDL and verified recovery only |

Session middleware therefore treats `/api/v1` as transport-public, not authorization-public. Every route keeps its existing handler-level fail-closed authentication.

## Database Decision

Add one forward-only migration after the current timestamped migrations. It will:

- revoke `EXECUTE` on the eighteen privileged connector functions from `public`, `anon` and `authenticated`;
- revoke and then explicitly grant those functions to `service_role`;
- change default function privileges for the migration owner so future versioned functions are not executable by `public`, `anon` or `authenticated` by default;
- leave currently intentional user-facing RPC grants unchanged;
- add comments documenting the service-only boundary.

The migration does not redefine worker functions, contact data, RLS policies or deduplication behavior. A paired rollback restores only the prior grants for the eighteen functions and the prior default privilege behavior. Rollback is for emergency compatibility only; restoring the unsafe end-user grants requires an explicit incident decision.

Supabase's internal `supabase_admin` role owns platform defaults that the project migration owner cannot alter in a clean local stack. Privileged application functions therefore must be created only through versioned migrations. Dashboard-authored privileged functions are outside the supported release path and require a separate owner-authorized privilege review.

The Production application must not depend on 0027/0028 until database adoption is proven. A batch identity read uses `contact_merge_aliases` once per page. If the exact-merge schema is absent, the repository returns the safe standalone mapping once and emits one bounded capability warning rather than calling a missing RPC per contact. Write/merge capabilities remain unavailable until migrations 0027/0028 are adopted and verified.

## API Decision

`/api/v1` is added to the session-public prefix catalog. This removes the 307 browser-login redirect while preserving authorization in `executeOperationalApiRequest` and the webhook handler. Regression tests must prove:

- the prefix is segment-bounded (`/api/v10` is not matched);
- missing credentials return JSON `401` rather than a redirect;
- invalid or under-scoped credentials return stable JSON errors;
- service credentials are never returned in an error body.

## Duplicate-Audit Decision

Extend `RichContactRepository` with one workspace-bounded `listContactPointsForContacts` read. Implementations:

- Supabase: one `contact_points` query using workspace scope and the bounded contact ID page; alias resolution is one page query, not one RPC per contact;
- memory: one in-memory bounded filter after legacy-point hydration;
- application audit: one call for at most `CONTACT_DUPLICATE_AUDIT_LIMIT` contacts.

The existing single-contact method remains for contact details and mutations. This avoids changing unrelated consumers.

## User Experience Decision

Action surfaces must lead with the person or service and keep technical references secondary and copyable only when diagnostic value exists:

- insights lists contact display names and human context;
- assignment controls list member display name/email and readable role;
- connection receipts use short support references with explanatory labels;
- incomplete-contact controls receive visible or screen-reader labels;
- loading copy is neutral and route-safe.

No cosmetic redesign is included. The goal is comprehension, accessibility and error prevention without destabilizing the premium visual system.

## Release and Recovery Sequence

1. Run all local code, migration replay and pgTAP gates.
2. Capture a current non-empty Production logical dump to an explicit release-artifact directory outside the repository.
3. Record SHA-256, byte size and database identity without logging PII.
4. Restore the dump into an isolated database and verify schema objects plus aggregate row counts.
5. Save the forward migration and compensating rollback command/receipt.
6. Apply the migration through the versioned migration path.
7. Verify ACLs, schema capabilities, advisors/logs and authenticated owner/assistant journeys.
8. Promote the application only after database compatibility is green.

If steps 2–4 cannot be proven, remote DDL and Production promotion stop. Local completion can still be committed as release-candidate work, but it cannot be described as released or fully operational.

## Non-Goals

- importing Judith's workbook;
- reconciling the 192 historical rows with 191 contacts;
- merging or deleting duplicate contacts;
- consolidating similarly named workspaces;
- completing Gmail, Calendar or Mailchimp provider UAT without Judith's consent;
- claiming 100% readiness from local tests alone.

## Verification Contract

- unit tests for route policy, handler auth, identity-map degradation and batch duplicate reads;
- pgTAP assertions for exact function ACLs and role impersonation denial;
- clean local migration replay from 0001 through the new migration;
- lint, typecheck, full test suite, production build and dependency audit;
- authenticated responsive smoke at 390, 768 and 1440 widths;
- Production backup/restore, migration, ACL and post-deploy evidence retained as release receipts.
