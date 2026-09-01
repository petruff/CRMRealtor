'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { AFFORDABILITY_SOURCE_TYPES, type AffordabilityFact, type AffordabilityInputs, type AffordabilitySourceType } from '@/lib/domain/affordability';

const value=(data:FormData,key:string)=>String(data.get(key)??'').trim();
const checked=(data:FormData,key:string)=>data.get(key)==='on';
const moneyCents=(raw:string)=>{const parsed=Number(raw);if(!Number.isFinite(parsed)||parsed<0)throw new Error('Enter a non-negative dollar amount.');return Math.round(parsed*100);};
const whole=(raw:string)=>{const parsed=Number(raw);if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error('Enter a non-negative whole number.');return parsed;};
const basisPoints=(raw:string)=>{const parsed=Number(raw);if(!Number.isFinite(parsed)||parsed<0)throw new Error('Enter a non-negative interest rate.');return Math.round(parsed*100);};

type InputSpec={key:keyof AffordabilityInputs;kind:'money'|'months'|'rate'};
const specs:readonly InputSpec[]=[
  {key:'priceCents',kind:'money'},{key:'downPaymentCents',kind:'money'},{key:'loanTermMonths',kind:'months'},
  {key:'annualRateBasisPoints',kind:'rate'},{key:'annualPropertyTaxCents',kind:'money'},
  {key:'annualHomeInsuranceCents',kind:'money'},{key:'annualFloodInsuranceCents',kind:'money'},
  {key:'monthlyAssociationCents',kind:'money'},{key:'monthlyAssessmentCents',kind:'money'},
  {key:'monthlyMaintenanceCents',kind:'money'},{key:'closingCostsCents',kind:'money'},
];

function parseInputs(data:FormData):AffordabilityInputs {
  const result={} as Record<keyof AffordabilityInputs,AffordabilityFact>;
  for(const spec of specs){const unknown=checked(data,`${spec.key}Unknown`);const sourceType=(unknown?'unknown':value(data,`${spec.key}Source`)) as AffordabilitySourceType;if(!AFFORDABILITY_SOURCE_TYPES.includes(sourceType))throw new Error('Choose a valid source for every scenario input.');const raw=value(data,`${spec.key}Value`);let parsed:number|undefined;if(!unknown){if(!raw)throw new Error('Every known scenario input needs a value.');parsed=spec.kind==='money'?moneyCents(raw):spec.kind==='rate'?basisPoints(raw):whole(raw);}result[spec.key]={value:parsed,sourceType,sourceReference:unknown?undefined:value(data,`${spec.key}Reference`)||undefined,asOfDate:unknown?undefined:value(data,`${spec.key}AsOf`)||new Date().toISOString().slice(0,10),verificationState:checked(data,`${spec.key}Verified`)?'verified':'unverified',assumption:unknown?false:checked(data,`${spec.key}Assumption`)};}
  return result as unknown as AffordabilityInputs;
}

export async function saveAffordabilityScenarioAction(formData:FormData):Promise<void>{const context=await getRepository();const scenarioId=value(formData,'scenarioId')||undefined;const expectedVersion=Number(value(formData,'expectedVersion')||'0');if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new Error('Scenario version is invalid.');await context.affordabilityRepository.upsert(context.workspaceScope,{scenarioId,expectedVersion,name:value(formData,'name'),contactId:value(formData,'contactId')||undefined,transactionId:value(formData,'transactionId')||undefined,inputs:parseInputs(formData),reasonCode:scenarioId?'realtor-scenario-update':'realtor-scenario-create',idempotencyKey:value(formData,'idempotencyKey')},new Date().toISOString());revalidatePath('/transactions/scenarios');}

export async function createAffordabilitySharePreviewAction(formData:FormData):Promise<void>{const context=await getRepository();const scenarioId=value(formData,'scenarioId');const scenarios=await context.affordabilityRepository.list(context.workspaceScope);const scenario=scenarios.find((item)=>item.id===scenarioId);if(!scenario)throw new Error('Scenario was not found.');await context.affordabilityRepository.createSharePreview(context.workspaceScope,{scenarioId,scenarioVersion:scenario.version,recipientName:value(formData,'recipientName'),recipientAddress:value(formData,'recipientAddress'),channel:'email',consentConfirmed:checked(formData,'consentConfirmed'),previewPayload:{scenarioId:scenario.id,scenarioVersion:scenario.version,name:scenario.name,inputs:scenario.inputs,outputs:scenario.outputs,disclaimer:scenario.disclaimer},idempotencyKey:value(formData,'idempotencyKey')},new Date().toISOString());revalidatePath('/transactions/scenarios');}
