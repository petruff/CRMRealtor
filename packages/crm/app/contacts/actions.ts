"use server";

import { revalidatePath } from "next/cache";
import {
  archiveSmartListCommand,
  createSmartListCommand,
  restoreSmartListCommand,
  updateSmartListCommand,
} from "@/lib/application/smart-list-commands";
import { getRepository } from "@/lib/data";
import { parseSmartListDefinitionFormData } from "@/app/contacts/smart-list-form";
import type { WorkQueueActionState } from "@/app/contacts/action-state";

function message(
  error: unknown,
  fallback: string,
  targetId?: string,
): WorkQueueActionState {
  const fieldErrors =
    error && typeof error === "object" && "fieldErrors" in error
      ? (error as { fieldErrors?: Record<string, string> }).fieldErrors
      : undefined;
  return {
    status: "error",
    message: error instanceof Error ? error.message : fallback,
    fieldErrors,
    targetId,
  };
}

export async function saveSmartListAction(
  _state: WorkQueueActionState,
  formData: FormData,
): Promise<WorkQueueActionState> {
  const id = String(formData.get("id") ?? "");
  const targetId = id || "new";
  try {
    const { smartListRepository, workspaceScope } = await getRepository();
    const definition = parseSmartListDefinitionFormData(formData);
    if (id) {
      await updateSmartListCommand(
        smartListRepository,
        workspaceScope,
        id,
        { name: formData.get("name"), definition },
      );
      revalidatePath("/contacts");
      return { status: "success", message: "Smart List definition updated.", targetId };
    }
    await createSmartListCommand(smartListRepository, workspaceScope, {
      name: formData.get("name"),
      definition,
    });
    revalidatePath("/contacts");
    return { status: "success", message: "Smart List created.", targetId };
  } catch (error) {
    return message(
      error,
      "We couldn't save this Smart List. Nothing changed.",
      targetId,
    );
  }
}

export async function setSmartListStatusAction(
  _state: WorkQueueActionState,
  formData: FormData,
): Promise<WorkQueueActionState> {
  try {
    const { smartListRepository, workspaceScope } = await getRepository();
    const id = String(formData.get("id") ?? "");
    const restore = formData.get("intent") === "restore";
    const result = restore
      ? await restoreSmartListCommand(smartListRepository, workspaceScope, id)
      : await archiveSmartListCommand(
          smartListRepository,
          workspaceScope,
          id,
          formData.get("reason"),
        );
    revalidatePath("/contacts");
    return {
      status: result.noOp ? "noop" : "success",
      message: result.noOp
        ? "That Smart List was already in the requested state."
        : restore
          ? "Smart List restored."
          : "Smart List archived.",
    };
  } catch (error) {
    return message(
      error,
      "We couldn't update this Smart List. Nothing changed.",
    );
  }
}
