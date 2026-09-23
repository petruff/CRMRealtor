'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { ClientPortalError, portalExpiry, validateAudienceLabel } from '@/lib/domain/client-portal';

export interface PortalLinkState {
  readonly status: 'idle' | 'created' | 'error';
  readonly url?: string;
  readonly message?: string;
}

async function origin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/u, '');
  const list = await headers();
  const host = list.get('x-forwarded-host') ?? list.get('host') ?? 'localhost:3000';
  const proto = list.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function createPortalLinkAction(transactionId: string, _state: PortalLinkState, formData: FormData): Promise<PortalLinkState> {
  try {
    const now = new Date();
    const audienceLabel = validateAudienceLabel(formData.get('audience'));
    const expiresAt = portalExpiry(formData.get('days'), now);
    const context = await getRepository();
    const deal = (await context.transactionRepository.list(context.workspaceScope)).find((row) => row.id === transactionId);
    if (!deal) throw new ClientPortalError('This deal is no longer available.');
    if (deal.status === 'lost' || deal.status === 'cancelled') throw new ClientPortalError('Portals are only for active or closed deals.');
    const { token } = await context.clientPortalRepository.create(context.workspaceScope, { transactionId, audienceLabel, expiresAt });
    revalidatePath('/transactions');
    return { status: 'created', url: `${await origin()}/portal/${token}` };
  } catch (error) {
    if (error instanceof ClientPortalError) return { status: 'error', message: error.message };
    console.error('[client-portal:create]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'The link couldn’t be created. Please try again.' };
  }
}

export async function revokePortalLinkAction(formData: FormData): Promise<void> {
  const linkId = String(formData.get('linkId') ?? '');
  if (!/^[0-9a-f-]{36}$/iu.test(linkId)) throw new Error('Choose a link to turn off.');
  const context = await getRepository();
  await context.clientPortalRepository.revoke(context.workspaceScope, linkId, new Date().toISOString());
  revalidatePath('/transactions');
}
