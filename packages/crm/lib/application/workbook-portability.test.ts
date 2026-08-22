import { describe, expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import { MAX_IMPORT_CELL_LENGTH, MAX_IMPORT_COLUMNS, parseContactImport } from './contact-import.ts';
import { createContactTemplate, parsePortableContactImport, WORKBOOK_LIMITS } from './workbook-portability.ts';

function workbook(rows: unknown[][]): Uint8Array {
  const book = utils.book_new(); utils.book_append_sheet(book, utils.aoa_to_sheet(rows), 'Contacts');
  return new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }));
}

async function inVercelRuntime<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try { return await operation(); }
  finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
}

function forgeOversizedZipEntry(bytes: Uint8Array): Uint8Array {
  const forged = bytes.slice();
  const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
  let eocd = -1;
  for (let offset = forged.byteLength - 22; offset >= Math.max(0, forged.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Test workbook EOCD was not found.');
  const centralOffset = view.getUint32(eocd + 16, true);
  if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error('Test workbook central entry was not found.');
  view.setUint32(centralOffset + 24, WORKBOOK_LIMITS.maxZipEntryUncompressedBytes + 1, true);
  return forged;
}

describe('workbook portability', () => {
  it('parses a bounded XLSX through the canonical candidate projection', async () => {
    const parsed = await parsePortableContactImport({ filename: 'contacts.xlsx', bytes: workbook([['First Name','Email'],['Ada','ADA@example.com']]) });
    expect(parsed.format).toBe('xlsx'); expect(parsed.candidates[0]).toMatchObject({ firstName: 'Ada', email: 'ada@example.com' });
  });
  it('parses a bounded XLSX through the traced worker in Vercel mode', async () => {
    const parsed = await inVercelRuntime(() => parsePortableContactImport({
        filename: 'contacts.xlsx',
        bytes: workbook([['First Name','Email'],['Grace','grace@example.com']]),
      }));
    expect(parsed.candidates[0]).toMatchObject({ firstName: 'Grace', email: 'grace@example.com' });
  });
  it('accepts more than five thousand real rows with CSV and XLSX parity', async () => {
    const rows = Array.from({ length: 6_001 }, (_, index) => [`Synthetic ${index}`, `synthetic-${index}@example.com`]);
    const bytes = workbook([['First Name', 'Email'], ...rows]);
    const xlsx = await parsePortableContactImport({
      filename: 'large.xlsx',
      bytes,
    });
    const serverlessXlsx = await inVercelRuntime(() => parsePortableContactImport({ filename: 'large.xlsx', bytes }));
    const csv = parseContactImport({
      filename: 'large.csv',
      content: [['First Name', 'Email'], ...rows].map((row) => row.join(',')).join('\n'),
    });

    expect(xlsx).toMatchObject({ totalRows: 6_001 });
    expect(xlsx.candidates).toHaveLength(6_001);
    expect(serverlessXlsx).toMatchObject({ totalRows: 6_001 });
    expect(serverlessXlsx.candidates).toHaveLength(6_001);
    expect(xlsx.candidates.map(({ firstName, email }) => ({ firstName, email })))
      .toEqual(csv.candidates.map(({ firstName, email }) => ({ firstName, email })));
  });
  it('ignores an inflated used range and empty styled tail rows', async () => {
    const rows = Array.from({ length: 144 }, (_, index) => [`Synthetic ${index}`, `synthetic-${index}@example.com`]);
    const book = utils.book_new();
    const sheet = utils.aoa_to_sheet([['First Name', 'Email'], ...rows]);
    sheet.A1048576 = { t: 's', v: '', s: { fill: { fgColor: { rgb: 'FFFFFF' } } } };
    sheet['!ref'] = 'A1:B1048576';
    utils.book_append_sheet(book, sheet, 'Contacts');

    const bytes = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx', cellStyles: true }));
    const parsed = await parsePortableContactImport({
      filename: 'inflated-used-range.xlsx',
      bytes,
    });
    const serverlessParsed = await inVercelRuntime(() => parsePortableContactImport({
      filename: 'inflated-used-range.xlsx', bytes,
    }));

    expect(parsed).toMatchObject({ totalRows: 144 });
    expect(parsed.candidates).toHaveLength(144);
    expect(serverlessParsed).toMatchObject({ totalRows: 144 });
    expect(serverlessParsed.candidates).toHaveLength(144);
  });
  it('rejects formula cells without returning a preview', async () => {
    const book = utils.book_new(); const sheet = utils.aoa_to_sheet([['First Name'],['Ada']]); sheet.A2 = { t: 'n', f: '1+1', v: 2 }; utils.book_append_sheet(book, sheet, 'Contacts');
    await expect(parsePortableContactImport({ filename: 'formula.xlsx', bytes: new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })) })).rejects.toThrow('formulas');
  });
  it('rejects mismatched signatures and unsupported extensions', async () => {
    await expect(parsePortableContactImport({ filename: 'fake.xlsx', bytes: new TextEncoder().encode('First Name\nAda') })).rejects.toThrow('signature');
    await expect(parsePortableContactImport({ filename: 'contacts.xlsm', bytes: workbook([['First Name'],['Ada']]) })).rejects.toThrow('Only CSV');
  });
  it('rejects multiple worksheets instead of silently ignoring later sheets', async () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([['First Name'], ['Ada']]), 'Contacts');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['First Name'], ['Grace']]), 'Leads');
    const bytes = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }));
    await expect(parsePortableContactImport({ filename: 'multiple.xlsx', bytes })).rejects.toThrow('multiple worksheets');
  });
  it('retains workbook column and cell-length safety limits', async () => {
    const wideHeaders = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, index) => `Column ${index}`);
    await expect(parsePortableContactImport({
      filename: 'wide.xlsx', bytes: workbook([wideHeaders, ['Synthetic']]),
    })).rejects.toThrow(/column safe limit/);
    await expect(parsePortableContactImport({
      filename: 'long-cell.xlsx',
      bytes: workbook([['First Name', 'Notes'], ['Synthetic', 'A'.repeat(MAX_IMPORT_CELL_LENGTH + 1)]]),
    })).rejects.toThrow(/cell exceeds 4096 characters/);
  });
  it('rejects an XLSX package that advertises zip-bomb expansion before SheetJS reads it', async () => {
    const bytes = forgeOversizedZipEntry(workbook([['First Name'], ['Synthetic']]));
    await expect(parsePortableContactImport({ filename: 'expansion-bomb.xlsx', bytes }))
      .rejects.toThrow(/safe expansion|uncompressed-size/);
    await expect(inVercelRuntime(() => parsePortableContactImport({ filename: 'expansion-bomb.xlsx', bytes })))
      .rejects.toThrow(/safe expansion/);
  });

  it('applies an explicit column mapping to workbook imports', async () => {
    const parsed = await parsePortableContactImport({
      filename: 'mapped.xlsx',
      bytes: workbook([['Given', 'Inbox'], ['Ada', 'ADA@example.com']]),
      mapping: { Given: 'firstName', Inbox: 'email' },
    });

    expect(parsed.candidates[0]).toMatchObject({ firstName: 'Ada', email: 'ada@example.com' });
    expect(parsed.unknownFields).toEqual([]);
  });
  it('discovers a First Class header below a report title and does not reinterpret rating or status', async () => {
    const headers = ['Contact Id','First Name','Last Name','Email','Cell Phone 1','Status','Deal Type','Assigned Agent ID','TCPA Optin Date','Rating','Email Optin','Hashtags','Primary Address','Primary City','Primary State','Primary Zip'];
    const parsed = await parsePortableContactImport({
      filename: 'agent-owned-contacts.xlsx',
      bytes: workbook([
        ['Agent Owned Contacts'],
        headers,
        ['contact-1','Judith','Serna','judith@example.com','+1 555 123 4567','Client','buyer','agent-1','2025-01-01','5','1','VIP; sphere','1 Main St','Miami','FL','33101'],
      ]),
    });

    expect(parsed).toMatchObject({ provider: 'first-class-real-estate', totalRows: 1 });
    expect(parsed.rejected).toEqual([]);
    expect(parsed.candidates[0]).toMatchObject({
      rowNumber: 3, firstName: 'Judith', intent: 'buyer', emailSubscribed: true,
      mailingAddress: '1 Main St', city: 'Miami', state: 'FL', postalCode: '33101',
    });
    expect(parsed.candidates[0]?.leadType).toBeUndefined();
    expect(parsed.candidates[0]?.pipelineStage).toBeUndefined();
    expect(parsed.candidates[0]?.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'contact-id', sourceRowNumber: 3 }),
      expect.objectContaining({ key: 'tcpa-optin-date', sourceRowNumber: 3 }),
    ]));
  });
  it('recognizes a reduced and reordered KvCore workbook after the file is renamed', async () => {
    const parsed = await parsePortableContactImport({
      filename: 'realtor-cleaned-export.xlsx',
      bytes: workbook([
        ['Contacts prepared for migration'],
        ['Rating', 'Deal Type', 'Email', 'Cell Phone 1', 'Status', 'Last Name', 'First Name'],
        ['4', 'buyer', 'casey@example.com', '+1 512 555 0199', 'Prospect', 'Morgan', 'Casey'],
      ]),
    });

    expect(parsed).toMatchObject({ provider: 'first-class-real-estate', totalRows: 1, rejected: [] });
    expect(parsed.candidates[0]).toMatchObject({
      rowNumber: 3, firstName: 'Casey', lastName: 'Morgan', email: 'casey@example.com',
      phone: '5125550199', intent: 'buyer',
    });
    expect(parsed.candidates[0]?.leadType).toBeUndefined();
    expect(parsed.candidates[0]?.pipelineStage).toBeUndefined();
    expect(parsed.candidates[0]?.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'status', label: 'Status', category: 'other', valueType: 'text', value: 'Prospect' }),
      expect.objectContaining({ key: 'rating', label: 'Rating', category: 'engagement', valueType: 'number', value: 4 }),
    ]));
  });
  it('preserves a legacy phone placeholder without sending it to canonical identity', async () => {
    const headers = ['Contact Id','First Name','Last Name','Email','Cell Phone 1','Status','Deal Type','Assigned Agent ID','TCPA Optin Date'];
    const parsed = await parsePortableContactImport({
      filename: 'agent-owned-contacts.xlsx',
      bytes: workbook([headers, ['contact-2','Jamie','Rivera','jamie@example.com','0','Prospect','seller','agent-1','2025-01-01']]),
    });
    expect(parsed.rejected).toEqual([]);
    expect(parsed.candidates[0]?.phone).toBeUndefined();
    expect(parsed.candidates[0]?.sourceFacts).toContainEqual(expect.objectContaining({ key: 'cell-phone-1', label: 'Cell Phone 1', category: 'identity', valueType: 'text', value: '0' }));
  });
  it('normalizes embedded spreadsheet line breaks before SQL-bound contact and source facts', async () => {
    const headers = ['Contact Id','First Name','Last Name','Email','Cell Phone 1','Status','Deal Type','Assigned Agent ID','TCPA Optin Date','Primary Address','Secondary Address'];
    const parsed = await parsePortableContactImport({
      filename: 'agent-owned-contacts.xlsx',
      bytes: workbook([headers, ['contact-3','Jamie','Rivera\nHousehold','jamie@example.com','(555) 123-4567','Client','buyer','agent-1','2025-01-01','1 Main St\r\nUnit 2','PO Box 3\nMiami']]),
    });
    expect(parsed.rejected).toEqual([]);
    expect(parsed.candidates[0]).toMatchObject({
      lastName: 'Rivera Household', phone: '5551234567', mailingAddress: '1 Main St Unit 2',
    });
    expect(parsed.candidates[0]?.sourceFacts).toContainEqual(expect.objectContaining({ key: 'secondary-address', label: 'Secondary Address', category: 'address', valueType: 'text', value: 'PO Box 3 Miami' }));
  });
  it('generates deterministic usable CSV and XLSX templates', async () => {
    const csv = await createContactTemplate('csv'); expect(new TextDecoder().decode(csv)).toContain('First Name');
    const xlsx = await createContactTemplate('xlsx'); expect(read(xlsx, { type: 'array' }).SheetNames).toEqual(['Contacts']);
  });
});
