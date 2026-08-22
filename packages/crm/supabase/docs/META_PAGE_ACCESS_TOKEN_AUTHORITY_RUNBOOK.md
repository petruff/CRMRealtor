# Meta Page access-token authority runbook

Migration `0018_meta_page_access_token_authority.sql` closes the Facebook Page
token gap left by the inbound-only Meta foundation. Meta Business Login stores
the user token on the connection, but `/me/accounts` returns a distinct Page
Access Token for each eligible Page. A Page subscription must use that Page
token; it must never infer that the connection token is interchangeable.

Instagram Login remains unchanged and uses the connection-level token.

## Setup sequence

1. Complete the reviewed, pinned-version Meta OAuth flow from migration 0016.
2. Call the provider discovery endpoint with the connection token, then call
   `replace_meta_eligible_assets(...)` with the exact eligible Page snapshot.
3. The server calls
   `read_meta_page_token_setup_state(connection,user,membership)`. It returns
   only Page hashes, current CAS versions and active-token booleans. The caller
   must be the active owner of the connection workspace.
4. Encrypt every Page token before SQL and call
   `bind_meta_facebook_page_access_tokens(...)` with the complete current
   eligible/selected Page set. The batch is bounded to 1–20 items and is
   all-or-nothing. First bind uses `expectedTokenVersion:null`; rotation uses
   the exact current integer for every Page. One stale item rejects the batch.
5. The owner may call `select_meta_assets(...)` only after the selected Page
   has an active, unexpired, correctly bound Page-token envelope.
6. For provider webhook subscription/setup, call
   `read_meta_page_subscription_authority(...)`. It returns the exact selected
   Page ID and encrypted Page-token envelope only to service role under an
   explicit active-owner/workspace binding. Browser roles have no execute or
   table grants.

## Frozen payload and AAD contract

The encrypted plaintext schema is `meta-page-access-token.v1` with exactly:

```json
{
  "accessToken": "provider-opaque-token",
  "assetId": "provider-page-id",
  "assetIdHash": "sha256-hex",
  "connectionId": "uuid",
  "graphVersion": "vN.N",
  "tokenVersion": 1,
  "workspaceId": "uuid"
}
```

Before using the token, the server must validate every decrypted binding
against the RPC result and current selected asset. `tokenHash` is SHA-256 of
the opaque provider token and becomes the generic payload canonical hash.

The envelope is stored in
`connector_private.connector_payload_envelopes` with:

- `payload_kind = meta-page-access-token`;
- `schema_version = meta-page-access-token.v1`;
- `envelope_version = 1`.

AAD follows the connector-wide migration 0008 contract without a provider
exception:

`workspaceId|connectionId|meta|meta-page-access-token|1`

The exact asset binding is inside the authenticated encrypted plaintext and is
revalidated after decryption. Never put Page IDs, Page tokens, ciphertext or
DEKs in browser state, logs, telemetry or receipts.

## Rotation, replacement and disconnect

Rotation first validates the complete exact snapshot and all expected
versions, then cryptoshreds the previous generic envelopes and advances each
Page version atomically. Discovery replacement changes superseded eligible
assets to `removed`; a trigger cryptoshreds their Page tokens. A confirmed
provider disconnect cryptoshreds all Page-token envelopes, including tokens
for assets that were not selected.

`disconnected_unconfirmed` deliberately preserves encrypted Page tokens for
manual provider-revocation recovery, consistent with migration 0009. The
connection/asset state still prevents any Page-token authority read. After
recovery, complete revocation through a reviewed forward path.

## Verification and rollback

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0018_meta_page_access_token_authority_test.sql --local
supabase db lint --local --schema public --schema connector_private
```

The 18-case focused matrix covers private grants/RLS, two-workspace owner
authority, selection-before-token denial, exact batch atomicity, CAS conflict,
rotation cryptoshred, discovery replacement, selected Page subscription read,
receipt redaction, confirmed disconnect and Instagram separation.

The rollback file is pre-write only. It refuses after any Page token envelope
or binding exists. After that boundary, stop setup/subscription work, preserve
evidence and use managed PITR or a reviewed forward remediation. Local reset
and TAP proof do not establish live Meta credentials, Business Verification,
App Review, webhook subscription, remote migration, real-Page UAT, deployment
or production readiness.

On 2026-08-12 the final local migration passed a clean 0001–0018 reset, the
focused 18-case TAP suite, and a pre-write rollback/replay rehearsal with
`ON_ERROR_STOP`. The forward-compatible 0016+0018 pair passed 42 tests, and the
compatible matrix outside the separately owned 0010 grant drift passed 280
tests across 14 files. Schema lint returned no 0018 finding.
