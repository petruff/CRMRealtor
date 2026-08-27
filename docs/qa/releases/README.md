# Release evidence

Production promotion is authorized only by an immutable, exact-SHA manifest at:

```text
docs/qa/releases/<40-character-candidate-sha>/release-manifest.json
```

The manifest is evidence, not a readiness claim by itself. Validation rejects a dirty evidence checkout, an unavailable or unexpected candidate commit, migration drift, a deployment bound to another SHA or digest, an unsupported Vercel cron schedule, incomplete provider inventory, missing or duplicate provider evidence, incomplete authenticated UAT, path aliases or traversal, and missing quality-gate receipts.

The scheduler contract is plan-aware and fail closed:

- The linked project was verified as Hobby on 2026-08-25. Hobby must use `0 6 * * *` as a daily maintenance-only sweep, record `interactiveConnectorSloMet: false`, and block live connector promotion; each candidate still requires fresh read-only plan evidence.
- A future read-only verification of Pro or Enterprise may use the intended `*/2 * * * *` cadence and mark the interactive worker eligible. The manifest does not upgrade the plan or change Vercel configuration.
- Cron invocations execute Vercel Functions and consume the plan's normal function usage. The manifest therefore requires a deployment-bound `scheduler-plan-support` receipt rather than inferring plan support from repository configuration.

## Local commands

Run from `packages/crm`:

```bash
npm run test:release-manifest
npm run release:manifest:validate -- --repo ../.. --manifest docs/qa/releases/<sha>/release-manifest.json --expected-sha <sha>
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/release-manifest.ts validate-tree --repo ../.. --require-manifest true
```

Creation is deliberately fail closed and refuses a dirty tree or an existing output file:

```bash
npm run release:manifest:create -- --repo ../.. --candidate-sha <sha> --candidate-branch <branch> --evidence docs/qa/releases/templates/assembled-evidence.json
```

The create command requires an explicit available candidate commit, computes the ordered migration checksums from that Git object, validates every referenced receipt from a separate clean evidence checkout, and writes with exclusive-create semantics. This avoids the self-reference error that would arise if adding receipts changed the candidate SHA. It never deploys, applies a migration, changes provider configuration, or overwrites evidence.

## Receipt contract

Every receipt is JSON and every manifest reference includes the repository-relative path plus the SHA-256 checksum of the exact receipt bytes. All receipts require:

```json
{
  "kind": "receipt-kind",
  "result": "pass",
  "candidateSha": "40-character-sha",
  "observedAt": "2026-08-25T12:00:00.000Z"
}
```

Additional required fields by kind:

| Kind | Required evidence |
|---|---|
| `deployment` | `deploymentId`, `deploymentDigest` |
| `scheduler-plan-support` | deployed ID, exact Vercel project/team IDs, verified plan, exact schedule, `supported: true`, `verifiedReadOnly: true`, and live-promotion decision |
| `migration-history` | exact `observedVersions` array |
| `migration-replay` | exact ordered `migrations` path/checksum array |
| `post-apply-schema-check` | `deploymentId` |
| `application-rollback-rehearsal` | deployed ID and rollback target SHA/deployment |
| `database-recovery-rehearsal` | deployed ID and rollback target SHA/deployment |
| `rollback-authority-regression` | proof the rollback target does not restore administrator-as-owner authority |
| `provider-lifecycle` | deployed ID, Google or Mailchimp provider, `actorClassification: canonical-owner`, and facts exactly matching the manifest record |
| `twilio-readiness` | deployed ID plus account, Messaging Service, A2P, sender, inbound/status callbacks, consent/STOP/HELP/quiet-hours, and real-number UAT facts |
| `meta-readiness` | deployed ID plus business/App Review, exact permissions, selected assets, signed webhook, token health, and real-account UAT facts |
| `authenticated-uat-route` | deployed ID, authenticated owner role, workspace hash, exact route/width, browser/device/version/mode/orientation, safe-area/overflow facts, and outcome/health/readiness |
| `authenticated-uat-device-mode` | dedicated iPhone 11 Mobile Safari evidence for browser and installed-PWA standalone modes |
| `quality-gate` | gate name from the required set |

Receipts must contain redacted identifiers or hashes only. Do not store tokens, cookies, raw provider payloads, personal contact data, or secrets.

## Provider inventory

The validator derives the applicable provider inventory from `CONNECTOR_PROVIDERS` in the exact candidate Git object and excludes only the explicit `contract-test` adapter. `providerInventory` must declare that ordered inventory, and `providers` must contain exactly one evidence record for each provider—currently Google, Mailchimp, Twilio, and Meta. An omitted, extra, or duplicated record fails closed.

Google records additionally declare required, granted, and missing scopes; scope-review status; real-account UAT; and capability health. Mailchimp records additionally declare audience binding, webhook, baseline, reconciliation, and real-account UAT facts. Twilio and Meta use provider-specific receipt kinds and closed fact schemas, so a generic lifecycle receipt cannot authorize either provider. A ready lifecycle is accepted only when every provider-specific fact is promotion-ready. Receipt facts must exactly match manifest facts.

## Required UAT matrix

- Widths: 390, 414, 768, and 1440.
- Routes: contacts, import, pipeline, Omnix, connections, insights, and sign-in/theme.
- Actor: authenticated canonical owner.
- Target: the exact deployment ID and candidate SHA recorded in the manifest.
- Evidence: exactly 28 unique route-by-width records. Every cell requires explicit device, browser, dotted browser version, display mode, orientation, safe-area handling, horizontal overflow, clipped-control status, `outcome: pass`, `health: healthy`, `readiness: ready`, and its own checksum-bound `authenticated-uat-route` receipt.
- iPhone 11: separate checksum-bound Mobile Safari receipts are mandatory for normal browser mode and an installed PWA in standalone mode, both at 414px portrait with safe-area and overflow proof.

Provider evidence marked blocked, stale, unknown, or produced by a support administrator remains useful diagnostic evidence, but cannot pass this promotion gate.

## CI behavior

`.github/workflows/ci.yml` runs dependency audit, pinned Gitleaks, lint, typecheck, full tests, a clean local Supabase migration replay, migration-history completeness checks, all pgTAP database tests, candidate-migration rollback plus ordered forward-repair rehearsal with pgTAP after recovery, required canonical manifest-tree validation, and build on one clean checkout at `github.sha`. Third-party workflow dependencies are pinned to immutable commit SHAs.

The secret scan uses a `git archive` of the exact candidate rather than the mutable working directory. Six reviewed false positives from existing documentation, a test fingerprint, and a public schema constant are bound by rule, path, line, and SHA-256 of the matched text in `packages/crm/scripts/gitleaks-baseline.json`. A new finding—or changed content at a reviewed location—fails closed without printing the matched value.

`.github/workflows/release-evidence.yml` is manual and read-only. It accepts only `docs/qa/releases/<candidate-sha>/release-manifest.json`, checks out the evidence revision and exact candidate separately, uses the manifest's distinct rollback target as the migration comparison base, reruns all candidate gates, independently replays migration history, rehearses every candidate migration's rollback/forward repair, runs pgTAP after recovery, then validates the immutable manifest and receipt checksums. Migration receipts are corroborating evidence, never a substitute for replay. The workflow contains no deployment or provider mutation step.
