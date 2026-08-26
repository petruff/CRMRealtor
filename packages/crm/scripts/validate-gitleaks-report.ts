import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface BaselineFinding {
  rule: string;
  path: string;
  line: number;
  secretSha256Parts: string[];
  reason: string;
}

interface GitleaksFinding {
  RuleID?: unknown;
  File?: unknown;
  StartLine?: unknown;
  Secret?: unknown;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function signature(finding: { rule: string; path: string; line: number; secretSha256: string }): string {
  return `${finding.rule}\u0000${finding.path}\u0000${finding.line}\u0000${finding.secretSha256}`;
}

function baselineSignature(finding: BaselineFinding): string {
  return signature({
    rule: finding.rule,
    path: finding.path,
    line: finding.line,
    secretSha256: finding.secretSha256Parts.join(''),
  });
}

function parseArguments(arguments_: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    values.set(key.slice(2), value);
  }
  return values;
}

export function validateGitleaksFindings(
  reportValue: unknown,
  baselineValue: unknown,
  snapshotRootValue: string,
): void {
  if (!Array.isArray(reportValue)) throw new Error('Gitleaks report must be a JSON array.');
  if (!baselineValue || typeof baselineValue !== 'object' || Array.isArray(baselineValue)) throw new Error('Gitleaks baseline must be an object.');
  const baselineObject = baselineValue as { schemaVersion?: unknown; findings?: unknown };
  if (baselineObject.schemaVersion !== 1 || !Array.isArray(baselineObject.findings)) throw new Error('Gitleaks baseline schema is invalid.');
  const snapshotRoot = resolve(snapshotRootValue);

  const baseline = (baselineObject.findings as BaselineFinding[]).map((finding, index) => {
    if (!finding || typeof finding !== 'object' || typeof finding.rule !== 'string' || typeof finding.path !== 'string'
      || !Number.isInteger(finding.line) || !Array.isArray(finding.secretSha256Parts)
      || finding.secretSha256Parts.length !== 8 || finding.secretSha256Parts.some((part) => !/^[a-f0-9]{8}$/.test(part))
      || !DIGEST_PATTERN.test(finding.secretSha256Parts.join('')) || typeof finding.reason !== 'string' || !finding.reason) {
      throw new Error(`Gitleaks baseline finding ${index} is invalid.`);
    }
    return finding;
  });

  const observed = reportValue.map((value, index) => {
    const finding = value as GitleaksFinding;
    if (typeof finding.RuleID !== 'string' || typeof finding.File !== 'string' || !Number.isInteger(finding.StartLine) || typeof finding.Secret !== 'string') {
      throw new Error(`Gitleaks report finding ${index} is invalid or redacted.`);
    }
    const absolute = resolve(finding.File);
    const fromSnapshot = relative(snapshotRoot, absolute);
    if (!fromSnapshot || fromSnapshot === '..' || fromSnapshot.startsWith(`..${sep}`) || isAbsolute(fromSnapshot)) {
      throw new Error(`Gitleaks finding ${index} is outside the candidate snapshot.`);
    }
    return {
      rule: finding.RuleID,
      path: fromSnapshot.replaceAll('\\', '/'),
      line: finding.StartLine as number,
      secretSha256: createHash('sha256').update(finding.Secret).digest('hex'),
    };
  });

  const expectedSignatures = new Set(baseline.map(baselineSignature));
  const observedSignatures = new Set(observed.map(signature));
  const unexpected = observed.filter((finding) => !expectedSignatures.has(signature(finding)));
  const missing = baseline.filter((finding) => !observedSignatures.has(baselineSignature(finding)));
  if (unexpected.length || missing.length || observed.length !== observedSignatures.size || baseline.length !== expectedSignatures.size) {
    const safeUnexpected = unexpected.map(({ rule, path, line }) => `${rule} at ${path}:${line}`).join(', ') || 'none';
    const safeMissing = missing.map(({ rule, path, line }) => `${rule} at ${path}:${line}`).join(', ') || 'none';
    throw new Error(`Secret scan baseline mismatch. Unexpected: ${safeUnexpected}. Missing or changed: ${safeMissing}.`);
  }
}

async function main(): Promise<void> {
  const values = parseArguments(process.argv.slice(2));
  const reportPath = values.get('report');
  const snapshotRoot = values.get('snapshot-root');
  const baselinePath = values.get('baseline') ?? fileURLToPath(new URL('./gitleaks-baseline.json', import.meta.url));
  if (!reportPath || !snapshotRoot) throw new Error('Usage: validate-gitleaks-report.ts --report <json> --snapshot-root <path> [--baseline <json>]');
  const [report, baseline] = await Promise.all([
    readFile(resolve(reportPath), 'utf8').then((contents) => JSON.parse(contents) as unknown),
    readFile(resolve(baselinePath), 'utf8').then((contents) => JSON.parse(contents) as unknown),
  ]);
  validateGitleaksFindings(report, baseline, snapshotRoot);
  process.stdout.write(`Secret scan accepted with ${(report as unknown[]).length} reviewed baseline findings and no drift.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
