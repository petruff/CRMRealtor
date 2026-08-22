const ENTITY_LABELS = {
  contact: 'Contact record',
  task: 'Task',
  activity: 'Activity',
  mailer: 'Mailer campaign',
  'mailer-send': 'Mailer delivery',
  connector: 'Connected service',
} as const;

const ENTITY_LINK_LABELS = {
  contact: 'Open contact',
  task: 'Open task',
  activity: 'Open activity',
  mailer: 'Open mailer',
  'mailer-send': 'Open mailing details',
  connector: 'Open connection',
} as const;

const FACT_LABELS: Record<string, string> = {
  birthdate: 'birthday',
  city: 'city',
  connectedAt: 'connection date',
  contactId: 'contact',
  createdAt: 'date added',
  dueAt: 'due date',
  email: 'email address',
  firstName: 'first name',
  grantedScopes: 'connection permissions',
  homePurchaseDate: 'home purchase anniversary',
  id: 'record details',
  lastContactedAt: 'last contact',
  lastName: 'last name',
  leadType: 'lead temperature',
  mailerId: 'mailer campaign',
  mailingAddress: 'mailing address',
  name: 'name',
  nextTouchAt: 'next follow-up',
  occurredAt: 'activity date',
  phone: 'phone number',
  pipelineStage: 'pipeline stage',
  postalCode: 'ZIP code',
  preferredName: 'preferred name',
  provider: 'service provider',
  relationship: 'relationship type',
  secondaryPhone: 'alternate phone number',
  sentOn: 'date sent',
  source: 'lead source',
  state: 'state',
  status: 'status',
  tags: 'tags',
  title: 'title',
  tokenExpiresAt: 'connection renewal date',
  type: 'activity type',
  updatedAt: 'last update',
};

const ALERT_CATEGORY_LABELS: Record<string, string> = {
  'follow-up': 'Follow-up',
  celebration: 'Relationship moment',
  pipeline: 'Pipeline',
  mailer: 'Mailer',
  task: 'Task',
};

function sentenceCase(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
  return words || 'stored CRM detail';
}

function naturalList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

export function evidenceEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType as keyof typeof ENTITY_LABELS] ?? sentenceCase(entityType);
}

export function evidenceEntityLinkLabel(entityType: string): string {
  return ENTITY_LINK_LABELS[entityType as keyof typeof ENTITY_LINK_LABELS] ?? 'Open source';
}

export function evidenceFactLabel(factKey: string): string {
  return FACT_LABELS[factKey] ?? sentenceCase(factKey);
}

export function evidenceFactSummary(factKeys: readonly string[]): string {
  const labels = factKeys
    .map(evidenceFactLabel)
    .filter((label, index, all) => all.indexOf(label) === index);
  return naturalList(labels);
}

export function evidenceTimestamp(
  value: string | undefined,
  timeZone?: string,
): string | undefined {
  if (!value) return undefined;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return undefined;
  try {
    return instant.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return undefined;
  }
}

export function alertCategoryLabel(category: string): string {
  return ALERT_CATEGORY_LABELS[category] ?? sentenceCase(category);
}
