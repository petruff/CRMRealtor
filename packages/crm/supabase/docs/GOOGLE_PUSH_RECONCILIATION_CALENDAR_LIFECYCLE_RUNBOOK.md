# Google push, send reconciliation and Calendar lifecycle (0021)

## Scope and safety boundary

Migration 0021 is a forward-only Story 4.2 remediation. It adds a durable,
coalescing Gmail Pub/Sub wake-up queue, marker-based Gmail send ambiguity
reconciliation, explicit task-driven Calendar lifecycle authority, and a real
identity-bound provider probe. It also hardens generic disconnect confirmation:
only `provider-confirmed` evidence can produce a confirmed disconnect and
cryptoshred. A provider with no revocation endpoint remains
`disconnected_unconfirmed` for manual recovery.

The application must validate the Pub/Sub OIDC JWT signature, issuer, exact
audience, verified service-account identity and exact subscription before it
calls the ingress RPC. SQL then validates the pre-bound hashes and the active
Google account/capability/watch. Pub/Sub data is only a wake-up signal. The
worker must use the encrypted `google.gmail-history` cursor and bounded
`users.history.list`; a 404/expired history cursor must enter
`full_resync_required`. Watch renewal remains an operational task and should
run before Google's expiration.

No raw email, Gmail history id, Pub/Sub body, subject, message body, OAuth
token, provider request or Calendar external id is stored in a public table or
receipt. Public delivery and reconciliation rows are hash-only. Provider IDs,
tokens and cursors remain in `connector_private` or encrypted envelopes.

## Gmail watch and history worker

1. After a successful provider `watch`, bind its active watch resource using
   `bind_google_gmail_watch_ingress_authority`. Exact identical replay may pass
   `NULL` for the hidden CAS version and returns `noOp=true`; any rotation must
   pass the current `bindingVersion`.
2. Verify Pub/Sub authentication and routing outside SQL, hash the minimized
   fields, then call `register_google_gmail_push_wakeup`. A provider retry with
   the same message hash returns its original delivery/job. A distinct message
   increments `wake_generation` and reuses the active job.
3. Claim at most 100 jobs, start with lease/fence, read encrypted authority,
   then page Gmail history in bounded batches. Bind each minimized metadata
   resource with the wake-up-specific binder.
4. Commit the encrypted cursor with CAS. The job requeues when the page has
   more results or `wake_generation > claimed_generation`; otherwise it
   succeeds. Never trust a push-supplied history id as the committed cursor.
5. For cursor expiry, use the transition outcome `cursor_expired`. This deletes
   the unusable private cursor and records `full_resync_required` without
   inventing provider completion.
6. Schedule renewal jobs before expiry with
   `schedule_due_google_gmail_watch_renewals` (horizon 5 minutes–7 days, limit
   1–100). It only creates/coalesces durable `watch-renewal` work. After a real
   `users.watch`, `renew_google_gmail_watch_from_wakeup` requires the exact
   wakeup lease/fence plus current watch and ingress versions and immutable
   route hashes, then atomically rotates both version projections.

## Gmail send ambiguity

The approved encrypted Gmail draft payload contains the deterministic Omnix
RFC Message-ID/client marker. Before the generic job enters unknown outcome,
record its hash with `record_google_gmail_send_ambiguity`.

If and only if the same connection has an active account-bound
`gmail-metadata` capability, reconciliation may list at most 100 recent message
IDs without `q`, fetch minimized metadata, and compare the exact Message-ID/
client marker. `messages.list q` is forbidden because Gmail does not allow `q`
under `gmail.metadata`. A send-only connection reports
`unavailable-no-resend`. Not-found, ambiguous and unavailable outcomes never
authorize a second send. The generic connector reconciliation lifecycle remains
the terminal job authority.

## Calendar lifecycle

The owner-required action IDs are:

- `calendar.complete-omnix-event`
- `calendar.cancel-omnix-event`
- `calendar.delete-omnix-event`

`bind_google_task_event_lifecycle` accepts only an exact leased/fenced Google
job, the current canonical task version and the exact already-bound
Omnix-created provider event. Complete requires the canonical task to be
`completed`; cancel/delete require it to be `archived`. Remote drift is written
through `record_google_calendar_task_conflict`; SQL never overwrites the task
from an unrelated provider event.

## Real provider probe

`read_google_connection_probe_authority` is service-only and requires the
explicit active owner user/membership pair. It returns encrypted tokens and
the persisted account binding. The service always calls OIDC userinfo using
the existing `openid email` scopes; it calls Gmail profile only when
`gmailProfileCheckAvailable=true`. The service hashes the observed OIDC
subject and normalized email, then calls `record_google_connection_probe`.
Success requires both hashes to equal the persisted account/display label.
The RPC changes neither scopes nor remote identity.
If it returns `accessState=refresh-required`, the same owner-bound service uses
`refresh_google_connection_probe_access_token`; this RPC requires the current
refresh secret and exact access-secret CAS version, rotates only the encrypted
access token, and preserves account, identity and scopes.

## Rollback and recovery

`supabase/rollbacks/0021_google_push_reconciliation_calendar_lifecycle.rollback.sql`
is pre-use only. It refuses when any delivery/wakeup, send reconciliation,
lifecycle side effect or lifecycle intent exists. It restores the frozen 0014
Google helper/function bodies and the frozen 0009 revocation transition object,
then removes only 0021 objects. After use, stop ingress/workers, preserve
receipts/resources and use managed PITR or a reviewed forward remediation.

Local commands:

```powershell
cd packages/crm
npx supabase db reset --local
npx supabase test db supabase/tests/0021_google_push_reconciliation_calendar_lifecycle_test.sql --local
```

The migration and pgTAP prove local deterministic database authority only.
They do not prove Google Cloud Pub/Sub IAM/OIDC configuration, OAuth provider
verification, live Gmail/Calendar behavior, production credentials, deployment
or human acceptance.

## Local verification evidence — 2026-08-12

- Clean reset/replay: migrations 0001–0021 PASS.
- Focused pgTAP: 30/30 PASS.
- Forward-compatible connector matrix: 12 files, 252 tests PASS.
- Pre-use rollback: PASS with `ON_ERROR_STOP`; table/function restoration
  assertions PASS; forward replay and focused pgTAP PASS.
- Schema lint: no 0021-owned warning. Remaining output is historical.
- Raw all-files test discovery still reaches six historical direct-table tests
  whose assumed grants were deliberately revoked by later least-privilege
  migrations. These are not 0021 regressions and no unsafe grants were restored.
