# Architecture Decision — Florida Transaction Authority

**Decision:** accepted for Story 7.1 implementation
**Scope:** transactions, parties, contact relationships, milestones, finance, property references, AI proposals, and provider actions

## Context

The original transaction create RPC changed a linked contact's Pipeline stage when a deal became `under-contract` or `closed`. That made one financial/operational record silently authoritative over a different relationship record. It also made replay, reversal, multi-transaction contacts, leases, referrals, and lost/cancelled scenarios ambiguous.

## Decision

1. A contact describes a relationship. Its lead type and Pipeline stage are relationship facts.
2. A transaction describes one buyer, seller, listing, lease, or referral process. Its kind, side, status, parties, milestones, and economics are transaction facts.
3. A property describes a real-world asset or interest. It is not contact identity and is not transaction status.
4. No transaction create, edit, deadline, financial update, party change, AI recommendation, or provider callback may silently mutate contact lead type or Pipeline stage.
5. A desired relationship change is a separate typed proposal/command with its own authority, current-source check, approval where required, receipt, and recovery path.
6. Existing transaction rows migrate to `unclassified` with `kindVerified=false`. The system does not infer buyer/seller/listing/lease meaning from representation side or address.
7. New transactions require a verified kind and title. Source remains a captured transaction snapshot and does not track later contact-source edits.
8. Transaction and party changes use optimistic versions and append-only events. Direct authenticated writes remain denied.
9. Additional parties may link to an existing contact, but a label alone never creates, resolves, or merges contact identity.
10. Today, Alerts, Approvals, Insights, and Omnix consume canonical projections; they do not recreate transaction state from page-local heuristics.

## Authority matrix

| Operation | Owner | Active assistant | Support administrator | Provider/AI |
| --- | --- | --- | --- | --- |
| Read workspace transactions | Allow | Allow | Only explicit support read | No direct authority |
| Create/edit/transition ordinary transaction | Allow | Allow | Deny unless separately named | Proposal only |
| Add or update a transaction party | Allow | Allow | Deny unless separately named | Proposal only |
| Change contact Pipeline from transaction context | Separate governed command | Separate governed command | Deny | Proposal only |
| Change workspace ownership/provider/AI secrets | Owner only | Deny | Deny | Deny |
| Append history | Security-definer command | Security-definer command | No direct write | No direct write |

## Failure and recovery model

- Stale versions, replay with different input, missing responsibility, cross-workspace IDs, and archived contacts fail before mutation.
- Exact replay returns the existing receipt and does not append duplicate history.
- The Story 7.1 rollback is a non-destructive feature deactivation: it revokes mutation RPCs while retaining schema and evidence.
- Forward repair restores least-privilege grants after validation. Productive history is never deleted to simulate rollback.
- Provider or AI uncertainty cannot mark a transaction, party, milestone, or contact changed without canonical evidence.

## Consequences

- Transaction dashboards may show a closed deal linked to a still-active relationship. That is valid and explicit.
- A contact may have multiple simultaneous or historical transactions without state collision.
- Legacy transactions require a bounded review to verify type; Omnix may prioritize that review but cannot fill it silently.
- Financial and deadline features can evolve independently while preserving contact identity and relationship history.
