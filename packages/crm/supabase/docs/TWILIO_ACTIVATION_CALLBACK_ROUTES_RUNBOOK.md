# Twilio activation and callback-route remediation runbook

Migration `0017_twilio_activation_and_callback_routes.sql` closes three Story
4.3 activation gaps without weakening normal `message.send`.

## Secret rotation setup state

The server calls `read_twilio_setup_state(connection_id, user_id,
membership_id)` with the authenticated user and active owner membership. The
RPC returns only current provider/API/webhook secret versions, connection and
readiness state, use-case, policy/disclosure version and UAT-required flag.
First bind uses null expected versions; every rotation must use the exact
returned versions. Ciphertext and endpoint hashes are not exposed.

## Two exact callback URLs

One opaque endpoint key owns two distinct exact hashes:

- `/api/connectors/twilio/{key}/inbound`
- `/api/connectors/twilio/{key}/status`

Call `bind_twilio_callback_routes(...)` after the authority/secret bind. It
rejects equal hashes. For each request, call the kind-aware
`read_twilio_callback_verification_authority(endpoint_hash, callback_kind,
now)` and verify Twilio's signature over the actual exact public URL outside
SQL. Inbound continues through `register_and_apply_twilio_callback(...)`;
delivery status uses `register_and_apply_twilio_status_callback(...)`. A table
trigger also enforces kind-to-route binding, so the legacy ingress cannot use
the inbound hash for a status callback. The former two-argument verification
read is deliberately unavailable to `service_role`.

## Controlled real-number UAT

The owner calls `request_twilio_real_number_uat(...)` only after registration,
restricted credentials, sender ownership, callback verification, both exact
routes, compliance policy and one explicit current canonical-phone consent are
present. The request snapshots policy/disclosure, consent, recipient/sender/body
hashes, timezone and quiet-hours decision. It creates no normal connector
intent and cannot enable ordinary `message.send`.

The service claims/starts the dedicated UAT job under a bounded lease/fence,
then reads encrypted provider/API/payload authority. Provider SID binding is
private and crash recovery changes execution mode to `lookup-only`. Only
`transition_twilio_real_number_uat_job(..., 'delivered', 'delivered'|'read',
evidence_hash, ...)` with a bound provider SID records UAT evidence and moves
the connection/readiness to active. Accepted, queued, sent, failed or unknown
results never activate production. STOP and disconnect cancel only UAT work
that has not crossed the side-effect boundary.

## Verification and rollback

```powershell
supabase db reset --local
supabase test db supabase/tests/0017_twilio_activation_and_callback_routes_test.sql --local
supabase test db supabase/tests/0015_twilio_compliant_texting_test.sql --local
```

The focused 16-case matrix covers RLS/service grants, setup CAS versions,
distinct routes, wrong-route zero mutation, owner-only UAT, normal-send block,
lease/fence, crash recovery and delivered-only activation. The adjusted 0015
matrix proves valid inbound and status routes plus the original consent/STOP/
delivery behavior. Rollback is pre-write only; once UAT or route evidence
exists, use PITR or a reviewed forward remediation. These local tests are not
carrier approval, legal approval, hosted callback proof or real-number UAT.

