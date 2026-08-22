# Omnix Mailchimp webhook-secret authority runbook

Scope: migration `0011_mailchimp_webhook_secret_authority.sql`. This forward
migration replaces the global Mailchimp webhook signing-secret assumption with
one encrypted, server-only secret per connection. It also closes the two-step
webhook payload replay race and adds a bounded baseline member application
seam. It does not enable Mailchimp or prove real-account operation.

## Data authority and cryptographic binding

`connector_private.connector_webhook_bindings` stores only the SHA-256-style
hash of the opaque endpoint key and the hash of the provider webhook ID. The
endpoint bearer and provider ID are not stored. Secret type
`mailchimp-webhook-signing-secret` reuses
`connector_private.connector_connection_secrets`; plaintext is encrypted by
the server before SQL and never appears in arguments, tables, results, logs or
receipts.

Canonical encryption AAD fields are:

```text
workspaceId | connectionId | mailchimp |
mailchimp-webhook-signing-secret | secretVersion
```

The service obtains the current nullable version from
`read_mailchimp_webhook_setup_state`, encrypts the new provider secret with
the next version, then calls the bind RPC with the current version as CAS.
First bind uses `expected_secret_version=null`; rotation requires the exact
current version. After audience replacement, setup state remains available
without knowing the prior endpoint bearer.

## Frozen service-only setup contracts

```text
read_mailchimp_webhook_setup_state(connection_id uuid) -> jsonb

bind_mailchimp_webhook_secret(connection_id uuid,
  endpoint_key_hash text, expected_secret_version integer,
  ciphertext bytea, nonce bytea, auth_tag bytea, wrapped_dek bytea,
  wrap_nonce bytea, wrap_auth_tag bytea, kek_version text, aad_hash text,
  webhook_id_hash text, occurred_at timestamptz,
  correlation_id uuid) -> jsonb

read_mailchimp_webhook_signing_secret(endpoint_key_hash text,
  now timestamptz) -> jsonb
```

Setup state returns exactly `{workspaceId, connectionId, secretVersion,
webhookRegistrationRequired, endpointBound}`. It exposes no endpoint hash,
webhook ID, account bearer or encrypted material.

Bind locks the Mailchimp connection and active selected audience, creates or
CAS-rotates the signing-secret envelope, creates/replaces the opaque endpoint
binding and confirms the provider webhook registration in one transaction.
It returns `{workspaceId, connectionId, audienceBinding, endpointBinding,
secret, receipt, noOp}`. `endpointBinding` contains only hashes/IDs/timestamps;
`secret` contains only `secretId`, `connectionId`, `secretType`,
`secretVersion`, `kekVersion`, `aadHash`, `refreshedAt` and `destroyedAt`.

Read accepts only the endpoint hash used by the protected route. It requires
an active/degraded Mailchimp connection, one active selected audience whose
webhook registration is confirmed, an active endpoint, and a non-destroyed,
unexpired signing-secret envelope. It returns `{workspaceId, connectionId,
provider, audienceBinding, endpointBinding, secret}`. Only `secret` contains
the encrypted envelope/version: base64 `ciphertext`, `nonce`, `authTag`,
`wrappedDek`, `wrapNonce`, `wrapAuthTag`, plus KEK/AAD/version metadata. Decrypt
in bounded server memory, verify the bounded raw request before parsing, then
discard plaintext immediately.

All three RPCs are executable only by `service_role`. `anon` and
`authenticated` have no function access or private-schema usage. Service role
has no direct private-table read.

## Atomic webhook ingress

The 0010 two-step `store_connector_payload_envelope` then
`register_mailchimp_webhook_event` flow is unsafe for retries because it
allocates a new private payload before resolving the replay key. Migration
0011 revokes `service_role` execution from the old registration function. Use:

```text
register_mailchimp_webhook_event_encrypted(connection_id uuid,
  audience_external_id text, replay_key_hash text, raw_body_hash text,
  signature_valid boolean, timestamp_valid boolean, payload_hash text,
  ciphertext bytea, nonce bytea, auth_tag bytea, wrapped_dek bytea,
  wrap_nonce bytea, wrap_auth_tag bytea, kek_version text, aad_hash text,
  correlation_id uuid, received_at timestamptz,
  max_attempts integer) -> jsonb
```

The RPC validates the active webhook-ready selected audience, attempts the
unique delivery insert first, and only then stores an encrypted payload and
job for an accepted request. Rejected requests persist redacted delivery and
receipt evidence only. Exact retry resolves the existing delivery/job/payload
before touching envelope storage. A retry may have a new server correlation
UUID and may arrive after the verification freshness window; replay equality
is the connection, replay key, body hash, selected binding and payload hash.
The original verification outcome/job/receipt remains authoritative. Divergent
body, payload or binding fails with `23505` and creates no payload.

Result shape is `{delivery, webhookJob, payload, receipt, accepted, noOp}`.
`payload` is metadata only (`payloadRef`, `payloadHash`, `envelopeVersion`,
`kekVersion`, `aadHash`). On an exact replay, `noOp=true` and the original job,
receipt and payload reference are returned. No encrypted bytes are returned.

## Baseline member reconciliation

```text
apply_mailchimp_baseline_member(connection_id uuid,
  audience_external_id text, member_external_id text, subscriber_hash text,
  normalized_email text, subscription_status text, source_key_hash text,
  correlation_id uuid, occurred_at timestamptz) -> jsonb
```

This service-only RPC is one item of a bounded provider page. It does not
fabricate a webhook delivery. It validates the selected audience and subscriber
hash, resolves exactly one active canonical email, binds external identity,
applies subscription authority, appends lifecycle/sync/receipt evidence, and
uses origin `baseline-reconciliation`. No match, ambiguous/archived identity,
member conflict, wrong audience or out-of-order state enters review without a
contact/link mutation. An existing unsubscribe/cleaned lock blocks baseline
resubscription and requires a separate governed consent operation.

The result is `{outcome, memberLink, authority, evidence, receipt, noOp}`.
`source_key_hash` is the idempotency key. Same item replay returns the original
evidence/receipt with `noOp=true`; a conflicting status/binding fails.

## Operations and incident response

1. Generate the opaque endpoint key and callback URL server-side.
2. Register the provider webhook and capture its one-time signing secret only
   in server memory.
3. Read setup state, encrypt with the exact connection/version AAD, and call
   bind in the same application workflow. Never log input or provider response.
4. Route inbound requests by the endpoint hash, read/decrypt the envelope,
   verify bounded raw bytes and timestamp, then call atomic ingress.
5. On endpoint exposure or provider webhook replacement, create a new opaque
   endpoint and signing secret, CAS-rotate via bind, and stop routing the old
   endpoint. Stale versions fail with `40001`.
6. Audience replacement sets webhook readiness back to required. Repeat setup;
   setup state supplies the private envelope version without exposing endpoint
   material.
7. Disconnect/revoking status makes reads fail immediately. Confirmed
   revocation uses the Story 3.5 worker to cryptoshred all connection secrets
   and revoke the endpoint; unconfirmed revocation preserves recovery material
   but cannot serve it.

## Apply, tests and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0011_mailchimp_webhook_secret_authority_test.sql --local
```

Then run the 0004–0010 matrices. Before remote apply, take a managed backup and
schema-only dump, confirm KEK access/rotation, configured route bounds and a
real Mailchimp webhook UAT plan. Local tests do not prove provider delivery or
signature compatibility.

`0011_mailchimp_webhook_secret_authority.rollback.sql` is pre-write only. It
refuses if any webhook ID hash, signing-secret row or baseline-reconciliation
evidence exists. In the empty window it removes the RPCs/columns, restores the
0010 evidence-origin constraint and restores the former 0010 register grant.
After writes, disable callbacks/workers and use PITR or a reviewed forward fix.
