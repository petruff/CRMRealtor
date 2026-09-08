import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { exportCaptureOutcome } from '@/lib/application/capture-outcome-export';
import { captureExportReceiptWriter } from '@/lib/data/capture-export-receipt';
import { CaptureOutcomeError } from '@/lib/domain/capture-outcome';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const context = await getRepository();
    if (!context.captureOutcomeRepository) throw new Error('unavailable');
    const client = context.isLive ? await createSupabaseServerClient() : undefined;
    if (context.isLive && !client) throw new Error('unavailable');
    const result = await exportCaptureOutcome({ scope: context.workspaceScope, captures: context.captureOutcomeRepository,
      contacts: context.repository, recordReceipt: client ? captureExportReceiptWriter(client, context.workspaceScope) : async () => { /* Explicit sample export has no durable audit receipt. */ },
    }, { contactId: id, proposalId: url.searchParams.get('proposalId') ?? '', includeSource: url.searchParams.get('includeSource') === 'true' });
    return new Response(result.body, { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"` } });
  } catch (error) {
    return Response.json({ error: 'This review could not be exported. Reopen it and retry.' }, {
      status: error instanceof CaptureOutcomeError && error.code === 'not-found' ? 404 : 503, headers,
    });
  }
}
