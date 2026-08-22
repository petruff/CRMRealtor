export const CRM_SEARCH_SCHEMA_VERSION = 'crm-search.v1' as const;
export const CRM_SEARCH_QUERY_MAX = 120;
export const CRM_SEARCH_RESULT_MAX = 50;

export const CRM_SEARCH_ENTITY_TYPES = [
  'contact', 'task', 'incomplete-record', 'smart-list', 'mailer', 'workspace-member',
] as const;
export type CrmSearchEntityType = (typeof CRM_SEARCH_ENTITY_TYPES)[number];

export interface CrmSearchResult {
  readonly entityType: CrmSearchEntityType;
  readonly recordId: string;
  readonly label: string;
  readonly detail: string;
  readonly href: string;
  readonly rank: number;
}

export interface CrmSearchResponse {
  readonly schemaVersion: typeof CRM_SEARCH_SCHEMA_VERSION;
  readonly query: string;
  readonly count: number;
  readonly results: readonly CrmSearchResult[];
}

export const CRM_COMMANDS = [
  { id: 'add-contact', label: 'Add contact', href: '/contacts/new' },
  { id: 'add-task', label: 'Add task', href: '/activities?create=task' },
  { id: 'import-contacts', label: 'Import contacts', href: '/contacts/import' },
  { id: 'create-smart-list', label: 'Create Smart List', href: '/contacts?smartList=create' },
  { id: 'open-pipeline', label: 'Open pipeline', href: '/pipeline' },
  { id: 'open-work-queue', label: 'Open work queue', href: '/activities' },
] as const;
export type CrmCommandId = (typeof CRM_COMMANDS)[number]['id'];

export function parseCrmSearchQuery(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Search query is required.');
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > CRM_SEARCH_QUERY_MAX || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new Error(`Search query must use 1–${CRM_SEARCH_QUERY_MAX} printable characters.`);
  }
  return clean;
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9@.+_-]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function rankSearchCandidate(query: string, label: string, fields: readonly string[], id: string): number {
  const needle = normalizeSearchText(query);
  const normalizedLabel = normalizeSearchText(label);
  if (normalizeSearchText(id) === needle) return 100;
  if (normalizedLabel === needle) return 95;
  if (normalizedLabel.startsWith(needle)) return 85;
  if (normalizedLabel.includes(needle)) return 75;
  if (fields.some((field) => normalizeSearchText(field) === needle)) return 65;
  if (fields.some((field) => normalizeSearchText(field).startsWith(needle))) return 55;
  if (fields.some((field) => normalizeSearchText(field).includes(needle))) return 45;
  return 0;
}

export function resolveCrmCommand(value: unknown) {
  if (typeof value !== 'string') throw new Error('Command is required.');
  const command = CRM_COMMANDS.find((item) => item.id === value);
  if (!command) throw new Error('Command is not allowlisted.');
  return command;
}
