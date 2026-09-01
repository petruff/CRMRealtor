import { describe,expect,it } from 'vitest';
import { validateWorkflowPackDefinition,validateWorkflowStepTransition,type TransactionWorkflowStep,type WorkflowPackDefinition } from './workflow-pack';

const PACK: WorkflowPackDefinition={id:'pack-1',packType:'condo-coop',name:'Condo review',version:1,effectiveDate:'2026-08-31',sourceTitle:'Brokerage approved checklist',sourceUrl:'https://example.com/checklist',reviewState:'reviewed',isCurrent:true,legalBoundary:'Operational checklist only. Consult brokerage or legal counsel.',steps:[{key:'review-documents',title:'Review approved document package',responsibleRole:'either',evidenceRequirement:'Brokerage-approved review record',acknowledgementRequired:true,legalBoundary:'Do not interpret legal sufficiency.'}],createdAt:'2026-08-31T00:00:00.000Z'};
const STEP: TransactionWorkflowStep={id:'step-1',workspaceId:'workspace',planId:'plan',stepKey:'review-documents',title:'Review',state:'proposed',responsibleMembershipId:'member',evidenceRequirement:'Review record',acknowledgementRequired:true,legalBoundary:'No legal advice.',version:1,updatedAt:'2026-08-31T00:00:00.000Z'};

describe('Florida workflow pack governance',()=>{
  it('admits only reviewed current packs with bounded unique sourced steps',()=>{
    expect(validateWorkflowPackDefinition(PACK).steps[0]?.key).toBe('review-documents');
    expect(()=>validateWorkflowPackDefinition({...PACK,reviewState:'draft'})).toThrow(/reviewed/);
    expect(()=>validateWorkflowPackDefinition({...PACK,sourceUrl:'http://example.com'})).toThrow(/HTTPS/);
    expect(()=>validateWorkflowPackDefinition({...PACK,steps:[PACK.steps[0]!,PACK.steps[0]!]})).toThrow(/unique/);
  });
  it('requires evidence and acknowledgement before completion',()=>{
    expect(()=>validateWorkflowStepTransition(STEP,{stepId:STEP.id,expectedVersion:1,state:'completed',acknowledged:false,reasonCode:'done',idempotencyKey:'step:done'})).toThrow(/Evidence/);
    expect(()=>validateWorkflowStepTransition(STEP,{stepId:STEP.id,expectedVersion:1,state:'completed',evidenceReference:'Review record',acknowledged:false,reasonCode:'done',idempotencyKey:'step:done'})).toThrow(/Acknowledgement/);
    expect(validateWorkflowStepTransition(STEP,{stepId:STEP.id,expectedVersion:1,state:'completed',evidenceReference:'Review record',acknowledged:true,reasonCode:'Completed by realtor',idempotencyKey:'step:done'})).toMatchObject({state:'completed',reasonCode:'completed-by-realtor'});
  });
});
