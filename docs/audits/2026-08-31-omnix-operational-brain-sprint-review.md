# Omnix Operational Brain — Sprint Review

**Date:** 2026-08-31
**Scope:** Story 5.1 operational proposal layer and the authorized second-brain backlog
**Decision:** CONCERNS — both implementation sprints and the Production schema are integrated; live provider evidence and authenticated UAT remain gated.

## Executive truth

Omnix now has a persistent operational core for recommendations, governed execution, nurture recurrence, bounded opt-in inbound-response classification and verified transaction deadlines. The three additive migrations and their transactional SQL suites passed on the Judith Production project. The current branch still does not prove the complete automated second-brain outcome because restricted Gmail consent, live connector reconciliation, live Gemini evaluation and authenticated device UAT remain open.

## Sprint 1 — implemented locally

| Capability                              | Evidence                                                                                                                                     | Status                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Versioned, recoverable action proposals | Workspace-scoped proposals, immutable versions, append-only events, content hashes, expiry, RLS, rollback and forward repair                 | Implemented locally                                    |
| Central Approval Inbox                  | Prioritized `/approvals` surface with evidence, exact version, owner/member authority, approve/reject and retry states                       | Implemented locally                                    |
| Explainable smart FIFO                  | Deterministic score combines urgency, lead temperature, overdue days, awaiting reply and potential value; stable FIFO resolves ties          | Implemented locally                                    |
| Persistent next best action             | Daily attention materialization creates one idempotent recommendation per contact                                                            | Implemented locally                                    |
| Relationship memory                     | Cited deterministic relationship summary and next action are persisted per contact                                                           | Implemented locally                                    |
| Governed CRM mutations                  | Exact approval can create an idempotent task or move a pipeline stage with a terminal execution receipt                                      | Implemented locally                                    |
| Governed provider draft handoff         | Exact owner approval can prepare a Gmail intent, Google Calendar intent or Mailchimp campaign draft through the existing connector authority | Implemented locally; real-account UAT pending          |
| Failure recovery                        | Provider handoff failures are recorded without claiming success and can be retried                                                           | Implemented locally                                    |
| Scheduled materialization               | Existing daily worker refreshes attention, recommendations and relationship memories                                                         | Implemented locally; remote scheduler evidence pending |

## Sprint 2 — implemented locally

1. Persisted nurture plans with `start`, `pause`, `resume`, `snooze`, `stop`, step history, recurrence and scheduler materialization.
2. Deterministic incoming Gmail metadata plus a separate restricted-scope Gmail Insights bundle that retrieves bounded inline text, refuses attachments, guard-scans untrusted input and persists only bounded classifications and hashes.
3. Transaction milestone entities for inspection, financing, appraisal, title, contingency and closing deadlines instead of contact-stage inference.
4. Deadline-driven recommendations and verified ledger rollups for volume, GCI, net commission, expenses and profitability.
5. Today links Approval Inbox, incoming-response and transaction-deadline counts to their exact workflows.
6. A redacted, fail-closed exact-model evaluation runner with routing, injection and grounded-output thresholds.

## External or policy gates still open

1. Content-level email intent, urgency, sentiment and summary are implemented behind a separate Gmail read scope. The Judith connection still has the five core scopes and must explicitly authorize Gmail Insights before the feature runs.
2. Mailchimp baseline, signed webhook and reconciliation evidence must run against Judith's selected audience.
3. Judith's workspace currently has no saved Gemini configuration. The exact-model evaluation must run after she saves the paid-private credential and preserve its redacted report.
4. Authenticated UAT must run as Judith owner and assistant, plus iPhone 11 Safari and installed PWA.

## Safety and architecture decisions

- AI output cannot write or call a provider directly.
- Approval is bound to the exact persisted version and content hash.
- Provider proposal approval creates a separate connector draft or intent; it does not send, schedule or publish.
- External work continues through connector jobs, receipts, reconciliation and the existing owner approval boundary.
- Scheduler-created recommendations are idempotent and service-authorized; browser clients do not receive scheduler authority.
- Live connection, model, migration and UAT claims require direct evidence and cannot be inferred from local tests.

## Local verification

- Focused Omnix domain, repository, materializer, command, executor, persistence and provider-handoff tests: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Full application suite: 223 files / 1,125 tests passed after the final operational-memory increment.
- Production build: passed; `/approvals`, `/nurture` and `/transactions` compiled as dynamic authenticated routes.
- All three migrations were applied to the Judith Production project. Their transactional SQL suites passed remotely and rolled back all synthetic data. Local Docker remains unavailable, so no separate local replay was claimed.

## Release blockers

- Reconcile the manually applied Production schema with a future canonical migration-history baseline before enabling unattended CLI pushes.
- Preserve real-account Google/Mailchimp negative-path and reconciliation evidence.
- Complete authenticated owner/assistant and device UAT.

Commit, push and deployment remain pending the final repository gates. No provider completion or authenticated UAT is claimed by this review.
