# Rich contact lifecycle operations

The Story 3.2 operator surface is CLI-first. Commands use the same validated application services as the UI and never accept a workspace or owner identifier from the caller.

## Safe sample checks

```powershell
npm run contacts:lifecycle -- points-list --contact-id c-monroe
npm run contacts:lifecycle -- contact-status --contact-id c-monroe
npm run contacts:lifecycle -- households-list
npm run contacts:lifecycle -- assignments-list --contact-id c-monroe
```

Sample mode is process-local demonstration data. The JSON envelope reports `mode: sample-process-only` and `durable: false`.

## Mutations

- Points: `point-add`, `point-update`, `point-archive`, `point-restore`.
- Households: `household-create`, `household-archive`, `member-add`, `member-remove`.
- Relationships: `relationship-add`, `relationship-archive`, `relationship-restore`.
- Assignments: `assign`, `unassign` using an active workspace membership ID.
- Custom fields: `field-create`, `field-archive`, `value-set`; field definitions require the workspace owner.
- Contact lifecycle: `contact-archive`, `contact-restore`. Archive preserves the contact ID and history.

Use `npm run contacts:lifecycle -- --help` for the complete option list. JSON custom-field values use `--value`, for example `--value '"Wine"'` or `--value true`.

## Live mode

Add `--live` only after Supabase migrations through `0007_rich_contact_lifecycle.sql` are applied and the CLI has end-user authentication. Live mode must fail closed if authority or the Story 3.2 repository contract is unavailable. It must never fall back to sample data.

## Operational boundaries

- Hot, Warm and Nurture remain the only prioritization axis.
- Contact points are the canonical phone/email authority after migration; legacy scalar fields are compatibility projections.
- Archive is reversible. Permanent deletion is not part of this story.
- Provider credentials, carrier registration, Google/Meta review and provider actions belong to the connector stories and are not implied by this lifecycle surface.
