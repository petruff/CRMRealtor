# Twilio UAT post-STOP recovery and Meta converted-review runbook

Migration `0020_twilio_uat_post_stop_recovery.sql` closes two HIGH recovery
gaps without changing public RPC signatures or provider scope.

## Twilio UAT state machine

The first `start_twilio_real_number_uat_attempt(...)` still requires current
canonical opt-in. After a provider SID has been bound, the job has crossed its
only external-send boundary: every subsequent authority response is
`executionMode: "lookup-only"` with a null payload envelope.

A signed delivered/read callback may arrive before the human reply and STOP.
That is an expected wait, not provider failure. The worker transitions with
`target_outcome='retry'` and
`target_error_category='uat_sequence_pending'`. SQL accepts this category
only when the exact job has a bound provider SID and its four-fact projection
is incomplete. It schedules `retry_wait` and removes the start increment from
`attempt_count`; therefore a human wait can pass the configured
`max_attempts` without becoming `failed`. Any other retry/error still uses the
normal bounded provider-attempt budget.

If the complete sequence arrives while a job is already at its provider
attempt ceiling, the worker uses the equally bound
`target_error_category='uat_finalize_pending'` handoff. SQL accepts it only
for the same bound SID with a complete four-fact projection, schedules one
lookup-only finalization lease, and likewise does not consume provider budget.

Once signed reply, applied STOP and pre-side-effect cancellation complete the
same-job projection, start/read may proceed despite the canonical opt-out only
for lookup/finalization. They do not authorize a second send. The read shape
is the frozen 0017 shape plus:

```json
{ "evidenceComplete": true }
```

The transition shape is unchanged except for additive
`sequencePending:boolean` and `finalizationPending:boolean`. Delivered
completion still requires the complete same-job projection and bound SID.

## Meta converted review

`resolve_meta_enquiry_review(...)` keeps its frozen signature. A pending
incomplete record follows the existing conversion path. If a generic CRM flow
has already converted the record, the reviewer may finish Meta linkage only
when the converted contact exactly equals the requested active contact and
the event, actor, workspace, external identity and conversation bindings all
match. SQL skips a second conversion, links all three Meta projections in the
same transaction and returns `conversionPreexisting:true`. A different
contact fails before any provider identity, conversation or event mutation;
an exact linked replay is a no-op.

## Verification

From `packages/crm`:

```powershell
npx supabase db reset --local --no-seed
npx supabase test db supabase/tests/0020_twilio_uat_post_stop_recovery_test.sql --local
npx supabase test db supabase/tests/0016_meta_inbound_business_messaging_test.sql supabase/tests/0017_twilio_activation_and_callback_routes_test.sql supabase/tests/0020_twilio_uat_post_stop_recovery_test.sql --local
npx supabase test db --local
npx supabase db lint --local --schema public --schema connector_private
```

The focused suites cover waits beyond `max_attempts`, delivery before
reply/STOP, opt-out without complete evidence, post-STOP lookup-only
completion, generic conversion, wrong-contact zero mutation and exact replay.

The rollback is pre-use only. It restores the frozen 0016/0017/0019 function
bodies and refuses once a post-side-effect UAT or Meta review exists. After
that boundary, retain evidence and deploy a reviewed forward remediation or
use managed PITR. Local tests do not establish live Twilio/Meta credentials,
signed callback operation, provider approval, deployment or production
readiness.

On 2026-08-12, a clean local reset replayed migrations 0001–0020. The focused
0016/0017/0020 matrix passed 52 cases and the forward-compatible connector
matrix passed 222 cases in 11 files. The pre-use rollback completed with
`ON_ERROR_STOP`, restored all four prior function bodies, and a subsequent
clean reset replayed 0020. Schema lint reported no 0020-owned finding; its
remaining warnings are historical routines outside this migration. The raw
all-files TAP command still exercises six legacy direct-table assertions
(0004/0005/0007/0010/0011/0012) after later least-privilege grants have been
revoked; those compatibility failures are not caused by 0020 and are not
reported as a green full matrix.
