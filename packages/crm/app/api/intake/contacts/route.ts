import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ContactImportError, parseJsonContactImport } from '@/lib/application/contact-import';
import { executeContactImport, previewContactImport } from '@/lib/application/contact-import-service';
import { importResultFromStoredPlan } from '@/lib/application/import-receipt-recovery';
import {
  MAX_INTAKE_BYTES,
  bearerTokenIsValid,
  intakeConfiguration,
  requestHash,
  receiptReplayState,
  validIdempotencyKey,
} from '@/lib/application/intake-security';
import { createAutomationContext } from '@/lib/data/automation-context';
import {
  CONTACT_INTAKE_PENDING_STATUS,
  validateStoredContactImportPlanResult,
} from '@/lib/data/import-gateway';

export const runtime = 'nodejs';

function json(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

async function boundedBody(request: NextRequest): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INTAKE_BYTES) return undefined;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_INTAKE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

export async function POST(request: NextRequest) {
  const startedAt = new Date();
  const correlationId = randomUUID();
  const configuration = intakeConfiguration();
  if (!configuration) return json('Automatic intake is not configured.', 503);
  if (!bearerTokenIsValid(request.headers.get('authorization'), configuration.token)) {
    return json('Unauthorized.', 401);
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!validIdempotencyKey(idempotencyKey)) {
    return json('A valid Idempotency-Key header (8–128 safe characters) is required.', 400);
  }

  const body = await boundedBody(request);
  if (body === undefined) return json('Request body is too large.', 413);
  const hash = requestHash(body);
  let context;
  try {
    context = await createAutomationContext(configuration);
  } catch (error) {
    console.error('Automatic intake workspace binding failed.', error);
    return json('Automatic intake workspace binding is unavailable.', 503);
  }
  try {
    const receipt = await context.importGateway.getReceipt(idempotencyKey);
    const replayState = receiptReplayState(receipt, hash);
    if (replayState === 'conflict') return json('Idempotency key was already used for a different request.', 409);
    if (replayState === 'replay' && receipt) {
      if (receipt.statusCode === CONTACT_INTAKE_PENDING_STATUS) {
        return json('This idempotent request is already processing.', 409);
      }
      const terminal = validateStoredContactImportPlanResult(receipt.response);
      const replayed = importResultFromStoredPlan('automatic-intake', terminal);
      const replayStatus = terminal.counts.rejected || terminal.counts.quarantined ? 207 : receipt.statusCode;
      return NextResponse.json(replayed, {
        status: replayStatus,
        headers: { 'Idempotency-Replayed': 'true' },
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return json('Request body must be valid JSON.', 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json('Request body must be an object.', 422);
    }
    const input = payload as { source?: unknown; contacts?: unknown };
    if (typeof input.source !== 'string' || !Array.isArray(input.contacts)) {
      return json('Provide source and a contacts array.', 422);
    }

    const parsed = parseJsonContactImport({ source: input.source, contacts: input.contacts });
    const now = new Date();
    const workQueue = {
      workspaceScope: context.workspaceScope,
      incompleteRecordRepository: context.incompleteRecordRepository,
      activityRepository: context.activityRepository,
      idempotencyKeyBase: idempotencyKey,
      atomic: {
        requestHash: hash,
        fileHash: hash,
        correlationId,
        startedAt: startedAt.toISOString(),
      },
    };
    const missingExternalIds = parsed.candidates
      .filter((candidate) => !candidate.externalId)
      .map((candidate) => candidate.rowNumber);
    if (missingExternalIds.length > 0) {
      const response = {
        ok: false,
        message: 'Every automatic-intake contact requires a non-empty externalId.',
        rows: missingExternalIds,
      };
      return NextResponse.json(response, { status: 422 });
    }
    const preview = await previewContactImport(
      context.repository,
      context.importGateway,
      parsed,
      context.workspaceScope,
      context.activityRepository,
    );
    await executeContactImport(
      context.repository,
      context.importGateway,
      preview,
      now,
      workQueue,
    );
    const terminalReceipt = await context.importGateway.getReceipt(idempotencyKey);
    if (!terminalReceipt || terminalReceipt.requestHash !== hash || terminalReceipt.statusCode !== 200) {
      throw new Error('Automatic intake terminal receipt is missing or does not match its request.');
    }
    const terminal = validateStoredContactImportPlanResult(terminalReceipt.response);
    const result = importResultFromStoredPlan('automatic-intake', terminal);
    const statusCode = terminal.counts.rejected || terminal.counts.quarantined ? 207 : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    if (error instanceof ContactImportError) return json(error.message, 422);
    console.error('Automatic contact intake failed.', error);
    return json('Automatic intake failed safely. Retry with the same idempotency key.', 500);
  }
}
