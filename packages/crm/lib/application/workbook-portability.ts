import { Worker } from 'node:worker_threads';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ContactImportError, MAX_IMPORT_BYTES, parseContactImport, parseContactImportRecords, type ContactImportMappingTarget, type ImportSource, type ParsedContactImport } from './contact-import.ts';

export const DATA_PORTABILITY_SCHEMA_VERSION = 'data-portability.v1';
export const WORKBOOK_LIMITS = Object.freeze({
  maxBytes: 10_485_760, maxSheets: 5, maxColumns: 256,
  maxCellsTotal: 100_000, maxStringLength: 4_096, timeoutMs: 5_000, memoryMb: 128,
  maxZipEntries: 4_096, maxZipUncompressedBytes: 33_554_432,
  maxZipEntryUncompressedBytes: 16_777_216, maxZipCompressionRatio: 200, maxZipPathLength: 512,
});

export type PortableImportFormat = 'csv' | 'vcard' | 'xls' | 'xlsx' | 'numbers';
type BinaryWorkbookFormat = Extract<PortableImportFormat, 'xls' | 'xlsx' | 'numbers'>;

const HEADER_SCAN_ROWS = 10;

function headerScore(row: readonly string[]): number {
  const normalized = row.map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const anchors = ['contact id', 'first name', 'last name', 'email', 'cell phone 1', 'status', 'deal type'];
  const anchorScore = anchors.filter((anchor) => normalized.includes(anchor)).length * 20;
  const populated = normalized.filter(Boolean).length;
  return anchorScore + Math.min(populated, 20);
}

function discoverHeaderRow(rows: readonly (readonly string[])[]): number {
  const candidates = rows.slice(0, HEADER_SCAN_ROWS).map((row, index) => ({ index, score: headerScore(row) }));
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  const winner = candidates[0];
  return winner && winner.score >= 3 ? winner.index : 0;
}

interface WorkerSuccess { ok: true; sheets: { name: string; rows: string[][] }[]; totalCells: number }
interface WorkerFailure { ok: false; code: string; message: string }
interface WorkbookCell { f?: string; v?: unknown; w?: string }

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function preflightXlsxPackage(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdSize = 22;
  const earliestEocd = Math.max(0, bytes.byteLength - minimumEocdSize - 65_535);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - minimumEocdSize; offset >= earliestEocd; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) { eocdOffset = offset; break; }
  }
  if (eocdOffset < 0) throw new ContactImportError('The XLSX package directory is missing or malformed.');

  const commentLength = view.getUint16(eocdOffset + 20, true);
  if (eocdOffset + minimumEocdSize + commentLength !== bytes.byteLength) {
    throw new ContactImportError('The XLSX package has invalid trailing data.');
  }
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntries = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount
    || entryCount === 0 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ContactImportError('Multi-disk and ZIP64 XLSX packages are not accepted.');
  }
  if (entryCount > WORKBOOK_LIMITS.maxZipEntries) {
    throw new ContactImportError(`The XLSX package exceeds ${WORKBOOK_LIMITS.maxZipEntries} entries.`);
  }
  const centralEnd = centralOffset + centralSize;
  if (centralOffset < 0 || centralEnd > eocdOffset || centralEnd < centralOffset) {
    throw new ContactImportError('The XLSX package directory is outside the file bounds.');
  }

  let cursor = centralOffset;
  let totalUncompressed = 0;
  const names = new Set<string>();
  const localRanges: { start: number; end: number }[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new ContactImportError('The XLSX package central directory is malformed.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (next > centralEnd || nameLength < 1 || nameLength > WORKBOOK_LIMITS.maxZipPathLength) {
      throw new ContactImportError('The XLSX package contains an invalid entry path.');
    }
    let name: string;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { throw new ContactImportError('The XLSX package contains an invalid UTF-8 entry path.'); }
    if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)
      || name.split('/').includes('..') || names.has(name)) {
      throw new ContactImportError('The XLSX package contains an unsafe or duplicate entry path.');
    }
    names.add(name);
    if ((flags & 0x1) !== 0 || (method !== 0 && method !== 8)) {
      throw new ContactImportError('Encrypted or unsupported XLSX package entries are not accepted.');
    }
    if (uncompressedSize > WORKBOOK_LIMITS.maxZipEntryUncompressedBytes) {
      throw new ContactImportError('An XLSX package entry exceeds the safe uncompressed-size limit.');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > WORKBOOK_LIMITS.maxZipUncompressedBytes) {
      throw new ContactImportError('The XLSX package exceeds the safe total uncompressed-size limit.');
    }
    const ratio = uncompressedSize / Math.max(1, compressedSize);
    if (uncompressedSize > 1_048_576 && ratio > WORKBOOK_LIMITS.maxZipCompressionRatio) {
      throw new ContactImportError('The XLSX package exceeds the safe compression-ratio limit.');
    }
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      throw new ContactImportError('The XLSX package contains an invalid local entry.');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset || dataEnd < dataStart) {
      throw new ContactImportError('The XLSX package entry data is outside the file bounds.');
    }
    localRanges.push({ start: localOffset, end: dataEnd });
    cursor = next;
  }
  if (cursor !== centralEnd) throw new ContactImportError('The XLSX package central directory has unexpected data.');
  localRanges.sort((left, right) => left.start - right.start);
  if (localRanges.some((range, index) => index > 0 && range.start < (localRanges[index - 1]?.end ?? 0))) {
    throw new ContactImportError('The XLSX package contains overlapping entries.');
  }
}

function workbookFormat(filename: string, bytes: Uint8Array): BinaryWorkbookFormat {
  const extension = extname(filename).toLowerCase();
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const cfb = bytes.length >= 8 && [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((value, index) => bytes[index] === value);
  if (extension === '.xlsx' && zip) return 'xlsx';
  if (extension === '.numbers' && zip) return 'numbers';
  if (extension === '.xls' && cfb) return 'xls';
  throw new ContactImportError('The file extension does not match a supported XLS, XLSX, or Numbers workbook signature.');
}

async function parseWorkbookInWorker(bytes: Uint8Array, format: BinaryWorkbookFormat): Promise<WorkerSuccess> {
  return new Promise((resolve, reject) => {
    const copy = bytes.slice();
    // The worker remains a real filesystem asset in the Vercel trace. A
    // process-rooted path avoids Next turning it into a non-existent chunk.
    const workerEntrypoint = pathToFileURL(join(process.cwd(), 'lib/application/workbook-parser-worker.mjs'));
    const worker = new Worker(workerEntrypoint, {
      workerData: { bytes: copy.buffer, format, limits: WORKBOOK_LIMITS }, transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: WORKBOOK_LIMITS.memoryMb, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => { void worker.terminate(); reject(new ContactImportError('Workbook parsing exceeded the safe time limit.')); }, WORKBOOK_LIMITS.timeoutMs);
    worker.once('message', (message: WorkerSuccess | WorkerFailure) => {
      clearTimeout(timer); void worker.terminate();
      if (!message.ok) reject(new ContactImportError(message.message)); else resolve(message);
    });
    worker.once('error', (error) => { clearTimeout(timer); reject(new ContactImportError(`Workbook parser failed safely: ${error.message}`)); });
    worker.once('exit', (code) => { if (code !== 0) { clearTimeout(timer); reject(new ContactImportError('Workbook parser stopped before producing a result.')); } });
  });
}

async function parseWorkbookInProcess(bytes: Uint8Array, format: BinaryWorkbookFormat): Promise<WorkerSuccess> {
  try {
    if (format !== 'xls') preflightXlsxPackage(bytes);
    const { read, utils } = await import('xlsx');
    const workbook = read(bytes, {
      type: 'array', dense: false,
      cellFormula: true, cellHTML: false, cellStyles: false, bookVBA: true,
      bookFiles: false, WTF: true, raw: true,
    });
    if ((workbook as typeof workbook & { vbaraw?: unknown }).vbaraw) {
      throw new ContactImportError('Macro-enabled workbooks are not accepted.');
    }
    if (workbook.SheetNames.length < 1) throw new ContactImportError('The workbook has no worksheets.');
    if (workbook.SheetNames.length > WORKBOOK_LIMITS.maxSheets) {
      throw new ContactImportError(`The workbook exceeds ${WORKBOOK_LIMITS.maxSheets} worksheets.`);
    }
    let totalCells = 0;
    const sheets: WorkerSuccess['sheets'] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) throw new ContactImportError(`Worksheet ${name} is malformed.`);
      let minColumn = Number.POSITIVE_INFINITY;
      let maxColumn = -1;
      const materialRows = new Map<number, Map<number, string>>();
      for (const [address, rawCell] of Object.entries(sheet)) {
        if (address.startsWith('!') || !rawCell) continue;
        const cell = rawCell as WorkbookCell;
        if (cell.f) throw new ContactImportError('Workbook formulas are not accepted.');
        const rawValue = String(cell.v ?? '');
        const formattedValue = String(cell.w ?? '');
        if (rawValue === '' && formattedValue === '') continue;
        totalCells += 1;
        if (Math.max(rawValue.length, formattedValue.length) > WORKBOOK_LIMITS.maxStringLength) {
          throw new ContactImportError(`A cell exceeds ${WORKBOOK_LIMITS.maxStringLength} characters.`);
        }
        if (totalCells > WORKBOOK_LIMITS.maxCellsTotal) {
          throw new ContactImportError(`The workbook exceeds ${WORKBOOK_LIMITS.maxCellsTotal} populated cells.`);
        }
        const position = utils.decode_cell(address);
        if (position.c >= WORKBOOK_LIMITS.maxColumns) {
          throw new ContactImportError(`Worksheet ${name} exceeds the ${WORKBOOK_LIMITS.maxColumns} column safe limit.`);
        }
        minColumn = Math.min(minColumn, position.c);
        maxColumn = Math.max(maxColumn, position.c);
        const materialRow = materialRows.get(position.r) ?? new Map<number, string>();
        materialRow.set(position.c, formattedValue || rawValue);
        materialRows.set(position.r, materialRow);
      }
      // Never trust a vendor workbook's declared used range. Exports commonly
      // retain formatting down to Excel's last row. Building the matrix from
      // material cells prevents both false row counts and range-amplification
      // work, even when a non-empty sparse cell sits at a very high row index.
      const width = maxColumn < 0 ? 0 : maxColumn - minColumn + 1;
      const matrix = [...materialRows.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, cells]) => Array.from({ length: width }, (_, offset) => cells.get(minColumn + offset) ?? ''));
      sheets.push({ name, rows: matrix.map((row) => row.map((value) => String(value ?? ''))) });
    }
    return { ok: true, sheets, totalCells };
  } catch (error) {
    if (error instanceof ContactImportError) throw error;
    const message = error instanceof Error ? error.message : 'Workbook parsing failed.';
    throw new ContactImportError(
      /password|encrypt/i.test(message)
        ? 'Encrypted workbooks are not accepted.'
        : 'The workbook is malformed or unsupported.',
    );
  }
}

async function parseWorkbook(bytes: Uint8Array, format: BinaryWorkbookFormat): Promise<WorkerSuccess> {
  // Production must retain memory and timeout isolation. Vercel traces the
  // process-rooted worker asset explicitly; a missing production asset fails
  // closed instead of moving compressed workbook parsing into the app process.
  try {
    return await parseWorkbookInWorker(bytes, format);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'production'
      && /cannot find module|err_module_not_found|stopped before producing/i.test(message)) {
      return parseWorkbookInProcess(bytes, format);
    }
    throw error;
  }
}

export async function parsePortableContactImport(input: { bytes: Uint8Array; filename: string; source?: ImportSource; mapping?: Readonly<Record<string, ContactImportMappingTarget | 'ignore'>> }): Promise<ParsedContactImport> {
  if (input.bytes.byteLength < 1) throw new ContactImportError('The import file is empty.');
  if (input.bytes.byteLength > WORKBOOK_LIMITS.maxBytes) throw new ContactImportError(`The file exceeds the ${WORKBOOK_LIMITS.maxBytes} byte safe limit.`);
  const extension = extname(input.filename).toLowerCase();
  if (extension === '.csv' || extension === '.vcf') {
    if (input.bytes.byteLength > MAX_IMPORT_BYTES) throw new ContactImportError('CSV and vCard files retain the 2 MB safe import limit.');
    return parseContactImport({ content: new TextDecoder('utf-8', { fatal: true }).decode(input.bytes), filename: input.filename, source: input.source, mapping: input.mapping });
  }
  if (extension !== '.xls' && extension !== '.xlsx' && extension !== '.numbers') {
    throw new ContactImportError('Only CSV, VCF, XLS, XLSX, and Apple Numbers files are supported.');
  }
  const format = workbookFormat(input.filename, input.bytes);
  const workbook = await parseWorkbook(input.bytes, format);
  const first = workbook.sheets[0];
  if (!first || first.rows.length < 2) throw new ContactImportError('The first worksheet must include a header and at least one contact row.');
  if (workbook.sheets.length > 1) {
    throw new ContactImportError(
      'This workbook contains multiple worksheets. Export or copy the contacts into one worksheet, then import it again.',
    );
  }
  const headerRowIndex = discoverHeaderRow(first.rows);
  return parseContactImportRecords({
    filename: input.filename,
    format,
    headers: first.rows[headerRowIndex] ?? [],
    rows: first.rows.slice(headerRowIndex + 1),
    source: input.source,
    mapping: input.mapping,
    firstDataRowNumber: headerRowIndex + 2,
  });
}

export const CONTACT_TEMPLATE_HEADERS = Object.freeze([
  'First Name','Last Name','Preferred Name','Phone','Secondary Phone','Email','Mailing Address','City','State','Postal Code','Birthday','Home Purchase Date','Lead Type','Relationship','Intent','Source','Pipeline Stage','Tags','Email Subscribed','Notes',
]);

export async function createContactTemplate(format: 'csv' | 'xlsx'): Promise<Uint8Array> {
  const example = ['Ada','Lovelace','','+15551234567','','ada@example.com','123 Main St','Miami','FL','33101','1815-12-10','','warm','lead','buyer','referral','new','sphere','false','Replace this example row'];
  if (format === 'csv') return new TextEncoder().encode([CONTACT_TEMPLATE_HEADERS, example].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n'));
  const { utils, write } = await import('xlsx');
  const workbook = utils.book_new(); utils.book_append_sheet(workbook, utils.aoa_to_sheet([[...CONTACT_TEMPLATE_HEADERS], example]), 'Contacts');
  return new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
}
