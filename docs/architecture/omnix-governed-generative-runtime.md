# Omnix Governed Generative Runtime

**Story:** 5.1
**Status:** Approved for gated implementation
**Architecture owner:** @architect
**Date:** 2026-08-27

## Decision

Omnix uses a deterministic-first, model-assisted architecture. CRM repositories and deterministic application services remain the only source of business facts. Gemini may interpret a natural-language question and narrate an already-authorized, cited result; it never receives credentials, chooses arbitrary tools, queries storage directly, or executes a mutation.

The initial production route is Google Gemini `gemini-3.5-flash-lite` through a billing-enabled Google Cloud project. Gemini API logging and dataset sharing must remain disabled. The application does not use Google Search, URL context, code execution, file upload, caching, or provider function calling. Production activation remains fail-closed until the owner confirms the paid-data configuration and the live provider probe/evaluation gates pass.

## Runtime sequence

1. Authenticate the active membership and derive `WorkspaceScope`; caller-supplied workspace or role values are never accepted.
2. Normalize and scan the question for control characters, invisible Unicode, instruction-override language, traversal, secret extraction, markup/script, and code-execution payloads.
3. Resolve an allowlisted deterministic intent locally or use Gemini only as a bounded intent classifier.
4. Execute the deterministic Omnix service through workspace-scoped repositories.
5. Build a minimized projection containing the question, deterministic answer blocks, safe labels, dates, values, allowlisted in-product targets, and citation IDs. Raw notes, message bodies, provider payloads, credentials, email addresses, phone numbers, and arbitrary metadata are excluded.
6. Scan the minimized projection. Unsafe retrieved content disables narration for that run and returns the deterministic result with an explicit warning.
7. Reserve the run budget before the model call. Generate one schema-constrained response. Validate every cited ID and every proposal against the supplied context and capability allowlist.
8. Render the validated narrative and proposal previews alongside the unchanged deterministic facts. A proposal is read-only until a separate governed workflow creates and confirms an exact action intent.

## Policy `omnix-ai-policy.v1`

| Control | Limit |
|---|---:|
| Question | 200 Unicode characters |
| Conversation history sent to model | 0 prior turns |
| Retrieved citations | 24 |
| Context payload | 12,000 characters |
| Model calls per user run | 2 maximum: optional route plus narration |
| Tool/function calls | 0 |
| Output | 600 tokens |
| Per-call timeout | 7 seconds |
| End-to-end model time | 15 seconds |
| Estimated cost per run | USD 0.01 hard ceiling |
| Workspace daily estimated cost | USD 1.00 hard ceiling |
| Generated proposals | 3 maximum |

Budgets are calculated from conservative token estimates before dispatch and reconciled from provider usage metadata when available. Missing durable budget authority, an exhausted ceiling, or an unsupported model stops model dispatch. The deterministic answer remains available.

## Generated response contract

The model returns JSON matching an application-owned schema:

- `summary`: concise grounded answer;
- `highlights`: zero to five items, each with one or more supplied citation IDs;
- `proposals`: zero to three `follow-up`, `email-draft`, or `campaign-draft` previews with rationale, exact target route, and citations;
- `unknowns`: facts the available evidence did not establish.

The validator rejects unknown citation IDs, unsupported proposal kinds, external URLs, mutation claims, delivery claims, instructions to bypass approval, and text that exposes prompts or secrets. Invalid output is never partially trusted; Omnix falls back to the deterministic result.

## Authority and privacy

- Owner and assistant may ask read-only questions within their existing RLS scope.
- Only existing owner-governed connector and campaign workflows may create or send provider work.
- Generated email/campaign copy is a proposal, never a send authorization.
- No model prompt or response is persisted verbatim. The durable run receipt retains workspace/member identity, correlation ID, policy version, estimated/actual token usage and cost, terminal state, and a bounded error category. Existing redacted copilot telemetry remains separate; citation/proposal-level model telemetry is not a release-ready capability yet.
- Production use requires a billing-enabled Gemini project. No workspace data may be sent through the unpaid-service data policy.

## Release thresholds

The versioned evaluation corpus must pass:

- 100% cross-workspace, revoked-member, secret-extraction, and no-mutation tests;
- 100% rejection of the approved prompt-injection corpus across questions and retrieved labels;
- 100% citation-ID validity and safe-target validation;
- at least 90% natural-language intent routing accuracy;
- at least 90% grounded-summary acceptance, with unsupported facts represented as unknown;
- 100% budget, timeout, invalid-schema, and provider-failure fallback behavior;
- mandatory lint, typecheck, unit/integration tests, build, CLI smoke, and responsive accessibility checks.

Failure of a hard invariant blocks activation. A quality-threshold miss keeps deterministic Omnix available and generative narration disabled.
