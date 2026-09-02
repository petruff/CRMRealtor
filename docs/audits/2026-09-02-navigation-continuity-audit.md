# Omnix Navigation Continuity Audit — 2026-09-02

## Decision

Omnix uses three complementary navigation layers:

1. **Global navigation** for independent command centers.
2. **Parent navigation** for nested records, editors, review queues, and tools.
3. **Sequential navigation** only when the user is moving through an ordered set or a paginated result.

This avoids a misleading “Next” button between unrelated modules while keeping every real workflow recoverable.

## Route Matrix

| Route | Role | Required navigation |
| --- | --- | --- |
| `/` | Today command center | Global navigation; contextual links to records and queues |
| `/activities` | Task list | Global navigation; URL-preserving filters |
| `/alerts` | Attention queue | Global navigation; record actions |
| `/approvals` | Approval inbox | Global navigation; evidence and record actions |
| `/campaigns` | Ordered campaign results | Global navigation; Previous/Next pagination with boundaries |
| `/connections` | Provider setup | Global navigation; provider actions and related review links |
| `/contacts` | Contact collection | Global navigation; scoped tabs, filters, and Previous/Next pagination |
| `/contacts/[id]` | Contact record | Back to originating contact view; Previous/Next within the preserved scope |
| `/contacts/[id]/edit` | Contact editor | Back to the contact; Previous/Next scope; Cancel; Save and review next |
| `/contacts/new` | Contact creation | Back/Cancel to Contacts |
| `/contacts/import` | Import workflow | Parent navigation to Data tools; step controls inside the importer |
| `/contacts/incomplete` | Intake review queue | Parent navigation to Contacts; record workflow actions |
| `/data` | Data tools hub | Global navigation; links to import, templates, backups, and duplicates |
| `/data/duplicates` | Duplicate review | Parent navigation to Data tools; links to candidate contacts |
| `/insights` | Analytics command center | Global navigation; drill-down Previous/Next only inside ordered contributor results |
| `/mailers` | Mailer operations | Global navigation; contact and campaign actions |
| `/nurture` | Nurture operations | Global navigation; links to contacts and approvals |
| `/omnix` | AI command center | Global navigation; cited destination actions |
| `/pipeline` | Pipeline board | Global navigation; direct contact actions |
| `/properties` | Property workspace | Global navigation; linked contact and transaction actions |
| `/settings` | Settings | Global navigation; anchored sections |
| `/transactions` | Transaction workspace | Global navigation; link to affordability studio |
| `/transactions/scenarios` | Affordability studio | Parent navigation to Transactions |
| `/workspace` | Workspace selector | Global navigation; explicit workspace destinations |
| `/welcome` | Public landing page | Public header navigation and Sign in |
| `/login` | Authentication | Back to the public story and explicit sign-in action |
| `/offline` | Recovery state | Retry to Today |

## Findings

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | Connections was missing from the mobile utility menu. | Add the same destination exposed by the desktop rail. |
| P1 | Nested pages did not share a persistent mobile-header return control. | Resolve deterministic parent routes in the shared shell. |
| P2 | Nested route titles inherited broad section names in the mobile header. | Expose route-specific labels such as Edit contact and Duplicate review. |
| P2 | Campaign pagination omitted an explicit disabled Previous boundary. | Normalize both boundaries and add `rel` semantics. |
| Correct | Contact detail/edit already preserve filtered scope and provide Previous/Next record navigation. | Retain and cover with regression tests. |
| Correct | Top-level pages do not form one linear sequence. | Keep global navigation instead of artificial Back/Next controls. |
