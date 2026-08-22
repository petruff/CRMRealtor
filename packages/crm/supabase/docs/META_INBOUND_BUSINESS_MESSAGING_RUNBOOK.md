# Meta inbound business messaging runbook

Migration `0016_meta_inbound_business_messaging.sql` is an inbound-only,
fail-closed data authority for eligible Facebook Pages or Instagram Login
professional assets. It does not enable Lead Ads, outbound DMs, personal
accounts, scraping or a guessed Graph API version.

## Activation sequence

1. An owner calls `begin_meta_oauth(...)` with a caller-supplied numeric
   `vN.N` Graph version, the reviewed official source URL/time/hash and the
   exact scope set for one supported mode. SQL accepts only:
   - `facebook-page`: `pages_manage_metadata`, `pages_messaging`,
     `pages_show_list`;
   - `instagram-login`: `instagram_business_basic`,
     `instagram_business_manage_messages`.
2. The server consumes the one-time OAuth transaction, exchanges the code on
   the provider, and calls `finalize_meta_oauth(...)`. Token ciphertext remains
   private. Business Verification and App Review evidence are mandatory before
   activation can continue.
3. The owner-bound service reads asset-discovery authority, obtains eligible
   assets from the pinned provider endpoint and replaces only the staged
   snapshot. For Facebook Pages, migration 0018 then binds the encrypted Page
   Access Token returned for every asset; the connection/user token is not
   treated as the Page subscription token. The owner selects hashes from that
   exact snapshot and approves a retention policy only after the Page-token
   bind succeeds.
4. The service binds encrypted app-secret and verify-token envelopes to one
   opaque endpoint. Challenge confirmation moves readiness to `active` only
   after reviewed version, scopes, selected assets, business verification and
   app review are all present.

No caller supplies a workspace or asset through an inbound body. The opaque
endpoint and private selected-asset record are authoritative.

## Verified ingress and normalization

Verify the provider signature against the bounded raw body outside SQL before
calling `register_meta_webhook_delivery_encrypted(...)`. Pass
`signature_valid=false` on failure; the RPC rejects invalid signature, wrong
version, wrong asset or malformed batches before its first durable mutation.
The atomic RPC deduplicates delivery/event IDs before storing encrypted content,
then creates one bounded normalization job.

Workers claim, start and read authority under the same lease/fence. The read
returns exact provider IDs and the encrypted content envelope only for that
executing job. `apply_meta_normalized_enquiry(...)` may link an existing exact
provider identity, use one unambiguous active canonical email/phone, or create
an `incomplete_records` quarantine. It never matches on names/handles and never
fabricates a Contact. Retry exhaustion remains an operational failure; it is
not mislabeled as a human identity decision.

## Privacy, disable and incidents

Public rows and receipts contain hashes/redacted metadata only. Exact asset,
sender, recipient and message IDs plus content/secret envelopes remain in
`connector_private`. `purge_expired_meta_content(...)` cryptoshreds bounded
content while retaining redacted provenance.

On provider/app-review/token/asset failure, stop claims, move connection health
to degraded/reauthorization, preserve accepted events and review history, and
repair forward. Disconnect blocks new ingress immediately; terminal revocation
cryptoshreds credentials through the generic connector lifecycle. Never claim
outbound or reconciliation support: `read_meta_connection_state(...)` returns
those capability flags explicitly false.

## Verification and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0016_meta_inbound_business_messaging_test.sql --local
supabase db lint --local --schema public --schema connector_private
```

The 24-case TAP matrix covers roles/workspaces, reviewed version/scopes, OAuth,
asset selection, challenge, zero-mutation invalid ingress, replay, fence,
quarantine/manual link, redaction, retention and disconnect. The rollback is
pre-write only and refuses once any Meta evidence exists. Local proof is not
Meta App Review, provider credentials, remote migration, real-asset UAT or
production deployment proof.

Per-Page token setup, rotation and cryptoshred are documented separately in
`META_PAGE_ACCESS_TOKEN_AUTHORITY_RUNBOOK.md`.
