"use server";

import { revalidatePath } from "next/cache";
import {
  createTaskCommand,
  transitionTasksCommand,
} from "@/lib/application/activity-commands";
import { getRepository } from "@/lib/data";
import type { WorkQueueActionState } from "@/app/contacts/action-state";

function failure(error: unknown, fallback: string): WorkQueueActionState {
  const fieldErrors =
    error && typeof error === "object" && "fieldErrors" in error
      ? (error as { fieldErrors?: Record<string, string> }).fieldErrors
      : undefined;
  return {
    status: "error",
    message: error instanceof Error ? error.message : fallback,
    fieldErrors,
  };
}

function refresh() {
  revalidatePath("/activities");
  revalidatePath("/contacts");
}

export async function createTaskAction(
  _state: WorkQueueActionState,
  formData: FormData,
): Promise<WorkQueueActionState> {
  try {
    const { activityRepository, workspaceScope } = await getRepository();
    const result = await createTaskCommand(activityRepository, workspaceScope, {
      contactId: formData.get("contactId") || undefined,
      title: formData.get("title"),
      description: formData.get("description") || undefined,
      dueAt: formData.get("dueAt"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    refresh();
    return {
      status: result.noOp ? "noop" : "success",
      message: result.noOp
        ? "That task was already created; no duplicate was added."
        : "Task added to the work queue.",
    };
  } catch (error) {
    return failure(error, "We couldn't create this task. Nothing changed.");
  }
}

export async function transitionTasksAction(
  _state: WorkQueueActionState,
  formData: FormData,
): Promise<WorkQueueActionState> {
  try {
    const rowIntent = formData.get("rowIntent");
    const [rowAction, rowTaskId] =
      typeof rowIntent === "string" ? rowIntent.split(":", 2) : [];
    const intent = rowAction ?? formData.get("intent");
    if (intent !== "complete" && intent !== "reopen" && intent !== "archive")
      return { status: "error", message: "Choose a valid task action." };
    const taskIds = rowTaskId
      ? [rowTaskId]
      : formData
          .getAll("taskIds")
          .filter((value): value is string => typeof value === "string");
    const { activityRepository, workspaceScope } = await getRepository();
    const result = await transitionTasksCommand(
      activityRepository,
      workspaceScope,
      taskIds,
      intent,
    );
    refresh();
    return {
      status: result.noOpTaskIds.length ? "noop" : "success",
      message: result.noOpTaskIds.length
        ? "Some selected tasks were already in that state; no duplicate activity was created."
        : `${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} updated.`,
    };
  } catch (error) {
    return failure(
      error,
      "We couldn't update the selected tasks. Nothing changed.",
    );
  }
}
