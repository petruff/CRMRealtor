# Twilio compliant texting runbook (migration 0015)

Story 4.3 adds the database authority for consent-aware Twilio messaging. It
does **not** make texting live by itself. Provider credentials, an owned sender,
the applicable carrier-registration path, approved consent/quiet-hours and
retention policies, signed-callback deployment, and controlled real-number UAT
remain production gates.

## Evidence and authority boundary

- Supabase Auth is the Omnix identity boundary. Twilio is a server connection;
  Omnix never captures a user's Twilio password.
- Owners configure the Twilio authority and compliance policy, approve exact
  `message.send` intent versions, and disable the connection. Assistants may
  record bounded consent evidence and create/revise drafts, but cannot read
  credentials, change the sender/policy, or self-approve a provider side effect.
- Browser/authenticated roles receive redacted rows only. Encrypted token/body
  envelopes, raw provider Message SIDs, callback endpoint hashes and worker
  authority are private or service-role RPC output.
- `service_role` is restricted to server workers and callback routes. A worker
  derives workspace/connection/sender from a current lease and fencing token;
  it never trusts browser-supplied authority.
- The database stores no raw phone or message body in connector receipts,
  callbacks, public message metadata or operational logs. Exact phone matching
  is ephemeral against active canonical Story 3.2 contact points.

## Fail-closed readiness

`read_twilio_connection_readiness(connection_id)` is the redacted member view.
`message.send` remains unavailable unless the connection authority is enabled
and all required evidence is current: restricted provider and API credentials,
owned sender/Messaging Service, callback binding, applicable registration,
approved use case/policy, and controlled-test evidence. States are:

- `registration_pending`
- `approval_blocked`
- `configured_disabled`
- `active`
- `degraded`
- `reauthorization_required`
- `disconnected`

A local reset, deterministic adapter or Twilio trial is never evidence that
provider-backed production texting is active. A device `sms:` link remains a
separate, explicitly non-provider fallback.

For US application-to-person SMS/MMS sent over ten-digit long-code numbers,
verify the applicable A2P 10DLC registration and current provider state. Toll-
free and short-code senders have different requirements; do not label every
sender as 10DLC. See Twilio's current [A2P 10DLC documentation](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc).

## Encrypted envelope contract

The application encrypts before calling SQL. Every envelope contains only
base64 ciphertext/nonce/tag/wrapped-DEK fields plus `kekVersion`, a lowercase
SHA-256 `aadHash`, and optional expiry. Plaintext never crosses into SQL.

Canonical secret types and AAD inputs are frozen for 0015:

| Secret type | Canonical AAD input |
| --- | --- |
| `twilio-provider-authority` | `workspaceId|connectionId|twilio|twilio-provider-authority|secretVersion` |
| `twilio-api-key-secret` | `workspaceId|connectionId|twilio|twilio-api-key-secret|secretVersion` |
| `twilio-webhook-auth-token` | `workspaceId|connectionId|twilio|twilio-webhook-auth-token|secretVersion` |

The decrypted plaintext schemas are canonical UTF-8 JSON with exact keys and no
extras:

```json
{
  "schemaVersion": "twilio-provider-authority.v1",
  "accountSid": "AC<32 hex>",
  "apiKeySid": "SK<32 hex>",
  "messagingServiceSid": "MG<32 hex>",
  "senderMode": "messaging_service"
}
```

The worker must hash and compare `accountSid`, `apiKeySid` and
`messagingServiceSid` to the respective public authority hashes before use.
Migration 0015 freezes Messaging Service sends only; the worker supplies
`MessagingServiceSid` and never accepts a caller-provided `From` override.

```json
{
  "schemaVersion": "twilio-api-key-secret.v1",
  "apiKeySecret": "<nonempty restricted API key secret>"
}
```

```json
{
  "schemaVersion": "twilio-webhook-auth-token.v1",
  "authToken": "<nonempty Twilio Auth Token>"
}
```

Send/reconciliation workers use the first two schemas. Callback verification
loads the third through the endpoint-bound callback RPC; it is not returned to
message workers. Public rows contain hashes only.

Draft and inbound content uses private payload kinds/schemas:

- `twilio-message-body` / `twilio-message-body.v1`
- `twilio-inbound-body` / `twilio-inbound-body.v1`

The outbound decrypted payload is canonical UTF-8 JSON with exact keys and no
extras:

```json
{
  "schemaVersion": "twilio-message-body.v1",
  "draftId": "<uuid>",
  "draftVersion": 1,
  "body": "<nonempty bounded UTF-8 message>",
  "bodyHash": "<64 lowercase hex>",
  "recipientPhone": "<canonical E.164>",
  "recipientPhoneHash": "<64 lowercase hex>",
  "connectionId": "<uuid>"
}
```

The worker verifies the connection/draft/version graph, recomputes both hashes,
and requires the body hash to equal the envelope, job and approval-snapshot
hashes and the phone hash to equal the approval snapshot. The payload cannot
override account, sender, `From` or status-callback routing. `callbackBaseUrl`
and opaque endpoint key come from validated server deployment configuration to
construct `StatusCallback`; the webhook Auth Token is callback verification
material only.

For an outbound draft, bind AAD to
`workspaceId|connectionId|draftId|draftVersion|twilio-message-body|1`. The
canonical payload hash passed to SQL must match the approved body hash. Inbound
AAD must bind workspace, connection, callback replay hash, payload kind and
schema version. KEK rotation replaces only the wrapped DEK metadata through the
connector rewrap seam; it never changes ciphertext or its business binding.

## Configuration sequence

1. Create the generic Twilio connector connection in `authorizing` state.
2. Complete provider-side account/sender ownership and applicable registration.
3. Encrypt the three server secrets and call
   `bind_twilio_connection_authority(...)` as `service_role`, supplying the
   owner user/membership binding, account/sender hashes, registration evidence,
   callback endpoint key hash, exact external URL hash, UAT evidence and CAS
   secret versions.
4. The owner calls `configure_twilio_compliance_policy(...)` for each approved
   use case and `ensure_twilio_message_send_policy(...)` for the durable
   owner-required Story 3.5 policy.
5. Verify the redacted readiness response and perform provider-side health
   checks before allowing the product to display `active`.

Replacing an authority uses expected secret versions. A stale version fails;
callers must reread server-owned setup metadata and re-encrypt rather than
blindly overwriting credentials.

## Consent, draft and approval flow

1. `record_texting_consent(...)` resolves one exact active, non-shared canonical
   phone point and appends immutable evidence. A phone number, prior contact,
   imported tag or inbound message never implies consent.
2. `create_twilio_message_draft(...)` and
   `revise_twilio_message_draft(...)` store versioned redacted metadata and a
   private encrypted body envelope. CAS rejects stale revisions.
3. `prepare_twilio_message_send_intent(...)` binds the exact current draft,
   consent event, compliance policy and Story 3.5 action policy. It does not
   approve or enqueue.
4. The owner calls `approve_and_enqueue_twilio_message_send(...)` with the exact
   body hash, recipient timezone/evidence, quiet-hours decision and schedule.
   It atomically creates the immutable approval snapshot, one public message,
   one durable job and the connector approval/receipt evidence. Divergent replay
   fails; exact replay is a no-op.
5. `start_connector_job_attempt(...)` is the canonical generic worker entry.
   Migration 0015's trigger marks `side_effect_started_at` on the linked message
   during the same database statement. This boundary prevents STOP or disable
   from cancelling a job after provider execution has begun.
6. `read_twilio_job_authority(...)` requires the exact executing lease/fence and
   revalidates readiness, phone, consent, suppression, snapshot, secret and
   payload bindings before returning encrypted worker material.
7. After provider acceptance, `bind_twilio_provider_message(...)` stores the raw
   Message SID only in the private table and exposes its hash in public evidence.
   An unknown result enters bounded reconciliation; never blind-resend.

The application owns the approved federal/state/provider quiet-hours evaluator,
including DST behavior. SQL persists the exact decision and fails closed when
verified timezone evidence is required or an unknown timezone policy says to
block/defer. Counsel and the business owner remain responsible for approving
the policy; database enforcement is not legal certification.

## Callback verification and STOP-first processing

Twilio signs the exact externally visible request URL plus all received form
parameters (or the raw JSON body, depending on the webhook). The route must:

1. Resolve the opaque endpoint key and call
   `read_twilio_callback_verification_authority(endpoint_key_hash,
   callback_kind, now)`.
2. Decrypt the current Auth Token server-side.
3. Reconstruct the **exact public URL** Twilio called, including reverse-proxy
   host/scheme/path behavior.
4. Validate `X-Twilio-Signature` using the official Twilio SDK and all supplied
   parameters/raw body. Do not maintain a hand-written fixed parameter list;
   Twilio may add parameters. See [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
5. Only after successful verification, hash the bounded identifiers/body and
   call `register_and_apply_twilio_callback(...)` for `/inbound` or
   `register_and_apply_twilio_status_callback(...)` for `/status`. Raw
   signatures, phone numbers and body content must not be passed into receipts
   or logs. Migration 0017 requires two distinct exact URL hashes; no base URL
   or wildcard is authority.

The ingress RPC deduplicates by endpoint/replay hash and rejects a divergent
parameters/body/account/sender binding. Verified STOP is applied atomically
before content processing: it appends opt-out evidence, installs suppression and
cancels only queued/not-started work. START appends fresh opt-in evidence; HELP
records evidence without changing consent. When Twilio Advanced Opt-Out already
sends the configured reply, Omnix must not send a duplicate automatic response.
Unsupported keywords and none/shared/archived identities go to hash-only human
review without mutating a Contact.

## Delivery status and reconciliation

Statuses are persisted monotonically. Duplicate or out-of-order callbacks return
a no-op and cannot regress a terminal state. Messaging Service initial states
such as accepted/scheduled may not produce callbacks, so the database cannot
assume every transition will arrive. Use:

- `schedule_due_twilio_reconciliation_jobs(now, minimum_age_seconds, limit)`
- `claim_twilio_reconciliation_jobs(worker_id, limit, lease_seconds, now)`
- `start_twilio_reconciliation_attempt(job_id, worker_id, fence, now)`
- `read_twilio_reconciliation_authority(job_id, worker_id, fence, now)`
- `transition_twilio_reconciliation_job(...)`

Keep pages bounded, honor lease/fence/CAS errors, and query the provider by the
private Message SID. Follow Twilio's current [message status callback guidance](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

## Disable, disconnect and incident response

`disable_twilio_connection(connection_id, destroy_send_secrets, correlation_id,
occurred_at)` stops new sends and cancels only pre-side-effect jobs. Consent,
STOP, conversations, messages, callbacks, reconciliation and receipts remain.
Destroying send credentials removes provider/API key ciphertext, while retaining
the webhook Auth Token long enough to validate late status callbacks.

The Story 3.5 disconnect lifecycle drives `disconnected` only after confirmed
revocation/no-endpoint evidence. Migration 0015's connection trigger mirrors
that honest state and revokes callback authority only at the terminal boundary.
Unknown provider results remain visible and reconcilable.

For an incident: block worker wake-ups, disable the connection, preserve database
and provider evidence, inspect leased/executing/unknown work, reconcile before
retrying, rotate credentials/endpoint keys, and re-run controlled UAT. Never
delete opt-out or delivery evidence to recover a queue.

## Verification and rollback

Local deterministic verification:

```powershell
supabase db reset --local
supabase test db supabase/tests/0015_twilio_compliant_texting_test.sql --local
supabase db lint --local --schema public --schema connector_private
```

Run these commands from `packages/crm`. The pgTAP suite covers two workspaces,
roles, private credential isolation, exact phone/consent, approval snapshot,
generic-start side-effect boundary, stale fence, SID idempotency, status order,
STOP/START/HELP, review quarantine, redaction, RLS, reconciliation and disable.

The rollback script is deliberately pre-write only. Rehearse it only immediately
after applying 0015 to an empty disposable database. Once any 0015 or Twilio
connector evidence exists, it refuses with SQLSTATE `55000`; use a reviewed
forward migration or point-in-time recovery instead.

Local reset/TAP proof does not establish remote migration, deployed callback
behavior, carrier approval, legal approval, provider verification, real-number
UAT or production readiness.

For the dedicated pre-production UAT queue, kind-specific callback routes and
secret-version setup read introduced by migration 0017, see
`TWILIO_ACTIVATION_CALLBACK_ROUTES_RUNBOOK.md`.
