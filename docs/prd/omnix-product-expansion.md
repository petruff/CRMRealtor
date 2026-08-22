# Omnix Product Expansion

**Date:** 2026-08-11  
**Owner:** @pm (Janus)  
**Status:** Active clean-room roadmap  
**Product:** Omnix — Powered by Cyryx Labs

## Product decision

The existing realtor CRM becomes **Omnix**. The current Apple-inspired design system, fast daily triage, contact history, import, physical mail and honest integration boundaries remain the foundation. The product grows additively into an explainable real-estate operating workspace for a realtor and assistant.

The referenced `AnilBotta/realtorspal-ai` repository is marked **Proprietary** and has no open-source license file. Its implementation, assets and branding must not be copied or rebranded without rights-holder permission. Omnix uses only a clean-room capability inventory and independently designed code.

## Clean-room capability inventory

| Capability observed in the reference | Omnix baseline | Decision |
|---|---|---|
| Lead/contact records and pipeline | Contact domain and stages exist | Add a dedicated pipeline workspace over the existing source of truth. |
| Activity board and due work | Today triage is stronger and client-specific | Preserve Today; add explainable Omnix recommendations rather than a generic activity feed. |
| Global filtering and saved filters | Bounded contact search exists | Add saved views only after real usage proves repeated segments. |
| Analytics | Not yet exposed | Add truthful contact, source, pipeline and data-readiness insights; no invented revenue. |
| AI agents and drafted outreach | No governed AI capability exists | Start read-only and explainable. External actions require explicit approval, scope and receipts. |
| Email/SMS/voice | Device fallbacks exist; providers are not connected | Implement through bounded connectors, never by collecting platform passwords. |
| Calendar | Follow-up dates exist; Google sync is absent | Keep Omnix as follow-up authority; add idempotent Google event reconciliation in a later connector story. |
| Lead generation/scraping | Secure website intake exists | Do not copy or enable ungoverned scraping. Use licensed data sources and explicit provenance only. |
| Custom fields and extensive forms | Client-specific buyer/seller data already exists | Prefer typed real-estate fields; add custom fields only for evidenced gaps. |
| Listings and transactions | No entities yet | Create separate bounded contexts; do not turn contact pipeline stages into accounting records. |

## Connector operating model

Omnix must **never capture or store the user's Gmail, Google, Mailchimp, Twilio, Instagram or Facebook password**.

1. The user selects **Connect** inside Omnix.
2. Omnix redirects to the provider's OAuth/authorization surface.
3. The provider authenticates the user and returns a short-lived authorization code.
4. The Omnix server exchanges the code, encrypts tokens at rest, records account identity and granted scopes, and never exposes refresh tokens to the browser.
5. Webhooks and scheduled reconciliation import remote changes idempotently.
6. Every outbound action records intent, approval, provider receipt, delivery state and retry/reconciliation result.
7. Disconnect revokes provider access where supported and removes local tokens without deleting CRM history.

### Provider boundaries

- **Gmail + Google Calendar:** one Google account connection may share consent, but scopes remain incremental. Gmail read/send and Calendar event scopes are distinct; production verification, privacy disclosures and realtor/assistant ownership must be tested.
- **Mailchimp:** OAuth connects the selected audience. Omnix sends temperature tags out and receives signups/unsubscribes through signed webhooks with loop prevention.
- **Texting/voice:** Twilio or another provider uses Omnix-owned service credentials, not a consumer login. US messaging requires registration, consent, opt-out, quiet hours and delivery receipts.
- **Instagram/Facebook:** Meta Business Login authorizes eligible business assets. App review, permissions, webhook verification, conversation-window rules and human escalation apply; personal-account password capture is forbidden.

## Omnix differentiation

The highest-value whitespace is not another generic chatbot. It is a governed **Relationship and Transaction Memory** that makes the realtor more reliable:

1. **Explainable next-best action:** why a person needs attention, the evidence used, and a direct safe action.
2. **Relationship continuity:** referrals, household links, promises, birthdays, homeaversaries and unresolved questions across every channel.
3. **Deal deadline radar:** contract milestones, dependencies and missing documents with human confirmation before client-facing action.
4. **Property-to-person matching:** natural-language buyer needs matched to licensed listing data, with every claim traceable to source fields.
5. **Client transparency timeline:** an optional shareable view of milestones and agent work, without exposing private CRM notes.
6. **AI confidence and compliance controls:** sources, uncertainty, Fair Housing checks, approval gates and immutable action receipts.

This direction is supported by current industry evidence: agents primarily adopt technology to save time and improve client experience, while accuracy, compliance, market-data interpretation and Fair Housing remain leading AI concerns.

## Delivery sequence

### Wave 1 — Omnix foundation

- Complete product rebrand and Cyryx Labs attribution.
- Add scalable navigation and mobile discovery without removing current routes.
- Add Pipeline, Insights and Omnix Intelligence using existing real data.
- Add pure/tested CLI-first intelligence and explicit “no model connected” disclosure.

### Wave 2 — Production workspace

- Live Supabase, shared realtor/assistant workspace, roles and RLS.
- Mailchimp bidirectional sync and real-data migration/UAT.
- Monitoring, backups, browser/RLS/accessibility automation.

### Wave 3 — Communications and calendar

- Google OAuth, Gmail activity/send and Calendar reconciliation.
- Communications timeline and provider receipts.
- SMS/voice after registration, consent and compliance controls.

### Wave 4 — Listings, transactions and governed AI

- Listings with licensed data provenance.
- Separate deals/transactions, commission, expenses and P&L after spreadsheet discovery.
- AI summaries, drafting, matching and deadline radar behind approval and audit boundaries.

## Definition of complete

Omnix branding is complete when no shipped UI, metadata or package identity uses the former product name. A connector is complete only with real account authorization, token lifecycle, webhook/reconciliation evidence, negative-path tests and disconnect/revocation proof. A local preview or a “Connect” card is never sufficient.

## Current industry sources

- [NAR 2025 REALTORS Technology Survey](https://cms.nar.realtor/sites/default/files/2025-10/2025-realtors-technology-survey-report-10-06-2025_1.pdf)
- [NAR: You have tried AI, but can you trust it?](https://www.nar.realtor/news/real-estate-news/technology/youve-tried-ai-but-can-you-trust-it)
- [NAR: Artificial Intelligence in Real Estate](https://www.nar.realtor/artificial-intelligence-real-estate)
