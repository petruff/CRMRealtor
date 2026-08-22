'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { ConnectorError } from '@/lib/domain/connector';
import { loadGoogleConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createGoogleOperationServerRepository } from '@/lib/data/google-operation-server-context';
import {
  prepareGoogleCalendarTaskIntent,
  prepareGoogleCalendarTaskLifecycleIntent,
} from '@/lib/application/google-operations';

export async function prepareTaskForGoogleCalendarAction(formData: FormData): Promise<void> {
  let status = 'open';
  try {
    const taskId = String(formData.get('googleTaskId') ?? '');
    const connectionId = String(formData.get('googleConnectionId') ?? '');
    const context = await getRepository();
    if (!context.isLive) throw new ConnectorError('forbidden', 'Google Calendar requires a live workspace.');
    const task = await context.activityRepository.getTask(context.workspaceScope, taskId);
    if (!task) throw new ConnectorError('not-found', 'An Omnix task is required.');
    if (!task.taskVersion) throw new ConnectorError('conflict', 'The current task version is unavailable.');
    const authenticated = await createSupabaseServerClient();
    const operations = createGoogleOperationServerRepository({ authenticated });
    const configuration = loadGoogleConfiguredRuntimeConfiguration();
    if (task.status === 'open') {
      const startAt = new Date(task.dueAt);
      await prepareGoogleCalendarTaskIntent(
        context.connectorRepository, operations, configuration, context.workspaceScope,
        {
          connectionId, taskId: task.id, taskVersion: task.taskVersion, title: task.title,
          startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 30 * 60_000).toISOString(),
          timeZone: process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
          correlationId: randomUUID(),
        },
      );
    } else {
      await prepareGoogleCalendarTaskLifecycleIntent(
        context.connectorRepository, operations, configuration, context.workspaceScope,
        {
          connectionId, taskId: task.id, taskVersion: task.taskVersion,
          taskStatus: task.status, lifecycle: task.status === 'completed' ? 'complete' : 'cancel',
          correlationId: randomUUID(),
        },
      );
    }
    revalidatePath('/activities');
    revalidatePath('/connections');
    status = task.status;
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message
      : 'The Calendar operation failed safely before calling Google.';
    redirect(`/activities?calendarError=${encodeURIComponent(message.slice(0, 180))}`);
  }
  redirect(`/activities?status=${encodeURIComponent(status)}&calendarPrepared=1`);
}
