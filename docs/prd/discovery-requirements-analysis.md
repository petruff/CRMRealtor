# Omnix — Requirements Discovery & Gap Analysis

> ⚠️ **SUPERSEDED 2026-08-10 by `requirements-analysis-v2.md`.** The client answered the questionnaire; four of five blockers are resolved and the scope roughly doubled. Kept for the traceability matrix (§2) and the audit trail of what we did *not* know at the outset. **BLOCKER-01 (Boldtrail export) is the one item here still unanswered.**

**Status:** DISCOVERY — NOT a PRD. No spec may be written until the blocking questions below are answered.
**Owner:** @pm (Janus)
**Date:** 2026-08-07
**Source:** Single inbound email from the client (verbatim, quoted below)
**Constitutional note:** Article IV (No Invention). Every FR/NFR traces to a client quote. Untraceable items are recorded as QUESTIONS, not requirements.

---

## 1. Source material

The entire requirements basis is **one informal email**. That is the single most important fact in this document. We have:

- No interview
- No observation of her current workflow
- No sight of her existing contact data
- No stated budget, timeline, or volume
- No confirmation she wants custom software at all

Anything resembling a complete PRD produced from this email would be invention.

---

## 2. Traceability matrix — explicit requirements

Only requirements with a direct quote are listed. `Confidence` reflects how unambiguous the quote is.

| ID | Requirement | Client quote (verbatim) | Confidence |
|----|-------------|------------------------|------------|
| FR-01 | Create/store contacts with contact information | "contacts can be added with their information" | HIGH (intent) / LOW (which fields) |
| FR-02 | Store a birthdate per contact | "birthdates" | HIGH |
| FR-03 | Store notes per contact | "notes" | HIGH (intent) / LOW (structure) |
| FR-04 | Tasks representing a future outreach action | "tasks such as when I need to reach out to them again" | HIGH |
| FR-05 | Outreach timing derives from lead type | "...to reach out to them again **based on lead type**" | HIGH (intent) / **NONE (the actual intervals)** |
| FR-06 | Three lead types: Hot, Warm, Nurture | "There are three lead types Hot, Warm and Nurture" | HIGH |
| FR-07 | Sync contacts CRM ↔ Mailchimp, eliminating manual entry | "I have to manually add contacts to it, so if the contacts could just merge between the CRM and mailchimp" | HIGH (intent) / LOW (direction, scope) |
| NFR-01 | Simplicity is a first-class constraint | "I just want something super simple lol" | HIGH |
| NFR-02 | Daily-use reliability | "I used to use it on a daily basis" | MEDIUM (inferred from usage pattern) |

### Explicitly tentative — NOT yet requirements

These were phrased as wishes, not needs. Treating them as committed scope is the most likely way this project bloats.

| ID | Item | Quote | Note |
|----|------|-------|------|
| WISH-01 | Social media linkage | "**If** it can be linked to social media that **would be great**" | Conditional. Meaning of "linked" undefined. |
| WISH-02 | Mailers tab | "**or** create a tab for mailers that have been sent out?" | Offered as an *alternative* to WISH-01, not in addition. Note the "or". |
| WISH-03 | Gmail linkage | "Ohh linked to my gmail! That would be awesome!" | Highest enthusiasm, lowest specification. Afterthought phrasing. |

**Critical reading of WISH-01/02:** the word "or" means she may be offering two ideas and expecting *one*. We should not scope both.

### Context, not requirements

| Statement | What it actually tells us |
|-----------|---------------------------|
| "I no longer have a CRM, but I was using KvCore which is now Boldtrail. My brokerage used to provide it." | She **lost** a tool; she did not choose to leave it. Her data may still be locked in Boldtrail — and access may be expiring. See BLOCKER-01. |
| "I've heard FollowUp Boss is one of the best ones, but I've never tried it or know what the framework is like." | She is **actively considering buying an off-the-shelf product.** She has not decided to commission custom software. See §5. |

---

## 3. BLOCKING gaps — cannot proceed without answers

### BLOCKER-01 — Her existing data may be disappearing right now ⏰ URGENT

Brokerage-provided KvCore/Boldtrail access is typically revoked when an agent leaves or the brokerage stops paying. She says she "no longer has a CRM" — it is unclear whether she has *no login* or merely *no subscription of her own*.

**If she still has access, she should export her contacts today**, regardless of what we build. If access is already gone, her contact history may be unrecoverable, which changes the entire project (we would be starting from her phone contacts and Mailchimp audience).

This is time-sensitive and independent of every other decision. It goes out first.

### BLOCKER-02 — The cadence rules are entirely unspecified

FR-05 is the engine of the whole product, and we have zero data on it. "Based on lead type" tells us the *shape* of the rule, not the rule. We need her actual numbers:

- Hot → reach out every ___?
- Warm → every ___?
- Nurture → every ___?

Also undefined: when she completes a follow-up, does the next one schedule automatically, or does she set it manually each time? Auto-recurring vs. manual is a fundamentally different product.

### BLOCKER-03 — What "linked to my gmail" means

At least three incompatible interpretations, in ascending order of cost:

1. **Click-to-email** — a mailto link. Trivial.
2. **Email logging** — emails to/from a contact appear on their record. Requires Gmail read access.
3. **Send from CRM** — compose and send inside the app. Requires send access.
4. **Lead parsing** — Zillow/Realtor.com lead emails auto-create contacts. This is the highest-value possibility and she may not have articulated it.

**Technical constraint worth knowing before promising anything:** Gmail read/send are Google *restricted scopes*. A published app needs Google verification plus a third-party security assessment (recurring cost, thousands of dollars). A single-user app can stay in Testing mode with her added as a test user, which avoids this entirely — but that only works while it is genuinely one user, and Testing-mode refresh tokens have historically been short-lived. This is the single biggest feasibility risk in the request.

### BLOCKER-04 — Mailchimp sync direction and scope

"Merge" is ambiguous. Needed:

- Which Mailchimp audience?
- One-way (CRM → Mailchimp) or two-way?
- **Do unsubscribes flow back into the CRM?** If they do not, she risks contacting people who opted out — a CAN-SPAM exposure. This is a compliance question, not a convenience one.
- Should lead type map to Mailchimp tags/segments?

### BLOCKER-05 — Where are her contacts now, and how many?

Unknown source of truth: phone contacts, a spreadsheet, Boldtrail, or the Mailchimp audience itself. Unknown volume — 200 contacts and 5,000 contacts justify very different builds.

---

## 4. Requirements she did NOT mention (ask — do not assume)

These are standard for a working agent's CRM. Her silence is not evidence she does not need them; it is evidence the email was informal. Each is a question, not a proposed feature.

| # | Area | Why it matters | Risk if skipped |
|---|------|----------------|-----------------|
| Q-01 | **Lead source / intake** | Where do new leads come from — Zillow, Realtor.com, open houses, referrals, sphere? If leads arrive as emails, this reframes BLOCKER-03 entirely. | Manual entry remains her bottleneck; the core pain goes unfixed. |
| Q-02 | **Mobile access** | Agents work from cars and showings. She used the old tool daily. | A desktop-only tool will not be used daily. Likely fatal to adoption. |
| Q-03 | **Transaction / pipeline stages** | She named lead *temperature* but no deal stages (under contract, closed). | Past clients are the highest-value nurture segment. Possibly intentional under "super simple". |
| Q-04 | **SMS / texting** | Dominant channel in US real estate. | Also a TCPA compliance surface if added later. |
| Q-05 | **Calendar** | She wants Gmail; Google Calendar is adjacent and cheap to add. | Tasks that do not appear in her calendar get missed. |
| Q-06 | **Home purchase anniversary** | Standard realtor touchpoint ("homeaversary"), same mechanism as FR-02 birthdays. | Cheap to add now, awkward later. Suggest, do not assume. |
| Q-07 | **Solo or team?** | Assistant, partner, or transaction coordinator changes auth and data model. | Multi-user retrofits are expensive. |
| Q-08 | **Mailers — physical or email?** | Realtor "mailers" are usually printed postcards for neighborhood farming, not email. | Building an email-mailer tab when she means postcards = wrong product. |
| Q-09 | **Brokerage data-ownership rules** | Some brokerages claim ownership of client data and restrict where it is stored. | Legal/contractual exposure for her. |
| Q-10 | **Budget, timeline, who maintains it** | Custom software has ongoing hosting, API, and maintenance cost. | Unowned maintenance is how internal tools die. |

---

## 5. Build vs. buy — DECIDED

**Resolved 2026-08-07 (Paulo): custom build. Settled off-channel with the client.**

Not to be reopened with her, and deliberately absent from all client communication. Recorded here only so a future reader does not mistake the omission for an oversight — she named FollowUp Boss herself, and the obvious question was asked and answered.

The decision carries two consequences that remain live:

- **BLOCKER-03 (Gmail restricted scopes) is now ours to solve.** An off-the-shelf product would have arrived Google-verified. We do not get that, and it is the largest feasibility risk in §3.
- **Ongoing maintenance has no owner yet.** Hosting, API changes, and Google/Mailchimp deprecations outlive delivery. See §8.

---

## 6. Complexity assessment (AEXOS spec pipeline, 5 dimensions, 1–5)

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Scope | 3 | Contacts, tasks, notes, cadence engine, mailers, two integrations |
| Integration | 4 | Gmail restricted OAuth scopes + Mailchimp API + bidirectional sync reconciliation |
| Infrastructure | 3 | Hosting, database, auth, scheduled jobs for cadence and sync |
| Knowledge | 2 | Well-trodden CRUD + OAuth patterns |
| Risk | 4 | Her daily revenue-generating tool; client PII; CAN-SPAM/TCPA surface |
| **Total** | **16** | **COMPLEX** (threshold ≥16) |

**Finding:** "super simple lol" scores COMPLEX. Not because the CRM is hard — the contact/task/notes core is genuinely simple — but because **the integrations and the risk profile carry the score.**

Useful lever: deferring Gmail from v1 drops Integration 4→2, total to **14 = STANDARD**. Gmail is the single largest complexity contributor and, per BLOCKER-03, also the least specified. That is not a coincidence worth ignoring.

---

## 7. Recommended next actions

1. **Send BLOCKER-01 to her today**, separately and ahead of everything else. Her data may be expiring. → drafted in `client-questionnaire.md`, Message 1.
2. Send the discovery questionnaire (BLOCKER-02 → 05 plus Q-01 to Q-10), grouped and in plain language, not as a spec interrogation. → drafted in `client-questionnaire.md`, Message 2.
3. ~~Raise build-vs-buy~~ — decided, see §5.
4. **Do not write a PRD or spec until answers return.** With current information, any PRD would be ~60% invention and would violate Article IV.

Once answers return: `@pm *create-prd` → `@architect` complexity re-score → epic → `@sm *draft`.

## 8. Open decisions for Paulo (not for the client)

- ~~Build vs. buy~~ — decided 2026-08-07, custom. §5.
- Target platform — web-responsive is the assumption pending Q-02 (mobile). Not yet confirmed.
- **Who owns hosting and ongoing maintenance after delivery?** Still open, and sharper now that custom is locked in: the Gmail integration in particular will need attention whenever Google changes its OAuth policy.

---

*Produced by @pm (Janus) under AEXOS Constitution Article IV — No Invention.*
