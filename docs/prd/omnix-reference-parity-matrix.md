# Omnix Clean-Room Reference Parity Matrix

**Audit date:** 2026-08-11  
**Reference:** `AnilBotta/realtorspal-ai` at revision `c7ca185fe6ce3ec4cfa87f18ae398ad382715c82`  
**Product:** Omnix — Powered by Cyryx Labs  
**Evidence boundary:** independently observed public routes, public repository metadata and current Omnix runtime/source. No reference code, copy, CSS, prompt, image or asset is reused.

## Direct answer

Omnix does **not** yet implement every useful operational capability observed in the reference. It does already cover the realtor's core contact, follow-up, pipeline, import, mailer and explainable-priority workflows, often with a safer or more truthful boundary. The remaining high-value gaps are listed after the inventory.

The reference itself is also not a complete production CRM. Several visible dashboards, agent controls, analytics, settings and provider claims are static, simulated, only partially wired or unsafe for multi-tenant client data. Visual presence is therefore not counted as operational parity.

## Classification

### Reference implementation

- **Implemented:** executes a real local persistence or provider path.
- **Partial:** a material path exists, but it is incomplete, inconsistent, credential-gated or unsafe.
- **Simulated/static:** the result, metric, activity or control is hardcoded, local-only or has no effective operation.
- **Absent:** no observed implementation supports the claimed outcome.

### Omnix

- **Real:** current application/domain/runtime evidence supports the outcome.
- **Partial:** a useful subset works and the missing boundary is named.
- **Simulated:** visible sample/static behavior exists without the operational capability.
- **Absent:** no current Omnix implementation evidence supports the outcome.

> A status of **Real** describes executable scope, not production deployment. The local Omnix environment remains visibly in sample mode until Supabase, real accounts and UAT are completed.

## Shared application chrome

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| C-01 | Navigation across the eight CRM areas | Implemented | Real | Grouped Today, Contacts, Pipeline, Insights, Omnix AI, Mailers, Connections and Workspace navigation. |
| C-02 | Global cross-app search | Partial | Partial | `/contacts` has real bounded search; no cross-app command search. |
| C-03 | Global Add/Import/Filter quick actions | Partial | Partial | Add and import are real from Contacts; no universal action palette. |
| C-04 | Saved filter templates | Partial | Absent | Reference persists only in browser storage; Omnix has no saved Smart Lists yet. |
| C-05 | Alerts center | Simulated/static | Absent | No unsupported alerts control is shown. |
| C-06 | Light and dark themes | Implemented | Real | Shared tokens, persisted theme selection and reduced-motion support. |
| C-07 | User identity/profile surface | Simulated/static | Partial | Supabase session and sign-out boundary exist; no full profile menu. |

## `/` — dashboard and operating board

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| D-01 | Total lead/contact KPI | Implemented | Real | Today and Insights derive counts from the contact repository. |
| D-02 | Conversion rate | Partial | Absent | Omnix refuses conversion without transaction/event truth. |
| D-03 | Active conversations, appointments, revenue and response-time KPIs | Simulated/static | Absent | Intentionally omitted because the reference values are fixed and Omnix lacks those sources. |
| D-04 | Multi-column relationship pipeline | Implemented | Real | `/pipeline` groups every stored contact by canonical stage. |
| D-05 | Persist stage from a selector | Implemented | Real | Contact edit persists the source stage. |
| D-06 | Drag-and-drop stage persistence | Implemented | Partial | Omnix keeps the board read-only; stage changes use the source record. |
| D-07 | View and edit a lead/contact | Implemented | Real | `/contacts/[id]` and `/contacts/[id]/edit`. |
| D-08 | Delete from the dashboard drawer | Partial | Absent | Reference drawer deletion is local-only; Omnix has no safe archive/delete yet. |
| D-09 | Call through provider | Partial | Partial | `tel:` handoff works; no provider, consent record or receipt. |
| D-10 | SMS through provider | Partial | Partial | `sms:` handoff works; no Twilio history, STOP or delivery receipt. |
| D-11 | Email send, history and drafts | Partial | Partial | `mailto:` works; direct send, history and drafts are absent. |
| D-12 | Configurable AI agent selection and ask/automate modes | Partial | Partial | `/omnix` provides deterministic recommendations; no model or autonomous action. |
| D-13 | Add a new lead from a pipeline column | Partial | Real | `/contacts/new` creates a record without the reference board-visibility inconsistency. |
| D-14 | Activity board with open/done/deleted states | Partial | Partial | Notes, touch timestamps and next-touch are real; no unified task/activity board. |
| D-15 | Generate nurturing activities for leads | Partial | Absent | No sequence generator or job processor. |
| D-16 | Activity search, day/status filters and bulk actions | Implemented | Absent | Requires a real activity/task domain first. |
| D-17 | Person/group grouping and custom group creation | Simulated/static | Absent | Reference controls show a coming-soon outcome. |
| D-18 | View a generated outreach draft | Partial | Absent | Governed drafts are not implemented. |
| D-19 | Send an activity draft | Simulated/static | Absent | Reference can mark complete without provider send; Omnix does not claim this. |

## `/leads` — records, filters, import and communications

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| L-01 | List and refresh leads | Implemented | Real | `/contacts` is repository-backed. |
| L-02 | Search identity, contact, location and business fields | Implemented | Partial | Name, phone, email, city, ZIP and tags are searchable; budget and broad custom fields are not. |
| L-03 | Quick filters for call/show/new/hot segments | Partial | Partial | Today has real triage; the named preset family is absent. |
| L-04 | Temperature filter | Implemented | Real | Hot, Warm and Nurture are canonical and URL-backed. |
| L-05 | Budget range filter | Implemented | Absent | Buyer price fields exist, but no list filter. |
| L-06 | Timeline urgency filter | Implemented | Partial | Timeline and next-touch exist, without an urgency filter control. |
| L-07 | Advanced location/property/source filters | Implemented | Partial | Location/tags and lead type are partly covered; property/source facets are absent. |
| L-08 | Clear current filters | Implemented | Real | Current Contact filters can be cleared deterministically. |
| L-09 | Create/edit/apply/delete filter templates with operators | Partial | Absent | High-value gap: server-persisted Smart Lists. |
| L-10 | Dense lead table with activity counters and dashboard flag | Partial | Partial | Cards/details are real; no activity counters or secondary dashboard flag. |
| L-11 | Add lead/contact | Implemented | Real | `/contacts/new`. |
| L-12 | View, edit and delete | Implemented | Partial | View/edit are real; archive/delete is absent. |
| L-13 | Add/remove from a separate dashboard subset | Implemented | Absent | Omnix keeps one source of truth and no parallel board flag. |
| L-14 | Call and SMS actions | Partial | Partial | Native device handoffs only. |
| L-15 | Email and draft badge | Partial | Partial | Native compose only; no draft count. |
| L-16 | AI nurturing action per lead | Partial | Partial | Cadence and next-best attention are deterministic; no model sequence. |
| L-17 | Download sample CSV/XLSX | Implemented | Absent | Omnix documents import format but does not generate sample files. |
| L-18 | Import CSV/XLS/XLSX | Implemented | Partial | CSV and vCard are real; XLS/XLSX is absent. |
| L-19 | Automatic and editable column mapping | Implemented | Partial | Provider presets and aliases exist; arbitrary mapping UI is absent. |
| L-20 | Default stage during import | Implemented | Real | Import engine applies explicit safe defaults. |
| L-21 | Import preview and result breakdown | Implemented | Real | Full preview/merge plan plus created, updated, skipped, rejected and notes-added outcomes. |
| L-22 | Google Drive/Sheets import | Simulated/static | Absent | No false connect/import control is shown. |
| L-23 | Rich lead identity with multiple phones/emails | Implemented | Partial | Preferred name, two phones and one email exist; richer household/contact points are a gap. |
| L-24 | Address, source, rating, type and tags | Implemented | Partial | Address/source/type/tags are real; no independent rating. |
| L-25 | Buyer financial/property/household fields | Implemented | Partial | Price, areas, beds, baths, timeline, pre-approval and lender exist; spouse/mortgage/property tenure/type are incomplete. |
| L-26 | Seller property facts | Implemented | Partial | Address, price, timeline and motivation exist; detailed listing facts are absent. |
| L-27 | Secondary lead types, assignments and custom fields | Partial | Absent | Household, associated-agent assignments and custom schema are not implemented. |
| L-28 | Email draft list/compose/send/delete/history | Partial | Absent | Requires Gmail or email-provider story with approvals and receipts. |
| L-29 | Email templates, tone, provider and AI draft | Partial | Absent | No direct email composer or model. |
| L-30 | Start/pause/resume/snooze/stop nurturing | Partial | Partial | Cadence dates are real; durable sequences, scheduler and provider delivery are absent. |

## `/partial-leads` — incomplete-record review

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| P-01 | List/refresh incomplete leads | Implemented | Absent | Secure intake exists, but no realtor-facing quarantine inbox. |
| P-02 | Search incomplete records | Implemented | Absent | Depends on the inbox domain. |
| P-03 | Inspect status/contact/business/timeline/notes | Implemented | Absent | No partial-record entity or review view. |
| P-04 | Convert incomplete record to a full lead | Implemented | Absent | High-value gap for webhooks and messy imports. |
| P-05 | Remove an incomplete record | Partial | Absent | Must be implemented as safe archive/delete with tenant enforcement. |

## `/agents` — agent catalog and automation

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| A-01 | Catalog of six named agents | Partial | Absent | Omnix does not reproduce decorative agent cards. |
| A-02 | Orchestrator | Partial | Absent | `/omnix` is a read-only recommendation surface, not an orchestrator. |
| A-03 | AI lead generator | Partial | Absent | Scraping/Apify path is not ported due provenance, consent and terms risks. |
| A-04 | AI lead nurturing | Partial | Partial | Deterministic cadence exists; generation/delivery does not. |
| A-05 | Customer service agent | Absent | Absent | Reference route lacks an effective processor. |
| A-06 | Onboarding and call-analysis agents | Simulated/static | Absent | No processor exists in the reference; no value to reproduce. |
| A-07 | Start/stop live agent stream | Simulated/static | Absent | Reference injects artificial activity; Omnix refuses simulated operations. |
| A-08 | Activity stream for runs/events/tasks | Partial | Absent | Requires durable job/event infrastructure. |
| A-09 | Approval queue approve/edit/reject | Partial | Absent | Reference status changes do not reliably execute action; Omnix needs governed execution first. |
| A-10 | Provider/model/tone/prompt/rule configuration | Partial | Absent | No LLM provider is connected. |
| A-11 | Auto-approval/validation/dedupe/escalation settings | Partial | Absent | No governed automation engine exists. |
| A-12 | Outreach templates | Partial | Absent | Requires communication and approval domains. |
| A-13 | View agent logs | Simulated/static | Absent | Reference control has no effective action. |
| A-14 | Test agent configurations | Partial | Absent | Reference test output is not rendered consistently; Omnix has no model path. |
| A-15 | Run lead generation with progress/retry | Partial | Absent | Not ported without licensed source, durable jobs and consent model. |

## `/analytics`

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| N-01 | Active lead/contact count | Implemented | Real | `/insights` derives current contact counts. |
| N-02 | Agents working/tasks/response time/uptime/daily goal | Simulated/static | Absent | Fixed metrics are intentionally omitted. |
| N-03 | Website visitor funnel | Simulated/static | Absent | No analytics provider/source. |
| N-04 | Generated/contacted/appointment/onboarded/closed funnel | Partial | Partial | Stored pipeline counts are real; event conversion funnel is absent. |
| N-05 | Conversion insight narratives and percentages | Simulated/static | Absent | No invented conversion story. |
| N-06 | Lead quality, funnel time and best source | Simulated/static | Partial | Source counts are real; quality and duration require event history. |

## `/data`

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| I-01 | Drag-and-drop upload | Simulated/static | Real | `/contacts/import` accepts real file input. |
| I-02 | Preview and start import | Simulated/static | Real | Server preview and commit paths are real. |
| I-03 | Import history | Simulated/static | Partial | Each execution has real results; no durable cross-run history view. |
| I-04 | Manual-upload data source | Simulated/static | Real | CSV/vCard import. |
| I-05 | Skip duplicates | Simulated/static | Real | Conservative identity merge and idempotent replay. |
| I-06 | Auto-assign agent | Simulated/static | Absent | Shared workspace/assignment domain is not implemented. |
| I-07 | Send welcome email on import | Simulated/static | Absent | No direct email provider or automatic outbound send. |
| I-08 | Default lead stage | Simulated/static | Real | Engine default is operational. |
| I-09 | Quick import statistics | Simulated/static | Real | Execution results are real; no fixed dashboard numbers. |
| I-10 | Export | Absent | Absent | Export remains a separate gap. |

## `/agent-config`

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| G-01 | Select among agents | Simulated/static | Absent | Reference selection does not change effective configuration. |
| G-02 | Behavior/model/performance/automation/analytics tabs | Simulated/static | Absent | Most reference tabs are empty or local-only. |
| G-03 | System prompt editing | Simulated/static | Absent | No provider/model story exists. |
| G-04 | Copy/reset prompt | Simulated/static | Absent | No effective handler in the reference. |
| G-05 | Restart/clone/view logs | Simulated/static | Absent | No effective handler in the reference. |
| G-06 | Provider/model selection | Simulated/static | Absent | No effective persistence on this route. |
| G-07 | Save configuration | Simulated/static | Absent | No effective handler; not a parity target. |

## `/settings` — providers, webhooks and keys

| ID | Option or capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| S-01 | Store OpenAI/Anthropic/Gemini keys | Partial | Absent | Reference exposes/stores secrets unsafely; Omnix has no model connection. |
| S-02 | Enable Facebook/Instagram lead ads | Partial | Absent | `/connections` truthfully marks Meta gated; no webhook/Graph implementation. |
| S-03 | Meta webhook URL/token copy | Partial | Absent | Requires server-issued secrets and verified webhook ownership. |
| S-04 | Meta activity counters | Partial | Absent | No Meta event source. |
| S-05 | Enable generic webhook | Partial | Partial | `/api/intake/contacts` is real and authenticated; no settings toggle/stats UI. |
| S-06 | Generic webhook URL/stats | Partial | Partial | Endpoint is real; operational status UI is absent. |
| S-07 | Twilio credentials and phone settings | Partial | Absent | `/connections` marks texting gated; secrets must remain server-only. |
| S-08 | SendGrid key/sender/status | Partial | Absent | No direct email provider. |
| S-09 | SMTP/Gmail app-password settings | Simulated/static | Absent | Reference has no SMTP sender or Gmail OAuth; Omnix does not repeat this claim. |
| S-10 | API key view/copy/regenerate | Partial | Absent | Intake uses server configuration; no user key-management surface. |
| S-11 | External lead CRUD/search/status documentation | Partial | Partial | Owner-bound idempotent create intake exists; broad external CRUD does not. |
| S-12 | Save provider settings | Partial | Absent | No encrypted connector/token vault or live connector story. |

## Backend capabilities without a primary route

| ID | Capability | Reference | Omnix | Omnix evidence or gap |
|---|---|---|---|---|
| B-01 | Signup/login/refresh/logout/me | Partial | Real | Supabase OAuth, cookie-backed server session and middleware. |
| B-02 | Shared demo account with known credentials | Implemented | Absent | Intentionally rejected; sample mode is labeled and passwordless. |
| B-03 | Health endpoint | Implemented | Absent | Explicit readiness/health endpoint is a remaining ops gap. |
| B-04 | External lead create/update/search/status/get | Partial | Partial | Secure owner-bound intake create/upsert only. |
| B-05 | Multipart CSV backend import | Implemented | Real | Import engine, CLI and workspace are operational. |
| B-06 | Streaming AI chat | Partial | Absent | No LLM provider connected. |
| B-07 | Twilio voice/TwiML/WebRTC endpoints | Partial | Absent | Carrier/compliance/provider work is gated. |
| B-08 | Email history/draft/send endpoints | Partial | Absent | Gmail/email connector not implemented. |
| B-09 | Facebook webhook | Partial | Absent | No signed webhook or Graph retrieval. |
| B-10 | Generic webhook/lead intake | Partial | Real | Omnix intake is bearer-authenticated, owner-bound, idempotent and fail-closed. |
| B-11 | Lead-generation audit/test logs | Partial | Absent | No lead-generation provider/job domain. |
| B-12 | Orchestrator/direct agent processors | Partial | Absent | No governed model capability broker. |
| B-13 | Nurturing reply analysis | Partial | Absent | No inbound communication channel. |
| B-14 | Draft/activity synchronization | Partial | Absent | No communication timeline/job receipts. |
| B-15 | Nurturing run/inbound/tick/status/stream service | Partial | Partial | Cadence rules are real; service, consent and delivery are absent. |
| B-16 | Lead-generation run/status/stream service | Partial | Absent | Not ported due provenance and durable-job requirements. |
| B-17 | In-process scheduler | Partial | Absent | Omnix requires a durable idempotent queue rather than an in-process timer. |

## What Omnix already does better

1. **Truthful metrics:** Insights omit revenue, conversions and agent performance until there is a verified source.
2. **Safer intake:** imports and API intake are owner-bound, conservative, idempotent and fail closed.
3. **No pretend integration:** provider cards disclose building/gated status; no password or secret form is presented as a connection.
4. **Explainable prioritization:** Today and Omnix Intelligence cite contact facts instead of injecting random activity.
5. **Realtor-specific mail operations:** physical-mail campaign history and address eligibility are real; the reference does not provide this workflow.
6. **Responsive/accessibility foundation:** 390px containment, 44px controls, keyboard focus, reduced motion and both themes are project gates.

## Useful remaining gaps, in delivery order

1. Shared realtor/assistant workspace, roles and RLS.
2. Real Supabase/Google identity production configuration and real-data UAT.
3. Server-persisted Smart Lists and advanced filters.
4. Incomplete-record review inbox for intake/import/webhook quarantine.
5. Richer household/contact schema and safe archive/delete.
6. Unified activity timeline plus tasks/follow-ups.
7. XLSX import and governed export if confirmed by the realtor.
8. Mailchimp bidirectional audience/tag/signup/unsubscribe sync.
9. Gmail and Google Calendar with incremental OAuth, receipts and reconciliation.
10. Texting/voice after registration, consent ledger, STOP, quiet hours and verified webhooks.
11. Durable jobs, retries, locks, idempotency and observable receipts.
12. Governed AI summaries/drafts/next-best action with sources, human approval and compliance checks.

## Explicit non-targets

Omnix will not reproduce static `/data` or `/agent-config` controls, fixed analytics, fake agent streams, random approvals, shared demo credentials, plaintext provider secrets, Gmail-via-app-password claims, unsigned Meta webhooks, ungoverned scraping or an activity “send” action that only changes local status.

## Reference links

- [Reference route registry](https://github.com/AnilBotta/realtorspal-ai/blob/c7ca185fe6ce3ec4cfa87f18ae398ad382715c82/frontend/src/App.js#L101-L108)
- [Reference frontend API boundary](https://github.com/AnilBotta/realtorspal-ai/blob/c7ca185fe6ce3ec4cfa87f18ae398ad382715c82/frontend/src/api.js)
- [Reference backend registry](https://github.com/AnilBotta/realtorspal-ai/blob/c7ca185fe6ce3ec4cfa87f18ae398ad382715c82/backend/server.py)

