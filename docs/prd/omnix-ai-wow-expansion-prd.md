# Omnix AI WOW Expansion PRD

**Version:** 1.0.0
**Date:** 2026-09-07
**Status:** Proposed — ready for product-owner review and story breakdown
**Program:** Epic 10 — AI Revenue and Relationship Operating System
**Baseline:** codex/story-5-1-governed-ai at eedc12eec250535946405671577e356f5f24c8e9
**Product:** Omnix — Powered by Cyryx Labs
**Primary user:** Independent US realtor
**Initial operator:** Judith and her authorized assistant
**Required reviewers:** Product, Architecture, Data, UX, Security, QA, DevOps, Legal/Compliance

## 1. Executive decision

Omnix should not compete by adding more AI buttons or a generic chatbot. It should become the realtor's revenue and relationship operating system: a system that observes authorized business signals, explains what matters, prepares the next action, and completes approved work across the lead, client, property, and transaction lifecycle.

The target experience is a closed operating loop:

1. Capture a signal from a lead, conversation, property interaction, document, transaction, or relationship milestone.
2. Resolve it to canonical people, properties, deals, and evidence.
3. Update cited relationship memory without overwriting source truth.
4. identify the highest-value or highest-risk next action.
5. Prepare the exact task, message, appointment, campaign, or record change.
6. Execute only within the user's explicit authority and communication consent.
7. Verify the result through provider receipts and feed the outcome back into the next recommendation.

The product must make the realtor feel that Omnix understands the business and removes work. It must never create a false impression of certainty, connectivity, compliance, or completed action.

## 2. Why this expansion is necessary

The active AI branch already contains a strong foundation: a persistent attention queue, relationship memory, Next Best Action, Approval Inbox, governed proposals, nurture lifecycle, inbound Gmail classification, transaction deadlines, property behavior, grounded CMA boundaries, website intake, attribution, an omnichannel timeline, and provider-aware execution.

That foundation is materially ahead of the main branch. The remaining gap is not basic CRM completeness. The gap is perceived intelligence and operational closure.

A realtor should experience useful magic in under five minutes:

- "Tell me who I should contact today and why."
- "Brief me before I meet this client."
- "I just finished a call; capture what happened and prepare everything."
- "Respond to a new lead immediately, qualify them, and hand them to me at the right moment."
- "Show me which homeowners in my database may be entering a seller window."
- "Read this contract or amendment, show the critical facts, and prepare deadlines for my confirmation."
- "Find the best property matches for this buyer and explain the fit."
- "Turn this listing or market update into a complete, compliant campaign."

The 2025 NAR Technology Survey provides the correct product lens: agents adopt technology primarily to save time and improve client experience, while a large share still reports neutral impact from AI. Omnix therefore wins through measurable completed outcomes, not AI novelty.

## 3. Competitive benchmark

This benchmark uses public product claims as directional evidence, not as proof of outcome.

| Product | Current market signal | Omnix response |
| --- | --- | --- |
| Follow Up Boss | AI summaries and transcripts, smart messages, suggested tasks, predictive lead prioritization, calling, and a broad integration ecosystem | Match conversation capture, task extraction, response assistance, and explainable prioritization; differentiate with transaction and relationship memory in one governed loop |
| Lofty | AI Sales Agent, operational coworker, social agent, homeowner/seller opportunity agent, and custom agents | Match the highest-value roles through bounded Omnix capabilities; differentiate with one shared evidence graph, permission ladder, and provider truth |
| BoldTrail | Behavioral lead nurture, daily AI prioritization, real-time intent signals, and mobile pipeline visibility | Match behavior-triggered prioritization and adaptive follow-up; differentiate with cited reasoning, recoverable actions, and explicit uncertainty |
| CINC | Always-on conversational nurture, real-estate qualification, and warm agent handoff | Match speed-to-lead and appointment qualification through a policy-controlled concierge; differentiate with transparent handoff state and complete post-conversation memory |
| Sierra Interactive | AI property search, lead scoring, predictive automation, AI content, texting, and integrated IDX/CRM | Match through licensed property intelligence, explainable scoring, and client-facing search; differentiate with transaction operations and relationship growth |

Primary references:

- NAR Realtor Technology Survey: https://www.nar.realtor/research-and-statistics/research-reports/realtor-technology-survey
- Follow Up Boss pricing and AI feature summary: https://www.followupboss.com/pricing
- Follow Up Boss AI calling: https://www.followupboss.com/features/outbound-calling
- Lofty AI Assistant and operational coworker: https://lofty.com/ai/assistant
- Lofty AI Copilot announcement: https://lofty.com/news/copilot
- BoldTrail Smart CRM: https://boldtrail.com/boldtrail-smart-crm/
- BoldTrail AI Search and Streams: https://boldtrail.com/ai-search/
- CINC AI: https://www.cincpro.com/features/cinc-ai
- Sierra real-estate CRM: https://www.sierrainteractive.com/our-solutions/real-estate-crm/

## 4. Product positioning

### 4.1 Category

AI Revenue and Relationship Operating System for independent realtors and small real-estate teams.

### 4.2 Promise

Omnix identifies the relationships and deals that need attention, prepares the work, and helps the realtor act with confidence — without losing control of client communication or source truth.

### 4.3 Differentiation

Omnix should combine five authorities that competitors commonly separate:

1. Relationship memory.
2. Conversation intelligence.
3. Lead and seller opportunity signals.
4. Property and transaction intelligence.
5. Governed action and verified execution.

The defensible product is not a model response. It is the accumulated, permissioned evidence graph plus the loop that turns evidence into safe action and measurable outcomes.

### 4.4 Product principles

- Outcomes over feature count.
- Proactive over query-only.
- Evidence over opaque scores.
- One next action over an overwhelming task dump.
- Preview and control over silent mutation.
- Realtor language over implementation language.
- Mobile completion over desktop-only administration.
- Progressive disclosure over technical clutter.
- Graceful degradation over false readiness.
- Provider-agnostic intelligence over model lock-in.

## 5. Core experience architecture

Omnix must present one cohesive system even though execution remains separated into bounded services.

### 5.1 Signal layer

Authorized events enter from:

- Website and landing-page forms.
- Email metadata and consented content.
- SMS and messaging channels.
- Calls, recordings, transcripts, and voice recaps.
- Calendar events and showing outcomes.
- Property search, favorite, repeat-view, saved-search, inquiry, and showing-request events.
- Contact updates, notes, tasks, and pipeline history.
- Transaction, milestone, document, commission, and expense events.
- Campaign engagement and referral events.
- Licensed property, public-record, and market-data providers.

Each signal must include source, time, workspace, actor or provider, consent boundary, identity state, and idempotency evidence.

### 5.2 Truth layer

Facts remain in their canonical domains. Model output never becomes a fact merely because it is plausible.

- Contact and household truth.
- Communication and consent truth.
- Property and listing truth.
- Deal and transaction truth.
- Document and deadline evidence.
- Financial and attribution truth.
- Provider connection and reconciliation truth.
- AI run, recommendation, proposal, approval, and execution truth.

### 5.3 Memory layer

Omnix builds versioned, source-hashed memory from authorized facts:

- Relationship summary.
- Preferences and exclusions.
- Life events and important dates.
- Property criteria and engagement.
- Communication style and preferred channel.
- Objections, commitments, and open loops.
- Transaction and document state.
- Referral network and household relationships.
- Explicit unknowns and contradictions.

Memory must invalidate or become stale when its source changes. Users must be able to inspect, correct, pin, or reject memory without altering immutable source evidence.

### 5.4 Intelligence layer

Specialized capabilities operate on minimized projections:

- Opportunity scoring.
- Lead qualification.
- Seller-window detection.
- Conversation summarization.
- Commitment and task extraction.
- Meeting preparation.
- Draft generation.
- Document extraction.
- Property matching and fit explanation.
- Transaction risk detection.
- Marketing content transformation.
- Business performance diagnosis.

### 5.5 Decision layer

The system combines deterministic rules, calibrated models, user priorities, consent, SLA, and economic relevance into one explainable recommendation.

Every recommendation must state:

- What happened.
- Why it matters now.
- What evidence supports it.
- What is known, estimated, stale, or unknown.
- The recommended next action.
- Expected effort and deadline.
- Whether Omnix can prepare or execute it.
- What approval or provider state is required.
- When the recommendation expires.

### 5.6 Action layer

Actions remain typed and allowlisted:

- Create or update a task.
- Prepare or send an individual email.
- Prepare or send an individual text.
- Schedule or update an appointment.
- Start, pause, resume, or stop a nurture plan.
- Change relationship pipeline state.
- Prepare a campaign.
- Create a document-review item.
- Add confirmed transaction facts or milestones.
- Create a partner handoff.
- Publish approved content through a supported channel.

### 5.7 Verification layer

Execution is not complete until the provider or canonical domain confirms it. Each action needs an immutable receipt, reconciliation state, failure category, retry policy, and user-readable recovery path.

## 6. Permission ladder

Omnix needs more useful autonomy without giving free-form model output direct authority.

| Level | Name | Allowed behavior | Default |
| --- | --- | --- | --- |
| L0 | Observe | Read authorized facts, summarize, search, and explain | Enabled |
| L1 | Prepare | Draft messages, tasks, appointments, plans, and changes without executing | Enabled |
| L2 | Confirm each | Execute one exact preview after explicit confirmation | Enabled for authorized users |
| L3 | Approved playbook | Execute bounded actions inside a user-approved envelope with limits, audience, channel, templates, quiet hours, consent, expiry, and stop conditions | Opt-in only |
| L4 | Prohibited | Legal conclusions, Fair Housing steering, unlicensed valuation, silent financial changes, unrestricted bulk sends, scraping, or actions outside the envelope | Never allowed |

The approved-playbook level is the strategic unlock. It lets Omnix respond quickly while preserving human control at the policy level. The user approves the playbook, not arbitrary future model behavior.

An automation envelope must define:

- Purpose and lifecycle stage.
- Eligible contact segment.
- Allowed channel and template family.
- Maximum message count and cadence.
- Allowed personalization fields.
- Required consent and suppression rules.
- Quiet hours and timezone.
- Qualification questions.
- Handoff triggers.
- Prohibited topics and mandatory disclosures.
- Spend and model budget.
- Start, expiry, pause, revoke, and emergency-stop controls.
- Evaluation threshold and rollback behavior.

## 7. Epic 10 capability portfolio

## 7.1 One-Minute Meeting Brief

### User outcome

Before a call, showing, listing appointment, or follow-up, the realtor receives a concise brief that makes the next conversation feel prepared and personal.

### Experience

The brief includes:

- Who the person is and how the relationship began.
- Last meaningful interaction.
- Current goal, timeline, price range, neighborhoods, property preferences, and constraints.
- Household and referral context.
- Active properties, appointments, transaction, and milestones.
- Open commitments from both sides.
- Recent intent signals and changes.
- Likely questions or objections, clearly labeled as suggestions.
- One recommended objective for the conversation.
- Three evidence-backed talking points.
- One recommended next action.

Every item links to evidence. Missing information is shown as unknown, not inferred.

### WOW moment

From Today or a contact, the realtor taps "Brief me" and receives a usable meeting card in under five seconds.

## 7.2 Post-Conversation Autopilot

### User outcome

The realtor finishes a call or meeting, records or types a short recap, and Omnix prepares all administrative follow-through.

### Inputs

- Governed call recording when consent requirements are met.
- Uploaded audio or mobile voice recap.
- Typed recap.
- Imported transcript.
- Existing email or message thread.

### Outputs

- Transcript with speaker and confidence boundaries where available.
- Concise summary.
- Buyer/seller intent.
- Timeline, budget, financing, geography, property criteria, and constraints.
- Questions, objections, and sentiment category.
- Realtor commitments and client commitments.
- Proposed contact-field updates.
- Proposed tasks and due dates.
- Proposed appointment.
- Proposed pipeline or nurture change.
- Personalized follow-up message in the realtor's approved voice.
- Risk and compliance flags.

The realtor reviews one consolidated change set, edits it, and approves all or selected items. The original evidence, extracted proposal, edits, and execution receipts remain linked.

### WOW moment

A 30-second voice recap becomes a clean note, two tasks, one calendar proposal, updated preferences, and a ready-to-send follow-up without duplicate entry.

## 7.3 Instant Response AI Concierge

### User outcome

New internet leads receive a fast, helpful, compliant first response and are handed to the realtor when human attention matters.

### Channels

- Website chat or form.
- SMS where consent and registration permit.
- Email.
- Meta messaging where approved.
- Optional voice only after a separate telephony and consent release.

### Capabilities

- Respond within the configured SLA.
- Identify buyer, seller, renter, investor, referral, or other intent.
- Ask only approved qualification questions.
- Capture timeline, geography, property need, financing stage, ownership status, and preferred contact method.
- Answer only from approved listing, realtor, and process knowledge.
- Offer an appointment from authorized availability.
- Detect urgency, frustration, high intent, out-of-scope questions, and explicit human requests.
- Hand off with a complete brief.
- Pause immediately on opt-out, low confidence, policy risk, or missing authority.
- Resume after the realtor records an outcome when the approved playbook permits it.

### WOW moment

A new lead is acknowledged in seconds, qualified without a form interrogation, and appears in Today as "Ready for you" with the entire conversation and recommended call objective.

## 7.4 Explainable Opportunity Radar

### User outcome

The realtor sees who is heating up, who may be entering a seller window, which relationships are decaying, and which deals are at risk.

### Signal families

- New lead response and reply behavior.
- Property views, favorites, saved searches, price-range narrowing, repeat visits, and showing requests.
- Conversation intent and commitment changes.
- Stage age and stalled work.
- Email, text, campaign, and appointment engagement.
- Home-purchase anniversary, tenure, explicit ownership, and permissioned property/public-record facts.
- Equity or market-value estimates only from approved sources with provenance and freshness.
- Transaction milestones, contradictory dates, missing evidence, and provider degradation.
- Referral and repeat-business relationships.

### Score contract

Every score must expose:

- Score type and version.
- Deterministic and model-assisted inputs.
- Top positive and negative factors.
- Data coverage.
- Calibration cohort and date when statistical prediction is used.
- Confidence boundary.
- Recommended action.
- Expiry and refresh trigger.

A score may reprioritize a recommendation. It may not silently change lifecycle truth.

### WOW moment

The dashboard shows "Three people changed behavior this week" and explains each change instead of displaying an unexplained hotness number.

## 7.5 Transaction Document Brain

### User outcome

The realtor uploads or connects an authorized contract, amendment, inspection, association document, or closing artifact and receives a review workspace rather than manual re-entry.

### Capabilities

- OCR and structured extraction.
- Document type classification.
- Parties, property, effective date, price, financing, escrow, closing date, and named contingency extraction.
- Critical-date candidates with source-page citations.
- Comparison between document versions and amendments.
- Missing-signature or missing-field indicators where mechanically observable.
- Conflict detection against stored transaction facts.
- Proposed transaction, milestone, task, and calendar updates.
- Plain-language summary with non-legal-advice boundary.
- Secure retention, deletion, provider, and access state.

No extracted term becomes canonical until an authorized user confirms it. Deadline calculation uses approved rule packs and source facts; the model may not invent legal dates.

### WOW moment

An amendment is uploaded and Omnix highlights exactly what changed, which dates are affected, and what needs confirmation.

## 7.6 Property Match Concierge and Client Workspace

### User outcome

Buyers can express what they want naturally, receive a transparent match collection, and provide feedback that improves the realtor's understanding.

### Capabilities

- Natural-language search translated into visible structured criteria.
- Licensed listing retrieval through approved provider adapters.
- Must-have, preference, exclusion, commute, school, HOA, insurance, flood, and affordability inputs with applicable data-rights and steering safeguards.
- Match explanation tied to listing facts.
- Difference and trade-off comparison.
- Shareable branded collection.
- Favorite, reject, comment, question, and showing-request feedback.
- Realtor-visible behavioral signals and next actions.
- No hidden steering on protected-class proxies.
- No unsupported valuation, insurance, tax, school-quality, safety, or investment-return conclusions.

### WOW moment

The buyer says "quiet one-story home under $550K, room for my mother, not too far from work," sees how Omnix translated the request, and receives properties with explicit fit and trade-off explanations.

## 7.7 Listing and Relationship Growth Studio

### User outcome

One approved source package becomes a coordinated marketing and relationship campaign without repetitive copy work.

### Inputs

- Verified listing facts and media.
- Market update facts.
- Realtor brand voice.
- Audience segment.
- Past-client or homeowner milestone.
- Approved campaign objective.

### Outputs

- Listing description variants.
- Email and text drafts.
- Social captions and channel-specific posts.
- Carousel and short-video scripts.
- Open-house promotion.
- Neighborhood update.
- Postcard copy.
- Review and referral request.
- Annual homeowner or equity check-in.
- Campaign brief, approval set, and attribution links.

All factual claims remain cited. Fair Housing lint, platform limits, consent, brand review, and human approval run before publishing or sending.

### WOW moment

A listing record becomes a complete launch kit with consistent facts and voice, ready for selective approval.

## 7.8 AI Business Coach

### User outcome

The realtor receives an evidence-backed diagnosis of what is producing revenue and what operational bottleneck should be corrected next.

### Capabilities

- Source-to-appointment, appointment-to-client, and client-to-close conversion.
- Speed-to-lead and response coverage.
- Stage aging and follow-up debt.
- GCI, net commission, marketing cost, and verified ROI.
- Relationship and referral contribution.
- Time-to-completion and acceptance rates for Omnix recommendations.
- Campaign performance and attribution boundaries.
- Weekly narrative with exact contributors.
- Scenario recommendations, never guaranteed forecasts.

### WOW moment

Instead of a passive dashboard, Omnix states: "Open-house leads convert to appointments, but your follow-up after day two is breaking. Here are the 14 records and the playbook change to review."

## 8. Priority and dependency decision

| Priority | Capability | User impact | Dependency risk | Decision |
| --- | --- | --- | --- | --- |
| P0 | One-Minute Meeting Brief | Immediate daily value | Low; current CRM evidence already exists | Build first |
| P0 | Post-Conversation Autopilot | Eliminates duplicate work and enriches data | Medium; transcription provider and recording consent | Build typed/text recap first, then audio |
| P0 | Instant Response AI Concierge | Direct conversion impact | High; connector, consent, evaluation, and automation envelope | Build after real channel UAT |
| P0 | Opportunity Radar | Focuses daily work and reactivation | Medium; useful deterministic version can precede predictive data | Build in two stages |
| P1 | Transaction Document Brain | Large administrative and risk reduction | High; document security, extraction, and legal boundary | Controlled pilot |
| P1 | Listing and Relationship Growth Studio | Visible marketing leverage | Medium; brand facts and channel approvals | Build after content governance |
| P1 | AI Business Coach | Founder/operator value | Medium; needs sufficient authoritative history | Build after instrumentation |
| P2 | Property Match Concierge | Strong client-facing differentiation | High; licensed IDX/RESO and Fair Housing design | Conditional on provider rights |

## 9. Recommended first vertical slice

The first release should combine One-Minute Meeting Brief and Post-Conversation Autopilot.

### 9.1 Demo narrative

1. Open Today.
2. See "Sarah Monroe — appointment in 30 minutes."
3. Tap "Brief me."
4. Omnix displays relationship context, preferences, last conversation, open commitments, recent property activity, and a suggested conversation goal with citations.
5. After the appointment, tap "Capture outcome."
6. Record or type a recap.
7. Omnix produces a summary and one consolidated proposal: update two preferences, create two tasks, schedule a follow-up, move nurture state, and prepare an email.
8. The realtor edits and approves selected changes.
9. The contact timeline shows source evidence, approved changes, provider receipts, and the next recommended action.

### 9.2 Why this goes first

- It is understandable in one demonstration.
- It saves time on an existing daily job.
- It improves the quality of the underlying CRM.
- It uses current relationship, property, task, proposal, approval, and timeline foundations.
- The typed-recap version does not require MLS rights or call recording.
- It creates reusable extraction, review, and change-set contracts for calls, documents, and messages.

### 9.3 First-slice acceptance criteria

1. The brief uses only authorized current facts and exposes exact evidence links.
2. The brief loads from Today, contact, and transaction contexts.
3. The recap accepts typed text at launch and supports audio only when an approved transcription adapter is configured.
4. Recap content is treated as untrusted and guard-scanned.
5. Extraction returns typed proposals for note, preference, task, appointment, pipeline, nurture, and follow-up draft.
6. No proposal executes before exact selection and confirmation.
7. The user can accept all, accept selected, edit, reject, or defer.
8. Source, model, policy, version, user edits, approvals, executions, failures, and receipts are linked.
9. Low-confidence and contradictory extractions are highlighted rather than silently applied.
10. Mobile completion requires no desktop-only step and preserves 44-pixel targets, keyboard behavior, 200-percent zoom, reduced motion, and no document overflow.
11. Deterministic brief remains available when the model is unconfigured, over budget, timed out, or failed.
12. Evaluation includes hallucination, commitment ownership, dates, money, negation, opt-out, prompt injection, protected-class content, and cross-workspace isolation.
13. Success is measured through completion time, accepted proposal rate, correction rate, follow-up delay, and data-completeness change; no outcome target is invented before baseline measurement.

## 10. UX system

### 10.1 Today

Today becomes the primary operating surface, not an analytics dashboard.

Top region:

- Today's revenue and risk brief using only supported metrics.
- Appointments requiring preparation.
- New leads waiting for response.
- Opportunities that changed.
- Transactions or commitments at risk.
- Approval queue.
- One recommended operating focus.

Each card answers "why now" and provides one direct action. Counts with different scopes must be reconciled in plain language.

### 10.2 Contact 360

The contact record adds a persistent Intelligence rail:

- Current relationship brief.
- One Next Best Action.
- Intent and relationship-health trend.
- Open commitments.
- Recent property and communication signals.
- Active nurture and transaction state.
- Suggested message.
- "Prepare me" and "Capture outcome" actions.
- AI work log with accepted, edited, rejected, expired, failed, and completed proposals.

The existing human-readable timeline remains the source narrative. Intelligence never replaces the evidence timeline.

### 10.3 Omnix workspace

Omnix remains globally accessible but becomes action-oriented:

- Ask naturally.
- Review today's brief.
- Search authorized business memory.
- Prepare a change set.
- Inspect citations.
- View active approved playbooks.
- Pause automation.
- Review failures and recover.
- Switch between relationship, lead, property, transaction, and business contexts.

The conversational interface must not hide state transitions. Material actions open exact previews in the appropriate domain surface.

### 10.4 Opportunity Radar

Use a ranked list with reason chips and trend, not a decorative heat map. Filters include buyer, seller, sphere, past client, transaction, source, signal type, confidence, and required action.

### 10.5 Capture outcome

Use a mobile-first bottom sheet or dedicated route:

- Record, upload, paste, or type.
- Show consent and retention state.
- Process with clear progress.
- Present a grouped proposal diff.
- Allow item-level edit and selection.
- Confirm.
- Show receipts and the resulting next action.

## 11. Data model additions

Physical design requires architecture review. The logical additions are:

- CommunicationSession: channel, participants, provider binding, consent, start/end, recording state, source.
- ConversationArtifact: transcript or recap metadata, content reference, retention, hash, language, confidence, provider.
- ConversationInsight: typed extraction with source spans, category, confidence, model/policy version, state.
- Commitment: owner, counterparty, description, due date, evidence, completion, contradiction state.
- MeetingBriefSnapshot: source set, generated view, as-of time, expiry, evidence links.
- ContactPreferenceEvidence: typed preference, polarity, confidence, source, confirmed state, supersession.
- IntentSignal: buyer, seller, referral, risk, relationship, property, or response signal with evidence and expiry.
- ScoreSnapshot: score type/version, inputs, coverage, explanation, calibration metadata, expiry.
- AutomationEnvelope: playbook authority, segment, channel, limits, policies, approvals, state, expiry.
- ConciergeConversation: lifecycle, handoff reason, qualification state, appointment state, opt-out, receipts.
- DocumentArtifact: provider/storage reference, type, retention, access, checksum, review state.
- DocumentExtraction: typed fields, source pages/spans, confidence, contradiction, confirmation state.
- CampaignAssetSet: source package, channel variants, brand policy, compliance findings, approvals.
- ClientWorkspace: contact/household authority, shared collection, feedback, consent, revocation.
- IntelligenceOutcome: recommendation-to-action-to-provider-to-business outcome linkage.

Sensitive raw content should remain outside general projections and model prompts. Repository queries must return the minimum typed fields needed for each capability.

## 12. Model and provider strategy

- Preserve a provider-neutral AI interface.
- Route tasks by capability, cost, latency, modality, and approved data policy.
- Use deterministic computation for dates, arithmetic, eligibility, consent, scoring inputs, and execution authority.
- Use models for language understanding, summarization, extraction, drafting, comparison, and explanation.
- Require structured output with schema validation.
- Refuse or retry invalid structured output within a bounded budget.
- Store model, version, policy, prompt-template version, source set, token/cost, latency, and terminal state.
- Never send secrets, unrestricted raw provider payloads, unnecessary contact fields, or cross-workspace context.
- Evaluate exact production routes before activation.
- Preserve a no-model fallback for every critical daily workflow.
- Do not train on workspace data without a separate explicit product, privacy, and legal decision.

## 13. Compliance and trust requirements

Implementation requires current legal review; this PRD is not legal advice.

- TCPA and channel-specific consent.
- National and applicable state Do Not Call requirements.
- A2P 10DLC and provider registration for application-originated messaging.
- STOP and unsubscribe processing.
- Quiet hours and contact timezone.
- Email sender identity and unsubscribe requirements.
- Call-recording consent based on applicable participant jurisdictions.
- Fair Housing review for qualification, content, property matching, scoring, seller targeting, and analytics.
- No protected-class steering or proxy optimization.
- No unlicensed appraisal, lending, tax, insurance, legal, title, or investment advice.
- Data retention, export, correction, deletion, and connector revocation.
- Clear AI disclosure where a channel, law, provider, or user policy requires it.
- Human handoff for low confidence, complaints, legal questions, financing questions, safety concerns, discrimination risk, or explicit request.
- Emergency pause at workspace and playbook level.

## 14. Measurement framework

### 14.1 North-star metric

Weekly relationships or transactions advanced through a verified Omnix-assisted action.

An advance requires:

- A cited recommendation or approved playbook.
- A completed task, response, appointment, confirmed data update, milestone, or campaign action.
- Canonical or provider evidence.
- No unresolved consent or execution contradiction.

### 14.2 Activation metrics

- Time to first useful brief.
- Time to first approved proposal.
- Percentage of active contacts with usable memory and a current next action.
- Percentage of imported contacts correctly classified or explicitly queued for review.
- First-week recurrence of Today and Capture Outcome.

### 14.3 Operational metrics

- Median new-lead response time.
- Percentage of new leads responded to inside configured SLA.
- Follow-up completion and overdue age.
- Meeting-brief usage before appointments.
- Time from conversation end to CRM update.
- Extracted-proposal acceptance, edit, rejection, and deferral rates.
- Appointment booking and attended appointment rate.
- Stale relationship reactivation.
- Transaction deadline confirmation and overdue rate.
- Provider reconciliation delay and failure recovery.

### 14.4 Quality and safety metrics

- Citation coverage.
- Unsupported-claim rate.
- Extraction field precision and correction rate by field.
- Commitment owner and due-date accuracy.
- Opt-out and suppression violations.
- Fair Housing evaluation failures.
- Cross-workspace access failures.
- Prompt-injection refusal.
- Budget and timeout failure rate.
- Automation-envelope boundary violations.
- Human-handoff accuracy.
- User-reported incorrect-memory rate.

### 14.5 Business metrics

- Source-to-appointment conversion.
- Appointment-to-client conversion.
- Client-to-close conversion.
- Verified GCI and net commission influenced by assisted actions.
- Referral and repeat-client contribution.
- Cost per advanced relationship.
- AI/provider cost per completed outcome.
- Retention and weekly active operating users.

No numerical target is approved until the current workspace produces a reliable baseline.

## 15. Delivery plan

### Phase 0 — Baseline reconciliation and release truth

- Decide how the active AI branch will be reconciled with main.
- Complete exact-candidate owner and assistant UAT.
- Complete mobile Safari and installed-PWA UAT.
- Complete real Google, Mailchimp, texting, Gemini, website, and licensed property provider evidence where applicable.
- Resolve migration history and preserve rollback/forward-repair evidence.
- Establish analytics events and baseline metrics.

Exit: one clean release candidate with no contradictory readiness claim.

### Phase 1 — Conversation loop

Stories:

- 10.1 Meeting Brief Snapshot.
- 10.2 Typed Capture Outcome and consolidated proposal diff.
- 10.3 Audio/transcript adapter, recording consent, and retention.
- 10.4 Contact Intelligence rail and AI work log.

Exit: the full pre-conversation and post-conversation demo works on mobile and desktop, with deterministic fallback.

### Phase 2 — Response and prioritization

Stories:

- 10.5 Automation Envelope authority.
- 10.6 Instant Response Concierge for one proven channel.
- 10.7 Explainable Opportunity Radar v1 using deterministic signals.
- 10.8 Warm handoff, appointment booking, and outcome resumption.

Exit: one real lead source and one real outbound channel complete the response, qualification, handoff, and receipt loop.

### Phase 3 — Documents and growth

Stories:

- 10.9 Secure Document Artifact and extraction boundary.
- 10.10 Transaction Document Brain pilot.
- 10.11 Listing and Relationship Growth Studio.
- 10.12 AI Business Coach v1.

Exit: one approved transaction-document type and one campaign source package pass production UAT.

### Phase 4 — Licensed property intelligence

Stories:

- 10.13 Licensed Property Match engine.
- 10.14 Client Workspace and feedback loop.
- 10.15 Seller Opportunity Radar using approved property/public-record data.
- 10.16 Predictive score calibration and monitoring.

Exit: licensed data rights, Fair Housing review, client experience, score calibration, and production reconciliation pass.

## 16. Release gates

Every story must pass:

- Explicit source-of-truth and authority mapping.
- Workspace and role isolation.
- Idempotency, optimistic concurrency, replay, and recovery.
- Deterministic fallback.
- Structured-output validation.
- Grounding and citation tests.
- Adversarial and prompt-injection tests.
- Consent, suppression, and compliance tests where communication is involved.
- Desktop, 390, 768, and 1440 layout checks.
- Keyboard, screen-reader semantics, 200-percent zoom, target size, focus, reduced motion, loading, empty, error, and recovery states.
- Lint, TypeScript, focused tests, full tests, production build, migration replay, SQL/RLS, dependency and secret checks.
- Exact-candidate authenticated UAT.
- Provider UAT and reconciliation when external behavior is claimed.
- Observable rollback or containment recovery.
- Story checklist, file list, QA verdict, and release evidence.

## 17. Non-goals

- A general-purpose autonomous agent with unrestricted tools.
- Scraping MLS or portal data.
- Black-box lead scores without evidence and calibration.
- Automatically creating legal deadlines from unconfirmed model output.
- Fully autonomous bulk marketing.
- Replacing the realtor in negotiation, advice, or fiduciary judgment.
- Training models on customer data by default.
- Unsupported financial, legal, appraisal, lending, insurance, tax, safety, school-quality, demographic, or investment claims.
- Decorative AI activity that does not lead to a useful user action.
- Claiming production readiness from local, sample, or configured state.

## 18. Key risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Feature breadth overwhelms the realtor | Low adoption | Organize around daily moments, one next action, and progressive disclosure |
| AI contaminates CRM truth | Long-term data damage | Store extraction as evidence-backed proposals; confirm before canonical mutation |
| Slow provider or licensing gates | Roadmap delay | Ship meeting/capture and deterministic radar before provider-dependent capabilities |
| Silent compliance failure | Legal and trust exposure | Channel policy engine, consent evidence, evaluation, envelope limits, and emergency pause |
| Weak data produces weak recommendations | Low perceived value | Data coverage shown in every score; capture loop improves data; unknown stays explicit |
| Cost grows faster than outcome | Margin loss | Task routing, caching by source hash, bounded context, budgets, and cost per completed outcome |
| Generic generated copy damages brand | Low trust | Versioned brand voice, source package, edit learning, approval, and compliance lint |
| Incorrect document extraction | Deadline risk | Page citations, typed confidence, contradiction detection, confirmation, and deterministic calculations |
| Branch divergence creates rework | Delivery and migration risk | Reconcile active AI branch before additive Epic 10 implementation |

## 19. Product-owner decisions required

1. Confirm that Omnix is positioned as an AI Revenue and Relationship Operating System, not merely a personal CRM.
2. Approve the first vertical slice: Meeting Brief plus Capture Outcome.
3. Approve the permission ladder and the future opt-in Automation Envelope.
4. Select the first real outbound channel for the Concierge after provider UAT.
5. Decide whether call recording is in the initial audio scope or whether the release begins with realtor-recorded voice recaps.
6. Select the first transaction document type for the Document Brain pilot.
7. Confirm whether the client-facing Property Workspace belongs in this product or a connected consumer experience.
8. Approve the branch reconciliation strategy before implementation continues.

## 20. Definition of WOW

A feature does not qualify as WOW because it uses a model. It qualifies only when:

1. The user immediately understands the value.
2. It completes or materially compresses a real realtor job.
3. It uses the user's authorized business context.
4. It produces an action, decision, or verified outcome.
5. The user can inspect why it happened.
6. The user remains in control.
7. Failure is honest and recoverable.
8. The experience is faster and calmer than the manual alternative.
9. The result improves future recommendations.
10. The effect can be demonstrated with a representative workflow in under three minutes.

The first target demo — Meeting Brief plus Capture Outcome — satisfies these conditions and should be used as the product standard for every later capability.
