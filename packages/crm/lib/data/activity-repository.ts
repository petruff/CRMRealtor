import type {
  ActivityEvent,
  ActivityEventType,
  CrmTask,
  TaskStatus,
  TaskTransition,
} from '../domain/activity.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface ActivityEventQuery {
  readonly contactId?: string;
  readonly taskId?: string;
  readonly type?: ActivityEventType;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
}

export interface TaskQuery {
  readonly query?: string;
  readonly contactId?: string;
  readonly assigneeMembershipId?: string;
  readonly status?: TaskStatus | 'all';
  readonly dueFrom?: string;
  readonly dueTo?: string;
  readonly limit: number;
}

export interface AppendActivityEventInput {
  readonly type: ActivityEventType;
  readonly contactId?: string;
  readonly taskId?: string;
  readonly incompleteRecordId?: string;
  readonly actorMembershipId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CreateTaskRecordInput {
  readonly contactId?: string;
  readonly title: string;
  readonly description?: string;
  readonly dueAt: string;
  readonly creatorMembershipId: string;
  readonly assigneeMembershipId: string;
  readonly createdAt: string;
  readonly idempotencyKey: string;
}

export interface CreateTaskRecordResult {
  readonly task: CrmTask;
  readonly event: ActivityEvent;
  readonly noOp: boolean;
}

export interface TransitionTasksInput {
  readonly taskIds: readonly string[];
  readonly transition: TaskTransition;
  readonly actorMembershipId: string;
  readonly transitionedAt: string;
}

export interface TransitionTasksResult {
  readonly tasks: readonly CrmTask[];
  readonly events: readonly ActivityEvent[];
  readonly noOpTaskIds: readonly string[];
}

export interface ContactActivityAggregate {
  readonly activityCount: number;
  readonly openTaskCount: number;
  readonly completedTaskCount: number;
}

/** Append-only events and transactional task/event mutations. No event update/delete seam exists. */
export interface ActivityRepository {
  listEvents(scope: WorkspaceScope, query: ActivityEventQuery): Promise<readonly ActivityEvent[]>;
  /** Exact task/activity totals for one bounded visible-contact window. */
  listContactAggregates?(
    scope: WorkspaceScope,
    contactIds: readonly string[],
  ): Promise<ReadonlyMap<string, ContactActivityAggregate>>;
  appendEvent(
    scope: WorkspaceScope,
    input: AppendActivityEventInput,
  ): Promise<{ event: ActivityEvent; noOp: boolean }>;
  listTasks(scope: WorkspaceScope, query: TaskQuery): Promise<readonly CrmTask[]>;
  getTask(scope: WorkspaceScope, id: string): Promise<CrmTask | undefined>;
  createTask(scope: WorkspaceScope, input: CreateTaskRecordInput): Promise<CreateTaskRecordResult>;
  transitionTasks(
    scope: WorkspaceScope,
    input: TransitionTasksInput,
  ): Promise<TransitionTasksResult>;
  /** Memory-only rollback boundary; live atomic workflows use database RPCs. */
  runTransaction?<T>(operation: () => Promise<T>): Promise<T>;
}
