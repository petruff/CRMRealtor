# Client Follow-Up — Ready to Send

**Owner:** @pm (Janus) · **Date:** 2026-08-10
**Companion to:** `requirements-analysis-v2.md`
**Context:** Phase 1 boundary approved by Paulo 2026-08-10. Seven open questions remain; two of them block parts of the phase 1 PRD (see internal notes).

---

## EMAIL — send as one message

> **Subject:** Great answers — seven quick things and then I can start

Hi [Name],

These were genuinely useful. Especially the last part, about what annoyed you with Boldtrail — that paragraph told me more than the rest of the questionnaire combined, and it changed the plan for the better. I'll explain at the end.

Seven quick things, most of them one word.

### 1. Can you still log into Boldtrail? Yes or no. ← the urgent one

I noticed Boldtrail wasn't on your list of where contacts live now, which makes me suspect the access is already gone. If it isn't, I'd like to grab an export this week.

You said the notes were your favourite part of it — and notes are the one thing that can't be rebuilt. Names and numbers we can recover from your phone and Mailchimp. "Met them at the Oak Street open house, wife is expecting in March" we cannot.

### 2. Warm follow-ups — 7 days or 14?

You said "once a week or every two weeks," and the automation needs one number to start from. You can change it whenever.

Worth mentioning: Hot is also weekly in your answers, so if Warm is 7 days too, the two end up on an identical rhythm and stop meaning anything different. 14 might serve you better — your call.

### 3. Something useful you told me without meaning to

You said yes to "lead emails automatically become contacts." But you also said your leads come from cold calling, open houses, referrals and social media — mostly calls, texts and DMs.

Which means almost none of your leads arrive by email, and that feature would sit there doing nothing.

Can I spend that effort on something you'd actually use instead — making it genuinely fast to add someone from your phone while you're standing at an open house? That feels much closer to your real problem.

### 4. Your assistant — should they see everything?

Or is anything off-limits: private notes, deal numbers, certain contacts? Much easier to decide now than to bolt on later.

### 5. Deals and profit/loss — what do you track today, and where?

You mentioned wanting to track deals and volume. Before I build anything, I'd like to see what you already do.

Honestly — if you've got a spreadsheet that works, keeping it may be the right answer. I'd rather not rebuild something you're already happy with.

### 6. Texting — can I start the paperwork now?

Business texting in the US needs carrier registration, which involves a few weeks of waiting. There's nothing for you to do and no cost to starting.

But if I file it now, it's approved and sitting ready by the time we get to texting — instead of us stopping for a month when we're otherwise finished. Just say go.

### 7. The website is its own project

You mentioned needing one developed. That's a separate build from the CRM — different work, different timeline.

Want me to quote it alongside so you can see both together, or park it until the CRM is up and running?

---

### And the plan, briefly

That line of yours about wanting contacts sorted Hot → Nurture so you can see who needs immediate attention? **That's now the front page.** You open it and there's a list of who to call today, in order. That's the whole point of the first version, and the old system genuinely failed you on it.

The first version also gets you: contacts with proper notes, birthdays and home purchase anniversaries, follow-up tasks that schedule themselves (adjustable when you want), your mailer checklist with the dates ticked off, under contract / closed stages, Mailchimp syncing with Hot/Warm/Nurture as tags, your assistant's login, and it'll work properly on your phone when you need to pull someone's number up.

And signing in is one click with your Google account. No prompts. That one I took personally.

Gmail — sending from inside the CRM, and emails logging themselves onto contacts — comes right after, along with calendar sync. I'm doing it in two steps deliberately: I'd rather get you something you're using every day within weeks than have you waiting months for everything at once.

Which I think is roughly what you meant by "super simple" anyway.

[Paulo]

---

## Internal notes — not for the client

### Which answers block phase 1

| Q | Blocks phase 1? | Impact if unanswered |
|---|---|---|
| 1 — Boldtrail | ⚠️ Partial | Determines whether data migration includes a notes import. Doesn't block the build; does block the migration task. **Time-sensitive regardless.** |
| 2 — Warm interval | 🔴 **YES** | The cadence engine needs a number. Cannot ship phase 1 without it. Defaulting to 14 is the fallback if she goes quiet. |
| 3 — drop Gmail (d) | No | Phase 2 scope. Asked now to redirect effort early. |
| 4 — assistant permissions | 🔴 **YES** | Roles go in the phase 1 data model. Retrofitting permissions is expensive. Fallback: assistant sees everything except deal financials. |
| 5 — deals/P&L | No | Phase 4. |
| 6 — SMS registration | No | Phase 3 feature, but the **action is now** — the clock runs free in parallel. |
| 7 — website | No | Separate engagement. |

### Deliberate choices in this draft

- **Boldtrail leads**, framed around the notes rather than the export — she told us notes were what she loved, so that's the lever that makes her act today.
- **Q2 includes the reasoning** (Hot and Warm collapsing into the same rhythm) rather than just asking for a number. She'll pick better with the observation in hand.
- **Q3 is framed as a trade, not a correction.** "Can I spend that effort elsewhere" rather than "you answered inconsistently." Same outcome, no defensiveness.
- **Q5 actively offers to not build something.** She's fee-sensitive and hated paying for features that "didn't generate any business" — declining scope buys credibility here.
- **The closing section is doing retention work.** She's fee-sensitive and wants it ASAP; showing that her own complaint became the front page proves she was listened to, and justifies the phasing in her own words rather than ours.

### Next step once answers land

`@pm *create-prd` for phase 1 → `@architect` for stack and the Google OAuth two-user question (blocks phase 2 promises) → epic → `@sm *draft`.
