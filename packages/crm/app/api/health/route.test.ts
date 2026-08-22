import { describe,expect,it } from 'vitest'; import { GET } from './route.ts';
describe('health',()=>{it('is process-only and redacted',async()=>{const response=GET();expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,product:'Omnix',schemaVersion:'health.v1',process:'ready'});});});
