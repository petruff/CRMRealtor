# Omnix CRM launch-readiness audit — independent realtor operations

**Date:** 2026-08-21  
**Scope:** authenticated production journey, current stories/code, Judith's confirmed requirements, and current official real-estate CRM patterns  
**Verdict:** **NO-GO for a complete launch today.** Contact storage/import is operational, but the daily-work authority and provider lifecycles are not yet coherent enough to call the product fully operational.

## Evidence boundary

- Production inspected at `https://crm-chi-teal-22.vercel.app` in an authenticated owner/developer session.
- Current production deployment is older than the local guided-connections correction and still exposes technical `UAT`, baseline, webhook and receipt language.
- Local tests/builds do not prove Judith's own login, mobile journey, provider authorization, provider webhook, reconciliation or disconnect.
- The benchmark is directional, not a claim of market superiority. Follow Up Boss currently emphasizes one lead hub, Smart Lists, calendar/team collaboration, mobile, integrated calling/texting/email, deal tracking and reporting. Lofty currently emphasizes behavioral prioritization, suggested next steps, automated lead intake/nurturing, transaction management and volume/GCI goals. Omnix should match the independent-agent jobs that Judith approved, not copy enterprise breadth.

## Production findings

| Priority | Journey | Current production evidence | Launch decision |
|---|---|---|---|
| P0 | Daily priorities | Today reports 191 people needing attention and shows three identical first-contact priorities. Alerts contains 382 items: 191 first-contact plus 191 data-readiness alerts. | Blocker. The command center amplifies the imported backlog instead of choosing executable work. |
| P0 | Cadence and tasks | Activities has 0 tasks while Today says 191 people need action. Contact detail says every imported Nurture contact is on an unapproved accelerated 8x8 weekly rhythm. Judith approved Hot weekly, Warm weekly/biweekly, Nurture monthly. | Blocker. There are two incompatible work authorities and the cadence does not match the client requirement. |
| P0 | Mailchimp | OAuth and audience selection are persisted, but signed webhook and initial reconciliation have no completion evidence. Audience refresh fails behind a generic reauthorization message. | Blocker for Mailchimp launch. Local recovery UX is implemented but not deployed or proven against the real audience. |
| P0 | Google email/calendar | The connection is stuck in `authorizing`; all Gmail and Calendar capabilities say permission required. | Blocker for email/calendar claims. Judith must complete provider consent in her account; code cannot substitute for that authorization. |
| P0 | Data reconciliation | Data & API shows a 192-row failed import receipt while 191 contacts are present. Story 3.16 repaired and classified 191 records, but source-file-to-CRM reconciliation remains incomplete. | Blocker for declaring migration complete. Prove expected source rows, rejected row and duplicate outcomes. |
| P0 | Duplicate safety | The contact list visibly contains at least one repeated name with different emails; Story 3.15 remains InProgress and merge activation is intentionally disabled. | Blocker for bulk outbound activation. Exact duplicate review/merge/reversal must close first. |
| P1 | Contact workspace | Contact detail exposes a long administration form and a relationship dropdown containing nearly the entire database. Primary actions are email/edit; no connected CRM email or texting is available. | Usable for records/notes, not yet a premium daily relationship workspace. |
| P1 | Pipeline | 183 cards render in New and 8 in Actively working; every displayed next step is due the same day. No transaction, property, commission, expense or P&L authority exists. | Relationship pipeline only. It does not satisfy the approved deal-volume/profit request. |
| P1 | Insights | Truthful stored-fact reporting exists, but 100% of sources are Other, phones/addresses are 0%, transitions are 0 and financial reporting is explicitly absent. | Honest but not decision-useful yet. |
| P1 | Alerts | Read-only and deterministic, but no acknowledge, snooze, ownership, notification schedule or delivery preference exists. | Useful inspection surface, not an operational notification system. |
| P1 | Mailers | Persistent physical-mail campaign/checklist capability exists, but the production workspace has 0 campaigns. | Feature exists; Judith's actual mailer set and workflow are not onboarded. |
| P1 | Administration | Settings only manages Omnix AI provider keys. Cadence, timezone, profile, assistant permissions, notifications and connection guidance are fragmented elsewhere. | Operational settings remain incomplete. |
| P1 | Scale and mobile | Contacts and Pipeline render very large record sets, while several 390px/native-200% authenticated QA gates remain open. | Needs pagination/virtualization and final authenticated mobile evidence. |
| P2 | Website/social intake | Governed website intake exists, but Judith's website is not built. Meta remains behind Business Verification/App Review and real UAT. | Correctly gated future channel, not launch-ready. |
| P2 | AI | Deterministic, cited preview works; generative routing is unconfigured and autonomous action is prohibited. | Keep optional. It must not distract from core CRM readiness. |

## What is already strong

- Authenticated workspace authority, owner/assistant roles and server-side persistence.
- CSV/vCard/XLS/XLSX preview with no direct row-count cap, bounded file/cell safety and deterministic classification.
- 191 imported contacts are organized into 183 Nurture leads and 8 Warm active clients, with 33 Needs review records separated.
- Notes, contact points, households, assignments, custom fields, archive, contact export and immutable activity evidence.
- Truthful pipeline/insight boundaries that do not invent revenue, conversion or provider success.
- Premium warm-editorial visual system, responsive shell foundation, keyboard semantics and reduced-motion code paths.

## Required release sequence

1. **Unify daily work:** remove the unapproved 8x8 override; make Hot/Warm/Nurture cadence authoritative; ensure Today, Alerts, contact detail and Activities share one completable work item per contact/date.
2. **Reconcile the migration:** account for all 192 source rows, resolve exact duplicates safely, verify representative records and preserve rollback evidence.
3. **Complete Mailchimp:** deploy the guided recovery UX, diagnose the redacted failure category, register the signed webhook, run baseline, prove one tag update and one unsubscribe, then reconcile.
4. **Complete Google:** Judith authorizes Gmail/Calendar; prove send, received metadata match, calendar task creation/update/completion and disconnect.
5. **Onboard operations:** create Judith's actual physical-mail campaigns, set owner/assistant assignments, and validate the first week of tasks.
6. **Close mobile/release evidence:** authenticated 390/768/1440, both themes, keyboard, reduced motion, native 200%, console and rollback checks.

## Local correction status — 2026-08-22

- **Implemented:** removed the unapproved 8x8 rule and copy; Hot/Warm remain weekly and Nurture remains monthly.
- **Implemented:** historical imports are distinguished from real-time new leads through immutable import evidence for Today, Alerts and Activities.
- **Implemented:** Activities exposes the same due relationship-follow-up queue and completes it through the canonical contact-touch command.
- **Implemented:** import organization v2 can dry-run/apply a deterministic spread of untouched historical follow-ups inside the approved 7/30-day cadence window while preserving manual dates.
- **Implemented:** Mailchimp connection presentation distinguishes remote audience-list failure from persisted binding/baseline/webhook state and offers one guided setup action.
- **Verified locally:** lint, typecheck, 172 test files / 781 tests and the Next.js production build pass.
- **Still blocked:** production deployment, authenticated Judith-workspace dry-run, explicit cadence rollback receipt, duplicate reconciliation, Mailchimp real webhook/baseline UAT and Judith's Google authorization.

The production findings above remain the launch authority until this correction is deployed and the authenticated before/after evidence is captured.

## Release gate update — 2026-08-22 00:52 ET

- **Reconciled in the Judith workspace:** the one import receipt accounts for all 192 source rows as 191 created contacts plus 1 `validation-rejected` quarantined row; failed rows = 0.
- **Duplicate preflight clean:** 0 exact canonical email groups, 0 exact canonical phone groups and 0 archived contacts among the 191 active contacts. No merge or bulk outbound was performed.
- **Rollback installed before apply:** owner-only `apply_imported_contact_organization` and `rollback_imported_contact_organization` RPCs are active. The run ledger is empty, proving no historical contact was redistributed during installation.
- **Guided connector authority installed:** the Google `workspace-core` consent bundle and Mailchimp transaction-versioned reauthorization RPCs are active. Provider consent and provider-side baseline/webhook evidence remain separate.
- **Responsive defect corrected locally:** the 768px layout now keeps the full-width mobile/tablet shell instead of compressing content behind the desktop rail; the Omnix launcher remains above the bottom navigation through tablet widths.
- **Local gates:** lint, typecheck, 172 test files / 784 tests and production build pass.

Open release gates are now: Preview/Production deployment verification, authenticated post-deploy 390/768/1440 evidence, Mailchimp provider-side completion, Judith Google consent, and the still-open durable cadence task-materialization story.

## Product direction after launch blockers

- Add the approved property, deal, closing, commission, expense, volume and P&L domains incrementally; do not fake them from contact stages.
- Replace database-sized dropdowns and boards with searchable pickers, pagination/virtualization and contextual progressive disclosure.
- Add persistent alert lifecycle and notification preferences only after the unified task authority is stable.
- Connect website/open-house forms to the governed intake API; keep Meta and texting behind provider/compliance evidence.

## Benchmark sources

- Follow Up Boss official product and integration pages: `https://www.followupboss.com/open`, `https://www.followupboss.com/how-it-works/organize`, `https://www.followupboss.com/features/texting`
- Lofty official CRM and automation pages: `https://lofty.com/real-estate/crm`, `https://lofty.com/feature/crm-automation`
