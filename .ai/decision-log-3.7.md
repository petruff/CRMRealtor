# Decision Log — Story 3.7

## 2026-08-12 — Preserve First Class fields through existing rich-contact authority

- The audited export contains 79 headers and 144 contact rows in both CSV and XLSX.
- XLSX row 1 is a report title; bounded header discovery selects row 2.
- `Rating` is a First Class 0–5 value, not Omnix `leadType`.
- `Status` is a First Class lifecycle label, not an Omnix `pipelineStage`.
- Legacy phone placeholders with fewer than seven digits remain preserved source facts but are excluded from canonical identity and contact phone fields.
- Valid phones are converted to the SQL canonical digits-only identity. Embedded spreadsheet control whitespace is normalized to printable spaces before persistence.
- Canonical identity/contact fields are normalized conservatively. Every non-empty original value is also preserved through the existing workspace-scoped custom-field/value authority used by the atomic import-group RPC.
- Definitions use the reserved `1st Class · ` prefix and imported values render read-only. Legacy consent values remain provenance only and do not authorize Omnix messaging.
- Raw customer files and rendered previews are transient local evidence and are not retained in the repository.

## 2026-08-12 — Make the production parser portable and First Class imports duplicate-safe

- Vercel cannot load a Next.js server chunk as a `worker_threads` entrypoint. Production therefore uses the same bounded SheetJS parser in-process; local/server runtimes retain the memory-isolated worker, with a module-resolution fallback only.
- Formula, macro, sheet, cell, column, string, file-size and processing protections are identical on both paths.
- Existing First Class identities are previewed as `Client already exists` and cause no contact, source-fact, link, note or activity mutation.
- A repeated identity inside the same First Class file is previewed as `Duplicate row — not imported`; only the first row is applied.

## 2026-08-20 — Remove commercial row caps without weakening parser security

- **IDS — ADAPT:** extended the existing `contact-import.ts` and `workbook-portability.ts` parser boundaries; no parallel importer or dependency was created.
- **IDS — REUSE:** kept the canonical candidate projection, KvCore source detection, source-fact provenance and identity/deduplication paths unchanged.
- CSV and workbook imports no longer have a direct row-count cap. Capacity is governed by file bytes, populated cells, columns, cell length, workbook sheets, parser time and worker memory.
- Workbook parsing no longer trusts `!ref`. Both worker and Vercel in-process paths derive a compact material range from non-empty cells before matrix conversion, so formatted blank tails cannot inflate row counts or parser work.
- Regression evidence covers 6,001 real rows in CSV/XLSX, an Excel-max-row inflated range with only 144 contacts, Vercel/local parity and retained safety-limit failures.

## 2026-08-20 — Keep compressed workbooks isolated in production

- **IDS — ADAPT:** retained the existing worker parser and changed its entrypoint to a traced process-rooted filesystem asset; no alternate workbook engine was introduced.
- XLSX central-directory preflight rejects ZIP64/multi-disk packages, unsafe or duplicate paths, overlapping entries, unsupported/encrypted methods, excessive entry count, per-entry/total expansion and extreme compression ratios before `xlsx.read`.
- Vercel no longer uses synchronous in-process workbook parsing. The import route trace explicitly includes the worker and SheetJS runtime; a missing worker fails closed.
- Configured signed-out requests are rejected before base64 decoding or worker creation. Authenticated workspaces receive a per-instance concurrency ceiling of two workbook parses; row count remains uncapped.
- The page segment carries a 15-second provider execution envelope in addition to the worker's five-second termination timer and 128 MB heap ceiling.
