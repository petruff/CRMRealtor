# Omnix connector operations

Story 3.5 supplies the provider-neutral control plane. It does not claim that Gmail, Google Calendar, Mailchimp, Twilio, or Meta is live. Each provider remains disabled until its Story 4.x implementation, provider credentials, external approvals, real-account UAT, webhook proof, and disconnect/revocation evidence are complete.

## CLI first

Run from `packages/crm`:

```powershell
npm run connectors -- definitions
npm run connectors -- connections
npm run connectors -- scopes --connection-id connection-contract-test
npm run connectors -- intents
npm run connectors -- jobs --state all
npm run connectors -- receipts
npm run connectors -- probe --connection-id connection-contract-test
```

Default mode is deliberately `sample-process-only` and non-durable. Live commands require the migrated Supabase repository plus an authenticated, active workspace membership; no sample fallback is allowed.

The external-write sequence is:

```powershell
npm run connectors -- draft --live --provider contract-test --connection-id <connection-id> --action test.succeed --payload-ref <encrypted-payload-id> --payload-hash <sha256> --policy-id <policy-id> --policy-version 1 --summary "Contract proof"
npm run connectors -- enqueue --live --intent-id <intent-id> --expected-version 1 --idempotency-key <unique-key>
npm run connectors -- drain --live
npm run connectors -- receipts --live --job-id <job-id>
```

`enqueue` is the owner-only atomic approve-and-enqueue operation. Editing creates a new version and requires a new approval. Rejecting never queues or calls a provider. `probe` never invents health: the foundation returns an honest unsupported/configuration state until the provider story supplies a receipt-backed probe. `drain`, `reconcile`, and `rewrap` use a separate `live-server-only` authority backed by `SUPABASE_SERVICE_ROLE_KEY`; they never reuse the realtor's end-user session. The production drain invocation remains restricted to the cron-authenticated server route.

As verified read-only on 2026-08-25, the linked Vercel project is on the Hobby plan, which supports only one cron invocation per day and may invoke it at any point within the selected hour. The repository therefore declares the supported `0 6 * * *` schedule in `packages/crm/vercel.json` as a maintenance/recovery sweep only. It does **not** meet the interactive connector worker SLO and cannot authorize a `ready` or live-provider release claim. A release manifest must record a fresh read-only plan verification, exact deployed schedule, and `liveConnectorPromotionAllowed: false` until the project is verified on Pro or Enterprise with the intended two-minute cadence.

Vercel Cron calls the route with `Authorization: Bearer $CRON_SECRET`; the handler refuses missing, short, or mismatched secrets and returns only aggregate counts. Postgres—not the cron schedule—remains the durable queue authority. Upgrading the Vercel plan or changing the cron cadence is an external configuration decision and is not performed by repository release tooling.

## Failure and recovery

- Retry only jobs in an eligible terminal or reconciliation state: `npm run connectors -- retry-job --live --job-id <id>`.
- Cancel only queued/retry/reconciliation work: `npm run connectors -- cancel-job --live --job-id <id>`.
- An unknown remote outcome records `provider.unknown` and enters reconciliation. The worker calls `reconcile`; it does not blindly execute the original provider operation again.
- Terminal and dead-letter work retains immutable redacted receipts for investigation.
- Disconnect is owner-only and two-phase: the browser records `revocation.requested` and the server worker invokes the compiled provider adapter under a lease/fence. Only `provider-confirmed` moves the connection to `disconnected` and cryptoshreds encrypted secrets/payloads. Unknown, unavailable or terminal provider revocation remains visibly `disconnected-unconfirmed` with recovery material preserved; see `packages/crm/supabase/docs/CONNECTOR_LIVE_DISCONNECT_RUNBOOK.md`.
- KEK rotation uses bounded `npm run connectors -- rewrap --live` batches. Repeat while the redacted `remaining` count is non-zero; old KEKs must remain available until every active envelope is verified on the new version and the recovery window closes.

## Secret and logging boundary

Omnix never requests provider passwords. OAuth access/refresh tokens and provider secrets are encrypted server-side with an AES-256-GCM envelope, per-secret DEK, versioned KEK, and workspace/connection/provider/secret/version AAD binding. Browser DTOs, CLI envelopes, job payloads, receipts, and logs contain references, hashes, bounded metadata, and fixed error categories—not tokens or message bodies.

## Provider activation boundary

- Mailchimp: Story 4.1; selected audience, OAuth app, signed webhook, and real-account UAT.
- Gmail and Google Calendar: Story 4.2; separate incremental scopes, consent verification, and real-account UAT.
- Twilio texting: Story 4.3; consent/STOP/HELP/quiet-hours controls and 10DLC when applicable.
- Instagram and Facebook: Story 4.4; Meta Business Login, business verification, App Review, eligible assets, pinned permissions/version, and signed webhook proof.

Until these gates pass, the `/connections` page and CLI must say the provider is disabled or awaiting approval. A successful local build is not provider readiness.

### Mailchimp Story 4.1 CLI contract

Mailchimp uses a registered OAuth application. Omnix must not ask a Realtor to
paste an API key or platform password. A fully configured deployment enters
`uat` mode first; `live` additionally requires
`OMNIX_CONNECTOR_MAILCHIMP_REAL_ACCOUNT_UAT=approved` after the real-audience
vertical slice. This separation allows OAuth and webhook acceptance testing
without presenting production readiness prematurely.

The deterministic contract can be inspected without credentials:

```powershell
npm run mailchimp -- status
npm run mailchimp -- mapping
npm run mailchimp -- select-audience --connection-id <id> --account-id-hash <sha256> --data-center <dc> --audience-json <json>
npm run mailchimp -- preview --binding-json <json> --contacts-json <json>
```

The preview reports only an audience binding, item count, mapping version, snapshot hash and opaque operation keys; it never emits raw email addresses. Live OAuth follows Mailchimp Authorization Code, derives the API server prefix only from the authenticated metadata endpoint, and stores the access token only in the encrypted server-side connector envelope.

Authenticated owner CLI seams are now available for the operations that have
complete provider contracts:

```powershell
$env:OMNIX_MAILCHIMP_OAUTH_SESSION_SECRET='<private URL-safe 43+ character session secret>'
npm run mailchimp -- oauth-start --live
npm run mailchimp -- oauth-complete --live --state <returned-state> --code <one-time-provider-code>
npm run mailchimp -- status --live --connection-id <id>
npm run mailchimp -- probe --live --connection-id <id>
npm run mailchimp -- audiences --live --connection-id <id> --limit 100
npm run mailchimp -- select-audience --live --connection-id <id> --audience-json '{"id":"<audience-id>"}'
npm run mailchimp -- setup-webhook --live --connection-id <id>
npm run mailchimp -- baseline --live --connection-id <id> --limit 100
npm run mailchimp -- reconcile --live --connection-id <id> --limit 100
npm run mailchimp -- preview-backfill --live --connection-id <id> --mode backfill
npm run mailchimp -- approve-backfill --live --run-id <run-id> --snapshot-hash <sha256> --mapping-version <version>
npm run mailchimp -- disconnect --live --connection-id <id>
```

OAuth start/completion is bound to the same authenticated owner access token and
private session secret; the secret is never included in the CLI envelope. The
browser owner flow uses an HTTP-only cookie for the same application service.
Signed-webhook setup, baseline/reconciliation requests and disconnect are now
direct live CLI compositions. They still fail closed unless the migrated
Supabase authority, service-role server context, provider credentials and KEK
configuration are present.

Bulk tag backfill is a separate governed workflow. The database computes a
count-only preview from the current canonical contacts and selected audience;
the CLI and UI never submit contact rows or email addresses for this decision.
The owner must approve the exact snapshot hash and mapping version before a
worker freezes bounded pages and creates the normal per-contact encrypted
intent, approval, job and receipt chain. Periodic tag checks may prepare a new
preview, but they cannot approve or send it automatically.

Baseline and periodic reconciliation are durable owner-requested runs. The cron
worker claims them with a lease/fence, reads a run-bound encrypted token, pages
only the selected audience in batches of 1–500, and persists numeric/hash-only
checkpoints. A missed webhook, provider outage or runtime deadline resumes from
that checkpoint. Identity misses, ambiguous emails and archived matches create
idempotent `incomplete_records` review items; they never create, merge or restore
a contact by inference.

`status --live` returns only the workspace-bound connection state, hashed account
identity, granted capability markers, selected audience, webhook setup state and
numeric reconciliation progress. It does not return access tokens, signing
secrets, endpoint keys, raw member data or email addresses. Assistants receive
the same redacted health on `/connections`; only owners can authorize, select,
reconcile or disconnect.

Mailchimp Marketing webhooks arrive as `application/x-www-form-urlencoded`. Omnix verifies `X-Mailchimp-Signature` (`t=<unix>,v1=<HMAC-SHA256>`) over the untouched bounded raw body with the five-minute replay window before parsing. An accepted request stores only hashes and an encrypted normalized operation, queues a lease/fence-protected webhook job, and responds `202` before applying CRM state. The cron drain processes that job under the same global runtime deadline, lease and fencing authority. Emails, raw bodies and signatures are excluded from receipts and operational logs. Migration 0011 encrypts the one-time provider secret per connection; there is no shared global secret. Atomic ingress resolves replay authority before allocating a payload, so retries reuse the original durable evidence without orphaned encrypted rows.

Disconnect is honest: Mailchimp account owners can remove the app from Mailchimp's Authorized Apps UI, but the reviewed Marketing API does not expose a remote revocation call used by Omnix. Omnix therefore blocks new work and records `disconnected_unconfirmed` with manual Authorized Apps guidance. It does not cryptoshred recovery material or claim provider revocation until independent provider confirmation exists.
`probe --live` calls Mailchimp's fixed read-only `/ping` endpoint and then stores a
redacted `connection.probed` receipt. It never prints or accepts an access token.
