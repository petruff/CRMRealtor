import { describe,expect,it,vi } from 'vitest'; vi.mock('@/lib/supabase/env',()=>({isSupabaseConfigured:()=>false})); import { GET } from './route.ts';
describe('readiness',()=>{it('returns non-200 without leaking configuration',async()=>{const response=await GET();expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toMatch(/key|url|tenant/i);});});
