#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import type { AffordabilityRepository } from '../lib/data/affordability-repository.ts';
import { createMemoryAffordabilityRepository } from '../lib/data/memory-affordability-repository.ts';
import { supabaseAffordabilityRepository } from '../lib/data/supabase-affordability-repository.ts';
import type { AffordabilitySharePreviewInput, UpsertAffordabilityScenarioInput } from '../lib/domain/affordability.ts';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';

interface Context {readonly repository:AffordabilityRepository;readonly scope:WorkspaceScope;readonly mode:'sample-process-only'|'live-authenticated'}
interface Output {write(value:string):void;error(value:string):void}
const usage=()=>['Usage: npm run affordability -- <command> [--scenario <id>] [--payload <json>] [--live]','Commands: list, revisions, shares, upsert, share-preview.','Mutations require exact JSON payloads and idempotency keys. share-preview records consent and preview only; it never sends.','Sample mode is process-local. --live requires end-user Supabase credentials.'].join('\n');
const option=(argv:readonly string[],name:string)=>{const index=argv.indexOf(name);if(index<0)return undefined;const result=argv[index+1];if(!result||result.startsWith('--'))throw new Error(`${name} requires a value.`);return result;};
const payload=<T>(argv:readonly string[]):T=>{const raw=option(argv,'--payload');if(!raw)throw new Error('--payload is required.');const parsed:unknown=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('--payload must be a JSON object.');return parsed as T;};
async function defaultContext(live:boolean):Promise<Context>{if(live){const{client,scope}=await createAuthenticatedCliContext();return{repository:supabaseAffordabilityRepository(client),scope,mode:'live-authenticated'};}return{repository:createMemoryAffordabilityRepository(),scope:SAMPLE_WORKSPACE_SCOPE,mode:'sample-process-only'};}

export async function runAffordabilityCli(argv:readonly string[],output:Output={write:(text)=>process.stdout.write(text),error:(text)=>process.stderr.write(text)},contextFactory:(live:boolean)=>Promise<Context>=defaultContext):Promise<number>{const command=argv[0];if(!command||command==='--help'||command==='-h'){output.write(`${usage()}\n`);return 0;}try{const context=await contextFactory(argv.includes('--live'));const occurredAt=new Date().toISOString();let result:unknown;switch(command){case'list':result=await context.repository.list(context.scope);break;case'revisions':{const scenarioId=option(argv,'--scenario');if(!scenarioId)throw new Error('--scenario is required.');result=await context.repository.listRevisions(context.scope,scenarioId);break;}case'shares':result=await context.repository.listShareIntents(context.scope,option(argv,'--scenario'));break;case'upsert':result=await context.repository.upsert(context.scope,payload<UpsertAffordabilityScenarioInput>(argv),occurredAt);break;case'share-preview':result=await context.repository.createSharePreview(context.scope,payload<AffordabilitySharePreviewInput>(argv),occurredAt);break;default:throw new Error(`Unknown command: ${command}`);}output.write(`${JSON.stringify({mode:context.mode,result},null,2)}\n`);return 0;}catch(error){output.error(`${error instanceof Error?error.message:'Affordability command failed.'}\n`);return 1;}}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const code=await runAffordabilityCli(process.argv.slice(2));process.exitCode=code;}
