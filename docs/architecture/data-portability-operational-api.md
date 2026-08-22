# Data Portability and Operational API Architecture

**Version:** 1.0  
**Date:** 2026-08-12  
**Story:** 3.4  
**Status:** Approved for implementation

## Outcome

Extend the existing Next.js application, contact import commands, repository boundary and Supabase workspace authority. No second service, retained upload, caller-selected workspace, or broad service-role CRUD is introduced.

```text
CLI / authenticated UI / external v1 route
              |
       bounded schema adapters
              |
     application commands + WorkspaceScope
              |
 repositories / narrow SECURITY DEFINER RPCs
              |
  workspace RLS + immutable receipts in Postgres
```

Uploads are read into a bounded buffer, hashed, parsed in an isolated worker, converted to the existing allowlisted contact-candidate model, previewed, and discarded. Only a mapping profile and aggregate run/row receipts may persist.

## Current state and capability baseline

- CSV and vCard parsing, preview, identity resolution and command-backed commit already exist.
- WorkspaceScope, membership-derived RLS, immutable activity/connector receipts and narrow RPC patterns are established.
- Route handlers are the approved HTTP boundary; CLI commands are the first operational surface.
- Contact archive, canonical contact points, custom fields and Smart Lists are established authorities and must not be bypassed.

## Parser decision

| Option | XLS | XLSX | License/source | Decision |
|---|---:|---:|---|---|
| A. SheetJS CE 0.20.3, vendored official tarball | Yes | Yes | Apache-2.0, authoritative SheetJS CDN | Selected |
| B. ExcelJS | No | Yes | MIT/GitHub | Rejected: loses required XLS capability |
| C. External office conversion service | Yes | Yes | deployment-specific | Rejected: second service, raw-file transfer and larger privacy/ops boundary |

The public npm `xlsx` endpoint is not used because it stops at 0.18.5. The official 0.20.3 tarball is pinned and vendored for reproducibility. SheetJS documents that versions through 0.19.2 were affected by prototype pollution and versions through 0.20.1 by ReDoS; 0.20.3 is beyond both remediation floors. Distribution must retain the Apache-2.0 attribution.

Official references:

- https://docs.sheetjs.com/docs/getting-started/installation/frameworks/
- https://docs.sheetjs.com/docs/api/parse-options/
- https://docs.sheetjs.com/docs/miscellany/license/
- https://cdn.sheetjs.com/advisories/CVE-2023-30533
- https://cdn.sheetjs.com/advisories/CVE-2024-22363

## Security boundaries

1. Extension and magic/container type must agree; only CSV, VCF, XLS and XLSX are accepted.
2. Bytes are bounded before parsing. Workbook parsing runs outside the request isolate with a hard timeout and memory ceiling.
3. Dense mode and `sheetRows` provide a parser-side row ceiling; sheet, cell and string ceilings are rechecked after parse.
4. `bookVBA: true` is used only to detect and reject a VBA blob. XLSM/XLSB and any workbook with VBA are rejected.
5. No password is supplied. Password-protected/encrypted workbooks fail closed.
6. Cell formula metadata is inspected; any formula rejects the workbook. Formula evaluation is never enabled.
7. Raw buffers and cell dumps are never logged or persisted. Telemetry is correlation ID, format, byte/count bounds, duration, outcome and fixed error category only.
8. CSV/XLSX export prefixes spreadsheet-control values (`=`, `+`, `-`, `@`, tab, CR) with a single quote and exports allowlisted fields only.
9. API keys use a random 256-bit plaintext shown once, a visible prefix, and an HMAC-SHA-256 verifier using a server-side pepper. Database rows never store plaintext.
10. API authentication resolves exactly one active key and its workspace before commands run. Request workspace/owner identifiers are rejected, not trusted.

## Data and command design

- `data_mapping_profiles`: workspace/versioned mapping and safe defaults; archived instead of deleted.
- `data_import_runs` and `data_import_row_outcomes`: immutable file hash, mapping version, actor, counts and contact/incomplete-record references; no raw source.
- `data_export_receipts`: immutable selection hash, entity/field/date/Smart List criteria, count and format; generated file is not retained.
- `operational_api_keys`: owner-managed prefix/verifier/scopes/expiry/revocation/rotation lineage.
- `operational_api_receipts`: immutable method/route/status/idempotency/resource reference and fixed error code; no bodies or secrets.
- `generic_webhook_endpoints` and `generic_webhook_receipts`: redacted endpoint identity, verifier generations and aggregate delivery truth.

All mutations reuse application commands. Narrow RPCs provide atomic key issuance/rotation, import-run finalization, mutation idempotency and receipt append. RLS derives authority only from active workspace membership.

## External API v1

- `GET/POST /api/v1/contacts`
- `GET/PATCH /api/v1/contacts/{id}`
- `POST /api/v1/contacts/{id}/archive`
- `GET /api/v1/contacts/search`
- `GET /api/v1/status`
- `POST /api/v1/intake`

Stable envelopes expose `data`, `meta` and `error { code, message, correlationId }`. Cursor pagination is opaque and bounded. Mutations require `Idempotency-Key`; updates require the current `updatedAt` value. Rate limiting is per key and never accepts a workspace from the request.

## Health contracts

- `/api/health`: process/liveness only, always public and redacted.
- `/api/readiness`: dependency configuration/availability by fixed component name; non-200 if a required live dependency is unavailable. No environment values, tenant counts or stack traces.

## Configuration and observability

Mutable limits are defined in `docs/architecture/config/data-portability-api.example.yaml` and represented by one validated application configuration object with environment overrides. Logs use fixed categories such as `file-too-large`, `parser-timeout`, `formula-detected`, `scope-denied`, `rate-limited` and `dependency-unavailable`.

## Test plan

- Parser fixtures plus malformed, encrypted, macro, formula, ZIP/CFB expansion, timeout and boundary cases.
- Mapping alias/default/profile version tests and zero-write preview failures.
- Import/export receipt, formula-injection and cross-workspace tests.
- API key one-time disclosure, HMAC verifier, scope, expiry, rotate/revoke and assistant-denial tests.
- External endpoint pagination, idempotency, optimistic conflict, rate limit, stable error and tenant injection tests.
- Webhook signature/bearer replay/rotation-overlap negatives.
- Separate health/readiness response and leakage tests.
- CLI smoke before UI, followed by lint, typecheck, full tests and build.

## Rollout and rollback

The migration is forward-only. Before any production use, rollback may remove Story 3.4 tables/RPCs only when no import/export/API/webhook receipts or issued keys exist. After use, disable endpoints/issuance first and retain audit rows; do not erase operational evidence.

## Approval record

- Product alignment: Story 3.4 AC1–AC9 and the user's instruction to implement the remaining CRM scope.
- Architect/security/license: GO with SheetJS CE 0.20.3 from the official vendored tarball and the controls above.
- Capability preservation: CSV/vCard behavior remains; XLS/XLSX and governed API are additive.

