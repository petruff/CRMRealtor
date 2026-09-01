import type {
  AffordabilityScenario,
  AffordabilityScenarioRevision,
  AffordabilityShareIntent,
  AffordabilitySharePreviewInput,
  UpsertAffordabilityScenarioInput,
} from '@/lib/domain/affordability';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface AffordabilityRepository {
  list(scope: WorkspaceScope): Promise<readonly AffordabilityScenario[]>;
  listRevisions(scope: WorkspaceScope, scenarioId: string): Promise<readonly AffordabilityScenarioRevision[]>;
  listShareIntents(scope: WorkspaceScope, scenarioId?: string): Promise<readonly AffordabilityShareIntent[]>;
  upsert(scope: WorkspaceScope, input: UpsertAffordabilityScenarioInput, occurredAt: string): Promise<AffordabilityScenario>;
  createSharePreview(scope: WorkspaceScope, input: AffordabilitySharePreviewInput, occurredAt: string): Promise<AffordabilityShareIntent>;
}
