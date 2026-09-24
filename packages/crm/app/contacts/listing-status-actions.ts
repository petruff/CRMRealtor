'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { setListingStatus } from '@/lib/application/listing-status-commands';
import { ListingStatusError } from '@/lib/domain/listing-status';

export type ListingStatusResult = { readonly status: 'saved' | 'error'; readonly message: string };

/** She marks a seller's home as listed (or pending, sold, withdrawn). */
export async function setListingStatusAction(contactId: unknown, status: unknown, propertyAddress: unknown): Promise<ListingStatusResult> {
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const result = await setListingStatus({
      repository, contactId, status, propertyAddress,
      ...(activityRepository ? { activity: { repository: activityRepository, scope: workspaceScope } } : {}),
    });
    if (typeof contactId === 'string') revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/');
    return { status: 'saved', message: result.message };
  } catch (error) {
    if (error instanceof ListingStatusError) return { status: 'error', message: error.message };
    console.error('[listing-status]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'The listing status couldn’t be saved. Nothing was changed.' };
  }
}
