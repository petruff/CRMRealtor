import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_WORKSPACE_SCOPE } from "@/lib/domain/workspace";
import { createMemorySmartListRepository } from "@/lib/data/memory-smart-list-repository";
import { getRepository } from "@/lib/data";
import { INITIAL_WORK_QUEUE_ACTION_STATE } from "./action-state";
import { saveSmartListAction } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data", () => ({ getRepository: vi.fn() }));

describe("Smart List server action", () => {
  const repository = createMemorySmartListRepository();

  beforeEach(() => {
    vi.mocked(getRepository).mockResolvedValue({
      smartListRepository: repository,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    } as Awaited<ReturnType<typeof getRepository>>);
  });

  it("persists an edited definition instead of updating only the name", async () => {
    const create = new FormData();
    create.set("name", "Austin buyers");
    create.set("criteriaCount", "1");
    create.set("criteria.0.field", "city");
    create.set("criteria.0.operator", "eq");
    create.set("criteria.0.value", "Austin");
    create.set("sort.field", "name");
    create.set("sort.direction", "asc");
    expect(await saveSmartListAction(INITIAL_WORK_QUEUE_ACTION_STATE, create))
      .toMatchObject({ status: "success", targetId: "new" });

    const [created] = await repository.list(SAMPLE_WORKSPACE_SCOPE);
    expect(created).toBeDefined();

    const edit = new FormData();
    edit.set("id", created?.id ?? "");
    edit.set("name", "Austin hot buyers");
    edit.set("criteriaCount", "2");
    edit.set("criteria.0.field", "city");
    edit.set("criteria.0.operator", "contains");
    edit.set("criteria.0.value", "Austin");
    edit.set("criteria.1.field", "leadType");
    edit.set("criteria.1.operator", "in");
    edit.append("criteria.1.value", "hot");
    edit.append("criteria.1.value", "warm");
    edit.set("sort.field", "nextTouchAt");
    edit.set("sort.direction", "desc");

    const state = await saveSmartListAction(INITIAL_WORK_QUEUE_ACTION_STATE, edit);
    const persisted = await repository.get(SAMPLE_WORKSPACE_SCOPE, created?.id ?? "");

    expect(state).toMatchObject({ status: "success", targetId: created?.id });
    expect(persisted).toMatchObject({
      name: "Austin hot buyers",
      definition: {
        criteria: [
          { field: "city", operator: "contains", value: "Austin" },
          { field: "leadType", operator: "in", value: ["hot", "warm"] },
        ],
        sort: { field: "nextTouchAt", direction: "desc" },
      },
    });
  });
});
