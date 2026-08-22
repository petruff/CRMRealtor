# Omnix workspace authority

Omnix uses one canonical `workspaceId` for tenant authority. Every repository
operation receives a non-optional `WorkspaceScope` derived from an active
membership. Request payloads must never supply or override that scope.

## Authority contract

`WorkspaceScope` contains:

- `authenticatedUserId`: the authenticated actor;
- `ownerUserId`: the unique active owner, retained only while legacy
  `owner_id` compatibility writes are required;
- `membershipId`: the actor's active membership;
- `workspaceId`: the canonical tenant ID;
- `role`: exactly `owner` or `assistant`;
- `mode`: `live` or explicit `sample`.

Repositories verify all six values against stored membership authority. Merely
constructing a TypeScript object does not grant access. An assistant may use
ordinary CRM data through the scoped repositories, but only an owner may list,
add or revoke memberships or read workspace health.

The initial product enforces exactly one active owner per workspace. It rejects
duplicate active membership for the same user and does not implement ownership
transfer, extra roles or email invitations.

## CLI first

Add this package script when the Story 3.0 integration updates `package.json`:

```json
"workspace": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/manage-workspace.ts"
```

Sample mode is the default and is always labelled `sample-process-only`:

```text
npm run workspace -- bootstrap --name "Realtor team"
npm run workspace -- show
npm run workspace -- members
npm run workspace -- add-member --user-id user-assistant-2 --role assistant
npm run workspace -- revoke-member --membership-id membership-sample-assistant
npm run workspace -- health
```

Each sample invocation creates a fresh, non-durable repository and never reads
Supabase credentials. An `add-member` result is therefore not present in a
later process; `members` and `revoke-member` use an explicit seeded sample
assistant.

### Authenticated live mode

Live CLI mode uses the public Supabase URL/key plus a short-lived **end-user**
access token from an already authenticated Google OAuth session. It never asks
for or accepts a Google password, Supabase password, refresh token, secret key
or service-role key. The CLI verifies the token with Supabase Auth, derives the
actor's one active `WorkspaceScope`, and lets membership-derived RLS and the
owner-only RPCs enforce authority.

Set these values in the current PowerShell process:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://PROJECT.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "PUBLIC_ANON_OR_PUBLISHABLE_KEY"
$env:OMNIX_SUPABASE_ACCESS_TOKEN = "SHORT_LIVED_END_USER_ACCESS_TOKEN"
```

`OMNIX_SUPABASE_ACCESS_TOKEN` must be the `access_token` from the user's current
Supabase Auth session after Google sign-in. Do not paste it into a command-line
argument, commit it, put it in browser-visible configuration, or substitute a
Supabase personal-management token. Remove it from the shell after use:

```powershell
Remove-Item Env:OMNIX_SUPABASE_ACCESS_TOKEN
```

Run the same operations with `--live`:

```text
npm run workspace -- bootstrap --name "Realtor team" --live
npm run workspace -- show --live
npm run workspace -- members --live
npm run workspace -- add-member --user-id 11111111-1111-4111-8111-111111111111 --role assistant --correlation-id 22222222-2222-4222-8222-222222222222 --live
npm run workspace -- revoke-member --membership-id 33333333-3333-4333-8333-333333333333 --correlation-id 44444444-4444-4444-8444-444444444444 --live
npm run workspace -- health --live
```

Only `bootstrap` may create a workspace. Other live commands fail with exit
code `4` when the authenticated user has no active membership. `show` is
available to an active owner or assistant; listing or changing memberships and
health require the owner role. `add-member` needs the target user's Supabase
Auth UUID; it does not send an invitation or email.

Live JSON is labelled `live-authenticated` and `durable: true`. Raw actor and
member user IDs are replaced by stable one-way `userRef` fingerprints in
output. Access tokens and keys are never emitted. Provider failures return
stable redacted messages instead of database or credential details.

Stable process exit codes:

| Code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Unexpected internal failure |
| `2` | Usage or input validation failure |
| `3` | Forbidden, revoked or mismatched authority |
| `4` | Scoped resource not found |
| `5` | Conflict or membership invariant rejection |

## Health and audit safety

Workspace health returns only stable check IDs, pass state, mode, durability and
redacted operational messages. It does not return member counts, contact rows,
emails, environment values, provider tokens or service keys. Sample health
truthfully reports migration and intake checks as not applicable.

Authority mutations record a structured audit fact with actor user ID,
workspace ID, action, result, timestamp and correlation ID. Revocation does not
delete membership or audit history, preserving historical actor identity.

The live command requires an applied Story 3.0 migration, configured Google
OAuth/Supabase project and real authenticated accounts. No email delivery or
invitation workflow is claimed by these contracts.
