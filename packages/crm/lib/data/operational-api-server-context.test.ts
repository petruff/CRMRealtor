import { beforeEach,describe,expect,it,vi } from 'vitest';
const rpc=vi.fn();
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc})}));
import { executeOperationalApiRequest } from './operational-api-server-context';

const request=(authorization?:string)=>new Request('http://localhost/api/v1/status',{headers:authorization?{authorization}:{}});
describe('operational API server boundary',()=>{beforeEach(()=>{vi.clearAllMocks();process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';process.env.OMNIX_API_KEY_PEPPER='p'.repeat(32);});
it('fails closed before constructing authority without bearer credentials',async()=>{const result=await executeOperationalApiRequest({action:'status.read',payload:{}},request());expect(result.status).toBe(401);expect(rpc).not.toHaveBeenCalled();expect(JSON.stringify(result.body)).not.toContain('server-only');});
it('calls only the narrow RPC and returns stable errors',async()=>{rpc.mockResolvedValue({data:null,error:{code:'42501',message:'secret database detail'}});const result=await executeOperationalApiRequest({action:'status.read',payload:{}},request(`Bearer omx_abcdefghijkl.${'s'.repeat(43)}`));expect(rpc).toHaveBeenCalledWith('execute_operational_contacts_api',expect.objectContaining({target_action:'status.read'}));expect(result).toMatchObject({status:403,body:{error:{code:'forbidden'}}});expect(JSON.stringify(result.body)).not.toContain('secret database detail');});
it('returns accepted for a governed intake mutation',async()=>{rpc.mockResolvedValue({data:{data:{id:'record'},meta:{noOp:false}},error:null});const result=await executeOperationalApiRequest({action:'intake.create',payload:{candidate:{firstName:'Ada'}},idempotencyKey:'intake-key-1'},request(`Bearer omx_abcdefghijkl.${'s'.repeat(43)}`));expect(result.status).toBe(202);});});
