import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/data';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { workspaceRepository, workspaceScope, isLive } = await getRepository();
    if (!isLive) {
      return NextResponse.json(
        {
          ok: false,
          product: 'Omnix',
          mode: 'sample',
          message: 'Sign in to inspect authenticated workspace health.',
        },
        { status: 401 },
      );
    }
    if (workspaceScope.role !== 'owner') {
      return NextResponse.json(
        { ok: false, message: 'Workspace owner access is required.' },
        { status: 403 },
      );
    }
    const health = await workspaceRepository.health(workspaceScope);
    return NextResponse.json({
      ok: health.status === 'healthy',
      product: 'Omnix',
      mode: 'live',
      health,
    }, { status: health.status === 'healthy' ? 200 : 503 });
  } catch (error) {
    console.error('Workspace health check failed.', error);
    return NextResponse.json(
      { ok: false, message: 'Workspace health is unavailable.' },
      { status: 503 },
    );
  }
}
