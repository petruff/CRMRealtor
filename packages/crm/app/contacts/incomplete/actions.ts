"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import {
  archiveIncompleteRecordCommand,
  convertIncompleteRecordCommand,
  restoreIncompleteRecordCommand,
} from "@/lib/application/incomplete-record-commands";
import { getRepository } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseMetaOperationRepository } from "@/lib/data/meta-operation-repository";
import { readMetaEnquiryReviewContext } from "@/lib/application/meta-review-service";
import { convertMetaReviewRecord } from "@/lib/application/meta-review-conversion-service";
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

function correction(formData: FormData) {
  const fields = [
    "firstName",
    "lastName",
    "phone",
    "email",
    "city",
    "state",
    "postalCode",
    "preferredName",
  ];
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = String(formData.get(field) ?? "").trim();
      return value ? [[field, value]] : [];
    }),
  );
}

function connectorServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Meta review authority is not configured.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function convertIncompleteAction(
  _state: WorkQueueActionState,
  formData: FormData,
): Promise<WorkQueueActionState> {
  try {
    const { incompleteRecordRepository, workspaceScope, isLive } =
      await getRepository();
    const recordId = String(formData.get("id") ?? "").trim();
    const metaEventId = String(formData.get("metaEventId") ?? "").trim();
    if (metaEventId && !isLive) {
      throw new Error("Meta enquiries require an authenticated live workspace.");
    }
    const receipt = metaEventId
      ? await convertMetaReviewRecord({
          scope: workspaceScope,
          incompleteRecordRepository,
          metaReviewRepository: supabaseMetaOperationRepository(
            await createSupabaseServerClient(),
          ),
          readReviewContext: () =>
            readMetaEnquiryReviewContext({
              service: connectorServiceClient(),
              scope: workspaceScope,
              eventId: metaEventId,
            }),
          recordId,
          eventId: metaEventId,
          correction: correction(formData),
          correlationId: randomUUID(),
        })
      : await convertIncompleteRecordCommand(
          incompleteRecordRepository,
          workspaceScope,
          recordId,
          { correction: correction(formData), idempotencyKey: randomUUID() },
        );
    revalidatePath("/contacts/incomplete");
    revalidatePath("/contacts");
    revalidatePath(`/contacts/${receipt.contactId}`);
    if (metaEventId) revalidatePath("/connections");
    return {
      status: receipt.noOp ? "noop" : "success",
      message: metaEventId
        ? "Contact saved and the Meta enquiry was linked with its source provenance."
        : receipt.noOp
        ? "This record was already converted; no duplicate contact was created."
        : `Converted to a contact (${receipt.action}).`,
    };
  } catch (error) {
    return failure(error, "We couldn't convert this record. Nothing changed.");
  }
}

export async function setIncompleteStatusAction(
  _state: WorkQueueActionState,
  formData: FormData,
): Promise<WorkQueueActionState> {
  try {
    const { incompleteRecordRepository, workspaceScope } =
      await getRepository();
    const restore = formData.get("intent") === "restore";
    const result = restore
      ? await restoreIncompleteRecordCommand(
          incompleteRecordRepository,
          workspaceScope,
          formData.get("id"),
        )
      : await archiveIncompleteRecordCommand(
          incompleteRecordRepository,
          workspaceScope,
          formData.get("id"),
          formData.get("reason") || "Reviewed and deferred",
        );
    revalidatePath("/contacts/incomplete");
    return {
      status: result.noOp ? "noop" : "success",
      message: result.noOp
        ? "That record was already in the requested state."
        : restore
          ? "Record restored to review."
          : "Record archived. It can be restored later.",
    };
  } catch (error) {
    return failure(error, "We couldn't update this record. Nothing changed.");
  }
}
