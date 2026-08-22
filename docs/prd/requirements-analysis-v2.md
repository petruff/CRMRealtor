# Omnix — Requirements Analysis v2 (post-client-answers)

**Status:** ANALYSIS COMPLETE — phasing decision required before PRD
**Owner:** @pm (Janus) · **Date:** 2026-08-10
**Supersedes:** `discovery-requirements-analysis.md` (v1 discovery)
**Source:** Client's full written answers to the §1–§8 questionnaire, received 2026-08-10

---

## 1. Headline finding

**The scope roughly doubled, and she also said "as soon as possible."**

Complexity re-scores from **16/25 (COMPLEX)** to **21/25 (deeply COMPLEX)** — see §6. Her answers added SMS, Google Calendar, a *website*, deal/P&L tracking, pipeline stages, and a second user, none of which were in the original email.

This is not a problem with her answers. It is what happens when you ask good questions: latent requirements surface. But **"super simple," "as soon as possible," and this scope cannot all three be true.** Something has to give, and it should be a deliberate choice rather than a discovery made in month three.

Recommendation: **phase it** (§7). Ship the thing that fixes her stated core pain in weeks, not the thing that fixes everything in quarters.

---

## 2. Blockers resolved

| Blocker | Status | Answer |
|---------|--------|--------|
| BLOCKER-02 — cadence | ✅ **RESOLVED** | Hot = weekly · Warm = 1–2 weeks · Nurture = monthly. Auto-schedule next touch, manually adjustable. |
| BLOCKER-03 — Gmail meaning | ⚠️ **Answered "yes to all four"** — but see §4.1, one of the four is worthless to her |
| BLOCKER-04 — Mailchimp | ✅ **RESOLVED** | One combined list (leads + past clients). Two-way. Unsubscribes flow back. Lead type → tags. Mailchimp signups → CRM contacts. |
| BLOCKER-05 — data location/volume | ✅ **RESOLVED** | 200–500 contacts, spread across phone + spreadsheet + Mailchimp |
| BLOCKER-01 — Boldtrail export | ❌ **STILL UNANSWERED** — see §5.1 |

**Confirmed simple, well-specified, low-risk:**

- **Mailer tracking.** "Several different mailers... a checkbox for each that I can check off and it dates it. I just want to know what was sent, when, and if it was done." That is a clean, small, buildable spec. Printed postcards, per-contact checklist, auto-timestamp on check. No ambiguity left.
- **Volume:** 200–500 contacts. Small. No scaling architecture needed — this is a meaningful cost saver and rules out a lot of over-engineering.
- **Social media: deferred by the client herself.** "I am not sure how I want to integrate this or if I even should." Cleanly out of scope. Do not build it.

---

## 3. The most valuable thing she wrote

Her §8 answer about Boldtrail is a better requirements document than §2 was:

> "I wanted them organized by HOT to Nurture because that would tell me **who needs my immediate attention** and it didn't do that."

**This reframes the core feature.** We had modelled lead type as a *cadence driver* (FR-05). Her actual need is **triage ordering** — open the app, see who needs attention right now, in priority order. Cadence feeds that view; it is not the point of it.

Supporting evidence from her own cadence answers: Hot = weekly, Warm = "once a week or every two weeks." Those substantially overlap. **Lead type is barely differentiating her cadence at all** — which tells us the cadence rules were never the real value. The sort order is.

The rest of that paragraph is a list of NFRs, stated as grievances:

| Her complaint | Requirement it implies |
|---|---|
| "hated how many prompts I had to go through just to sign in" | **NFR: one-click sign-in.** Google sign-in — she already lives in Gmail. Conveniently, this is also how we obtain the OAuth token that Gmail and Calendar need later. One decision solves two problems. |
| "Not very mobile friendly" | Mobile lookup must work — despite her calling it a desk tool. See §4.2. |
| "Too much stuff that didn't generate any business" | **NFR: no feature bloat.** Directly argues for phasing over a big-bang build. |
| "everything it offered was an additional fee" | Pricing/packaging sensitivity. Be straight about ongoing costs (hosting, Twilio, APIs). |
| "email campaigns were also super generic" | **Do not build campaigns.** Mailchimp stays her email tool. Sync to it; don't replace it. |
| "I loved that I could put notes in there" | Notes are a first-class feature, not a text field afterthought. |

---

## 4. Contradictions to resolve before building

### 4.1 She said yes to Gmail (d) — but it does not fit her lead sources ⚠️

She ticked **(d) "Lead emails (Zillow and the like) automatically become contacts."**

But §1 says her leads come from **"Cold calling, open houses, referrals, and social media"**, arriving **"mainly through calls/texts/messages on social media."**

**She has no email-based lead source.** Building (d) would deliver near-zero value — it is parsing a stream that doesn't exist. She almost certainly ticked all four boxes because all four sounded good, which is exactly the failure mode of an all-of-the-above question.

Her *real* intake problem is manual entry from calls, open houses, and Instagram DMs. Which means the high-value intake features are:

- **Fast contact entry that works on a phone** (she's at an open house, not her desk)
- **The website form capture she mentioned in §5** — that is her one genuine automated intake path

**Action:** confirm with her, then drop (d). Redirect that effort to fast mobile entry.

### 4.2 "Desk tool" vs. "not very mobile friendly"

She says: *"Mainly on the laptop... More of a at the office sitting at my desk tool."*
She also says: mobile-unfriendliness is something she **hated** about Boldtrail, and *"there was times that I needed to pull a client's contact information and I would pull it up on the phone."*

**Resolution:** desktop-first design, but **responsive web** so phone lookup genuinely works. Notably she never asked for a native app — that is a real cost saving, and we should not upsell one. Do not read "desk tool" as permission to let mobile rot; she named it as a grievance.

### 4.3 Hot and Warm cadences overlap

Hot = weekly. Warm = "once a week or every two weeks." Needs one decision: is Warm 7 or 14 days? Small question, but the automation needs a number. (See §3 — the sort order matters more than this either way.)

---

## 5. New and still-open items

### 5.1 Boldtrail export — never answered, and now more worrying ⏰

She listed her contacts as living in "phone, spreadsheet and Mailchimp." **Boldtrail is conspicuously absent from that list.** That suggests access is already gone — but she never confirmed it.

This matters more now than it did before, because §8 tells us **the notes were the thing she loved most about Boldtrail.** If those notes are still reachable, they are the single highest-value data in this project. If access is gone, they are gone, and we should stop hoping.

**Action:** one direct question. Yes or no, can she still log in.

### 5.2 A website is a second project 🚩

> "have it linked to my website **(which I also need to develop)** and whoever fills out a form it can automatically be added to the CRM as contact."

She needs a website built. That is a separate engagement with its own design, copy, hosting, and SEO work — not a CRM feature. The **form → CRM webhook** is a small CRM feature; **the website** is not.

**Action:** scope, price, and schedule separately. Do not let it ride along inside the CRM budget, and do not make the CRM's delivery date depend on it.

### 5.3 SMS has a regulatory lead time most people don't expect ⏰

> "Definitely texting! All three!"

US application-to-person SMS requires **10DLC brand and campaign registration** through the carriers (via Twilio or similar). This takes weeks and involves per-campaign fees and approval, and unregistered traffic gets filtered or blocked. There is also **TCPA** exposure: written consent, opt-out handling, and quiet hours are legal requirements, not preferences.

**Sequencing insight:** if texting is wanted at all, **start the 10DLC registration during phase 1**, even though the feature ships later. The paperwork clock runs in parallel with development for free. Discovering this at build time costs weeks of idle waiting.

### 5.4 Deal / P&L tracking is its own module

> "I wonder if we could integrate like a profit or loss type of thing? To keep track of deals and volume/sales."

Phrased as a musing, not a requirement — but it's a real need for an agent (GCI, commission splits, brokerage cap, volume, closed units). It is also a **whole module**, and it touches financial data, which raises the risk score.

**Action:** treat as a genuine phase-4 candidate. Ask what she actually tracks today, and where — many agents use a spreadsheet they're happy with.

### 5.5 Assistant = multi-user from day one

> "An assistant"

Confirmed second user. Auth, roles, and permissions must be in the data model **now** — retrofitting multi-tenancy is expensive and error-prone. Open question: should the assistant see everything, or is anything restricted?

### 5.6 Leads arrive via social DMs

*"mainly through calls/texts/messages on social media"* — her highest-volume intake channel is Instagram/Facebook DMs, which has no practical automated path (Meta's messaging APIs are business-account-gated and awkward). Realistically this stays **manual entry**, which is precisely why fast mobile entry (§4.1) matters.

---

## 6. Complexity re-score

| Dimension | v1 | v2 | Why it moved |
|-----------|----|----|--------------|
| Scope | 3 | **5** | + pipeline stages, deals/P&L, multi-user, calendar, SMS, website forms |
| Integration | 4 | **5** | Gmail read **and** send, Google Calendar, Mailchimp **two-way**, Twilio/SMS, website webhook — five integrations, two behind regulatory gates |
| Infrastructure | 3 | **4** | + auth with roles, webhook endpoints, OAuth token lifecycle, background sync/reconciliation |
| Knowledge | 2 | **2** | Still well-trodden patterns |
| Risk | 4 | **5** | Daily revenue tool · client PII · CAN-SPAM · **TCPA/10DLC** · financial data in P&L |
| **Total** | **16** | **21 / 25** | **Deeply COMPLEX** |

Two-way Mailchimp sync deserves a specific note: bidirectional sync on a single shared list needs conflict resolution and loop prevention (a CRM write triggering a Mailchimp webhook triggering a CRM write). It is routinely underestimated. **One-way CRM → Mailchimp plus a separate unsubscribe-in webhook** delivers ~90% of her value at a fraction of the risk, and is what I'd recommend for v1.

---

## 7. Recommended phasing

Her timeline is "as soon as possible." The only honest way to serve that is a narrow v1 that fixes her actual #1 pain (§3) and ships.

### Phase 1 — "the thing she's missing today" (target: weeks)

Everything here is low-risk, needs no external API approval, and directly answers a stated grievance:

- Contacts (200–500) with import from spreadsheet + phone + Mailchimp export
- **Hot / Warm / Nurture with the priority triage view as the home screen** ← her #1 stated need
- Notes (first-class, timestamped)
- Auto-scheduled follow-up tasks from lead type, manually adjustable
- Birthdays **and** home purchase anniversaries
- Mailer checklist — named mailers, per-contact checkbox, auto-date
- Pipeline stages (under contract, closed) — cheap now, awkward later
- Click-to-email (Gmail option **a** — a mailto link, effectively free)
- **Google sign-in** — kills her sign-in complaint *and* banks the OAuth consent for phase 2
- Responsive, so phone lookup works
- Two users: her + assistant
- Mailchimp **one-way** (CRM → Mailchimp) with lead-type tags, plus unsubscribe webhook coming back

**In parallel, costing nothing:** begin 10DLC registration (§5.3) and scope the website separately (§5.2).

### Phase 2 — Gmail and Calendar

- Gmail email logging onto contact records (option **b**)
- Send from inside the CRM (option **c**) — her "going back and forth between systems" complaint
- Google Calendar sync for tasks
- Drop option **(d)** unless §4.1 says otherwise

*Gated on:* Google restricted-scope handling. Single-user Testing mode avoids the paid security assessment, but she now has an assistant — verify the two-user case before promising this.

### Phase 3 — texting + website capture

- SMS (10DLC already approved by now if started in phase 1), with TCPA consent and opt-out
- Website form → CRM webhook (once the website exists)

### Phase 4 — deals and P&L

- Transactions, commission, volume, closed units — after §5.4 discovery

---

## 8. Open questions for the client (short list)

1. **Can you still log into Boldtrail?** Yes/no. Your notes are the thing worth rescuing. *(BLOCKER-01)*
2. Warm follow-up — **7 days or 14?** Need one number.
3. Gmail: your leads come from calls, open houses, and DMs — not email. Shall we **drop the "lead emails become contacts"** piece and put that effort into fast contact entry on your phone instead?
4. Should your assistant see **everything**, or should anything be off-limits?
5. Deals/P&L — what do you track today, and where? *(A spreadsheet you already like may be the right answer.)*
6. Texting — worth starting the carrier registration now? It takes weeks and runs in the background at no cost to the timeline.
7. The website is a separate build — want it quoted alongside, or later?

## 9. Open decisions for Paulo

- **Confirm the phase 1 boundary** — this gates the PRD. Nothing gets written until it's fixed.
- Mailchimp: one-way + unsubscribe webhook for v1 (recommended), or full two-way?
- Who owns ongoing maintenance and the recurring costs (hosting, Twilio, 10DLC fees)? Still unanswered from v1, and now there are real per-month line items — she is demonstrably fee-sensitive ("everything it offered was an additional fee").

---

*Produced by @pm (Janus) under AEXOS Constitution Article IV — No Invention. Every requirement above traces to a client quote; inferences are labelled as such.*
