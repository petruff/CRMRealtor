import { parentPort, workerData } from 'node:worker_threads';
import { read, utils } from 'xlsx';

const fail = (code, message) => parentPort.postMessage({ ok: false, code, message });

const preflightXlsxPackage = (bytes, limits) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22, earliest = Math.max(0, bytes.byteLength - 65_557); offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.byteLength) throw new Error('unsafe-zip: malformed package directory');
  const disk = view.getUint16(eocd + 4, true), centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true), count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (disk || centralDisk || diskEntries !== count || !count || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || count > limits.maxZipEntries) throw new Error('unsafe-zip: unsupported package directory');
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > eocd || centralEnd < centralOffset) throw new Error('unsafe-zip: package directory outside bounds');
  let cursor = centralOffset, total = 0;
  const names = new Set(), ranges = [], decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('unsafe-zip: malformed central entry');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd || !nameLength || nameLength > limits.maxZipPathLength) throw new Error('unsafe-zip: invalid entry path');
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || names.has(name)) throw new Error('unsafe-zip: unsafe entry path');
    names.add(name);
    if ((flags & 1) || (method !== 0 && method !== 8)) throw new Error('unsafe-zip: encrypted or unsupported entry');
    if (uncompressed > limits.maxZipEntryUncompressedBytes) throw new Error('unsafe-zip: entry expansion limit');
    total += uncompressed;
    if (total > limits.maxZipUncompressedBytes) throw new Error('unsafe-zip: total expansion limit');
    if (uncompressed > 1_048_576 && uncompressed / Math.max(1, compressed) > limits.maxZipCompressionRatio) throw new Error('unsafe-zip: compression ratio limit');
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('unsafe-zip: invalid local entry');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true), dataEnd = dataStart + compressed;
    if (dataEnd > centralOffset || dataEnd < dataStart) throw new Error('unsafe-zip: entry outside bounds');
    ranges.push({ start: localOffset, end: dataEnd }); cursor = next;
  }
  if (cursor !== centralEnd) throw new Error('unsafe-zip: unexpected central data');
  ranges.sort((left, right) => left.start - right.start);
  if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) throw new Error('unsafe-zip: overlapping entries');
};

try {
  const bytes = new Uint8Array(workerData.bytes);
  if (workerData.format !== 'xls') preflightXlsxPackage(bytes, workerData.limits);
  const workbook = read(bytes, {
    type: 'array', dense: false,
    cellFormula: true, cellHTML: false, cellStyles: false, bookVBA: true,
    bookFiles: false, WTF: true, raw: true,
  });
  if (workbook.vbaraw) fail('macro-detected', 'Macro-enabled workbooks are not accepted.');
  else if (workbook.SheetNames.length < 1) fail('malformed-workbook', 'The workbook has no worksheets.');
  else if (workbook.SheetNames.length > workerData.limits.maxSheets) fail('too-many-sheets', `The workbook exceeds ${workerData.limits.maxSheets} worksheets.`);
  else {
    let totalCells = 0;
    const sheets = [];
    let rejected = false;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      let minColumn = Number.POSITIVE_INFINITY, maxColumn = -1;
      const materialRows = new Map();
      for (const [address, cell] of Object.entries(sheet)) {
        if (address.startsWith('!') || !cell) continue;
        if (cell.f) { fail('formula-detected', 'Workbook formulas are not accepted.'); rejected = true; break; }
        const rawValue = String(cell.v ?? ''), formattedValue = String(cell.w ?? '');
        if (rawValue === '' && formattedValue === '') continue;
        totalCells += 1;
        if (Math.max(rawValue.length, formattedValue.length) > workerData.limits.maxStringLength) { fail('string-too-long', `A cell exceeds ${workerData.limits.maxStringLength} characters.`); rejected = true; break; }
        if (totalCells > workerData.limits.maxCellsTotal) { fail('too-many-cells', `The workbook exceeds ${workerData.limits.maxCellsTotal} populated cells.`); rejected = true; break; }
        const position = utils.decode_cell(address);
        if (position.c >= workerData.limits.maxColumns) { fail('too-many-columns', `Worksheet ${name} exceeds the ${workerData.limits.maxColumns} column safe limit.`); rejected = true; break; }
        minColumn = Math.min(minColumn, position.c); maxColumn = Math.max(maxColumn, position.c);
        const materialRow = materialRows.get(position.r) ?? new Map();
        materialRow.set(position.c, formattedValue || rawValue);
        materialRows.set(position.r, materialRow);
      }
      if (rejected) break;
      const width = maxColumn < 0 ? 0 : maxColumn - minColumn + 1;
      const matrix = [...materialRows.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, cells]) => Array.from({ length: width }, (_, offset) => cells.get(minColumn + offset) ?? ''));
      sheets.push({ name, rows: matrix.map((row) => row.map((value) => String(value ?? ''))) });
    }
    if (!rejected) parentPort.postMessage({ ok: true, sheets, totalCells });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Workbook parsing failed.';
  const unsafeZip = /unsafe-zip/i.test(message);
  fail(unsafeZip ? 'unsafe-package' : /password|encrypt/i.test(message) ? 'encrypted-workbook' : 'malformed-workbook', unsafeZip ? 'The XLSX package exceeds safe expansion or structure limits.' : /password|encrypt/i.test(message) ? 'Encrypted workbooks are not accepted.' : 'The workbook is malformed or unsupported.');
}
