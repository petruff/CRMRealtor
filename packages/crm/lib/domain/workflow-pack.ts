export const WORKFLOW_PACK_TYPES = ['buyer','seller','condo-coop','flood','association','closing'] as const;
export type WorkflowPackType = (typeof WORKFLOW_PACK_TYPES)[number];
export const WORKFLOW_REVIEW_STATES = ['draft','reviewed','withdrawn'] as const;
export type WorkflowReviewState = (typeof WORKFLOW_REVIEW_STATES)[number];
export const WORKFLOW_STEP_STATES = ['proposed','in-progress','completed','skipped','blocked'] as const;
export type WorkflowStepState = (typeof WORKFLOW_STEP_STATES)[number];

export interface WorkflowPackStepDefinition {
  readonly key: string;
  readonly title: string;
  readonly responsibleRole: 'owner'|'assistant'|'either';
  readonly evidenceRequirement: string;
  readonly acknowledgementRequired: boolean;
  readonly legalBoundary: string;
}

export interface WorkflowPackDefinition {
  readonly id: string;
  readonly packType: WorkflowPackType;
  readonly name: string;
  readonly version: number;
  readonly effectiveDate: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly reviewState: WorkflowReviewState;
  readonly isCurrent: boolean;
  readonly legalBoundary: string;
  readonly steps: readonly WorkflowPackStepDefinition[];
  readonly createdAt: string;
}

export interface TransactionWorkflowPlan {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly packDefinitionId: string;
  readonly packType: WorkflowPackType;
  readonly packName: string;
  readonly packVersion: number;
  readonly definitionSnapshot: WorkflowPackDefinition;
  readonly status: 'active'|'completed'|'cancelled';
  readonly version: number;
  readonly startedByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransactionWorkflowStep {
  readonly id: string;
  readonly workspaceId: string;
  readonly planId: string;
  readonly stepKey: string;
  readonly title: string;
  readonly state: WorkflowStepState;
  readonly responsibleMembershipId: string;
  readonly evidenceRequirement: string;
  readonly evidenceReference?: string;
  readonly acknowledgementRequired: boolean;
  readonly acknowledgedAt?: string;
  readonly legalBoundary: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface StartWorkflowPlanInput {
  readonly transactionId: string;
  readonly packDefinitionId: string;
  readonly responsibleMembershipId: string;
  readonly idempotencyKey: string;
}

export interface TransitionWorkflowStepInput {
  readonly stepId: string;
  readonly expectedVersion: number;
  readonly state: Exclude<WorkflowStepState,'proposed'>;
  readonly evidenceReference?: string;
  readonly acknowledged: boolean;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

function text(value: string, label: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g,' ').slice(0,max);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function validateWorkflowPackDefinition(input: WorkflowPackDefinition): WorkflowPackDefinition {
  if (!WORKFLOW_PACK_TYPES.includes(input.packType)) throw new Error('Workflow pack type is invalid.');
  if (!WORKFLOW_REVIEW_STATES.includes(input.reviewState)) throw new Error('Workflow review state is invalid.');
  if (!Number.isSafeInteger(input.version) || input.version<1) throw new Error('Workflow pack version is invalid.');
  if (input.isCurrent && input.reviewState!=='reviewed') throw new Error('Only a reviewed workflow pack can be current.');
  let parsed: URL; try { parsed=new URL(input.sourceUrl); } catch { throw new Error('Workflow source URL is invalid.'); }
  if (parsed.protocol!=='https:') throw new Error('Workflow source URL must use HTTPS.');
  const keys=new Set<string>();
  if (!input.steps.length || input.steps.length>40) throw new Error('Workflow pack must contain 1 to 40 steps.');
  const steps=input.steps.map((step)=>{
    const key=step.key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key) || keys.has(key)) throw new Error('Workflow step keys must be unique and bounded.');
    keys.add(key);
    return {...step,key,title:text(step.title,'Workflow step title',160),evidenceRequirement:text(step.evidenceRequirement,'Evidence requirement',240),legalBoundary:text(step.legalBoundary,'Step legal boundary',320)};
  });
  return {...input,name:text(input.name,'Workflow pack name',120),sourceTitle:text(input.sourceTitle,'Workflow source title',160),legalBoundary:text(input.legalBoundary,'Workflow legal boundary',500),steps};
}

export function validateWorkflowStepTransition(step: TransactionWorkflowStep,input: TransitionWorkflowStepInput): TransitionWorkflowStepInput {
  if (step.id!==input.stepId || step.version!==input.expectedVersion) throw new Error('Workflow step version is stale.');
  if (!WORKFLOW_STEP_STATES.includes(input.state)) throw new Error('Workflow step state is invalid.');
  const evidenceReference=input.evidenceReference?.trim().replace(/\s+/g,' ').slice(0,240)||undefined;
  if (input.state==='completed' && step.evidenceRequirement!=='none' && !evidenceReference) throw new Error('Evidence is required to complete this step.');
  if (input.state==='completed' && step.acknowledgementRequired && !input.acknowledged) throw new Error('Acknowledgement is required to complete this step.');
  return {...input,evidenceReference,reasonCode:text(input.reasonCode,'Workflow reason',80).toLowerCase().replace(/[^a-z0-9-]+/g,'-'),idempotencyKey:text(input.idempotencyKey,'Workflow idempotency key',160)};
}
