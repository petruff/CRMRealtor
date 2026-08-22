# Exact contact deduplication and reversible merge design

**Story:** 3.15  
**Status:** design complete; mutation intentionally blocked  
**Date:** 2026-08-18

## Decision

Omnix must not implement a physical `contact_id` reparenting transaction across
the current schema. The live 0026 schema contains 28 direct foreign-key paths
to `contacts` and 13 additional provider paths through `contact_points`. Every
one of those foreign keys is non-deferrable. Notes, activity and imported source
facts are also protected by immutable triggers. Temporarily weakening those
guards or updating only a subset would make rollback incomplete and violate
Story 3.15 AC5–7.

The safe contract is a **logical, reversible alias merge**:

1. keep every donor contact and every dependent row physically intact;
2. archive the donor with an explicit merge reason and active survivor alias;
3. make contact-scoped reads and import identity resolution follow the active
   alias to one canonical contact;
4. keep provider-bound/outbound records review-only until each connector uses
   the canonical resolver;
5. reverse by deactivating the alias and restoring the donor's exact prior
   archive projection. No dependent row must be reconstructed.

This decision prioritizes complete reversal and evidence preservation over a
premature partial merge.

## Current foreign-key inventory

### Direct `contacts` consumers (28 paths)

| Table | Contact column/path | Merge risk |
|---|---|---|
| `contacts` | `referred_by_id` | self-reference and alias cycle |
| `contact_points` | `contact_id` | provider children and primary/value uniqueness |
| `contact_external_links` | `contact_id` | exact provider identity authority |
| `contact_import_source_facts` | `contact_id` | immutable provenance |
| `notes` | `contact_id` | immutable note-content guard |
| `note_lifecycle_events` | `contact_id` | append-only lifecycle evidence |
| `activity_events` | `contact_id` | immutable activity ledger |
| `tasks` | `contact_id` | Calendar children |
| `household_memberships` | `contact_id` | active membership uniqueness |
| `contact_relationships` | `first_contact_id`, `second_contact_id` | canonical pair/order and self-pair risk |
| `contact_assignments` | `contact_id` | active assignee uniqueness |
| `contact_custom_field_values` | `contact_id` | one value per definition |
| `incomplete_records` | `converted_contact_id` | immutable conversion authority |
| `data_import_row_outcomes` | `contact_id` | import receipt provenance |
| `mailer_sends` | `contact_id` | composite primary key collision |
| `meta_external_identities` | `contact_id` | provider sender identity |
| `meta_conversations` | `contact_id` | provider conversation authority |
| `texting_consent_events` | `contact_id` | legal/consent evidence |
| `texting_consent_states` | `contact_id` | current legal authority projection |
| `texting_conversations` | `contact_id` | outbound conversation routing |
| `texting_message_drafts` | `contact_id` | approval target |
| `texting_messages` | `contact_id` | immutable provider evidence |
| `texting_send_approval_snapshots` | `contact_id` | immutable compliance snapshot |
| `twilio_real_number_uat_jobs` | `contact_id` | activation evidence |

`notes`, `contact_external_links` and `mailer_sends` each expose both a legacy
owner composite FK and a workspace composite FK; those duplicate constraints
account for the 28 catalog paths.

### `contact_points` children (13 paths)

- `public.mailchimp_member_links`
- `public.mailchimp_sync_evidence`
- `connector_private.mailchimp_outbound_backfill_items`
- `public.google_email_drafts`
- `connector_private.google_gmail_resources`
- `public.texting_consent_events`
- `public.texting_consent_states`
- `public.texting_conversations`
- `public.texting_message_drafts`
- `public.texting_message_draft_versions`
- `public.texting_messages`
- `public.texting_send_approval_snapshots`
- `public.twilio_real_number_uat_jobs`

### Task/note children that must remain reachable

- `activity_events`, `google_calendar_task_states` and
  `connector_private.google_calendar_task_resources` reference `tasks`.
- `note_lifecycle_events` references `notes`.

## Architectural invariants

The first mutation-capable release must preserve these invariants at the SQL,
repository and worker boundaries:

- an active alias is always a one-level star: one canonical survivor and one or
  more donors; chains and cycles are invalid;
- donor rows and every dependent row retain their physical primary and foreign
  keys; alias resolution changes reachability, never provenance;
- a caller may nominate an exact-evidence group, but cannot choose the
  survivor; the database applies the deterministic ranking;
- reads may aggregate an alias group, but writes resolve to the survivor and
  keep the original physical owner visible in internal evidence;
- no outbound operation may silently substitute a donor, survivor or contact
  point after owner review; an alias change makes the operation stale;
- unmerge is whole-plan in v1. Partial donor reversal and merging an already
  aliased group remain review-only because they create reversal ordering;
- after the first production apply, recovery uses the forward
  `reverse_exact_contact_merge` contract. A destructive down migration is not
  a production rollback mechanism.

## Proposed 0027 schema contract

Migration 0027 must be additive and must not alter any existing FK or immutable
trigger.

### `contact_merge_plans`

- workspace, plan ID, actor membership and database-selected survivor contact;
- exact evidence kind (`external-id`, `email`, `phone`) and only its SHA-256
  group hash, never raw PII;
- bounded dependency-count snapshot and snapshot hash;
- state: `pending`, `review-only`, `applied`, `reversed`, `expired`;
- request hash, reason codes, creation/expiry/apply/reversal timestamps;
- unique request/idempotency keys per workspace.

`pending -> applied -> reversed` is the only mutation path. `pending ->
expired` and `pending -> review-only` are terminal. Repeating the same request
hash returns the existing plan; repeating apply or reverse with the same
idempotency key is a no-op receipt. A different request against a terminal
plan is rejected.

### `contact_merge_plan_members`

The plan is group-scoped rather than pair-scoped. It stores one survivor member
and one or more donor members, each with the contact UUID, role, original donor
archive projection and a per-contact dependency fingerprint. This avoids a
partially consolidated three-contact exact group and makes the whole group
reversible in one transaction. The table has unique `(plan_id, contact_id)` and
exactly one survivor is enforced when applying. Plans containing a contact in
any active alias are review-only in v1.

### `contact_merge_aliases`

- one immutable donor/survivor pair per donor member of an applied plan;
- `active_from` and nullable `inactive_at` for reversal;
- unique active donor; a constraint trigger rejects chains and cycles;
- forced RLS read for active members; writes only through owner RPCs.

The constraint trigger also rejects an active donor being used as a survivor,
an active survivor being used as a donor, and cross-workspace pairs. Contact
mutation guards reject direct updates/restores of an active donor; application
writes must resolve to the survivor. The reverse RPC is the only path allowed
to restore a donor archive projection.

### `contact_merge_events`

Append-only redacted events for `planned`, `review-required`, `applied` and
`reversed`, with actor, plan, correlation ID, reason code and time. No raw
email, phone, provider ID, name, city or note text may appear.

### RPCs

- `plan_exact_contact_merge(...)`: owner-only and group-hash driven. It
  recomputes the complete candidate set, returns only redacted counts and
  hashes, and selects the survivor by: has an exact external link first,
  oldest `created_at` second, UUID ascending last. If evidence classes disagree,
  the group is provider-bound, any member is already aliased, or fewer than two
  active candidates remain, the persisted result is `review-only`.
- `apply_exact_contact_merge(...)`: owner-only, locks the plan and all member
  contacts in UUID order, checks expiry, request hash, snapshot hash and
  activation gate, then reruns exact evidence. It rejects a changed member set,
  conflicting identifier, in-flight outbound authority or changed dependency
  fingerprint. Donor archive, aliases and events are committed atomically.
- `reverse_exact_contact_merge(...)`: owner-only and whole-plan. It locks the
  plan/members, rejects any later alias participation or divergent donor
  archive projection, deactivates every alias and restores every recorded donor
  archive projection in the same transaction.
- `resolve_canonical_contact_id(workspace_id, contact_id)`: stable read helper
  that returns the active survivor or the original ID and never crosses a
  workspace.
- `list_contact_alias_group_ids(workspace_id, contact_id)`: stable read helper
  returning the canonical ID and physical member IDs for repository aggregation.
- `assert_contact_outbound_target(workspace_id, contact_id, contact_point_id)`:
  fail-closed helper used at intent creation, approval and immediately before a
  provider call. It rejects an aliased donor, a point physically owned by a
  donor, an archived target or an alias version different from the reviewed
  version.

Direct table mutation remains ungranted. RLS must cover active owner,
assistant-read, revoked and two-workspace negatives. Only the active owner may
plan/apply/reverse.

The owner membership and workspace are derived and revalidated from `auth.uid()`;
browser-supplied membership/workspace values are never authority. All
`SECURITY DEFINER` functions use a fixed `search_path`, qualify relations and
reject service calls without an explicit worker contract. Authenticated members
may execute the two read resolvers only for their active workspace. They cannot
read pending plan internals or mutate merge tables directly.

## Snapshot, locking and stale-plan contract

The snapshot hash is not a count hash. It is a canonical SHA-256 digest over:

1. ordered member UUIDs and the selected survivor UUID;
2. the fields that affect active/archive and exact-identity decisions;
3. ordered per-table dependency fingerprints made from row primary keys and
   relevant version/update state; and
4. the active-alias epoch and in-flight outbound count.

The plan may expose per-table counts, but never raw identifier values. Apply
locks the plan and contacts in stable UUID order before recomputing the digest.
Any mismatch returns a dedicated `stale-plan` error and performs zero mutation.
New dependent rows are not lost by the logical design, but a changed snapshot
still requires a new owner review. Provider and outbound creation functions
must also reject active donors, closing the race between the apply check and a
new provider-bound row.

## Exact evidence and conflict rules

An automatic plan requires exactly one shared canonical evidence class and no
conflicting exact identifier:

- same `(provider, external_id)` within the workspace; or
- same normalized active email; or
- same canonical active E.164 phone.

Name, city, fuzzy similarity, household, relationship, temperature, status and
lead source are never identity evidence. A shared household phone with distinct
external IDs/emails is review-only. Multiple evidence classes resolving to
different contact sets are review-only.

Until every repository/connector follows `resolve_canonical_contact_id`, any
row in the Meta, Mailchimp, Google, Twilio/texting, mailer-send or consent
authorities makes the plan review-only. This prevents outbound operations from
silently switching recipients.

## Required cross-layer work before migration 0027 apply is safe

1. Contact detail, notes, activities, tasks, households, relationships,
   assignments, custom values and Imported profile must read the canonical
   alias group.
2. Import identity resolution must return the survivor while preserving the
   original matched contact in the redacted receipt.
3. Every outbound connector must resolve canonical contact/point authority or
   explicitly refuse an aliased donor.
4. Archive/restore must reject manual donor restore while an alias is active.
5. CLI must remain dry-run by default and require plan ID, snapshot hash,
   backup/export receipt and explicit `--apply`.

### Repository resolution contract

Do not scatter raw resolver RPC calls through pages. Add a `ContactIdentityMap`
data boundary with `resolveCanonical(...)` and `listGroupMembers(...)`, then
inject it into contact-scoped repositories/services.

- `ContactRepository.get` resolves a donor route to the survivor and returns
  requested/canonical metadata; `list` suppresses active donors.
- Notes, activities, tasks, households, relationships, assignments, custom
  values and Imported profile query the group member IDs and retain each row's
  physical `contactId` in the domain result.
- Mutations resolve once to the canonical survivor. Archive/restore rejects a
  donor while its alias is active.
- List/search paths use a bulk alias map for the page, not one resolver RPC per
  contact. Empty alias tables must preserve current behavior and query plans.

Required application ownership is centered in
`lib/data/contact-identity-map.ts`, its Supabase/memory adapters, and the
existing contact/rich-contact/activity repositories. Page code consumes the
repository contract and must not infer aliases itself.

### Connector and outbound contract

Merge activation remains blocked while a candidate has Mailchimp, Google,
Meta, Twilio/texting, consent, mailer-send or queued connector authority. To
remove that restriction later, every connector must implement both guards:

1. **review guard:** resolve and record canonical contact ID, contact-point ID
   and alias epoch before creating/approving the intent;
2. **dispatch guard:** rerun `assert_contact_outbound_target` after claiming the
   job and before the provider call. A mismatch becomes manual review, never
   recipient substitution or automatic retry.

Existing queued/executing work makes the plan review-only. Incoming provider
evidence keeps its physical donor link for provenance, while contact-facing
reads aggregate it through the alias group.

### Import compatibility contract

`resolve_contact_import_identity` first finds raw matches by external ID,
canonical email and E.164 phone, then maps every match through the active alias
and deduplicates by canonical ID. One canonical result is an active match to the
survivor even when the physical match is an archived donor; more than one
canonical result remains ambiguous. The receipt stores the survivor UUID,
matched evidence class, alias-resolution boolean and a hash of the original
physical match set—never raw PII.

`apply_contact_import_group` re-resolves in the same transaction, writes new
profile facts and external links to the survivor, and preserves the source row
and original-match hash. Exact replay remains a no-op. After reversal, a donor
that regains its archived projection again produces the existing
`archived-match` behavior.

## Performance and indexes

Migration 0027 must include and test:

- unique partial `(workspace_id, donor_contact_id)` for active aliases;
- partial `(workspace_id, survivor_contact_id)` for active group expansion;
- `(workspace_id, state, expires_at)` and unique
  `(workspace_id, request_hash)` for plans;
- unique `(plan_id, contact_id)` plus `(contact_id, role)` lookup support for
  plan members;
- `(workspace_id, plan_id, occurred_at)` for append-only events.

Resolution is one indexed lookup for a donor and one indexed expansion for a
survivor. Repository tests must assert a bounded number of Supabase calls for a
contact page/list so alias support cannot introduce N+1 behavior. Production
activation requires `EXPLAIN (ANALYZE, BUFFERS)` evidence using aggregate,
PII-free fixtures representative of the Judith workspace.

## Forward-only rollout

1. **0027 foundation:** additive tables, RLS, read resolvers, plan RPC, guards
   and full pgTAP. Apply/reverse exist but authenticated execution remains
   activation-gated.
2. **Application compatibility:** deploy the identity-map adapters, grouped
   reads, canonical writes, import resolution and connector refusal paths.
   With zero aliases this is behavior-preserving.
3. **0028 activation:** only after repository/connector regressions pass, enable
   owner apply/reverse. This is a forward migration, not a dashboard toggle.
4. **Controlled cleanup:** fresh Judith-workspace read-only audit, external
   encrypted backup/export receipt, dry-run plan review, then explicit apply of
   zero-conflict groups.
5. **Recovery:** use whole-plan reverse and re-audit. Never drop merge tables or
   immutable events after any production apply.

## Implementation ownership and readiness

**@data-engineer owns:** 0027/0028 schema, plan members, RLS/grants, triggers,
RPCs, indexes, pgTAP and local rollback/replay proof.

**@dev owns:** identity-map interfaces/adapters, contact-scoped repository
aggregation, canonical mutation routing, import integration, connector guards,
CLI dry-run/apply UX and unit/integration tests.

**@qa owns:** adversarial workspace/RLS, stale-plan/race, alias read/write,
outbound refusal, import replay, N+1/performance and whole-plan reverse gates.

Architecture verdict: **GO for T3 foundation only under the activation gate;
NO-GO for production apply and T4 `--apply` until the application compatibility
and dispatch guards above are complete.** T4 dry-run/read-only planning may
proceed in parallel. This split prevents a database alias from hiding history
or rerouting a reviewed recipient before every consumer understands aliases.

### Frozen 0028 activation handoff

The 0027 contract is frozen at the following boundary. Migration 0028 must not
be authored or applied until application evidence proves all of these items:

- every contact list/detail/history repository expands
  `list_contact_alias_group_ids(...)` without N+1 reads;
- every contact-scoped mutation resolves
  `resolve_canonical_contact_id(...)` before authorization and persistence;
- import identity resolution canonicalizes external-ID, email and phone matches
  before ambiguity evaluation and retains a hash of the physical match set;
- Mailchimp, Google, Meta, Twilio/texting and mailer review plus worker dispatch
  call `assert_contact_outbound_target(...)` with the reviewed alias epoch;
- repository, import and connector tests prove donor history remains visible,
  donor writes target the survivor, and changed aliases fail closed;
- whole-plan apply/replay/reverse pgTAP proves archive projections, event
  receipts and the alias epoch return to the documented state.

As of 2026-08-20, a repository search found no application consumer of the
three 0027 resolver/guard functions. This is an explicit **NO-GO for 0028**,
not permission to weaken the provider-bound review restriction or expose a
partial physical merge.

### Local 0028 implementation evidence

Migration `0028_contact_merge_activation.sql` now contains the smallest safe
database activation: it refuses pre-existing productive aliases, replaces the
0027 inert constraint, activates version 2 for existing workspace-state rows,
and makes version 2 the default for rows created lazily by future plans. It does
not reparent any foreign key or rewrite an immutable ledger.

The operational rollback
`0028_contact_merge_activation.rollback.sql` is a deactivation, not a data
reconstruction path. It fails closed while any plan is applied or any alias is
active. Operators must call `reverse_exact_contact_merge(...)` for every
applied plan first; reversed plans, inactive aliases and append-only events are
retained as evidence.

`0028_contact_merge_activation_test.sql` proves a three-contact whole plan with
an originally active donor and an originally archived donor: apply, exact
replay, canonical/group reads, outbound refusal, reverse, exact reverse replay,
archive-projection restoration, event cardinality and monotonic alias epochs.
The local schema is ready, but this does not override the cross-layer production
gate below.

## Production gate

Production mutation remains prohibited until all of the following are present:

- migration reset, focused/compatible pgTAP and rollback/replay evidence;
- repository/service/CLI tests and full lint/typecheck/test/build;
- fresh authenticated Judith-workspace read-only audit;
- a `pg_dump`/approved export receipt outside Supabase tables;
- zero-conflict plans only; provider-bound and conflicting groups stay review-only;
- post-apply read-only re-audit with aggregate, PII-free counts.
