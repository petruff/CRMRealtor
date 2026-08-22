# Story 4.2 — Google provider decision log

**Status:** local implementation complete; external activation evidence pending  
**Date:** 2026-08-12  
**Authority:** Story 4.2 AC1–AC10 and the Story 3.5 connector platform

## Least-privilege scope decision

- Google sign-in remains identity-only (`openid email profile`). It is not a Gmail or Calendar connection.
- Connector consent is incremental and uses separate feature bundles:
  - Gmail send: `https://www.googleapis.com/auth/gmail.send` (Google classifies it as sensitive).
  - Gmail minimized activity: `https://www.googleapis.com/auth/gmail.metadata` (Google classifies it as restricted). Omnix will not request message bodies or attachments.
  - Calendar: `https://www.googleapis.com/auth/calendar.app.created`, limited to a secondary calendar created by Omnix and events on it.
- No `gmail.readonly`, `gmail.modify`, broad `calendar`, `calendar.events`, primary-calendar write, service-account domain delegation or reuse of Supabase identity tokens.
- The web-server authorization request uses exact registered redirects, PKCE/state binding, `access_type=offline` and `include_granted_scopes=true`. The callback persists the exact granted set and fails closed if the expected remote account changes.

## Sync and recovery decision

- Gmail uses a bounded initial metadata synchronization followed by `history.list`. Verified Pub/Sub push is a wake-up only; durable coalescing jobs own processing, and scheduled renewal prevents a watch from silently expiring. A stale `startHistoryId` that returns HTTP 404 requires an explicit bounded full resync.
- Ambiguous Gmail send acceptance never retries the send. With the separately approved metadata bundle, Omnix scans at most 100 recent message IDs without `q` and compares the deterministic Message-ID; without that scope it remains unresolved and fail-closed.
- Gmail history pages remain bounded at the official maximum of 500 records; cursors are private, workspace/account-bound and idempotent.
- Google Calendar uses an initial event list followed by `syncToken` incremental reads. All non-pagination query parameters remain identical across pages and later syncs. HTTP 410 clears only the private calendar cursor and starts a bounded full resync.
- The Omnix task is canonical. Create/update/complete/cancel/delete operations target only the stable Omnix-owned event. Remote changes or deletes become a conflict/reconciliation outcome and never silently overwrite the task.

## Privacy and verification boundary

- Gmail metadata persists only provider IDs, direction, minimized matching addresses, timestamp, approved labels and a provider link. Body and attachment collection is prohibited. Subject persistence remains off pending a separately approved retention decision.
- Because `gmail.metadata` is restricted, a public deployment must complete Google's OAuth verification requirements. If restricted-scope data is stored or transmitted through servers, the applicable security assessment is an external activation gate.
- No production/live claim is allowed without production OAuth credentials, exact registered redirects, approved privacy/retention, scope verification/assessment as applicable, and owner/assistant real-account UAT.

## Official sources reviewed

- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Gmail synchronization: https://developers.google.com/workspace/gmail/api/guides/sync
- Gmail history API: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Gmail send: https://developers.google.com/workspace/gmail/api/guides/sending
- Calendar scopes: https://developers.google.com/workspace/calendar/api/auth
- Google web-server OAuth and incremental authorization: https://developers.google.com/identity/protocols/oauth2/web-server
- Secondary calendar creation: https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert
- Calendar synchronization: https://developers.google.com/workspace/calendar/api/guides/sync
- Calendar errors: https://developers.google.com/workspace/calendar/api/guides/errors

## External activation inputs still required

- Google Cloud project, OAuth client ID/secret and exact callback registrations.
- Final privacy notice, retention/deletion policy and restricted-scope assessment decision.
- Real owner and assistant test accounts and a dedicated UAT calendar.
- Human approval of the real-account UAT evidence before the provider mode can become `live`.

## Implementation evidence

- Migrations `0014_google_connector_authority.sql` and `0021_google_push_reconciliation_calendar_lifecycle.sql`, with rollback/runbooks, are the durable authority for OAuth, capability bundles, token refresh, push wake-ups/watch renewal, cursors, drafts, provider resources, send ambiguity and task lifecycle/conflicts.
- CLI `npm run google` proves explicit scopes and fails closed without authenticated live credentials. Its live probe calls OIDC userinfo and, when authorized, Gmail profile, then persists only account/email/evidence hashes; UI reuses the same repository/application seams.
- Gmail send is draft → immutable intent → owner approval → durable job → provider binding. Metadata sync excludes bodies/subjects and requires an exact active canonical email point.
- Calendar writes target only the secondary Omnix calendar. Task version and signed event fields detect remote edits/deletes without overwriting Omnix.
- Local gates: lint PASS; typecheck PASS; Vitest 118 files/561 tests PASS; optimized build PASS; focused pgTAP 0021 30/30 and compatible pgTAP 252/252 PASS; CLI help/scopes/status PASS and live-without-authority fail-closed PASS.
- Browser/accessibility and real Google account UAT remain NOT_RUN; no deployed/production claim.
