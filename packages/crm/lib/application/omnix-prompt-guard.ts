import { createHash } from 'node:crypto';

export const OMNIX_PROMPT_GUARD_VERSION = 'omnix-prompt-guard.v1' as const;

export type OmnixPromptGuardCode =
  | 'control-character'
  | 'invisible-unicode'
  | 'instruction-override'
  | 'prompt-extraction'
  | 'path-traversal'
  | 'code-execution';

export interface OmnixPromptGuardResult {
  readonly safe: boolean;
  readonly version: typeof OMNIX_PROMPT_GUARD_VERSION;
  readonly codes: readonly OmnixPromptGuardCode[];
  readonly contentHash: string;
}
const CHECKS: ReadonlyArray<readonly [OmnixPromptGuardCode, RegExp]> = [
  ['control-character', /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u],
  ['invisible-unicode', /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u],
  ['instruction-override', /\b(?:ignore|disregard|forget|override|bypass)\b[\s\S]{0,80}\b(?:previous|prior|system|developer|instruction|policy|guard)\b/iu],
  ['prompt-extraction', /\b(?:reveal|show|print|repeat|expose|leak)\b[\s\S]{0,80}\b(?:system prompt|developer message|hidden instruction|api key|secret|credential|token)\b/iu],
  ['path-traversal', /(?:\.\.[\\/]){1,}|(?:^|\s)[a-z]:\\(?:windows|users)\\/iu],
  ['code-execution', /(?:<script\b|javascript:|\beval\s*\(|\bexec\s*\(|\bpowershell\b|\bcmd\.exe\b|\brm\s+-rf\b|\bdrop\s+table\b|\bunion\s+select\b)/iu],
];

export function scanOmnixPromptContent(value: string): OmnixPromptGuardResult {
  const normalized = value.normalize('NFKC');
  const codes = CHECKS.filter(([, pattern]) => pattern.test(normalized)).map(([code]) => code);
  return Object.freeze({
    safe: codes.length === 0,
    version: OMNIX_PROMPT_GUARD_VERSION,
    codes,
    contentHash: createHash('sha256').update(normalized).digest('hex'),
  });
}
