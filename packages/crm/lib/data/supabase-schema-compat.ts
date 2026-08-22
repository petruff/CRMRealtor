interface SupabaseSchemaError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST205', '42P01', '42883']);

/**
 * Production can briefly run an application release before its additive,
 * optional read model is promoted. Only the exact missing capability is
 * treated as absent; authorization, network and malformed-data failures still
 * fail closed.
 */
export function isMissingSchemaCapability(
  error: SupabaseSchemaError | null | undefined,
  capabilities: readonly string[],
): boolean {
  if (!error?.code || !MISSING_SCHEMA_CODES.has(error.code)) return false;
  const evidence = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  return capabilities.some((capability) => evidence.includes(capability));
}
