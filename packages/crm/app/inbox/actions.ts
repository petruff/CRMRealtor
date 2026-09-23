'use server';

import { loadInbox } from './load-inbox';

/** Badge count for the navigation. Returns undefined rather than a false zero. */
export async function inboxBadgeAction(): Promise<{ total: number; urgent: number } | undefined> {
  try {
    const { projection } = await loadInbox();
    return { total: projection.total, urgent: projection.urgent };
  } catch {
    return undefined;
  }
}
