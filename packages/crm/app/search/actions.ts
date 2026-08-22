'use server';

import { getRepository } from '@/lib/data';
import { searchCrm } from '@/lib/application/crm-search-service';
import { resolveCrmCommand } from '@/lib/domain/crm-search';

export async function searchCrmAction(query: string) {
  try {
    return { ok: true as const, response: await searchCrm(await getRepository(), query) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : 'Search failed safely.' };
  }
}

export async function resolveCrmCommandAction(commandId: string) {
  try {
    return { ok: true as const, command: resolveCrmCommand(commandId) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : 'Command is unavailable.' };
  }
}
