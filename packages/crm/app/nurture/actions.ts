'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import type { NurturePlanAction } from '@/lib/domain/nurture-plan';

export async function transitionNurturePlanAction(formData: FormData): Promise<void> {
  const planId = formData.get('planId');
  const action = formData.get('action') as NurturePlanAction;
  const expectedVersion = Number(formData.get('version'));
  if (typeof planId !== 'string' || !['pause', 'resume', 'snooze', 'stop'].includes(action)
    || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('The nurture plan action is invalid.');
  }
  const now = new Date();
  const days = Math.min(90, Math.max(1, Number(formData.get('days') ?? 7)));
  const context = await getRepository();
  await context.nurturePlanRepository.transition(context.workspaceScope, planId, {
    expectedVersion, action,
    ...(action === 'snooze' ? { snoozedUntil: new Date(now.getTime() + days * 86_400_000).toISOString() } : {}),
    ...(action === 'stop' ? { stopReason: String(formData.get('stopReason') ?? '').trim() } : {}),
    idempotencyKey: `nurture:${planId}:${expectedVersion}:${action}`,
    occurredAt: now.toISOString(),
  });
  revalidatePath('/nurture');
  revalidatePath('/approvals');
  revalidatePath('/omnix');
}
