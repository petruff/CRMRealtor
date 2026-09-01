import { describe,expect,it,vi } from 'vitest';
import { createMemoryAffordabilityRepository } from '../lib/data/memory-affordability-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '../lib/domain/workspace';
import { runAffordabilityCli } from './manage-affordability';

describe('affordability CLI',()=>{
  it('documents preview-only sharing and lists scenarios',async()=>{const write=vi.fn();const error=vi.fn();expect(await runAffordabilityCli(['--help'],{write,error})).toBe(0);expect(write.mock.calls[0]?.[0]).toMatch(/never sends/);write.mockClear();expect(await runAffordabilityCli(['list'],{write,error},async()=>({repository:createMemoryAffordabilityRepository(),scope:SAMPLE_WORKSPACE_SCOPE,mode:'sample-process-only'}))).toBe(0);expect(write.mock.calls[0]?.[0]).toMatch(/sample-process-only/);expect(error).not.toHaveBeenCalled();});
  it('fails closed when a required scenario selector is absent',async()=>{const write=vi.fn();const error=vi.fn();expect(await runAffordabilityCli(['revisions'],{write,error},async()=>({repository:createMemoryAffordabilityRepository(),scope:SAMPLE_WORKSPACE_SCOPE,mode:'sample-process-only'}))).toBe(1);expect(error.mock.calls[0]?.[0]).toMatch(/--scenario is required/);});
});
