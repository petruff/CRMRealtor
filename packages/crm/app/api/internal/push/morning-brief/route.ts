import { authorizeConnectorCronRequest } from '@/lib/security/connector-cron-auth';
import { sendConfiguredMorningBriefs } from '@/lib/application/morning-brief-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Daily Vercel cron. Same bearer authority as the connector drain; never public. */
export async function GET(request: Request) {
  try {
    authorizeConnectorCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET);
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const result = await sendConfiguredMorningBriefs(process.env);
    return Response.json({ schemaVersion: 'morning-brief-result.v1', result });
  } catch (error) {
    const configured = !(error instanceof Error && error.message.includes('not configured'));
    console.error(JSON.stringify({ schemaVersion: 'morning-brief-error.v1', category: configured ? 'run-failed' : 'not-configured' }));
    return Response.json({ error: configured ? 'unavailable' : 'not-configured' }, { status: configured ? 503 : 501 });
  }
}
