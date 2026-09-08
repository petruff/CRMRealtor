import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseMeetingBriefRepository } from './supabase-meeting-brief-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';

const scope={...SAMPLE_WORKSPACE_SCOPE,mode:'live' as const};
function fixture(failTable?:string,behaviorRows:unknown[]=[]) {
  const queries:{table:string;columns:string;filters:unknown[][];limit?:number}[]=[];
  const client={
    rpc:vi.fn(async()=>({data:[{contact_id:'c-1',is_canonical:true,alias_epoch:1},{contact_id:'donor-1',is_canonical:false,alias_epoch:1}],error:null})),
    from(table:string){
      const q={table,columns:'',filters:[] as unknown[][],limit:undefined as number|undefined}; queries.push(q);
      const builder={select(columns:string){q.columns=columns;return builder;},eq(...args:unknown[]){q.filters.push(['eq',...args]);return builder;},in(...args:unknown[]){q.filters.push(['in',...args]);return builder;},or(...args:unknown[]){q.filters.push(['or',...args]);return builder;},is(...args:unknown[]){q.filters.push(['is',...args]);return builder;},order(){return builder;},limit(limit:number){q.limit=limit;return builder;},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({data:table==='notes'?[{id:'n-1',workspace_id:scope.workspaceId,contact_id:'donor-1',body:'No condos',created_at:'2026-09-01T12:00:00Z'}]:table==='property_behavior_events'?behaviorRows:[],error:table===failTable?{message:'private credential'}:null}));}};
      return builder;
    },
  } as unknown as SupabaseClient;
  return {client,queries};
}
describe('bounded meeting brief live sources',()=>{
  it('scopes and limits every source query, preserves canonical donor notes and never selects provider payloads',async()=>{
    const {client,queries}=fixture();const sources=await supabaseMeetingBriefRepository(client).loadSources(scope,'c-1');
    expect(sources.records).toContainEqual(expect.objectContaining({id:'n-1',contactId:'c-1',text:'Recorded note: No condos'}));
    for(const q of queries){expect(q.filters).toContainEqual(['eq','workspace_id',scope.workspaceId]);expect(q.limit).toBe(20);expect(q.columns).not.toContain('*');expect(q.columns).not.toMatch(/secret|payload|token|metadata/);}
    expect(queries.find(q=>q.table==='notes')?.filters).toContainEqual(['in','contact_id',['c-1','donor-1']]);
  });
  it('returns explicit source unavailability without database details',async()=>{
    const {client}=fixture('notes');const result=await supabaseMeetingBriefRepository(client).loadSources(scope,'c-1');
    expect(result.unavailable).toContain('notes');expect(JSON.stringify(result)).not.toContain('private credential');
  });
  it('rejects query-language fragments before making a database request',async()=>{
    const {client,queries}=fixture();await expect(supabaseMeetingBriefRepository(client).loadSources(scope,'c-1,other')).rejects.toMatchObject({code:'invalid-input'});expect(queries).toEqual([]);
  });
  it('includes only permitted property behavior metadata and preserves old event time for stale display',async()=>{
    const base={workspace_id:scope.workspaceId,contact_id:'c-1',behavior_type:'showing-request',source:'website',source_occurred_at:'2025-01-01T12:00:00Z'};
    const {client,queries}=fixture(undefined,[{...base,id:'allowed',permission_state:'allowed'},{...base,id:'restricted',permission_state:'restricted'},{...base,id:'revoked',permission_state:'revoked'}]);
    const result=await supabaseMeetingBriefRepository(client).loadSources(scope,'c-1');expect(result.records.filter(r=>r.sourceType==='property-behavior').map(r=>r.id)).toEqual(['allowed']);
    expect(result.records.find(r=>r.id==='allowed')?.time).toBe('2025-01-01T12:00:00Z');expect(queries.find(q=>q.table==='property_behavior_events')?.filters).toContainEqual(['eq','permission_state','allowed']);
  });
});
