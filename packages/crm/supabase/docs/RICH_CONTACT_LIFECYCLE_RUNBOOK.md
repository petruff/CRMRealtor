# Omnix rich-contact lifecycle database runbook

Scope: migration `0007_rich_contact_lifecycle.sql` only. It adds the Story 3.2
contact model and preserves the Story 3.0/3.1 workspace, import, task and
activity contracts. `lead_type` (`hot`, `warm`, `nurture`) remains the sole
prioritization axis; there is no independent rating column.

## Pre-deploy gate

1. Confirm migrations 0001–0006 are applied in order and no migration is
   running concurrently.
2. Take a verified managed backup/PITR checkpoint and a schema snapshot. The
   local rehearsal used:

   ```powershell
   supabase db dump --local --schema public --file $env:TEMP\omnix-before-0007-rich-contact-schema.sql
   ```

3. Run read-only preflight counts for invalid non-empty phones and emails. The
   migration validates those values before creating canonical points and aborts
   instead of silently dropping invalid data.
4. Confirm each existing workspace has one active owner membership. Legacy
   scalar backfill records that membership as deterministic compatibility
   evidence.
5. Pause contact imports and contact mutations for the migration window. The
   migration is transactional, but an application quiesce gives an auditable
   backfill boundary.

## Apply and local verification

From `packages/crm`:

```powershell
supabase db reset --local
supabase test db supabase/tests/0004_shared_workspace_authority_test.sql `
  supabase/tests/0005_crm_work_queue_test.sql `
  supabase/tests/0006_connector_platform_foundation_test.sql `
  supabase/tests/0007_rich_contact_lifecycle_test.sql --local
```

The combined matrix must report `Files=4, Tests=64` and `Result: PASS`. The
0007 matrix contributes 18 cases covering deterministic scalar backfill,
bounded and normalized contact points, workspace isolation, owner/assistant
boundaries, household history, canonical unordered relationships, assignment
history, typed custom values, archive/restore, archived-task denial, ambiguous
identity, atomic import, replay conflict, rollback-on-failure and append-only
evidence.

This is local schema evidence. It is not proof of remote migration, deployed
adapter behavior, production backup recovery or end-to-end import operation.

## Authority and compatibility behavior

- `workspace_id` is present on every rich table and every cross-object foreign
  key includes it. RLS is enabled and forced.
- Authenticated clients have `SELECT` only on the rich tables. Mutations use
  typed `SECURITY DEFINER` RPCs and explicit actor membership IDs.
- Owners and assistants may maintain ordinary contact facts. Only owners may
  define/archive custom fields or archive/restore a household.
- `contact_points` is canonical. `contacts.phone`, `secondary_phone`, `email`
  and `email_subscribed` remain synchronous compatibility projections.
- Active phone points are limited to three per contact; active email points to
  two. A contact has at most one active primary point per type. Normalized
  duplicates are rejected per contact, while a shared number/email across
  different people remains visible as an ambiguous identity.
- Household membership, assignment and relationship removal records end or
  archive evidence; rows are not product-deleted.
- `active_contacts` is the default non-archived read surface. Explicit archive
  detail reads use `contacts`. New tasks against archived contacts fail closed.
- Household membership never grants access and is never an identity-match key.

## Import transaction seam

`resolve_contact_import_identity(workspace_id, provider, external_id, email,
phone)` returns:

```json
{
  "outcome": "none | ambiguous-identity | active-match | archived-match",
  "contactId": "uuid | null",
  "matchedBy": "external-id | email | phone | null",
  "matchCount": 0
}
```

Resolution includes archived contacts and never mutates them. An
`archived-match` requires an explicit restore followed by a new command.

`apply_contact_import_group(workspace_id, actor_membership_id,
group_idempotency_key, request_hash, plan, occurred_at)` commits one collapsed
target group. Plan v1 permits only:

- `action`: `create`, `update` or `unchanged`;
- `contactId` and bounded `contact` facts;
- up to five `points`, 20 `householdIds`, 20 `assigneeMembershipIds` and 100
  `customValues`;
- one `externalLink`, one optional 1–5000 character `note`, and one
  `activityIdempotencyKey`.

A merge row is an `unchanged` target group for the already selected contact. It
may still add its external link, deduplicated exact note and `contact-imported`
receipt. The result is `{ contactId, action, notesAdded, noOp }`. Same-key,
same-hash replay returns the stored result with `noOp: true`; divergent replay
raises a unique conflict. Any point, household, assignment, custom value, link,
note or activity failure rolls back the whole group, including its receipt.

## Activity and archive evidence

Story 3.2 extends the persisted activity enum with:

- `contact-archived`, `contact-restored`;
- `contact-point-added`, `contact-point-updated`,
  `contact-point-archived`, `contact-point-restored`;
- `household-updated`, `relationship-updated`, `assignment-updated`,
  `custom-field-updated`.

The existing Story 3.1 `append_activity_event` parameter type is unchanged.
Rich lifecycle writers use an internal text-to-v2 allowlist helper so existing
callers do not need an enum signature migration. Activity events remain
append-only and idempotent by `(workspace_id, idempotency_key)`.

## Rollback

Prefer the verified pre-migration backup/PITR checkpoint. The manual rollback
is destructive and only supports a verified pre-write window:

```powershell
Get-Content -Raw supabase/rollbacks/0007_rich_contact_lifecycle.rollback.sql |
  docker exec -i supabase_db_omnix-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

It refuses to run when rich lifecycle events, archived contacts, household,
relationship, assignment or custom-field rows exist, or when contact points
are not exactly the deterministic migration backfill. In the safe window it
removes 0007 objects, restores the Story 3.1 activity enum/constraint and task
guard, restores the prior conversion validators and preserves the legacy
contact rows.

After Story 3.2 writes exist, do not run the manual rollback. Pause new contact
imports, preserve activity/history rows, and use PITR or an approved forward
reconciliation migration. Application rollback alone does not restore the
database contract.

## Post-deploy observation

- Compare `contacts` with canonical point counts and inspect projection errors.
- Alert on import hash conflicts, ambiguous identity outcomes and rejected
  archived-contact task creation; do not auto-merge ambiguous people.
- Monitor RLS denials and constraint failures by workspace without logging
  contact values.
- Verify archive actions have matching activity evidence and restores keep the
  same contact ID and history.
- Keep provider-specific consent and messaging authority out of
  `contact_points`; Story 4.3 owns the consent ledger.
