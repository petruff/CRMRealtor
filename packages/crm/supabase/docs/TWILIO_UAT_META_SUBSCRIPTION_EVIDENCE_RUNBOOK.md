# Verified Twilio UAT and Meta subscription evidence runbook

Migration `0019_twilio_uat_meta_subscription_evidence.sql` closes two HIGH
truthfulness gaps without changing provider scope. It adds no Meta outbound
messaging and does not make an external provider call from SQL.

## Twilio activation sequence

Declarative setup may configure two distinct exact callback routes, restricted
credentials, sender ownership, registration and policy. It may not populate
`callback_verified_at`, `real_number_uat_at` or the UAT evidence hash.

An owner may then request one bounded real-number UAT. The worker can execute
that test while the connection remains `authorizing`. Production activation
requires these four ordered, persisted facts for that exact UAT job:

1. a signed `/status` callback for its provider SID with `delivered` or `read`;
2. a signed inbound reply from its recipient (`none`, `help` or `start`);
3. a signed inbound `STOP` that reaches applied consent/suppression state;
4. cancellation of the automatically created safety-probe job while its
   `side_effect_started_at` is still null.

`transition_twilio_real_number_uat_job(...)` still has the frozen 0017
signature. Provider polling is necessary but insufficient. Its delivered path
checks the four-fact projection, then atomically fills verified timestamps,
activates the connection and emits redacted final evidence. A polling-only
completion fails with `23514`.

The safety-probe row is not a provider send. It is a durable control used to
prove that STOP prevents/cancels work before a side effect. It can only move
from `queued` to `cancelled` and can never cross the side-effect boundary.

## Meta subscription state and retry

Every selected asset gets append-only `attempted`, `subscribed`, `failed` or
`unsubscribed` evidence plus a workspace-bound projection. Existing selected
assets are backfilled to `pending`; selection never claims provider success.

Provider setup records results through:

```text
record_meta_asset_subscription_result(
  connection_id uuid,
  asset_id_hash text,
  outcome text,
  operation_key_hash text,
  provider_evidence_hash text|null,
  error_category text|null,
  correlation_id uuid,
  occurred_at timestamptz
) -> jsonb
```

Return shape:

```json
{
  "event": { "event_type": "attempted|subscribed|failed|unsubscribed" },
  "state": { "status": "pending|subscribed|failed|unsubscribed" },
  "noOp": false
}
```

An exact retry may carry a new correlation ID; the operation key is the replay
authority. A divergent replay fails. `select_meta_assets(...)` keeps its
frozen signature and now returns `noOp:true` for the exact current selection,
without resetting provider-subscription state or writing another receipt.

The service reads retry authority through:

```text
read_meta_asset_subscription_retry_authority(
  connection_id uuid,
  authenticated_user_id uuid,
  membership_id uuid,
  now timestamptz
) -> jsonb
```

It requires an active owner binding and at least one selected
`pending|failed|unsubscribed` asset. It returns:

```json
{
  "workspaceId": "uuid",
  "connectionId": "uuid",
  "graphVersion": "vN.N",
  "loginMode": "facebook-page|instagram-login",
  "selectedAssets": [{
    "bindingId": "uuid",
    "channel": "facebook|instagram",
    "assetIdHash": "sha256",
    "assetId": "exact-service-only-id",
    "subscriptionState": {},
    "retryAllowed": true,
    "pageAccessToken": "encrypted-envelope-or-null"
  }],
  "connectionAccessToken": { "ciphertext": "base64" }
}
```

Facebook Page mode requires a current Page-token envelope for every selected
asset. Instagram Login requires selected Instagram assets and uses only the
connection access token. Browser roles cannot execute this read.

## Disconnect and human review authority

The fenced revocation worker calls:

```text
read_meta_revocation_authority(
  revocation_job_id uuid,
  worker_id uuid,
  fencing_token bigint,
  now timestamptz
) -> jsonb
```

It requires the exact live lease/fence and a `revoking` Meta connection. It
returns redacted job metadata, pinned Graph version/login mode, selected exact
asset IDs, Page-token envelopes for Facebook Page mode, and the connection
access-token envelope. This is sufficient for `DELETE
/{asset}/subscribed_apps` followed by `DELETE /me/permissions`. It emits no
receipt and grants no browser access.

The application service reads one quarantined enquiry through:

```text
read_meta_enquiry_review_authority(
  event_id uuid,
  authenticated_user_id uuid,
  membership_id uuid,
  now timestamptz
) -> jsonb
```

The membership must be active owner or assistant in the event workspace. The
result includes redacted event/provenance hashes, `incompleteRecordId` for a
manual-resolution link and the encrypted content envelope. Exact provider IDs
and tokens are not returned. Decrypted content must remain request-scoped and
must not enter receipts, logs or telemetry.

## Operations and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0019_twilio_uat_meta_subscription_evidence_test.sql --local
supabase test db supabase/tests/0015_twilio_compliant_texting_test.sql supabase/tests/0016_meta_inbound_business_messaging_test.sql supabase/tests/0017_twilio_activation_and_callback_routes_test.sql supabase/tests/0018_meta_page_access_token_authority_test.sql supabase/tests/0019_twilio_uat_meta_subscription_evidence_test.sql --local
supabase db lint --local --schema public --schema connector_private
```

The rollback is pre-write only. It refuses after any 0019 UAT probe/evidence
or Meta subscription event/projection exists. In the empty window it restores
the frozen 0016–0018 function bodies before dropping the new tables, triggers
and types. Rehearse with:

```powershell
Get-Content -Raw supabase/rollbacks/0019_twilio_uat_meta_subscription_evidence.rollback.sql |
  docker exec -i supabase_db_omnix-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

After evidence exists, stop new UAT/subscription work, preserve callback,
consent, revocation and subscription history, and use managed PITR or a
reviewed forward remediation. Local deterministic tests do not establish live
Twilio/Meta credentials, provider approval, remote subscription/revocation,
deployment or production readiness.

On 2026-08-12 a clean local reset replayed migrations 0001–0019. The focused
0019 TAP passed 21 cases; the compatible 0004–0019 matrix passed 326 cases in
16 files. The pre-write rollback completed with `ON_ERROR_STOP`, removed the
0019 objects, restored the frozen Page authority, and a subsequent clean reset
replayed 0019. Schema lint reported no 0019 finding; remaining warnings are
historical functions outside this migration.
