# INC-2026-08-23-01 — Import receipt and connector activation

## Status

- State: Identified; recovery implementation in progress
- Severity: SEV-2 (provisional; escalate if contact loss, corruption, or cross-workspace exposure is confirmed)
- Detected at: 2026-08-23T21:05:58-04:00
- Detection source: Production user report
- Affected environment: Production

## User impact

- A production contact import reported that the contact changes completed but the immutable import receipt could not be recorded.
- The user cannot rely on the import audit trail until the imported contacts and receipt state are reconciled.
- Mailchimp setup does not currently provide a successful, actionable completion path.
- Google connection reports authorization pending and unavailable capability health while Gmail activity and Google Calendar permissions remain ungranted.

## Confirmed evidence

- The import action performs the contact mutation before calling the separate `record_data_import_receipt` operation.
- A failure in the second operation produces the exact user-visible message reported from Production.
- Google connector permissions require the workspace owner to complete the provider consent screen; a developer authorization cannot replace that consent.

## Root causes confirmed

- All 144 rows were applied before the receipt failure: 117 contacts were created, 27 were updated, and no row failed. The reconciled workspace contains 308 active contacts and no exact canonical email/phone duplicate groups.
- The `data_import_runs.format` constraint does not include the already supported `numbers` parser format, so the immutable receipt insert was rejected after row application.
- Mailchimp OAuth completed, but Marketing API requests incorrectly reuse the metadata endpoint's `OAuth` scheme instead of Bearer authentication.
- Google remains in the pre-consent `authorizing` state. The aggregate callback rejects partial grants even though persisted capabilities are independently scoped, and the callback currently suppresses its safe diagnostic category.

## Incident command

- Incident coordination: AEXOS Operations Incident Lead
- Product/data implementation: AEXOS Development and Data Engineering
- Independent verification: AEXOS Quality Assurance
- Mechanical release authority: AEXOS DevOps
- User/provider consent authority: Workspace owner

## Containment

- Do not delete, merge, re-import, or bulk-reclassify contacts until the current import is reconciled.
- Preserve the current production deployment and the previously identified rollback target.
- Use read-only inspection for contact counts, duplicates, classifications, connector states, and receipts.
- Do not claim Google or Mailchimp authorization without provider receipts from the workspace owner's account.

## Recovery criteria

1. The production import is reconciled row by row or by a deterministic source fingerprint, with no unexplained duplicates, omissions, or classification drift.
2. The import has a durable immutable receipt, recorded atomically or recovered through an idempotent, evidence-bound operation.
3. A failed receipt operation cannot leave future imports in an ambiguous success state.
4. Google connection health distinguishes configuration, owner consent, granted scopes, and provider availability with an actionable owner flow.
5. Mailchimp connection health distinguishes authorization, audience selection, baseline, webhook, and provider availability with an actionable owner flow.
6. Focused regression tests, the full quality gates, authenticated Production smoke checks, and rollback evidence pass.

## Timeline

- 2026-08-23T21:05:58-04:00 — Incident investigation started after the production user report.
- 2026-08-23T21:08:00-04:00 — Source inspection confirmed that contact mutation and receipt recording are separate operations.
- 2026-08-23T21:18:00-04:00 — Production logs and authenticated read-only reconciliation confirmed 144 rows applied, 308 active contacts, expected pipeline totals, and zero exact canonical duplicate groups.
- 2026-08-23T21:24:00-04:00 — Import schema, Mailchimp authorization scheme, and Google partial-consent handling were confirmed as the three root causes.

## Communications

- Next update: after production read-only reconciliation and connector-state diagnosis.
- No root cause or recovery completion has been declared yet.
