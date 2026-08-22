# Physical mailer checklist

The Mailers workspace tracks printed postcards and letters. It does not send email or replace Mailchimp.

## Operator workflow

1. Open `/mailers` and create a named physical-mail campaign.
2. Select the campaign and search the contact checklist if needed.
3. Mark a contact only after the piece is sent. The server records the current calendar date.
4. Clear the check if the mailing was recorded by mistake; this removes that campaign/contact send row.

The campaign cards show sent, remaining, and total active-contact counts. In demo mode the state survives navigation and reload while the local server process remains alive, but it is not durable storage. The global sample-data banner remains authoritative.

## CLI-first operation

Every operation emits JSON:

```powershell
npm run mailers -- list
npm run mailers -- create --name "September market update" --notes "Printed postcard"
npm run mailers -- mark --campaign m-jan --contact c-monroe
npm run mailers -- unmark --campaign m-jan --contact c-monroe
```

Without `--live`, the CLI labels its mode `demo-process-only`; separate invocations do not share mutations. Durable live commands require `--live` plus:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OMNIX_INTAKE_WORKSPACE_ID (preferred) or OMNIX_INTAKE_OWNER_ID (compatibility alias)
```

The live CLI fails closed if Supabase credentials or a unique server-side workspace binding is absent. If both workspace and owner are configured they must identify the same active owner workspace. It never falls back to demo after `--live` is selected.

`OMNIX_TIME_ZONE` should be the Realtor’s IANA time zone, such as `America/New_York`. The mailing date uses that calendar zone so a Vercel UTC rollover cannot stamp tomorrow’s date. When it is omitted, the local process calendar is used.

## Database and security

Apply migrations in order through `0004_shared_workspace_authority.sql`. Migration 0003 preserves the original owner-scoped send history; migration 0004 backfills canonical `workspace_id`, requires campaign/contact/send relationships to stay in the same workspace and changes RLS/repository queries to active membership authority. Legacy `owner_id` remains populated only during the compatibility window and is not an authorization boundary.

The application validates campaign names, notes, identifiers, status transitions, and dates on the server. Mark and unmark operations are idempotent; repeated marking preserves the first recorded date.

## Disable and rollback

The migration is forward-only because its ownership constraints protect contact history. To disable the UI temporarily, remove the Mailers navigation entry or route in a later authorized change; do not drop `mailer_sends` or bulk-delete mailing history. Correct an individual mistake by clearing that contact’s checkbox.
