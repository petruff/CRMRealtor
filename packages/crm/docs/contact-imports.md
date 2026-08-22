# Contact imports and automatic intake

The CRM accepts bounded CSV and vCard files through `/contacts/import`. It can auto-detect common exports from Mailchimp, Google Contacts, Apple Contacts, and BoldTrail/kvCORE, while a generic spreadsheet preset handles standard headings.

## Safety model

- Preview is read-only. Saving is disabled in demo mode.
- Matching order is external platform ID, normalized email, then normalized phone.
- Existing non-empty contact fields are never overwritten by an import. Tags are unioned and an unsubscribe always wins.
- Identical notes are not appended twice. Replaying an external ID updates or leaves the linked contact; it never creates another one.
- File imports accept at most 1,000 rows or 2 MB. Automatic batches accept at most 50 contacts or 256 KB.
- Uploaded file contents stay in the current page state only; the app does not put contact data in URLs or browser storage.

## CLI-first preview

```powershell
npm run contacts:import -- .\contacts.csv --source auto
```

This prints a machine-readable preview and writes nothing. A live commit deliberately requires the configured intake endpoint and secret:

```powershell
$env:OMNIX_INTAKE_URL='https://omnix.example.com/api/intake/contacts'
$env:OMNIX_INTAKE_TOKEN='replace-with-a-long-random-secret'
npm run contacts:import -- .\contacts.csv --source mailchimp --commit
```

The CLI derives a stable idempotency key from the mapped payload unless `--idempotency-key` is supplied.

## Platform and website automation

Apply Supabase migrations through `0004_shared_workspace_authority.sql`, then set these server-only environment values:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=...
OMNIX_INTAKE_WORKSPACE_ID=00000000-0000-4000-8000-000000000000
# Temporary compatibility alias only; when present it must match the workspace owner.
OMNIX_INTAKE_OWNER_ID=
OMNIX_INTAKE_TOKEN=use-a-long-random-secret-at-least-24-characters
```

`OMNIX_INTAKE_WORKSPACE_ID` is the canonical server-side tenant binding. The request cannot select a workspace. `OMNIX_INTAKE_OWNER_ID` remains a temporary alias that must resolve to one unique active owner workspace; contradictory, missing, revoked, or ambiguous bindings fail before any write. Send requests to `POST /api/intake/contacts`:

```json
{
  "source": "website",
  "contacts": [
    {
      "externalId": "lead-123",
      "firstName": "Avery",
      "lastName": "Stone",
      "email": "avery@example.com",
      "phone": "+1 555 010 2000",
      "note": "Asked to tour 12 Main Street"
    }
  ]
}
```

Required headers are `Authorization: Bearer <OMNIX_INTAKE_TOKEN>`, `Content-Type: application/json`, and a stable `Idempotency-Key` of 8–128 safe characters. An exact replay returns the stored aggregate receipt with `Idempotency-Replayed: true`; reusing a key for different content returns `409`.

Every automatic-intake contact must include a stable, non-empty `externalId` of at most 255 characters. Use the source platform's immutable submission/lead identifier; do not generate a new value when retrying the same lead.

CLI commit refuses files with rejected rows instead of silently omitting them, and returns a non-zero exit code for partial (`207`) responses.
When an export has no vendor ID, the CLI derives a stable file-row identifier for the automatic-intake contract; existing email/phone matching still runs before any create.

The endpoint returns `503` if any live credential is missing. It never falls back to demo storage. Direct OAuth connectors and continuous pull synchronization remain separate future integrations; today, any platform that can export CSV/vCard or send an authenticated webhook can feed the CRM without pretending unsupported credentials exist.

## Disable and rollback

Remove `OMNIX_INTAKE_TOKEN` (or any other required intake variable) and restart the app to disable machine intake immediately; the route will return `503`. Keep migration `0002` applied because it is additive and stores provenance required for safe re-imports. If imported contacts must be corrected, review them in Omnix rather than dropping provenance tables or bulk-deleting records.
