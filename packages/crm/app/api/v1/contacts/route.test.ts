import { describe,expect,it,vi } from 'vitest';
const {execute}=vi.hoisted(()=>({execute:vi.fn()}));vi.mock('@/lib/data/operational-api-server-context',()=>({executeOperationalApiRequest:execute}));
import { GET, POST } from './route';
describe('operational contacts',()=>{
  it('encodes the database cursor as opaque base64url metadata',async()=>{execute.mockResolvedValue({status:200,body:{data:{items:[{id:'c1'}],limit:1,nextCursor:{updatedAt:'2026-08-12T00:00:00Z',id:'c1'}},meta:{noOp:false}}});const response=await GET(new Request('http://localhost/api/v1/contacts?limit=1'));const body=await response.json();expect(body.data.nextCursor).toBeUndefined();expect(JSON.parse(Buffer.from(body.meta.nextCursor,'base64url').toString('utf8'))).toEqual({updatedAt:'2026-08-12T00:00:00Z',id:'c1'});});

  it.each([
    [{ firstName: 'Missing' }, false],
    [{ firstName: 'Suppressed', emailSubscribed: true, tags: ['VIP', 'DNC'] }, false],
    [{ firstName: 'Explicit', emailSubscribed: true, tags: ['VIP'] }, true],
  ])('passes consent-safe create payloads to the operational RPC', async (payload, expectedConsent) => {
    execute.mockResolvedValue({ status: 201, body: { data: { id: 'contact-a' } } });
    await POST(new Request('http://localhost/api/v1/contacts', {
      method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
    }));
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'contacts.create', payload: expect.objectContaining({ emailSubscribed: expectedConsent }),
    }), expect.any(Request));
  });
});
