# Incident response and restore runbook

**Scope:** Omnix CRM production (Vercel + Supabase) for an independent Florida realtor.
**Why it exists:** the Florida Information Protection Act (FIPA, Fla. Stat. §501.171) requires notice to affected Florida residents within 30 days of determining a breach of personal information, notice to the Attorney General when 500+ residents are affected, and "reasonable measures" to protect data. A written, rehearsed plan is part of that evidence. This is operational guidance, not legal advice — involve counsel for any real incident.

## 1. Roles
| Role | Person | Responsibility |
|---|---|---|
| Incident lead | Paulo (engineering) | Containment, evidence, technical timeline |
| Data owner | Judith (workspace owner) | Business decisions, client communication, legal counsel |
| Counsel | To be named by Judith | Notification obligations and wording |

## 2. First hour — contain
1. Record the time the issue was first suspected (starts the internal clock).
2. Revoke sessions: Settings → *Sign out of all devices* for each affected account; rotate the Google password if account takeover is suspected.
3. Rotate secrets that could be involved: Supabase service-role key, `OMNIX_INTAKE_TOKEN`, connector KEK (see `CONNECTOR_KEK_*` runbooks), Gemini key (Settings → Omnix AI), provider tokens (Connections → disconnect).
4. Pause outbound automation: disable connector flags (`OMNIX_CONNECTOR_*_ENABLED=false`) and redeploy.
5. Preserve evidence before changing data: export Supabase logs (auth, API, Postgres) and Vercel request logs for the window.

## 3. First 72 hours — assess
- Which tables and which people were exposed? Use `activity_events`, connector receipts and Supabase logs.
- Does the data meet FIPA's "personal information" definition (name + SSN/ID/financial account/medical/health insurance, or username/email + password)? Contact lists alone (name, phone, email) usually do not, but client documents may.
- Decide with counsel whether notice is required; if yes, the 30-day limit runs from that determination.

## 4. Restore
Supabase Point-in-Time Recovery (PITR) must be enabled on the production project (Pro plan add-on).
1. Identify the last known-good timestamp.
2. Restore to a **new** project first; never overwrite production blind.
3. Verify counts for `contacts`, `notes`, `note_revisions`, `activity_events`, `transactions` against the incident timeline.
4. Point a preview deployment at the restored project, smoke-test sign-in, Today, a contact, notes.
5. Promote only with the data owner's approval; record the decision in `docs/incidents/`.

## 5. Rehearsal (quarterly)
- Restore the latest backup into a scratch project and run the smoke test above.
- Confirm every secret listed in step 2.3 can still be rotated by the current operators.
- Record the date, duration and gaps in `docs/incidents/restore-drills.md`.
