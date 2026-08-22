# Realtor Requirements Coverage

**Audit date:** 2026-08-11  
**Owner:** @pm (Janus)  
**Status:** Active product traceability baseline  
**Primary source:** Realtor questionnaire answers supplied by Paulo on 2026-08-11  
**Supporting sources:** `requirements-analysis-v2.md`, Stories 1.1–1.4, local production build and browser review

## Purpose

This document prevents a client answer from disappearing between discovery, stories, and implementation. It records what is complete, what is only partially wired, what is missing, and what is deliberately deferred. A polished demo is not treated as production evidence.

## Status definitions

- **Implemented:** present in domain/application/UI with executable evidence.
- **Partial:** a safe foundation or manual path exists, but the stated client outcome is not complete.
- **Missing:** no implementation currently delivers the stated outcome.
- **Deferred:** intentionally outside the current phase because the client has not defined the workflow or an external gate applies.

## Requirement coverage matrix

| ID | Realtor need | Status | Current evidence | Remaining work / boundary |
|---|---|---|---|---|
| RQ-01 | Manage roughly 200–500 contacts from phone, spreadsheet, and Mailchimp | Partial | CSV/vCard importer, Apple/Google/Mailchimp/BoldTrail presets, server preview, conservative merge, bounded CLI/UI search and temperature filter | Validate with real exports. Direct account connectors are not implemented. |
| RQ-02 | Capture cold calls, open houses, referrals, social media, and website leads | Partial | Lead-source model and form cover every named source. Authenticated JSON intake accepts website/platform pushes. | Wire each real website/platform to the intake endpoint. Social DM account integration remains deferred. |
| RQ-03 | Hot and Warm weekly; Nurture monthly | Implemented | Cadence engine uses 7/7/30 days and tests its scheduling rules. | Confirm the live timezone and validate the rhythm with the realtor during UAT. |
| RQ-04 | Automatically schedule the next follow-up but allow manual adjustment | Implemented | Record-touch command schedules the next date; manual override is preserved until used. | Add Calendar synchronization in Phase 2. |
| RQ-05 | Organize people Hot → Warm → Nurture so immediate attention is obvious | Implemented | Today triage, Contacts grouping, overdue/first-contact/due-today prioritization, search and temperature filter. | Validate terminology and result speed with the realtor during UAT. |
| RQ-06 | Keep simple, timestamped contact notes | Implemented | Append-only notes on the contact record with server validation and persistence boundary. | Import the real BoldTrail notes if access still exists. |
| RQ-07 | One-click Gmail compose | Implemented | Contact cards/details expose `mailto:` actions. | None for the Phase 1 outcome. |
| RQ-08 | Show sent/received Gmail messages on the contact record | Missing | Connections labels Gmail as being built. | Phase 2: Google restricted scopes, token lifecycle, message matching, privacy and integration tests. |
| RQ-09 | Write and send email inside the CRM | Missing | No Gmail send command or UI exists. | Phase 2: incremental OAuth scope, compose/send flow, failure receipts and audit trail. |
| RQ-10 | Convert lead emails into contacts | Deferred | Generic secure JSON intake exists, but no Gmail lead parser exists. | Client lead sources are mainly calls/texts/DMs; keep deferred unless real lead-email evidence appears. |
| RQ-11 | Use one combined Mailchimp audience | Partial | Mailchimp exports import safely and subscription state is modeled. | Select/configure the real audience and establish a live source-of-truth contract. |
| RQ-12 | Carry Hot/Warm/Nurture into Mailchimp as tags | Missing | Tags exist in CRM/import domain only. | Phase 1 closure: CRM → Mailchimp synchronization with deterministic tag mapping and loop prevention. |
| RQ-13 | Bring Mailchimp signups into CRM | Missing | JSON intake could receive a normalized push, but no Mailchimp webhook is wired. | Implement signed webhook intake, audience/member identity mapping and idempotent upsert. |
| RQ-14 | Reflect Mailchimp unsubscribes in CRM | Missing | `emailSubscribed` is modeled and import-safe; no live webhook exists. | Implement unsubscribe-in webhook before calling Mailchimp integration complete. |
| RQ-15 | Track several printed postcard campaigns per contact with sent date | Implemented | Named campaigns, complete-address readiness, eligibility-aware summaries, per-contact sent date, historical safety, CLI and UI tests. | Validate real mailing addresses and campaign history during migration UAT. |
| RQ-16 | Use mainly on laptop, occasionally on phone for quick lookup | Implemented | Desktop and 390 px layouts pass without overflow; bounded search/filter and Call/Text/Email remain immediately reachable. | Validate on the realtor's actual laptop and phone during UAT. |
| RQ-17 | Track past clients, birthdays and home-purchase anniversaries | Implemented | Relationship model, important dates and Today reminders are implemented. | Validate imported date quality with real data. |
| RQ-18 | Track stages such as under contract and closed | Implemented | Pipeline stages exist in domain, forms, lists and database schema. | Phase 4 financial transaction records must remain separate from the contact stage. |
| RQ-19 | Track deals, volume, sales and profit/loss | Missing | No transaction or finance entities exist. | Phase 4 discovery: inspect the realtor's current spreadsheet before specifying calculations. |
| RQ-20 | Text from the CRM and keep records together | Partial | `sms:` quick actions open the device messaging app. | Phase 3: start 10DLC/TCPA work, then implement consent, quiet hours, opt-out and message history. |
| RQ-21 | Show follow-up tasks in Google Calendar | Missing | Connections labels Calendar as being built. | Phase 2: incremental OAuth, event ownership, update/delete reconciliation and error recovery. |
| RQ-22 | Allow an assistant to use the CRM | Missing | Current RLS is single-owner. A second signed-in user would receive a separate workspace. | Phase 1 closure: shared workspace, invitation, roles, permissions, RLS matrix and cross-user audit tests. |
| RQ-23 | Website form submissions become contacts automatically | Partial | Authenticated, owner-bound, idempotent JSON intake is implemented and fail-closed. | Connect the separate website project and configure live secrets/owner binding. |
| RQ-24 | One-click sign-in with minimal prompts | Partial | Google sign-in flow and middleware exist. | Provision Supabase/Google OAuth, configure production redirects and test realtor plus assistant accounts. |
| RQ-25 | Avoid generic email-campaign tooling and unnecessary paid clutter | Implemented | Physical mailers are distinct; Mailchimp remains the email campaign tool; UI exposes only current workflows. | Keep future modules phase-gated and show recurring third-party costs before activation. |
| RQ-26 | Preserve Facebook/Instagram context or automate DMs | Deferred | Social media is retained as a lead source; no unsupported account connection is claimed. | Do not build until the realtor defines the desired workflow and Meta review requirements are accepted. |

## Browser findings from the current build

1. **Daily triage is aligned with the core pain.** The first screen answers who needs attention now and preserves Hot-first ordering.
2. **Mobile lookup is structurally sound.** The 390 px Contacts and contact-detail routes have no horizontal overflow and expose Call, Text, Email, notes and follow-up actions.
3. **Contact retrieval now scales to the stated working set.** Search covers name, phone, email, city, ZIP and tags; a Hot/Warm/Nurture filter persists in the URL.
4. **Physical-mail eligibility is explicit.** Incomplete addresses show their missing fields, cannot be newly marked sent, and do not inflate deliverable totals; historical sends remain visible.
5. **Connections now preserves the evidence boundary.** Gmail and Calendar disclose scopes, provider verification, production configuration and assistant-access work.
6. **The running application is demonstrably sample mode.** The page correctly states that the database is not connected and changes are not durable.

## Delivery roadmap derived from the questionnaire

### Phase 1 launch closure — required before daily live use

1. **Completed locally:** contact search, quick retrieval and physical-mail address readiness (Story 1.5 PASS). Live-data UAT remains below.
2. Live Supabase project, migrations, Google sign-in, production environment and rollback evidence.
3. Shared realtor/assistant workspace with the approved permission policy.
4. Mailchimp live synchronization: CRM tags out, signups/unsubscribes in.
5. Real-data migration rehearsal, duplicate review and realtor acceptance.
6. Automated browser/accessibility/RLS regression, monitoring and backup/restore rehearsal.

### Phase 2 — Gmail and Calendar

1. Gmail send from CRM.
2. Gmail activity on contact records.
3. Google Calendar synchronization for follow-up tasks.
4. Reassess Gmail lead parsing only if a real email-based lead source exists.

### Phase 3 — texting and website activation

1. Start 10DLC registration before implementation completion.
2. Add consent, opt-out, quiet-hours and conversation history.
3. Wire the separate website form to the already implemented intake endpoint.

### Phase 4 — transactions and business performance

1. Observe the realtor's current deal/P&L process.
2. Define transactions, commission, volume, expenses and reporting without turning contact stages into accounting records.

### Explicitly deferred

- Instagram/Facebook DM ingestion until the realtor defines the job-to-be-done.
- Generic email campaign builder; Mailchimp remains the campaign system.
- Gmail lead parsing without evidence of an email-based lead stream.

## Definition of complete

The CRM may be called ready for the realtor only when Phase 1 launch-closure items have persisted evidence, real accounts and real-data UAT. Local tests or a visually complete sample mode do not establish production readiness. Later phases may remain incomplete if they are visibly labelled and do not create false claims in the launched product.
