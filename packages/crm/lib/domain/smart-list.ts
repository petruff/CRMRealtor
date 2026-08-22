import {
  displayName,
  type Contact,
  type Intent,
  type LeadSource,
  type LeadType,
  type PipelineStage,
  type Relationship,
} from './contact.ts';

export const SMART_LIST_SCHEMA_VERSION = 'smart-list-filter.v1' as const;
export const SMART_LIST_NAME_MAX = 80;
export const SMART_LIST_QUERY_MAX = 200;
export const SMART_LIST_CRITERIA_MAX = 20;
export const SMART_LIST_RESULT_MAX = 500;

export const SMART_LIST_STATUSES = ['active', 'archived'] as const;
export type SmartListStatus = (typeof SMART_LIST_STATUSES)[number];

export const SMART_LIST_SORT_FIELDS = ['priority', 'name', 'nextTouchAt', 'createdAt'] as const;
export type SmartListSortField = (typeof SMART_LIST_SORT_FIELDS)[number];
export type SmartListSortDirection = 'asc' | 'desc';

export const SMART_LIST_ENUM_FIELDS = [
  'leadType',
  'relationship',
  'intent',
  'source',
  'pipelineStage',
] as const;
export type SmartListEnumField = (typeof SMART_LIST_ENUM_FIELDS)[number];

export const SMART_LIST_TEXT_FIELDS = [
  'city',
  'state',
  'postalCode',
  'buyer.timeline',
  'seller.timeline',
] as const;
export type SmartListTextField = (typeof SMART_LIST_TEXT_FIELDS)[number];

export const SMART_LIST_NUMBER_FIELDS = ['buyer.priceMin', 'buyer.priceMax'] as const;
export type SmartListNumberField = (typeof SMART_LIST_NUMBER_FIELDS)[number];

export type SmartListCriterion =
  | { readonly field: 'query'; readonly operator: 'contains' | 'eq'; readonly value: string }
  | {
      readonly field: SmartListEnumField;
      readonly operator: 'eq' | 'in';
      readonly value: string | readonly string[];
    }
  | {
      readonly field: SmartListTextField;
      readonly operator: 'contains' | 'eq';
      readonly value: string;
    }
  | {
      readonly field: SmartListNumberField;
      readonly operator: 'min' | 'max';
      readonly value: number;
    }
  | { readonly field: 'tags'; readonly operator: 'any' | 'all'; readonly value: readonly string[] }
  | {
      readonly field: 'nextTouchAt';
      readonly operator: 'before' | 'on' | 'after';
      readonly value: string;
    }
  | { readonly field: 'nextTouchAt'; readonly operator: 'empty' };

export interface SmartListDefinitionV1 {
  readonly schemaVersion: typeof SMART_LIST_SCHEMA_VERSION;
  readonly criteria: readonly SmartListCriterion[];
  readonly sort?: Readonly<{
    field: SmartListSortField;
    direction: SmartListSortDirection;
  }>;
}

export interface SmartList {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly definition: SmartListDefinitionV1;
  readonly status: SmartListStatus;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
  readonly archiveReason?: string;
}

export type SmartListFieldErrors = Readonly<Record<string, string>>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class SmartListValidationError extends Error {
  readonly code: 'invalid-input' | 'conflict';
  readonly fieldErrors: SmartListFieldErrors;

  constructor(
    message: string,
    fieldErrors: SmartListFieldErrors = {},
    code: 'invalid-input' | 'conflict' = 'invalid-input',
  ) {
    super(message);
    this.name = 'SmartListValidationError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const ENUM_VALUES: Record<SmartListEnumField, readonly string[]> = {
  leadType: ['hot', 'warm', 'nurture'] satisfies readonly LeadType[],
  relationship: ['lead', 'active-client', 'past-client', 'sphere'] satisfies readonly Relationship[],
  intent: ['buyer', 'seller', 'both', 'investor', 'renter', 'unknown'] satisfies readonly Intent[],
  source: [
    'cold-call',
    'open-house',
    'referral',
    'social-media',
    'website',
    'mailer',
    'other',
  ] satisfies readonly LeadSource[],
  pipelineStage: [
    'new',
    'contacted',
    'appointment-set',
    'active',
    'under-contract',
    'closed',
    'lost',
  ] satisfies readonly PipelineStage[],
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function printableText(value: unknown, path: string, max = SMART_LIST_QUERY_MAX): string {
  if (typeof value !== 'string') {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      [path]: 'Enter text.',
    });
  }
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new SmartListValidationError(`Use 1–${max} printable characters.`, {
      [path]: `Use 1–${max} printable characters.`,
    });
  }
  return clean;
}

export function parseSmartListName(value: unknown): string {
  return printableText(value, 'name', SMART_LIST_NAME_MAX);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      [path]: 'Choose at least one value.',
    });
  }
  const result = Array.from(new Set(value.map((item, index) => printableText(item, `${path}.${index}`, 80))));
  if (result.length > 50) {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      [path]: 'Choose 50 values or fewer.',
    });
  }
  return result;
}

function validDateOnly(value: unknown, path: string): string {
  const clean = printableText(value, path, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      [path]: 'Use a valid date in YYYY-MM-DD format.',
    });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      [path]: 'Use a valid date in YYYY-MM-DD format.',
    });
  }
  return clean;
}

function parseCriterion(value: unknown, index: number): SmartListCriterion {
  const input = record(value);
  const path = `criteria.${index}`;
  if (!input || typeof input.field !== 'string' || typeof input.operator !== 'string') {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      [path]: 'Choose an allowlisted field and operator.',
    });
  }
  const field = input.field;
  const operator = input.operator;

  if (field === 'query') {
    if (operator !== 'contains' && operator !== 'eq') {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.operator`]: 'Query supports contains or eq.',
      });
    }
    return { field, operator, value: printableText(input.value, `${path}.value`) };
  }

  if (SMART_LIST_ENUM_FIELDS.includes(field as SmartListEnumField)) {
    if (operator !== 'eq' && operator !== 'in') {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.operator`]: 'Enum fields support eq or in.',
      });
    }
    const allowed = ENUM_VALUES[field as SmartListEnumField];
    const values = operator === 'in'
      ? stringArray(input.value, `${path}.value`)
      : [printableText(input.value, `${path}.value`, 40)];
    if (values.some((item) => !allowed.includes(item))) {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.value`]: `Choose only: ${allowed.join(', ')}.`,
      });
    }
    return operator === 'in'
      ? { field: field as SmartListEnumField, operator, value: values }
      : { field: field as SmartListEnumField, operator, value: values[0] ?? '' };
  }

  if (SMART_LIST_TEXT_FIELDS.includes(field as SmartListTextField)) {
    if (operator !== 'contains' && operator !== 'eq') {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.operator`]: 'Text fields support contains or eq.',
      });
    }
    return {
      field: field as SmartListTextField,
      operator,
      value: printableText(input.value, `${path}.value`),
    };
  }

  if (SMART_LIST_NUMBER_FIELDS.includes(field as SmartListNumberField)) {
    if (operator !== 'min' && operator !== 'max') {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.operator`]: 'Number fields support min or max.',
      });
    }
    if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0) {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.value`]: 'Enter zero or a positive finite number.',
      });
    }
    return { field: field as SmartListNumberField, operator, value: input.value };
  }

  if (field === 'tags') {
    if (operator !== 'any' && operator !== 'all') {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.operator`]: 'Tags support any or all.',
      });
    }
    return { field, operator, value: stringArray(input.value, `${path}.value`) };
  }

  if (field === 'nextTouchAt') {
    if (operator === 'empty') {
      if (input.value !== undefined) {
        throw new SmartListValidationError('Smart List definition is invalid.', {
          [`${path}.value`]: 'The empty operator does not accept a value.',
        });
      }
      return { field, operator };
    }
    if (operator !== 'before' && operator !== 'on' && operator !== 'after') {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        [`${path}.operator`]: 'Dates support before, on, after, or empty.',
      });
    }
    return { field, operator, value: validDateOnly(input.value, `${path}.value`) };
  }

  throw new SmartListValidationError('Unknown Smart List field.', {
    [`${path}.field`]: 'Unknown Smart List field.',
  });
}

export function parseSmartListDefinition(value: unknown): SmartListDefinitionV1 {
  const input = record(value);
  if (!input) {
    throw new SmartListValidationError('Smart List definition must be an object.', {
      definition: 'Enter a versioned Smart List definition.',
    });
  }
  if (input.schemaVersion !== SMART_LIST_SCHEMA_VERSION) {
    throw new SmartListValidationError(`Only ${SMART_LIST_SCHEMA_VERSION} is supported.`, {
      schemaVersion: `Only ${SMART_LIST_SCHEMA_VERSION} is supported.`,
    });
  }
  if (!Array.isArray(input.criteria)) {
    throw new SmartListValidationError('Smart List definition is invalid.', {
      criteria: 'Criteria must be an array.',
    });
  }
  if (input.criteria.length > SMART_LIST_CRITERIA_MAX) {
    throw new SmartListValidationError(`Use ${SMART_LIST_CRITERIA_MAX} criteria or fewer.`, {
      criteria: `Use ${SMART_LIST_CRITERIA_MAX} criteria or fewer.`,
    });
  }
  const criteria = input.criteria.map(parseCriterion);
  let sort: SmartListDefinitionV1['sort'];
  if (input.sort !== undefined) {
    const candidate = record(input.sort);
    if (
      !candidate
      || !SMART_LIST_SORT_FIELDS.includes(candidate.field as SmartListSortField)
      || (candidate.direction !== 'asc' && candidate.direction !== 'desc')
    ) {
      throw new SmartListValidationError('Smart List definition is invalid.', {
        sort: 'Choose an allowlisted sort field and direction.',
      });
    }
    sort = {
      field: candidate.field as SmartListSortField,
      direction: candidate.direction,
    };
  }
  return { schemaVersion: SMART_LIST_SCHEMA_VERSION, criteria, ...(sort ? { sort } : {}) };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9@.+_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function searchableValues(contact: Contact): string[] {
  return [
    displayName(contact),
    contact.firstName,
    contact.lastName,
    contact.preferredName,
    contact.phone,
    contact.secondaryPhone,
    contact.email,
    contact.city,
    contact.postalCode,
    ...contact.tags,
  ].filter((item): item is string => Boolean(item));
}

function textField(contact: Contact, field: SmartListTextField): string | undefined {
  if (field === 'buyer.timeline') return contact.buyer?.timeline;
  if (field === 'seller.timeline') return contact.seller?.timeline;
  return contact[field];
}

function numberField(contact: Contact, field: SmartListNumberField): number | undefined {
  return field === 'buyer.priceMin' ? contact.buyer?.priceMin : contact.buyer?.priceMax;
}

function enumField(contact: Contact, field: SmartListEnumField): string {
  return contact[field];
}

function matchesCriterion(contact: Contact, criterion: SmartListCriterion): boolean {
  if (criterion.field === 'query') {
    const needle = normalizeText(criterion.value);
    const values = searchableValues(contact);
    if (criterion.operator === 'eq') return values.some((item) => normalizeText(item) === needle);
    const haystack = normalizeText(values.join(' '));
    const digits = values.join(' ').replace(/\D/g, '');
    return needle.split(' ').every((term) => (
      /^\d{3,}$/.test(term) ? digits.includes(term) : haystack.includes(term)
    ));
  }
  if (SMART_LIST_ENUM_FIELDS.includes(criterion.field as SmartListEnumField)) {
    const enumCriterion = criterion as Extract<SmartListCriterion, { field: SmartListEnumField }>;
    const current = enumField(contact, enumCriterion.field);
    return enumCriterion.operator === 'eq'
      ? current === enumCriterion.value
      : (enumCriterion.value as readonly string[]).includes(current);
  }
  if (SMART_LIST_TEXT_FIELDS.includes(criterion.field as SmartListTextField)) {
    const textCriterion = criterion as Extract<SmartListCriterion, { field: SmartListTextField }>;
    const current = normalizeText(textField(contact, textCriterion.field) ?? '');
    const expected = normalizeText(textCriterion.value);
    return textCriterion.operator === 'eq' ? current === expected : current.includes(expected);
  }
  if (SMART_LIST_NUMBER_FIELDS.includes(criterion.field as SmartListNumberField)) {
    const numberCriterion = criterion as Extract<SmartListCriterion, { field: SmartListNumberField }>;
    const current = numberField(contact, numberCriterion.field);
    if (current === undefined) return false;
    return numberCriterion.operator === 'min'
      ? current >= numberCriterion.value
      : current <= numberCriterion.value;
  }
  if (criterion.field === 'tags') {
    const tags = new Set(contact.tags.map(normalizeText));
    const wanted = criterion.value.map(normalizeText);
    return criterion.operator === 'all'
      ? wanted.every((tag) => tags.has(tag))
      : wanted.some((tag) => tags.has(tag));
  }
  const current = contact.nextTouchAt?.slice(0, 10);
  if (criterion.operator === 'empty') return !current;
  if (!current) return false;
  if (criterion.operator === 'on') return current === criterion.value;
  return criterion.operator === 'before' ? current < criterion.value : current > criterion.value;
}

const PRIORITY_RANK: Record<LeadType, number> = { hot: 0, warm: 1, nurture: 2 };

function optionalCompare(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left.localeCompare(right);
}

function compareContacts(
  left: Contact,
  right: Contact,
  sort: NonNullable<SmartListDefinitionV1['sort']>,
): number {
  let result = 0;
  if (sort.field === 'priority') result = PRIORITY_RANK[left.leadType] - PRIORITY_RANK[right.leadType];
  else if (sort.field === 'name') result = normalizeText(displayName(left)).localeCompare(normalizeText(displayName(right)));
  else if (sort.field === 'nextTouchAt') {
    if (!left.nextTouchAt || !right.nextTouchAt) result = optionalCompare(left.nextTouchAt, right.nextTouchAt);
    else result = left.nextTouchAt.localeCompare(right.nextTouchAt) * (sort.direction === 'desc' ? -1 : 1);
  }
  else result = left.createdAt.localeCompare(right.createdAt);
  if (sort.direction === 'desc' && sort.field !== 'nextTouchAt') result *= -1;
  return result || left.id.localeCompare(right.id);
}

/** Validates again at execution time, evaluates all criteria, and returns at most 500 contacts. */
export function applySmartListDefinition(
  contacts: readonly Contact[],
  untrustedDefinition: unknown,
): Contact[] {
  const definition = parseSmartListDefinition(untrustedDefinition);
  const sort = definition.sort ?? { field: 'priority', direction: 'asc' };
  return contacts
    .filter((contact) => definition.criteria.every((criterion) => matchesCriterion(contact, criterion)))
    .sort((left, right) => compareContacts(left, right, sort))
    .slice(0, SMART_LIST_RESULT_MAX);
}

export function archiveSmartList(
  list: SmartList,
  actorMembershipId: string,
  archivedAt: string,
  reason?: string,
): { list: SmartList; noOp: boolean } {
  if (list.status === 'archived') return { list, noOp: true };
  return {
    noOp: false,
    list: {
      ...list,
      status: 'archived',
      updatedAt: archivedAt,
      archivedAt,
      archivedByMembershipId: actorMembershipId,
      ...(reason ? { archiveReason: reason } : {}),
    },
  };
}

export function restoreSmartList(
  list: SmartList,
  restoredAt: string,
): { list: SmartList; noOp: boolean } {
  if (list.status === 'active') return { list, noOp: true };
  const restored: Mutable<SmartList> = { ...list, status: 'active', updatedAt: restoredAt };
  delete restored.archivedAt;
  delete restored.archivedByMembershipId;
  delete restored.archiveReason;
  return { list: restored, noOp: false };
}
