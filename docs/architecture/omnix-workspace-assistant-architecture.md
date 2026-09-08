# Omnix workspace assistant architecture

Date: 2026-09-07. Architecture authority: Vega (@architect).
Disposition: approved for bounded implementation; release remains evidence-gated.
Source: existing Stories 5.1/5.2/5.3, Epic 10 conversation loop, and the user's explicit request for Gemini to answer, research and help organize the CRM.

## Existing system and concrete gaps

The existing `/omnix` flow already loads registered workspace AI credentials with `loadWorkspaceAiRuntimeCredential`, reserves/finalizes durable model budget, routes a question, reads scoped repositories, renders citations, and persists generated proposals for later approval. No replacement model account, separate agent control plane or vector database is needed for the next increment.

`lib/domain/omnix-copilot.ts` is the current typed read-tool registry: its intent union, examples, parser and executor define supported operations. The Gemini router currently returns only one canonical query or null. The service reads contacts, tasks/activity, rich-contact details, mailers and connector lifecycle. RepositoryContext already exposes additional transaction, nurture, property, affordability, signal and proposal authorities, but the copilot context/intent handlers do not consume them. A question such as a client's deal status can therefore yield a generic contact profile rather than the requested transaction status.

`app/omnix/actions.ts` currently falls from an unmatched model query into public web research. A null/invalid/unsupported CRM route is not proof of public-search intent. This ambiguity must be removed before advertising workspace-wide natural-language access. Private contact names, recap content, financial details or unresolved CRM questions must not be sent to search tools merely because parsing failed.

The narrator accepts cited generated prose, but valid citation IDs alone do not establish that a novel claim is supported. Generated proposals currently cover follow-up/email/campaign and persist through `createOmnixProposalCommand`. The follow-up persistence implementation supplies a next-day due time; that is a proposed schedule, not an extracted client commitment. Chat UI has a 200-character question limit and local transcript state; it is not a durable conversational agent with server-owned thread context.

## Approved implementation boundary

[AUTO-DECISION] Extend the existing assistant or create a new autonomous runtime? → Extend Omnix's typed read intents, scoped executor and governed proposal review (reason: these already enforce tenant, citation, approval and budget boundaries).

[AUTO-DECISION] Index all raw CRM data into a model store? → No (reason: canonical repositories already provide the needed structured facts, and an additional index would introduce stale copies, privacy lifecycle work and unnecessary infrastructure).

The minimal increment provides broad **coverage of available CRM modules**, bounded factual answers and proposed organizational work. It does not promise unrestricted access to every field, private provider body, licensed feed, historical record or unavailable module. Responses report coverage, read time and limitations explicitly. An unavailable adapter is not an empty dataset.

### Routing contract

Use a versioned, strictly validated decision with three outcomes:

- `crm`: one allowlisted typed intent, or a bounded plan of up to three read intents when the implementation supports composition. Intent parameters are primitive validated filters, dates or user-supplied names; the server resolves canonical record identities.
- `public-web`: an explicitly public research question. This permits the existing sourced `researchWithGemini` path without adding private repository data to its request.
- `clarify`: ambiguous target, unsupported private question, insufficient authorization or mixed private/public request that cannot safely be separated.

Preserve existing deterministic command parsing and old canonical commands. Add natural-language aliases for common client status, workspace overview, transactions, properties, nurture, finances and organization questions. Route model output must reject extra keys, arbitrary tools, arbitrary SQL, URLs-as-tools, workspace/member IDs, unsupported actions and unbounded plans. A failed model route must retain a deterministic CRM fallback/clarification; it must not become automatic web research.

If composition is not implemented, return a clear single-scope answer and suggestions for remaining scopes. Never silently drop additional parts of the user's question and call it answered. Mixed public/private research can return separate explicitly labeled CRM and public sections only when each context remains isolated.

### Canonical read registry and coverage

| Intent family | Existing seam | Contract |
| --- | --- | --- |
| Workspace overview and organization | Existing copilot brief/alerts/tasks/pipeline; `operationalSignalRepository`, `attentionRepository` when needed | Deterministic priorities, missing next steps and recorded commitments with source links and clear derivation rules. |
| Client status/profile | `ContactRepository`, `RichContactRepository`, activity, transaction parties, nurture, meeting brief source projection | Resolve one canonical contact; ambiguous names return choices. Distinguish relationship stage, transaction status, qualification and follow-up status rather than collapsing them. |
| Transactions/workflow | `TransactionRepository.list/listParties/listWorkflowPlans/listWorkflowSteps` | Read authorized transactions and known milestones. Client-specific requests filter through canonical parties before projecting facts. |
| Recorded finances | `TransactionRepository.listFinancials`; existing affordability projections where explicitly requested | Distinguish recorded amount, derived estimate, missing financial authority and scenario assumptions. Never present expected commission as received funds or a scenario as lender approval. |
| Properties | `PropertyRepository.list/listFacts/listInterests/listTransactionLinks` | Preserve canonical identity, permission/freshness/retention state and manual versus licensed provenance. Expired or disallowed licensed facts are unavailable. |
| Nurture | `NurturePlanRepository.list/get` | Expose stored plan state, cadence and next step; active plan is not evidence of provider delivery. |
| Proposals and capture | `OmnixProposalRepository`, `CaptureOutcomeRepository` | Distinguish proposed, approved, executing, completed and awaiting-provider states. Return exact review links. |
| Mailers/connections/campaigns | Existing handlers and connector lifecycle projections | Preserve present behavior and distinguish configuration from current provider readiness. |

Extend `OmnixCopilotRepositoryContext` with optional compatible seams so legacy fixtures/consumers continue to work. Keep module read handlers small; avoid making the existing large copilot service an arbitrary query engine. Add citation entity types and known server-generated routes to domain/UI/presentation mapping together. Do not mislabel transaction/property/nurture/finance evidence as contact evidence just to satisfy the old union.

Every handler uses authenticated `WorkspaceScope`, validates subject bindings, and returns bounded answer blocks, citations, unavailable/truncated warnings and coverage. The present contact read cap is 500; some underlying repository methods return a capped list without a total. Never label a capped sum/count as a complete workspace total. Use truthful sampled/recent counts or introduce a bounded aggregate/pagination seam with explicit complete/partial coverage. Filter at the repository where possible; do not load unrestricted raw workspace records merely to discard most of them before the model call.

Read-only model context contains only relevant allowlisted structured facts and source references within existing context/citation ceilings. Never include credentials, hidden operational settings, unrestricted raw messages, or confidential recap text as a generic workspace overview. Notes necessary for an explicit client detail question remain untrusted quoted evidence.

### Grounded response contract

Reuse `OmnixCopilotSuccessResponse` and UI mapping with additive entity/coverage fields. Deterministic fact blocks render even if the model is disabled or fails. Summary interpretation is clearly labeled, and cited evidence preserves source timestamp and response as-of time. Stored notes describe what was recorded; they do not prove external truth.

For newly generated factual sections, prefer model selection/ordering of server-defined fact IDs followed by exact server reconstruction, as used by meeting narration. If free-form synthesis is retained, validate referenced evidence and disallow unsupported names, amounts, dates, status transitions and execution claims; invalid output falls back to deterministic facts. No citation-only validator should be represented as complete factual verification.

The single-turn API remains compatible. Increasing input length requires a named versioned question-policy change across domain, UI, tests and model budget estimates; do not silently remove limits. Server conversational follow-up is a separate bounded addition: resolve user references from authorized explicit context, never treat browser transcript text or stale model output as current canonical facts. Until implemented, pronouns such as "her deal" require a selected client or clarification.

### Organizational actions

Read intent execution must remain free of canonical mutations. Answer suggestions can link directly to existing capture/review flows. Any new assistant-created action must persist an ordinary Omnix proposal with exact target, evidence, payload hash, role requirement, expiry and stable idempotency key, then expose its actual review link. A missing persistence receipt means no actionable preview is claimed.

Reuse Story 10.2 note/task/pipeline/nurture/provider preparation adapters and existing proposal decision/execution commands; do not create an assistant-only mutation API. User wording such as "organize my CRM" authorizes preparation and recommendations, not invented deadlines, silent bulk changes, consent grants, financial changes or sending outreach. Explicitly supplied instructions may populate proposals, but existing exact-review confirmation remains the established mutation boundary.

Suggested due dates must be visibly proposed and editable; dates extracted as commitments must have an exact source or require clarification. Before approving execution, revalidate the target's current state, contact alias/suppression, recipient/connection and domain preconditions. Provider intent receipts mean preparation/awaiting-provider until canonical external evidence exists. Financial/transaction deadline changes without an existing approved adapter remain review links, not executable generic patches.

### Gemini and cost authority

Continue loading the already registered workspace Gemini credential server-side; configuration UI state does not prove live model availability. Preserve active membership, paid-private policy, allowed model configuration, redacted errors and durable budget accounting. Do not print credential values or introduce a second API-key setup flow when a valid registered credential exists.

Current `OMNIX_AI_POLICY` permits two model calls, 12,000 context characters, 24 citations, 600 output tokens, three proposals, seven-second requests and a fifteen-second run. A broader deterministic read plan can still fit router plus narrator; it must not add a separate unbudgeted model call per tool. If a richer answer needs different output limits, introduce a separate bounded versioned policy and tests while preserving the monetary/daily ceiling. Finalize budget on all paths, including malformed output, routing failure and fallback. Context minimization and privacy checks precede dispatch.

## Trade-offs and acceptance

Typed module coverage is less flexible than arbitrary database tools but keeps factual sources, performance and authorization inspectable. Bounded composition costs more read work but answers real multi-module questions without a new model loop. Explicit CRM/public routing reduces accidental disclosure and confusing fallbacks, with clarification required for genuinely ambiguous requests. Proposal review adds a user decision but retains reliable undo/recovery and existing provider safety.

Required evidence before deployment:

- Parser/route tests for common client status questions, supported module queries, public research, mixed/private ambiguity, unknown targets and invalid model tool output.
- Grounding tests for contradictory/stale/missing facts, transactions versus relationship status, calculated versus recorded money, licensed property restrictions, caps/truncation and deterministic model failure fallback.
- Tenant/role tests including canonical contact aliases and cross-workspace IDs; no private context passed to web research; no raw content or credentials in telemetry.
- Proposal tests for exact review links, durable persistence failure, due-date confirmation, unchanged approval authority, stale targets and replay.
- Existing CLI/server/UI parity and regression coverage; responsive, keyboard and screen-reader UI checks.
- Lint, typecheck, full tests, production build, any changed SQL/RLS acceptance, and independent QA against the actual release candidate. Real authenticated Gemini and provider readiness require separate live evidence; no synthetic model response can establish them.

The user's deployment authorization permits progressing through release gates. It does not convert failed CI, missing migrations, unavailable authenticated UAT or unverified provider effects into passes. Preserve the current uncommitted conversation-loop work and bind final deployment claims to the committed candidate and verified environment.

## Release-contract adjudication — 2026-09-08 UTC

This decision reviews `docs/audits/2026-09-07-gemini-agentic-release-readiness.md`, the actual candidate CI workflow, `packages/crm/scripts/release-manifest-supabase-ci.test.ts`, `docs/qa/releases/README.md`, Story 6.12 AC7/AC8 and architecture decision AD-3. It does not grant a policy exception or certify missing evidence.

### Candidate validation is not Production promotion

Ordinary candidate CI deliberately permits zero tracked release manifests to avoid an impossible in-tree exact-SHA self-reference. That behavior authorizes testing a clean candidate; the workflow has no deployment step. It does not contradict the separate requirement to assemble immutable deployment-bound evidence from another clean checkout before Production promotion.

The release README states: "Production promotion is authorized only by an immutable, exact-SHA manifest". AD-3 states that only manifest-linked receipts authorize promotion, and Story 6.12 AC7/AC8 require that binding and fail-closed promotion. The current contract has no narrower application-update exception. Calling this an ordinary update to an existing app, leaving Gemini unconfigured, or retaining provider settings does not create one. Story 9.7's prior deployment is historical evidence, not a policy amendment.

[AUTO-DECISION] Does explicit user authorization to implement/apply/deploy require another generic confirmation? → No. Continue authorized preparation, QA, candidate freeze, exact-SHA CI, recovery evidence and candidate deployment/UAT work. That authorization does not explicitly direct a waiver of the actual release-evidence contract.

[AUTO-DECISION] Can architecture approve Production promotion with ordinary CI alone? → No. Preserve the full manifest requirement and its provider/physical-device gates. A separate application-update policy would require an explicit governed amendment with its own validation contract; no such amendment is enacted here.

A candidate Preview is a valid way to obtain deployment-bound evidence before promotion, provided it does not silently share or mutate Production data. Schema-dependent authenticated UAT needs an appropriately provisioned isolated test environment or a separately accepted Production migration gate; sample mode proves neither. Anonymous health/readiness alone does not establish authorized CRUD or model readiness. The existing production remains the rollback reference until a verified replacement satisfies the applicable gate.

The observed empty `workspace_ai_configurations` and disabled Settings state mean live Gemini acceptance is unavailable until the canonical owner restores/configures the intended credential. Preserve this as an explicit configuration gap; never substitute an unrelated secret or treat UI expectations as evidence. Provider/physical iPhone evidence remains required by the current promotion contract even when the new feature does not activate autonomous behavior.

### Pre-migration recoverability

The written database contract requires a rehearsed rollback/forward-recovery path, not a particular backup command. A complete `pg_dump` or managed backup is valuable, but its absence is not by itself proof that every additive schema change is unrecoverable. Conversely, calling a catalog export a backup does not satisfy data recovery.

A targeted schema recovery path is acceptable **only after evidence establishes all of these conditions**:

1. Enumerate the complete remote-pending migration set, exact checksums, current applied history, dependencies and top-level effects. Distinguish DDL/function definitions from DML executed inside those future functions. Confirm that applying the migrations performs no destructive data rewrite, truncation, deletion, backfill needing reversal, or external side effect.
2. Capture the actual affected live function definitions, signatures, ownership/security settings/ACLs, enum labels, table/constraint/index/trigger/policy/grant definitions, extension dependencies and migration rows. Store and verify protected artifact hashes; do not include secrets or raw customer records in public evidence. This artifact is explicitly a **targeted schema snapshot**, not a full database backup.
3. In disposable infrastructure, reproduce the relevant remote pre-state and validate the ordered migration application, restrictive containment rollback and forward repair, with RLS/authority regression and preservation of representative historical receipts/data. A code-only replay cannot prove that captured live definitions were recoverable if those definitions differ from source.
4. Confirm application compatibility during application rollback and containment. Revoking RPC execution preserves data but can disable existing nurture or other workflows; document those impacts and a verified recovery sequence. Do not claim containment restores complete availability.
5. Apply only reviewed transactional units after those checks, preserving enum commit boundaries. Record history atomically with successful application wherever the administrative path permits it, and verify exact catalog/history afterward. Never mark failed SQL applied or use production for test fixtures/rollback rehearsal.

The readiness investigation has not yet captured or tested that snapshot, so **recoverability is currently unproven and production migration application is not yet approved**. If the complete effects review finds any data-changing operation whose prior state cannot be restored through this path, obtain a real data backup/restore capability before applying that operation. A schema snapshot cannot recover lost rows, credentials, or provider state.

The existing pending reconciliation migration `20260901180000_remote_lint_definition_reconciliation.sql` is already in baseline `eedc12e` but absent remotely. A candidate-diff recovery run whose base is `eedc12e` can therefore omit its rollback/repair despite replaying it on a fresh database. The release recovery plan must cover the **entire observed remote-pending set**, including that reconciliation, from the actual or reproduced remote-equivalent pre-state; do not equate the Git diff with the required live upgrade set.

### Next valid gates

Finish independent QA and authenticated role/CRUD test preparation, freeze the clean candidate, and obtain its actual CI result including SQL/RLS/recovery. In parallel, produce the read-only remote schema snapshot and exact pending-migration recovery plan. Resolve live Gemini configuration through the canonical owner flow. Build deployment-bound candidate/Preview and UAT evidence without inventing missing provider or physical-device receipts. Production promotion remains blocked until the existing manifest contract passes; this finding does not prevent continued implementation, isolated testing or evidence assembly.

Trade-off: preserving the explicit promotion contract can delay this update for provider/device evidence outside its immediate feature scope. Reinterpreting the gate during the release would be faster but would destroy the authority and evidence guarantees the project explicitly adopted. Targeted schema recovery can avoid unnecessary full-data handling for genuinely additive changes, but demands an effects audit and rehearsal and offers no substitute for data restoration when data is changed.
