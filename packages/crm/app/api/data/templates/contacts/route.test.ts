import { describe, expect, it } from 'vitest';
import { GET } from './route.ts';

describe('contact data template route', () => {
  it('serves redacted deterministic template formats', async () => {
    const csv = await GET(new Request('http://localhost/api/data/templates/contacts?format=csv'));
    expect(csv.headers.get('content-disposition')).toContain('.csv'); expect(await csv.text()).toContain('First Name');
    const xlsx = await GET(new Request('http://localhost/api/data/templates/contacts?format=xlsx'));
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml'); expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
