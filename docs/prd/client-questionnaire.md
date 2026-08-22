# Client Discovery — Ready-to-Send Messages

**Owner:** @pm (Janus) · **Date:** 2026-08-07
**Companion to:** `discovery-requirements-analysis.md`
**Instructions:** Send Message 1 **now**, on its own. Send Message 2 after, or the next day — do not merge them. The urgency of the first one gets diluted if it arrives inside a long list of questions.

Build-vs-buy is settled (custom). It is deliberately absent below — do not reopen it.

---

## MESSAGE 1 — send immediately, standalone

> **Subject:** Quick one, and it's time-sensitive — can you still log into Boldtrail?

Hi [Name],

Before anything else — one urgent thing, and then I'll get out of your way.

You mentioned your brokerage used to provide KvCore/Boldtrail and that you don't have a CRM anymore. **If you can still log in, please export your contacts today**, even if you do nothing else with the file.

Brokerage-provided accounts usually get switched off at some point after you're no longer on their plan, and when that happens the contact history tends to go with it. Names you can rebuild. Years of notes, birthdays, and "met them at the Oak Street open house" details — those you can't.

If you can get in, look for **Contacts → Export**, or **Smart CRM → Export**, and save the CSV somewhere safe. If you can't find it, send me a screenshot of what you're seeing and I'll point you to it.

If you've already lost access, no problem at all — just let me know and we'll work from whatever you've got. I only wanted to make sure that if there's a window still open, we don't discover it three weeks from now after it closed.

More questions coming shortly, but this one couldn't wait.

[Paulo]

---

## MESSAGE 2 — the questionnaire

> **Subject:** A few questions so I build you the right thing

Hi [Name],

This was great to read — and yes, most of it is very doable. "Super simple" is exactly the right instinct. The trick is making sure the simple version is simple in the ways that actually help you, which is why I'm going to ask you some annoyingly specific questions.

It's a longer list than I'd like, but most are one-word answers. **Section 2 is the one I genuinely need** — the rest you can answer quickly, skip, or reply "no idea yet," which is a real and useful answer.

### 1. Your contacts right now

- Roughly how many are we talking — 200? 2,000?
- Where do they live today? Your phone, a spreadsheet, Mailchimp, still in Boldtrail?
- Where do new leads come from — Zillow, Realtor.com, open houses, referrals, your website?
- When a new lead comes in, how do you find out? An email, a text, a phone call?

### 2. The follow-up rhythm ⭐ *the important one*

You said tasks should be based on lead type. I need your actual rhythm — whatever you'd do in a perfect week:

- **Hot** → reach out every ______
- **Warm** → every ______
- **Nurture** → every ______

And one more: when you finish a follow-up, should the system **automatically** line up the next one, or would you rather set it yourself each time? Some people love the automatic version, some people find it nags them. No wrong answer, but it changes how I build it.

### 3. Gmail

This one got me curious, because "linked to Gmail" can mean a few very different things. Which were you picturing?

- **a)** Click a contact, it opens a new email to them
- **b)** Emails you send and receive show up on that contact's record automatically
- **c)** You write and send emails from inside the CRM itself
- **d)** Lead emails (Zillow and the like) automatically become contacts, so you're not retyping them

Any combination is fine. I just want to build the one you actually meant rather than guessing.

### 4. Mailchimp

- Which audience/list should it sync with — do you have just the one?
- If someone unsubscribes in Mailchimp, should the CRM know about it? **I'd strongly suggest yes** — it keeps you from cheerfully emailing someone who's opted out.
- Should Hot / Warm / Nurture carry over into Mailchimp as tags, so you can send different things to different groups?
- Anything going the other way — should people who sign up through Mailchimp show up as contacts?

### 5. Social media and mailers

You mentioned these with an "or," so — did you want one, or both?

- **Social:** what would "linked" actually do for you day to day? Keep their Facebook/Instagram on file so it's one click away, or something more than that?
- **Mailers:** are these printed postcards you send out, or email campaigns? And what would you want to see — who received what, and when?

### 6. Where you'll actually use it

You used the old one daily, so be honest with me: phone, laptop, or both? And is this more of a "sitting at my desk with coffee" tool, or a "in the car between showings" tool? That answer changes the design quite a bit.

### 7. Quick ones — yes/no is plenty

- Track past clients and their home purchase anniversary, not just leads? (The "happy homeaversary" touchpoint — same idea as birthdays, and easy to add now.)
- Any stages beyond Hot/Warm/Nurture — under contract, closed, that sort of thing? Or does that feel like clutter?
- Texting, or are email and phone enough?
- Should your follow-up tasks show up in your Google Calendar?
- Is anyone else going to use this — an assistant, a partner, a transaction coordinator?
- Does your brokerage have any rules about where client data can be stored? Worth checking before we pick anything.

### 8. Practical

- When would you like to actually be using this?
- What did you specifically **miss** about Boldtrail — and what specifically **annoyed** you about it?

That last question is my favorite, honestly. Knowing what irritated you tells me more than any feature list will.

Take your time. Bullet points, voice note, whatever's easiest.

[Paulo]

---

## Internal notes — not for the client

| Section | Resolves |
|---------|----------|
| 1 | BLOCKER-05, Q-01 |
| 2 | **BLOCKER-02** — hard blocker on the cadence engine |
| 3 | **BLOCKER-03** — option (d) is the high-value reading; watch for it |
| 4 | BLOCKER-04, incl. the CAN-SPAM unsubscribe path |
| 5 | WISH-01 / WISH-02 — the "or" is being tested deliberately |
| 6 | Q-02 (mobile) — likely determines adoption |
| 7 | Q-03 to Q-09 |
| 8 | Q-10, plus prior-tool pain signals |

**Watch for in her reply:**

- If she picks Gmail **(c)** or **(d)** → restricted OAuth scopes are confirmed in scope; re-score complexity before promising a date.
- If §1 reveals leads arrive by email → **(d)** is the real requirement even if she didn't tick it, and it reframes the Gmail work entirely.
- If §6 says "phone, in the car" → mobile is a hard constraint, not a preference.
- If §7 reveals a second user → auth and data model change now, not later.
- Do **not** treat silence on any Q-item as a "no." Silence means unasked-again.
