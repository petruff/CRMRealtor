/**
 * Platform-neutral contact import parser.
 *
 * Runtime imports stay platform-neutral so the browser-independent engine can
 * also run from Node's type-stripping CLI without a bundler.
 */

import {
  IncompleteRecordError,
  projectIncompleteCandidate,
  type IncompleteCandidate,
  type IncompleteValidationReason,
} from '../domain/incomplete-record.ts';

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_COLUMNS = 256;
export const MAX_IMPORT_CELLS = 100_000;
export const MAX_IMPORT_CELL_LENGTH = 4_096;
export const MAX_INTAKE_BATCH = 50;

export type ImportSource =
  | 'auto'
  | 'spreadsheet'
  | 'mailchimp'
  | 'google'
  | 'apple'
  | 'boldtrail'
  | 'website'
  | 'platform';

export type ImportLeadType = 'hot' | 'warm' | 'nurture';
export type ImportRelationship = 'lead' | 'active-client' | 'past-client' | 'sphere';
export type ImportIntent = 'buyer' | 'seller' | 'both' | 'investor' | 'renter' | 'unknown';
export type ImportLeadSource =
  | 'cold-call'
  | 'open-house'
  | 'referral'
  | 'social-media'
  | 'website'
  | 'mailer'
  | 'other';
export type ImportPipelineStage =
  | 'new'
  | 'contacted'
  | 'appointment-set'
  | 'active'
  | 'under-contract'
  | 'closed'
  | 'lost';

export interface ContactImportCandidate {
  rowNumber: number;
  externalId?: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  mailingAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  birthdate?: string;
  homePurchaseDate?: string;
  leadType?: ImportLeadType;
  qualificationStatus?: 'qualified' | 'needs-qualification';
  relationship?: ImportRelationship;
  intent?: ImportIntent;
  source?: ImportLeadSource;
  pipelineStage?: ImportPipelineStage;
  tags: string[];
  emailSubscribed?: boolean;
  note?: string;
  /** Bounded source-native values preserved for governed migration fields. */
  sourceFacts?: readonly ContactImportSourceFact[];
}

export interface ContactImportSourceFact {
  readonly key: string;
  readonly label: string;
  readonly category: ContactImportSourceFactCategory;
  readonly valueType: ContactImportSourceFactValueType;
  readonly value: string | number | boolean;
  readonly sourceRowNumber?: number;
}

export type ContactImportSourceFactCategory =
  | 'identity'
  | 'ownership'
  | 'address'
  | 'real-estate'
  | 'engagement'
  | 'verification'
  | 'consent'
  | 'other';

export type ContactImportSourceFactValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'timestamp';

const SOURCE_FACT_CATEGORY_BY_KEY: Readonly<Record<string, ContactImportSourceFactCategory>> = {
  'contact-id': 'identity', 'first-name': 'identity', 'last-name': 'identity', email: 'identity',
  'cell-phone-1': 'identity', 'work-phone': 'identity', 'home-phone': 'identity', 'cell-phone-2': 'identity',
  'spouse-first-name': 'identity', 'spouse-last-name': 'identity', 'spouse-phone': 'identity',
  'spouse-email': 'identity', 'spouse-birthday': 'identity', birthday: 'identity', 'external-vendor-id': 'identity',
  source: 'ownership', 'system-source': 'ownership', 'assigned-agent': 'ownership', 'agent-email': 'ownership',
  'assigned-agent-id': 'ownership', 'owner-type': 'ownership', 'owner-id': 'ownership', 'is-private': 'ownership',
  referrer: 'ownership', 'capture-method': 'ownership', 'lead-channel': 'ownership',
  location: 'address', 'complete-primary-address': 'address', 'primary-address': 'address',
  'primary-city': 'address', 'primary-state': 'address', 'primary-zip': 'address',
  'primary-address-label-line-1': 'address', 'primary-address-label-line-2': 'address',
  'secondary-address': 'address', latitude: 'address', longitude: 'address',
  'deal-type': 'real-estate', 'business-type': 'real-estate', 'last-closed-date': 'real-estate',
  'homeowner-status': 'real-estate', 'avg-price': 'real-estate', 'avg-beds': 'real-estate',
  'avg-baths': 'real-estate', 'preferred-listing-name': 'real-estate', 'preferred-city': 'real-estate',
  'price-range': 'real-estate', 'active-mls-id': 'real-estate',
  registered: 'engagement', hashtags: 'engagement', rating: 'engagement', 'call-count': 'engagement',
  'last-call': 'engagement', 'email-count': 'engagement', 'last-email': 'engagement',
  'last-email-date': 'engagement', 'search-count': 'engagement', 'saved-search-count': 'engagement',
  'fav-count': 'engagement', 'primary-call': 'engagement', 'primary-sms': 'engagement',
  'picture-url': 'engagement', 'text-count': 'engagement', 'last-email-sent-by-contact': 'engagement',
  'verification-run': 'verification', 'email-verified': 'verification', 'phone-verified': 'verification',
  'email-optin': 'consent', 'text-on': 'consent', 'phone-on': 'consent', 'behavior-alerts-on': 'consent',
  'valuation-optin': 'consent', 'tcpa-optin-date': 'consent', 'tcpa-optin-party': 'consent',
  'tcpa-optin-party-id': 'consent',
};

const SOURCE_FACT_BOOLEAN_KEYS = new Set([
  'email-optin', 'text-on', 'phone-on', 'is-private', 'registered', 'primary-call', 'primary-sms',
  'behavior-alerts-on', 'verification-run', 'email-verified', 'phone-verified',
  'last-email-sent-by-contact', 'valuation-optin',
]);
const SOURCE_FACT_NUMBER_KEYS = new Set([
  'rating', 'avg-price', 'avg-beds', 'avg-baths', 'call-count', 'email-count', 'search-count',
  'saved-search-count', 'fav-count', 'latitude', 'longitude', 'text-count',
]);
const SOURCE_FACT_DATE_KEYS = new Set(['spouse-birthday', 'birthday', 'last-closed-date']);
const SOURCE_FACT_TIMESTAMP_KEYS = new Set([
  'last-call', 'last-email-date', 'created-at', 'updated-at', 'merged-at', 'tcpa-optin-date',
]);

function sourceFactValue(
  key: string,
  value: string,
): Pick<ContactImportSourceFact, 'valueType' | 'value'> {
  if (SOURCE_FACT_BOOLEAN_KEYS.has(key)) {
    const normalized = value.toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) return { valueType: 'boolean', value: true };
    if (['false', 'no', '0', 'off'].includes(normalized)) return { valueType: 'boolean', value: false };
  }
  if (SOURCE_FACT_NUMBER_KEYS.has(key)) {
    const normalized = Number(value.replace(/[$,%\s]/g, ''));
    if (Number.isFinite(normalized)) return { valueType: 'number', value: normalized };
  }
  if (SOURCE_FACT_DATE_KEYS.has(key)) {
    try {
      const normalized = dateOnly(value);
      if (normalized) return { valueType: 'date', value: normalized };
    } catch { /* Preserve an unparseable source value as text. */ }
  }
  if (SOURCE_FACT_TIMESTAMP_KEYS.has(key)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return { valueType: 'timestamp', value: parsed.toISOString() };
  }
  return { valueType: 'text', value };
}

const KVCORE_FILE_HINT = /(?:^|[^a-z0-9])(?:1st[ -]?class(?:[ -]?real[ -]?estate)?|first[ -]?class(?:[ -]?real[ -]?estate)?|kvcore)(?:[^a-z0-9]|$)/i;
const KVCORE_IDENTITY_HEADERS = new Set([
  'contact id', 'first name', 'last name', 'email', 'contact name',
]);
const KVCORE_SOURCE_HEADERS = new Set([
  'cell phone 1', 'cell phone 2', 'deal type', 'assigned agent id',
  'tcpa optin date', 'tcpa optin party', 'email optin', 'hashtags',
  'primary address', 'secondary address',
]);

/**
 * KvCore/First Class exports are user-editable before download. Detection must
 * therefore survive removed and reordered columns without relying on the
 * ambiguous Status or Rating labels. A filename hint is useful, while two
 * source-native headers plus one identity header are sufficient when a user
 * has renamed the file for another workflow.
 */
function isKvCoreContactExport(filename: string, headers: readonly string[]): boolean {
  const normalized = new Set(headers.map(normalizeHeader));
  if (KVCORE_FILE_HINT.test(filename)) return true;
  const identityCount = [...KVCORE_IDENTITY_HEADERS].filter((header) => normalized.has(header)).length;
  const sourceCount = [...KVCORE_SOURCE_HEADERS].filter((header) => normalized.has(header)).length;
  return identityCount >= 1 && sourceCount >= 2;
}

export interface ContactImportRejection {
  rowNumber: number;
  errors: string[];
  /** Safe allowlisted projection only; raw rows and unknown columns never cross this seam. */
  incomplete?: {
    externalId?: string;
    candidate: IncompleteCandidate;
    reasons: readonly IncompleteValidationReason[];
  };
}

export interface ParsedContactImport {
  filename: string;
  format: 'csv' | 'vcard' | 'json' | 'xls' | 'xlsx' | 'numbers';
  requestedSource: ImportSource;
  detectedSource: Exclude<ImportSource, 'auto'>;
  /** Stable source key used for external-id deduplication (for example zillow). */
  provider: string;
  totalRows: number;
  headers: string[];
  recognizedFields: string[];
  unknownFields: string[];
  preservedFields: string[];
  candidates: ContactImportCandidate[];
  rejected: ContactImportRejection[];
}

/** Reuses the canonical allowlisted candidate projection for trusted tabular adapters. */
export function parseContactImportRecords(input: {
  filename: string;
  format: 'xls' | 'xlsx' | 'numbers';
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  source?: ImportSource;
  mapping?: Readonly<Record<string, CandidateField | 'ignore'>>;
  firstDataRowNumber?: number;
}): ParsedContactImport {
  const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const content = [input.headers, ...input.rows]
    .map((row) => row.map((value) => csvCell(String(value))).join(','))
    .join('\n');
  const parsed = parseContactImport({
    content,
    filename: input.filename.replace(/\.(xlsx?|xls|numbers)$/i, '.csv'),
    source: input.source,
    mapping: input.mapping,
    // The workbook worker already enforced the original-file, cell-count,
    // string-length, formula and memory bounds before this trusted adapter.
    contentByteLimit: Number.MAX_SAFE_INTEGER,
  });
  const firstDataRowNumber = input.firstDataRowNumber ?? 2;
  const rowDelta = firstDataRowNumber - 2;
  return {
    ...parsed,
    filename: input.filename,
    format: input.format,
    candidates: parsed.candidates.map((candidate) => ({
      ...candidate,
      rowNumber: candidate.rowNumber + rowDelta,
      ...(candidate.sourceFacts ? { sourceFacts: candidate.sourceFacts.map((fact) => ({
        ...fact,
        ...(fact.sourceRowNumber === undefined
          ? {} : { sourceRowNumber: fact.sourceRowNumber + rowDelta }),
      })) } : {}),
    })),
    rejected: parsed.rejected.map((rejected) => ({ ...rejected, rowNumber: rejected.rowNumber + rowDelta })),
  };
}

export class ContactImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactImportError';
  }
}

type CandidateField = Exclude<keyof ContactImportCandidate, 'rowNumber' | 'tags' | 'sourceFacts'> | 'fullName' | 'tags';
export type ContactImportMappingTarget = CandidateField;
export const CONTACT_IMPORT_MAPPING_TARGETS: readonly CandidateField[] = [
  'externalId','firstName','lastName','fullName','preferredName','phone','secondaryPhone','email','mailingAddress','city','state','postalCode','birthdate','homePurchaseDate','leadType','qualificationStatus','relationship','intent','source','pipelineStage','tags','emailSubscribed','note',
] as const;

const FIELD_ALIASES: Record<CandidateField, readonly string[]> = {
  externalId: ['id', 'contact id', 'contactid', 'external id', 'externalid', 'uid', 'lead id'],
  firstName: ['first name', 'firstname', 'given name', 'givenname', 'fname', 'contact first name'],
  lastName: ['last name', 'lastname', 'family name', 'familyname', 'surname', 'lname', 'contact last name'],
  fullName: ['name', 'full name', 'fullname', 'contact name', 'display name'],
  preferredName: ['preferred name', 'preferredname', 'nickname', 'nick name'],
  phone: ['phone', 'phone number', 'phonenumber', 'mobile', 'mobile phone', 'cell', 'cell phone', 'primary phone'],
  secondaryPhone: ['secondary phone', 'secondaryphone', 'alternate phone', 'other phone', 'phone 2 value'],
  email: ['email', 'email address', 'emailaddress', 'primary email', 'e-mail 1 value', 'email 1 value'],
  mailingAddress: ['address', 'mailing address', 'mailingaddress', 'street', 'street address', 'address 1'],
  city: ['city', 'mailing city'],
  state: ['state', 'province', 'region', 'mailing state'],
  postalCode: ['zip', 'zip code', 'zipcode', 'postal code', 'postalcode'],
  birthdate: ['birthday', 'birthdate', 'birth date', 'date of birth', 'dob'],
  homePurchaseDate: ['home purchase date', 'homepurchase date', 'homepurchasedate', 'closing date', 'home anniversary', 'homeaversary'],
  leadType: ['lead type', 'leadtype', 'temperature', 'priority'],
  qualificationStatus: ['qualification status', 'qualificationstatus', 'needs qualification', 'figure out'],
  relationship: ['relationship', 'contact type', 'contacttype', 'category'],
  intent: ['intent', 'looking to', 'transaction type'],
  source: ['source', 'lead source', 'leadsource', 'origin'],
  // Generic Status is deliberately excluded. It is vendor-specific and may
  // only become an Omnix pipeline stage through an explicit user mapping.
  pipelineStage: ['pipeline stage', 'pipelinestage', 'stage'],
  tags: ['tags', 'tag', 'categories', 'groups', 'labels'],
  emailSubscribed: ['email subscribed', 'emailsubscribed', 'marketing status', 'email marketing', 'subscription status'],
  note: ['note', 'notes', 'comments', 'comment', 'description', 'last note'],
};

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Spreadsheet exports frequently embed CR/LF inside address/name cells.
  // Preserve the semantic text while producing the printable representation
  // required by both contact and custom-field persistence constraints.
  const result = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return result || undefined;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ALIAS_LOOKUP = new Map<string, CandidateField>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [CandidateField, readonly string[]][]) {
  for (const alias of aliases) ALIAS_LOOKUP.set(normalizeHeader(alias), field);
}

function fieldForHeader(header: string): CandidateField | undefined {
  const normalized = normalizeHeader(header);
  const direct = ALIAS_LOOKUP.get(normalized);
  if (direct) return direct;
  if (/^phone \d+ value$/.test(normalized)) return normalized.startsWith('phone 1') ? 'phone' : 'secondaryPhone';
  if (/^(e mail|email) \d+ value$/.test(normalized)) return 'email';
  if (/^address \d+ formatted$/.test(normalized)) return 'mailingAddress';
  return undefined;
}

function delimiterScore(line: string, delimiter: string): number {
  let quoted = false;
  let score = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) score += 1;
  }
  return score;
}

function chooseDelimiter(content: string): string {
  const firstRecord = content.split(/\r?\n/, 1)[0] ?? '';
  const options = [',', ';', '\t'];
  return options.sort((left, right) => delimiterScore(firstRecord, right) - delimiterScore(firstRecord, left))[0] ?? ',';
}

export function parseDelimited(content: string): string[][] {
  const delimiter = chooseDelimiter(content);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      record.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      record.push(cell);
      if (record.some((entry) => entry.trim())) records.push(record);
      record = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  if (quoted) throw new ContactImportError('The CSV contains an unclosed quoted field.');
  record.push(cell);
  if (record.some((entry) => entry.trim())) records.push(record);
  return records;
}

function validateTabularSecurityBounds(rows: readonly (readonly string[])[]): void {
  let totalCells = 0;
  for (const row of rows) {
    if (row.length > MAX_IMPORT_COLUMNS) {
      throw new ContactImportError(`The import exceeds the ${MAX_IMPORT_COLUMNS} column safe limit.`);
    }
    totalCells += row.length;
    if (totalCells > MAX_IMPORT_CELLS) {
      throw new ContactImportError(`The import exceeds the ${MAX_IMPORT_CELLS.toLocaleString('en-US')} cell safe limit.`);
    }
    if (row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)) {
      throw new ContactImportError(`A cell exceeds ${MAX_IMPORT_CELL_LENGTH.toLocaleString('en-US')} characters.`);
    }
  }
}

function splitName(fullName: string | undefined): { firstName: string; lastName: string } {
  const parts = fullName?.split(/\s+/).filter(Boolean) ?? [];
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? '' };
}

function dateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let year: number;
  let month: number;
  let day: number;
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if ((match = value.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if ((match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  } else {
    throw new ContactImportError(`Invalid date "${value}".`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ContactImportError(`Invalid date "${value}".`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim().replace(/[ _]+/g, '-');
  return allowed.includes(normalized as T) ? (normalized as T) : undefined;
}

function leadTypeValue(value: string | undefined, tags: string[]): ImportLeadType | undefined {
  const explicit = enumValue(value, ['hot', 'warm', 'nurture']);
  if (explicit) return explicit;
  const haystack = tags.join(' ').toLowerCase();
  if (/\bhot\b/.test(haystack)) return 'hot';
  if (/\bwarm\b/.test(haystack)) return 'warm';
  if (/\bnurture\b/.test(haystack)) return 'nurture';
  return undefined;
}

function qualificationStatusValue(value: string | undefined): ContactImportCandidate['qualificationStatus'] {
  const canonical = enumValue(value, ['qualified', 'needs-qualification']);
  if (canonical) return canonical;
  const normalized = value?.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
  return normalized === 'needs review' || normalized === 'needs qualification'
    ? 'needs-qualification'
    : undefined;
}

function relationshipValue(value: string | undefined): ImportRelationship | undefined {
  const canonical = enumValue(value, ['lead', 'active-client', 'past-client', 'sphere']);
  if (canonical) return canonical;
  const normalized = value?.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
  if (normalized === 'client' || normalized === 'active client' || normalized === 'current client') return 'active-client';
  if (normalized === 'past client' || normalized === 'former client') return 'past-client';
  if (normalized === 'prospect' || normalized === 'active lead' || normalized === 'new lead') return 'lead';
  if (normalized === 'soi' || normalized === 'sphere of influence') return 'sphere';
  return undefined;
}

function pipelineStageValue(value: string | undefined): ImportPipelineStage | undefined {
  const canonical = enumValue(value, ['new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost']);
  if (canonical) return canonical;
  const normalized = value?.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
  if (normalized === 'new lead' || normalized === 'prospect') return 'new';
  if (normalized === 'active lead' || normalized === 'client' || normalized === 'active client') return 'active';
  if (normalized === 'appointment' || normalized === 'appointment set' || normalized === 'consultation') return 'appointment-set';
  if (normalized === 'pending' || normalized === 'in contract' || normalized === 'escrow') return 'under-contract';
  if (normalized === 'past client' || normalized === 'sold') return 'closed';
  if (normalized === 'archived' || normalized === 'inactive' || normalized === 'dead' || normalized === 'dnc') return 'lost';
  return undefined;
}

function leadSourceValue(value: string | undefined): ImportLeadSource | undefined {
  const canonical = enumValue(value, ['cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other']);
  if (canonical) return canonical;
  const normalized = value?.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
  if (normalized === 'lead import' || normalized === 'manual add' || normalized === 'manual entry' || normalized === 'import') return 'other';
  if (normalized === 'direct website' || normalized === 'organic website' || normalized === 'web form') return 'website';
  if (normalized === 'facebook' || normalized === 'instagram' || normalized === 'social') return 'social-media';
  if (normalized === 'open house') return 'open-house';
  if (normalized === 'cold call' || normalized === 'cold calling') return 'cold-call';
  return undefined;
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (['true', 'yes', '1', 'subscribed', 'active'].includes(normalized)) return true;
  if (['false', 'no', '0', 'unsubscribed', 'cleaned', 'non-subscribed'].includes(normalized)) return false;
  return undefined;
}

function tagsValue(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(value.split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean)));
}

function firstClassSourceValue(value: string | undefined): ImportLeadSource | undefined {
  return leadSourceValue(value);
}

function firstClassPhoneValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  // Placeholder values from the legacy export remain in sourceFacts, but must
  // never enter canonical identity resolution or contact phone validation.
  return digits.length >= 7 && digits.length <= 15 ? digits : undefined;
}

function rowObject(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
}

function candidateFromRecord(
  record: Record<string, unknown>,
  rowNumber: number,
  firstClassExport = false,
  sourceRecord: Record<string, unknown> = record,
): {
  candidate?: ContactImportCandidate;
  errors: string[];
  incomplete?: ContactImportRejection['incomplete'];
} {
  const values = new Map<CandidateField, string>();
  for (const [header, raw] of Object.entries(record)) {
    const normalizedHeader = normalizeHeader(header);
    let field = fieldForHeader(header);
    if (firstClassExport) {
      // First Class uses these labels for its own 0–5 rating and lifecycle
      // taxonomy. They are not Omnix lead temperature or pipeline stages.
      if (normalizedHeader === 'rating' || normalizedHeader === 'status') field = undefined;
      else if (normalizedHeader === 'cell phone 1') field = 'phone';
      else if (normalizedHeader === 'cell phone 2') field = 'secondaryPhone';
      else if (normalizedHeader === 'deal type') field = 'intent';
      else if (normalizedHeader === 'email optin') field = 'emailSubscribed';
      else if (normalizedHeader === 'hashtags') field = 'tags';
      else if (normalizedHeader === 'primary address') field = 'mailingAddress';
      else if (normalizedHeader === 'primary city') field = 'city';
      else if (normalizedHeader === 'primary state') field = 'state';
      else if (normalizedHeader === 'primary zip') field = 'postalCode';
    }
    const text = clean(raw);
    if (field && text && !values.has(field)) values.set(field, text);
  }

  const split = splitName(values.get('fullName'));
  const firstName = values.get('firstName') ?? split.firstName;
  const lastName = values.get('lastName') ?? split.lastName;
  const errors: string[] = [];
  if (!firstName && !lastName) errors.push('At least a first or last name is required.');
  if ((values.get('externalId')?.length ?? 0) > 255) errors.push('External ID must be 255 characters or fewer.');

  const email = values.get('email')?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email address is invalid.');

  let birthdate: string | undefined;
  let homePurchaseDate: string | undefined;
  try {
    birthdate = dateOnly(values.get('birthdate'));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Birthday is invalid.');
  }
  try {
    homePurchaseDate = dateOnly(values.get('homePurchaseDate'));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Home purchase date is invalid.');
  }

  const tags = tagsValue(values.get('tags'));
  const leadType = leadTypeValue(values.get('leadType'), tags);
  const qualificationStatus = qualificationStatusValue(values.get('qualificationStatus'));
  const relationship = relationshipValue(values.get('relationship'));
  const intent = enumValue(values.get('intent'), ['buyer', 'seller', 'both', 'investor', 'renter', 'unknown']);
  const source = firstClassExport
    ? firstClassSourceValue(values.get('source'))
    : leadSourceValue(values.get('source'));
  const pipelineStage = pipelineStageValue(values.get('pipelineStage'));
  const emailSubscribed = booleanValue(values.get('emailSubscribed'));
  if (values.get('leadType') && !leadType) errors.push('Lead type must be Hot, Warm, or Nurture.');
  if (values.get('qualificationStatus') && !qualificationStatus) errors.push('Qualification status must be Qualified or Needs review.');
  if (values.get('relationship') && !relationship) errors.push('Relationship is invalid.');
  if (values.get('intent') && !intent) errors.push('Intent is invalid.');
  if (values.get('source') && !source) errors.push('Lead source is invalid.');
  if (values.get('pipelineStage') && !pipelineStage) errors.push('Pipeline stage is invalid.');
  if (values.get('emailSubscribed') && emailSubscribed === undefined) errors.push('Email subscription state is invalid.');

  const candidate: ContactImportCandidate = {
    rowNumber,
    externalId: values.get('externalId'),
    firstName: firstName ?? '',
    lastName: lastName ?? '',
    preferredName: values.get('preferredName'),
    phone: firstClassExport ? firstClassPhoneValue(values.get('phone')) : values.get('phone'),
    secondaryPhone: firstClassExport ? firstClassPhoneValue(values.get('secondaryPhone')) : values.get('secondaryPhone'),
    email,
    mailingAddress: values.get('mailingAddress'),
    city: values.get('city'),
    state: values.get('state'),
    postalCode: values.get('postalCode'),
    birthdate,
    homePurchaseDate,
    leadType,
    qualificationStatus,
    relationship,
    intent,
    source,
    pipelineStage,
    tags,
    emailSubscribed,
    note: values.get('note'),
    ...(firstClassExport ? { sourceFacts: Object.entries(sourceRecord).flatMap(([label, raw]) => {
      const value = clean(raw);
      if (!value) return [];
      const key = normalizeHeader(label).replace(/ /g, '-');
      return [{
        key,
        label,
        category: SOURCE_FACT_CATEGORY_BY_KEY[key] ?? 'other',
        ...sourceFactValue(key, value),
        sourceRowNumber: rowNumber,
      } satisfies ContactImportSourceFact];
    }) } : {}),
  };
  if (errors.length > 0) {
    try {
      const safeExternalId = candidate.externalId && candidate.externalId.length <= 255
        ? candidate.externalId
        : undefined;
      const projection = projectIncompleteCandidate(candidate, errors, safeExternalId);
      return {
        errors,
        incomplete: {
          ...(safeExternalId ? { externalId: safeExternalId } : {}),
          candidate: projection.candidate,
          reasons: projection.reasons,
        },
      };
    } catch (error) {
      if (!(error instanceof IncompleteRecordError) || error.code !== 'invalid-input') throw error;
      return { errors };
    }
  }
  return {
    errors,
    candidate,
  };
}

function detectCsvSource(filename: string, headers: string[]): Exclude<ImportSource, 'auto'> {
  const name = filename.toLowerCase();
  const normalized = headers.map(normalizeHeader);
  if (name.includes('mailchimp') || normalized.includes('email marketing')) return 'mailchimp';
  if (name.includes('boldtrail') || name.includes('kvcore') || normalized.includes('lead id')) return 'boldtrail';
  if (name.includes('google') || normalized.some((header) => /^phone \d+ value$/.test(header))) return 'google';
  return 'spreadsheet';
}

function unescapeVcard(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function parseVcards(content: string): Record<string, string>[] {
  const unfolded = content.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];
  return blocks.map((block) => {
    const record: Record<string, string> = {};
    const phones: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const property = line.slice(0, separator).split(';', 1)[0]?.toUpperCase() ?? '';
      const raw = unescapeVcard(line.slice(separator + 1));
      if (property === 'N') {
        const [lastName = '', firstName = ''] = raw.split(';');
        record['First Name'] = firstName;
        record['Last Name'] = lastName;
      } else if (property === 'FN') record['Full Name'] = raw;
      else if (property === 'TEL') phones.push(raw);
      else if (property === 'EMAIL' && !record.Email) record.Email = raw;
      else if (property === 'ADR') {
        const parts = raw.split(';');
        record.Address = [parts[2], parts[1]].filter(Boolean).join(' ');
        record.City = parts[3] ?? '';
        record.State = parts[4] ?? '';
        record['Postal Code'] = parts[5] ?? '';
      } else if (property === 'BDAY') record.Birthday = raw;
      else if (property === 'NOTE') record.Notes = raw;
      else if (property === 'CATEGORIES') record.Tags = raw;
      else if (property === 'UID') record['External ID'] = raw;
    }
    if (phones[0]) record.Phone = phones[0];
    if (phones[1]) record['Secondary Phone'] = phones[1];
    return record;
  });
}

export function parseContactImport(input: {
  content: string;
  filename: string;
  source?: ImportSource;
  mapping?: Readonly<Record<string, CandidateField | 'ignore'>>;
  contentByteLimit?: number;
}): ParsedContactImport {
  const filename = clean(input.filename) ?? 'contacts.csv';
  const requestedSource = input.source ?? 'auto';
  const isVcard = /\.vcf$/i.test(filename) || /^BEGIN:VCARD/im.test(input.content);
  if (new TextEncoder().encode(input.content).byteLength > (input.contentByteLimit ?? MAX_IMPORT_BYTES)) {
    throw new ContactImportError(
      input.contentByteLimit === undefined
        ? 'The file is larger than the 2 MB safe import limit.'
        : 'The file is larger than the safe import limit.',
    );
  }
  let headers: string[];
  let records: Record<string, string>[];
  let sourceRecords: Record<string, string>[];
  if (isVcard) {
    records = parseVcards(input.content);
    sourceRecords = records;
    headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  } else {
    const rows = parseDelimited(input.content);
    validateTabularSecurityBounds(rows);
    if (rows.length < 2) throw new ContactImportError('The CSV must include a header and at least one contact row.');
    headers = (rows[0] ?? []).map((header) => header.replace(/^\uFEFF/, '').trim());
    if (!headers.some(Boolean)) throw new ContactImportError('The CSV header is empty.');
    const mappedHeaders = headers.map((header) => {
      const target=input.mapping?.[header];
      if (!target || target==='ignore') return target==='ignore'?`__ignored_${header}`:header;
      if (!CONTACT_IMPORT_MAPPING_TARGETS.includes(target)) throw new ContactImportError('Import mapping contains an unsupported target.');
      return FIELD_ALIASES[target][0] ?? target;
    });
    sourceRecords = rows.slice(1).map((row) => rowObject(headers, row));
    records = rows.slice(1).map((row) => rowObject(mappedHeaders, row));
  }

  if (records.length === 0) throw new ContactImportError('No contacts were found in the file.');

  const detectedSource = requestedSource === 'auto'
    ? isVcard ? 'apple' : detectCsvSource(filename, headers)
    : requestedSource;
  const firstClassExport = !isVcard && isKvCoreContactExport(filename, headers);
  const effectiveHeaders=headers.map((header)=>{const target=input.mapping?.[header];return target&&target!=='ignore'?(FIELD_ALIASES[target][0]??target):target==='ignore'?`__ignored_${header}`:header;});
  const recognizedFields = firstClassExport
    ? ['externalId','firstName','lastName','email','phone','secondaryPhone','intent','emailSubscribed','tags','mailingAddress','city','state','postalCode','source','birthdate']
    : Array.from(new Set(effectiveHeaders.map(fieldForHeader).filter((field): field is CandidateField => Boolean(field))));
  const preservedFields = firstClassExport ? headers.filter(Boolean) : [];
  const unknownFields = firstClassExport ? [] : headers.filter((header,index) => header && !fieldForHeader(effectiveHeaders[index]??header) && input.mapping?.[header]!=='ignore');
  const candidates: ContactImportCandidate[] = [];
  const rejected: ContactImportRejection[] = [];
  records.forEach((record, index) => {
    const result = candidateFromRecord(record, index + 2, firstClassExport, sourceRecords[index] ?? record);
    if (result.candidate) candidates.push(result.candidate);
    else rejected.push({
      rowNumber: index + 2,
      errors: result.errors,
      ...(result.incomplete ? { incomplete: result.incomplete } : {}),
    });
  });

  return {
    filename,
    format: isVcard ? 'vcard' : 'csv',
    requestedSource,
    detectedSource,
    provider: firstClassExport ? 'first-class-real-estate' : detectedSource,
    totalRows: records.length,
    headers,
    recognizedFields,
    unknownFields,
    preservedFields,
    candidates,
    rejected,
  };
}

export function parseJsonContactImport(input: {
  source: string;
  contacts: unknown[];
}): ParsedContactImport {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(input.source)) throw new ContactImportError('Source must be 1–64 letters, numbers, dashes, or underscores.');
  if (input.contacts.length === 0 || input.contacts.length > MAX_INTAKE_BATCH) {
    throw new ContactImportError(`Automatic intake accepts 1–${MAX_INTAKE_BATCH} contacts per request.`);
  }
  const records = input.contacts.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {};
    return Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, typeof value === 'string' ? value : value == null ? '' : String(value)]));
  });
  const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const candidates: ContactImportCandidate[] = [];
  const rejected: ContactImportRejection[] = [];
  records.forEach((record, index) => {
    const result = candidateFromRecord(record, index + 1);
    if (result.candidate) candidates.push(result.candidate);
    else rejected.push({
      rowNumber: index + 1,
      errors: result.errors,
      ...(result.incomplete ? { incomplete: result.incomplete } : {}),
    });
  });
  return {
    filename: `${input.source}.json`,
    format: 'json',
    requestedSource: 'platform',
    detectedSource: input.source === 'website' ? 'website' : 'platform',
    provider: input.source.toLowerCase(),
    totalRows: records.length,
    headers,
    recognizedFields: Array.from(new Set(headers.map(fieldForHeader).filter((field): field is CandidateField => Boolean(field)))),
    unknownFields: headers.filter((header) => header && !fieldForHeader(header)),
    preservedFields: [],
    candidates,
    rejected,
  };
}

export function normalizeEmailIdentity(email?: string): string | undefined {
  return clean(email)?.toLowerCase();
}

export function normalizePhoneIdentity(phone?: string): string | undefined {
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (!digits) return undefined;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}
