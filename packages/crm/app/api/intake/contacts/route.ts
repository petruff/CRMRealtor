import { NextResponse, type NextRequest } from 'next/server';
import { ContactImportError, parseJsonContactImport } from '@/lib/application/contact-import';
import {
  executeContactImport,
  previewContactImport,
  quarantineContactImportRejections,
} from '@/lib/application/contact-import-service';
import {
  MAX_INTAKE_BYTES,
  bearerTokenIsValid,
  intakeConfiguration,
  requestHash,
  receiptReplayState,
  validIdempotencyKey,
} from '@/lib/application/intake-security';
import { createAutomationContext } from '@/lib/data/automation-context';

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
  let claimed = false;

  try {
    const receipt = await context.importGateway.getReceipt(idempotencyKey);
    const replayState = receiptReplayState(receipt, hash);
    if (replayState === 'conflict') return json('Idempotency key was already used for a different request.', 409);
    if (replayState === 'replay' && receipt) {
      return NextResponse.json(receipt.response, {
        status: receipt.statusCode,
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
    claimed = await context.importGateway.claimReceipt({
      idempotencyKey,
      requestHash: hash,
      statusCode: 202,
      response: { ok: false, message: 'Intake request is processing.' },
      createdAt: new Date().toISOString(),
    });
    if (!claimed) {
      const racedReceipt = await context.importGateway.getReceipt(idempotencyKey);
      const racedState = receiptReplayState(racedReceipt, hash);
      if (racedState === 'conflict') return json('Idempotency key was already used for a different request.', 409);
      if (!racedReceipt || racedReceipt.statusCode === 202) return json('This idempotent request is already processing.', 409);
      return NextResponse.json(racedReceipt.response, {
        status: racedReceipt.statusCode,
        headers: { 'Idempotency-Replayed': 'true' },
      });
    }

    const now = new Date();
    const workQueue = {
      workspaceScope: context.workspaceScope,
      incompleteRecordRepository: context.incompleteRecordRepository,
      activityRepository: context.activityRepository,
      idempotencyKeyBase: `intake:${idempotencyKey}`,
    };
    if (parsed.rejected.length > 0) {
      const quarantined = await quarantineContactImportRejections(workQueue, {
        source: parsed.provider,
        rejected: parsed.rejected,
      }, now);
      const response = {
        ok: false,
        message: 'One or more automatic-intake contacts are invalid.',
        rejected: parsed.rejected,
        quarantined,
      };
      await context.importGateway.completeReceipt({
        idempotencyKey,
        requestHash: hash,
        statusCode: 422,
        response,
        createdAt: now.toISOString(),
      });
      return NextResponse.json(response, { status: 422 });
    }
    const missingExternalIds = parsed.candidates
      .filter((candidate) => !candidate.externalId)
      .map((candidate) => candidate.rowNumber);
    if (missingExternalIds.length > 0) {
      const response = {
        ok: false,
        message: 'Every automatic-intake contact requires a non-empty externalId.',
        rows: missingExternalIds,
      };
      await context.importGateway.completeReceipt({
        idempotencyKey,
        requestHash: hash,
        statusCode: 422,
        response,
        createdAt: now.toISOString(),
      });
      return NextResponse.json(response, { status: 422 });
    }
    const preview = await previewContactImport(
      context.repository,
      context.importGateway,
      parsed,
      context.workspaceScope,
    );
    const result = await executeContactImport(
      context.repository,
      context.importGateway,
      preview,
      now,
      workQueue,
    );
    const statusCode = result.failed || result.rejected ? 207 : 200;
    await context.importGateway.completeReceipt({
      idempotencyKey,
      requestHash: hash,
      statusCode,
      response: result,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    if (claimed) {
      try {
        await context.importGateway.releaseReceipt(idempotencyKey, hash);
      } catch (releaseError) {
        console.error('Automatic contact intake could not release its failed reservation.', releaseError);
      }
    }
    if (error instanceof ContactImportError) return json(error.message, 422);
    console.error('Automatic contact intake failed.', error);
    return json('Automatic intake failed safely. Retry with the same idempotency key.', 500);
  }
}
