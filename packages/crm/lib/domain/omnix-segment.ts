import type { Contact, Intent, LeadSource, LeadType, PipelineStage, Relationship } from './contact.ts';

/**
 * Safe, read-only contact segments for the Omnix assistant ("hot buyers I
 * haven't talked to in a week", "birthdays this month"). A segment is a closed
 * set of typed filters: never SQL, never free-form code, never a write.
 */
export interface OmnixSegmentFilter {
  readonly leadType?: LeadType;
  readonly relationship?: Relationship;
  readonly intent?: Exclude<Intent, 'unknown' | 'both'>;
  readonly stage?: PipelineStage;
  readonly source?: LeadSource;
  readonly city?: string;
  /** Last real conversation at least this many days ago (or never). */
  readonly noContactDays?: number;
  readonly neverContacted?: boolean;
  readonly newWithinDays?: number;
  readonly birthdayWithinDays?: number;
  readonly anniversaryWithinDays?: number;
  readonly followUpDue?: boolean;
  readonly preApproved?: boolean;
  /** The question asked "how many" — lead with the number. */
  readonly count?: boolean;
}

const LEAD_TYPES: readonly LeadType[] = ['hot', 'warm', 'nurture'];
const RELATIONSHIPS: readonly Relationship[] = ['lead', 'active-client', 'past-client', 'sphere'];
const INTENTS: readonly NonNullable<OmnixSegmentFilter['intent']>[] = ['buyer', 'seller', 'investor', 'renter'];
const STAGES: readonly PipelineStage[] = ['new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost'];
const SOURCES: readonly LeadSource[] = ['cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other'];
const NUMBER_KEYS = ['noContactDays', 'newWithinDays', 'birthdayWithinDays', 'anniversaryWithinDays'] as const;
const FLAG_KEYS = ['neverContacted', 'followUpDue', 'preApproved', 'count'] as const;
const KEY_ORDER = ['leadType', 'relationship', 'intent', 'stage', 'source', 'city', ...NUMBER_KEYS, ...FLAG_KEYS] as const;
const NUMBER_LIMITS: Record<(typeof NUMBER_KEYS)[number], readonly [number, number]> = {
  noContactDays: [1, 730], newWithinDays: [1, 365], birthdayWithinDays: [0, 90], anniversaryWithinDays: [0, 90],
};

export class OmnixSegmentError extends Error {}

/** Canonical form used by the parser, the AI router and the tests: `segment key=value; key=value`. */
export function segmentQuery(filter: OmnixSegmentFilter): string {
  const parts: string[] = [];
  for (const key of KEY_ORDER) {
    const value = filter[key];
    if (value === undefined || value === false) continue;
    parts.push(value === true ? `${key}=yes` : `${key}=${value}`);
  }
  return parts.length ? `segment ${parts.join('; ')}` : 'segment all';
}

function oneOf<T extends string>(value: string, allowed: readonly T[], key: string): T {
  if (!allowed.includes(value as T)) throw new OmnixSegmentError(`Unsupported ${key}.`);
  return value as T;
}

/** Strict parser for the canonical form. Unknown keys or values are rejected, never ignored. */
export function parseSegmentQuery(query: string): OmnixSegmentFilter | undefined {
  const match = /^segment (.+)$/iu.exec(query.trim());
  if (!match?.[1]) return undefined;
  if (match[1].trim().toLowerCase() === 'all') return {};
  const filter: Record<string, string | number | boolean> = {};
  for (const raw of match[1].split(';')) {
    const pair = /^\s*([a-zA-Z]+)\s*=\s*(.+?)\s*$/u.exec(raw);
    if (!pair?.[1] || !pair[2]) throw new OmnixSegmentError('Segment filters must look like key=value.');
    const [, key, value] = pair;
    if (key in filter) throw new OmnixSegmentError(`Repeated ${key}.`);
    if (key === 'leadType') filter[key] = oneOf(value.toLowerCase(), LEAD_TYPES, key);
    else if (key === 'relationship') filter[key] = oneOf(value.toLowerCase(), RELATIONSHIPS, key);
    else if (key === 'intent') filter[key] = oneOf(value.toLowerCase(), INTENTS, key);
    else if (key === 'stage') filter[key] = oneOf(value.toLowerCase(), STAGES, key);
    else if (key === 'source') filter[key] = oneOf(value.toLowerCase(), SOURCES, key);
    else if (key === 'city') {
      if (!/^[\p{L}][\p{L} .'-]{0,59}$/u.test(value)) throw new OmnixSegmentError('Unsupported city.');
      filter[key] = value;
    } else if ((NUMBER_KEYS as readonly string[]).includes(key)) {
      const [min, max] = NUMBER_LIMITS[key as (typeof NUMBER_KEYS)[number]];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new OmnixSegmentError(`Unsupported ${key}.`);
      filter[key] = parsed;
    } else if ((FLAG_KEYS as readonly string[]).includes(key)) {
      if (value.toLowerCase() !== 'yes') throw new OmnixSegmentError(`Unsupported ${key}.`);
      filter[key] = true;
    } else {
      throw new OmnixSegmentError(`Unsupported filter ${key}.`);
    }
  }
  return filter as OmnixSegmentFilter;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/** Days from `today` until the next month/day of `isoDate` (0 = today). */
export function daysUntilAnnual(isoDate: string | undefined, today: string): number | undefined {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/u.test(isoDate)) return undefined;
  const year = Number(today.slice(0, 4));
  const monthDay = isoDate.slice(5, 10);
  for (const candidateYear of [year, year + 1]) {
    // Feb 29 falls back to Mar 1 in non-leap years.
    let candidate = `${candidateYear}-${monthDay}`;
    if (Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) || new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) !== candidate) {
      candidate = `${candidateYear}-03-01`;
    }
    const diff = dayNumber(candidate) - dayNumber(today);
    if (diff >= 0) return diff;
  }
  return undefined;
}

export function daysSince(isoInstant: string | undefined, today: string): number | undefined {
  if (!isoInstant || Number.isNaN(Date.parse(isoInstant))) return undefined;
  return Math.max(0, dayNumber(today) - dayNumber(new Date(isoInstant).toISOString()));
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().trim();
}

export interface OmnixSegmentMatch {
  readonly contact: Contact;
  /** Short, factual reasons shown next to the name. */
  readonly reasons: readonly string[];
  readonly sortKey: number;
}

const HEAT_RANK: Record<LeadType, number> = { hot: 0, warm: 1, nurture: 2 };

export function applySegment(contacts: readonly Contact[], filter: OmnixSegmentFilter, today: string): OmnixSegmentMatch[] {
  const city = filter.city ? fold(filter.city) : undefined;
  const matches: OmnixSegmentMatch[] = [];
  for (const contact of contacts) {
    if (contact.archivedAt) continue;
    if (filter.leadType && contact.leadType !== filter.leadType) continue;
    if (filter.relationship && contact.relationship !== filter.relationship) continue;
    if (filter.intent && contact.intent !== filter.intent && !(contact.intent === 'both' && (filter.intent === 'buyer' || filter.intent === 'seller'))) continue;
    if (filter.stage && contact.pipelineStage !== filter.stage) continue;
    if (filter.source && contact.source !== filter.source) continue;
    if (city) {
      const places = [contact.city, ...(contact.buyer?.areas ?? [])].filter((place): place is string => Boolean(place)).map(fold);
      if (!places.some((place) => place.includes(city))) continue;
    }
    if (filter.preApproved && contact.buyer?.preApproved !== true) continue;
    const reasons: string[] = [];
    let sortKey = HEAT_RANK[contact.leadType] * 100_000;
    const since = daysSince(contact.lastContactedAt, today);
    if (filter.neverContacted) {
      if (contact.lastContactedAt) continue;
      reasons.push('Never contacted');
    }
    if (filter.noContactDays !== undefined) {
      if (since !== undefined && since < filter.noContactDays) continue;
      reasons.push(since === undefined ? 'Never contacted' : `Last talked ${since} days ago`);
      sortKey = -(since ?? 100_000);
    }
    if (filter.newWithinDays !== undefined) {
      const age = daysSince(contact.createdAt, today);
      if (age === undefined || age > filter.newWithinDays) continue;
      reasons.push(age === 0 ? 'Added today' : `Added ${age} day${age === 1 ? '' : 's'} ago`);
      sortKey = age;
    }
    if (filter.birthdayWithinDays !== undefined) {
      const days = daysUntilAnnual(contact.birthdate, today);
      if (days === undefined || days > filter.birthdayWithinDays) continue;
      reasons.push(days === 0 ? 'Birthday today' : `Birthday in ${days} day${days === 1 ? '' : 's'}`);
      sortKey = days;
    }
    if (filter.anniversaryWithinDays !== undefined) {
      const days = daysUntilAnnual(contact.homePurchaseDate, today);
      if (days === undefined || days > filter.anniversaryWithinDays) continue;
      reasons.push(days === 0 ? 'Home anniversary today' : `Home anniversary in ${days} day${days === 1 ? '' : 's'}`);
      sortKey = days;
    }
    if (filter.followUpDue) {
      if (!contact.nextTouchAt || dayNumber(contact.nextTouchAt) > dayNumber(today)) continue;
      const late = dayNumber(today) - dayNumber(contact.nextTouchAt);
      reasons.push(late === 0 ? 'Follow-up due today' : `Follow-up ${late} day${late === 1 ? '' : 's'} overdue`);
      sortKey = -late;
    }
    if (!reasons.length) {
      reasons.push(since === undefined ? 'Never contacted' : `Last talked ${since} days ago`);
      sortKey += since === undefined ? 0 : 1_000 - Math.min(since, 999);
    }
    matches.push({ contact, reasons, sortKey });
  }
  return matches.sort((a, b) => a.sortKey - b.sortKey || a.contact.lastName.localeCompare(b.contact.lastName));
}

// ---------------------------------------------------------------------------
// Plain-language description
// ---------------------------------------------------------------------------

const RELATIONSHIP_NOUN: Record<Relationship, string> = { lead: 'leads', 'active-client': 'active clients', 'past-client': 'past clients', sphere: 'sphere contacts' };
const INTENT_NOUN: Record<NonNullable<OmnixSegmentFilter['intent']>, string> = { buyer: 'buyers', seller: 'sellers', investor: 'investors', renter: 'renters' };
const STAGE_PHRASE: Record<PipelineStage, string> = {
  new: 'not contacted yet (New stage)', contacted: 'in the Contacted stage', 'appointment-set': 'with an appointment set',
  active: 'in the Active stage', 'under-contract': 'under contract', closed: 'closed', lost: 'marked lost',
};
const SOURCE_PHRASE: Record<LeadSource, string> = {
  'cold-call': 'from cold calls', 'open-house': 'from open houses', referral: 'from referrals', 'social-media': 'from social media',
  website: 'from your website', mailer: 'from mailers', other: 'from other sources',
};

function windowPhrase(days: number): string {
  if (days === 0) return 'today';
  if (days === 7) return 'in the next 7 days';
  if (days === 30 || days === 31) return 'in the next 30 days';
  return `in the next ${days} days`;
}

export function describeSegment(filter: OmnixSegmentFilter): string {
  const adjectives = [filter.leadType ? filter.leadType : undefined, filter.preApproved ? 'pre-approved' : undefined].filter(Boolean);
  const noun = filter.intent ? INTENT_NOUN[filter.intent]
    : filter.relationship ? RELATIONSHIP_NOUN[filter.relationship]
      : filter.birthdayWithinDays !== undefined || filter.anniversaryWithinDays !== undefined ? 'people' : 'contacts';
  const relationshipTail = filter.intent && filter.relationship && filter.relationship !== 'lead' ? ` (${RELATIONSHIP_NOUN[filter.relationship]})` : '';
  const clauses = [
    filter.stage ? STAGE_PHRASE[filter.stage] : undefined,
    filter.source ? SOURCE_PHRASE[filter.source] : undefined,
    filter.city ? `in ${filter.city}` : undefined,
    filter.neverContacted ? 'never contacted' : undefined,
    filter.noContactDays !== undefined ? `not contacted in ${filter.noContactDays}+ days` : undefined,
    filter.newWithinDays !== undefined ? (filter.newWithinDays <= 1 ? 'added today' : `added in the last ${filter.newWithinDays} days`) : undefined,
    filter.birthdayWithinDays !== undefined ? `with a birthday ${windowPhrase(filter.birthdayWithinDays)}` : undefined,
    filter.anniversaryWithinDays !== undefined ? `with a home anniversary ${windowPhrase(filter.anniversaryWithinDays)}` : undefined,
    filter.followUpDue ? 'with a follow-up due' : undefined,
  ].filter(Boolean);
  return [[...adjectives, noun].join(' ') + relationshipTail, ...clauses].join(' ');
}

// ---------------------------------------------------------------------------
// Natural language (English, Spanish, Portuguese)
// ---------------------------------------------------------------------------

const LIST_TRIGGER = /^(?:who|which|show|list|find|give me|get me|pull up|any|are there|do i have|what|how many|quem|quais|qual|mostre|mostrar|mostra|liste|listar|me mostre|tenho|existe|existem|quantos|quantas|quien|quienes|cuales|cual|muestra|muestrame|mostrar|lista|hay|tengo|cuantos|cuantas|my|meus|minhas|mis)\b/u;
const COUNT_TRIGGER = /^(?:how many|quantos|quantas|cuantos|cuantas)\b/u;
const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, un: 1, una: 1, dos: 2, cuatro: 4,
};

function amount(raw: string | undefined): number | undefined {
  if (!raw) return 1;
  return /^\d+$/u.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
}

function unitDays(unit: string): number {
  if (/^(?:week|weeks|semana|semanas)$/u.test(unit)) return 7;
  if (/^(?:month|months|mes|meses)$/u.test(unit)) return 30;
  if (/^(?:year|years|ano|anos|ano|anos)$/u.test(unit)) return 365;
  return 1;
}

const DURATION = /(\d+|a|an|one|two|three|four|five|six|um|uma|dois|duas|tres|quatro|cinco|seis|un|una|dos|cuatro)?\s*(days?|weeks?|months?|years?|dias?|semanas?|mes|meses|anos?)\b/u;

function windowDays(folded: string, fallback: number): number {
  if (/\b(?:today|hoje|hoy)\b/u.test(folded)) return 0;
  if (/\b(?:this week|next week|next 7 days|esta semana|essa semana|proxima semana|la proxima semana|proximos 7 dias)\b/u.test(folded)) return 7;
  if (/\b(?:this month|next month|next 30 days|este mes|esse mes|proximo mes|el proximo mes|proximos 30 dias)\b/u.test(folded)) return 30;
  const explicit = /\b(?:next|in the next|within|nos proximos|nos pr[oó]ximos|en los proximos|dentro de)\s+(\d+)\s*(days?|dias?|weeks?|semanas?)\b/u.exec(folded);
  if (explicit?.[1] && explicit[2]) return Math.min(90, Number(explicit[1]) * unitDays(explicit[2]));
  return fallback;
}

/**
 * Deterministic understanding of common list questions. Returns undefined when
 * the wording is not clearly a list/count question so other intents (or the AI
 * router) can take it.
 */
export function interpretSegmentQuestion(question: string): OmnixSegmentFilter | undefined {
  const folded = fold(question).replace(/[?!.,¿¡'’]/gu, ' ').replace(/\s+/gu, ' ').trim();
  // Requests to act (draft, create, log…) are not list questions.
  if (/^(?:draft|write|text|send|create|add|log|remind|schedule|call|email|escreva|envie|crie|adicione|registre|lembre|agende|ligue|escribe|envia|crea|agrega|registra|recuerdame|agenda|llama)\b/u.test(folded)) return undefined;
  const listLike = LIST_TRIGGER.test(folded);
  const filter: { -readonly [K in keyof OmnixSegmentFilter]: OmnixSegmentFilter[K] } = {};
  let population = false;

  if (COUNT_TRIGGER.test(folded)) filter.count = true;
  if (/\b(?:hot|quentes?|calientes?)\b/u.test(folded)) filter.leadType = 'hot';
  else if (/\b(?:warm|mornos?|mornas?|tibios?|tibias?)\b/u.test(folded)) filter.leadType = 'warm';
  else if (/\b(?:nurture|cold|frios?|frias?)\b/u.test(folded) && !/\bgone cold\b|\bwent cold\b|\besfri/u.test(folded)) filter.leadType = 'nurture';

  if (/\b(?:past clients?|former clients?|ex[- ]clientes?|antigos clientes|clientes antigos|clientes anteriores|clientes pasados)\b/u.test(folded)) { filter.relationship = 'past-client'; population = true; }
  else if (/\b(?:active clients?|current clients?|clientes ativos|clientes activos|clients?|clientes?)\b/u.test(folded)) { filter.relationship = 'active-client'; population = true; }
  else if (/\b(?:sphere|esfera)\b/u.test(folded)) { filter.relationship = 'sphere'; population = true; }
  else if (/\b(?:leads?|prospects?|prospectos?)\b/u.test(folded)) { filter.relationship = 'lead'; population = true; }

  if (/\b(?:buyers?|compradore?s?|compradoras?)\b/u.test(folded)) { filter.intent = 'buyer'; population = true; }
  else if (/\b(?:sellers?|vendedore?s?|vendedoras?|listings?)\b/u.test(folded)) { filter.intent = 'seller'; population = true; }
  else if (/\b(?:investors?|investidore?s?|inversionistas?|inversores?)\b/u.test(folded)) { filter.intent = 'investor'; population = true; }
  else if (/\b(?:renters?|tenants?|inquilinos?|locatarios?)\b/u.test(folded)) { filter.intent = 'renter'; population = true; }
  if (filter.intent && filter.relationship === 'active-client' && !/\bclients?\b|\bclientes?\b/u.test(folded.replace(/\b(?:buyers?|sellers?)\b/gu, ''))) delete filter.relationship;

  if (/\b(?:contacts?|people|contatos?|pessoas|contactos?|personas)\b/u.test(folded)) population = true;

  if (/\b(?:under contract|in escrow|pending deals?|sob contrato|em contrato|bajo contrato)\b/u.test(folded)) filter.stage = 'under-contract';
  else if (/\b(?:appointments? set|with appointments?|agendados?|com visita marcada|con cita)\b/u.test(folded)) filter.stage = 'appointment-set';
  else if (/\b(?:closed|fechados?|cerrados?)\b/u.test(folded) && !/\bclos(?:e|ing)\b/u.test(folded)) filter.stage = 'closed';
  else if (/\b(?:lost|perdidos?)\b/u.test(folded)) filter.stage = 'lost';

  if (/\bopen houses?\b/u.test(folded)) filter.source = 'open-house';
  else if (/\b(?:referrals?|referred|indicacao|indicacoes|indicados?|referidos?)\b/u.test(folded)) filter.source = 'referral';
  else if (/\b(?:website|web site|lead page|site|sitio web|pagina web)\b/u.test(folded)) filter.source = 'website';
  else if (/\b(?:instagram|facebook|social media|social|redes sociais|redes sociales)\b/u.test(folded)) filter.source = 'social-media';
  else if (/\b(?:mailers?|postcards?|correspondencia)\b/u.test(folded)) filter.source = 'mailer';
  else if (/\bcold calls?\b/u.test(folded)) filter.source = 'cold-call';

  if (/\b(?:pre ?approved|preapproved|pre-approved|pre aprovados?|preaprobados?)\b/u.test(folded)) filter.preApproved = true;

  if (/\b(?:never (?:been )?(?:contacted|called|reached)|not (?:been )?contacted yet|haven t (?:called|contacted) yet|nunca (?:contatad|contactad|liguei|llame))/u.test(folded)) {
    filter.neverContacted = true;
  } else {
    const quiet = /\b(?:haven t|have not|havent|not|no|without|sem|sin|nao)\b.{0,40}?\b(?:talked|talk|spoken|contacted|contact|reached|called|heard|contato|falei|falado|contacto|hablado|hable|llamado)\b.{0,30}?(?:\b(?:in|for|over|ha|faz|hace|en|desde)\b\s*)?(?:the last |os ultimos |los ultimos |o ultimo |el ultimo |more than |over |mais de |mas de )?(\d+|a|an|one|two|three|four|five|six|um|uma|dois|duas|tres|quatro|cinco|seis|un|una|dos|cuatro)?\s*(days?|weeks?|months?|years?|dias?|semanas?|mes|meses|anos?)\b/u.exec(folded);
    if (quiet?.[2]) {
      const count = amount(quiet[1]);
      if (count) filter.noContactDays = Math.min(730, Math.max(1, count * unitDays(quiet[2])));
    } else if (/\b(?:went quiet|gone quiet|gone cold|went cold|in a while|falling through the cracks|esfriaram|esfriou|sumiram|se enfriaron|hace tiempo|faz tempo)\b/u.test(folded)) {
      filter.noContactDays = 30;
    }
  }

  if (/\b(?:new|novos?|novas?|nuevos?|nuevas?|recent|recentes|recientes)\b/u.test(folded) && population) {
    if (/\b(?:today|hoje|hoy)\b/u.test(folded)) filter.newWithinDays = 1;
    else if (/\b(?:this week|esta semana|essa semana|last 7 days|ultimos 7 dias)\b/u.test(folded)) filter.newWithinDays = 7;
    else if (/\b(?:this month|este mes|esse mes|last 30 days|ultimos 30 dias)\b/u.test(folded)) filter.newWithinDays = 30;
    else {
      const recent = new RegExp(`\\b(?:last|past|ultimos|ultimas)\\s+${DURATION.source}`, 'u').exec(folded);
      filter.newWithinDays = recent?.[2] ? Math.min(365, (amount(recent[1]) ?? 1) * unitDays(recent[2])) : 14;
    }
  }

  if (/\b(?:home anniversar\w*|house anniversar\w*|homeaversar\w*|closing anniversar\w*|aniversarios? de (?:compra|casa)|aniversarios? da casa|aniversarios? de la casa)\b/u.test(folded)) {
    filter.anniversaryWithinDays = windowDays(folded, 30);
  } else if (/\b(?:birthdays?|aniversarios?|aniversariantes?|cumpleanos|cumpleaneros?)\b/u.test(folded)) {
    filter.birthdayWithinDays = windowDays(folded, 30);
  }

  if (/\b(?:follow[- ]?ups? (?:due|today|overdue)|due for (?:a )?follow[- ]?up|need(?:s)? (?:a )?follow[- ]?up|follow[- ]?up due|followups? due|retorno (?:pendente|atrasado)|seguimiento pendiente)\b/u.test(folded)) {
    filter.followUpDue = true;
  }

  const place = /\b(?:in|em|en|near|around|perto de|cerca de)\s+([a-z][a-z .'-]{1,40}?)(?:\s+(?:who|that|with|without|que|com|con|sem|sin|and|e|y|this|next|last|haven|not|for)\b.*)?$/u.exec(folded);
  if (place?.[1]) {
    const candidate = place[1].trim();
    if (!/^(?:the|a|an|my|o|os|a|as|la|las|el|los|escrow|contract|contrato|\d.*|(?:the )?(?:next|last) .*|(?:a|one) (?:week|month|while)|a while|a year|this .*|esta .*|essa .*|este .*|months?|weeks?|days?|years?|dias?|semanas?|meses|anos?)$/u.test(candidate)
      && !DURATION.test(candidate)) {
      filter.city = candidate.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ').slice(0, 60);
    }
  }

  const criteria = Object.keys(filter).filter((key) => key !== 'count' && key !== 'relationship' && key !== 'intent');
  if (!criteria.length && !population) return undefined;
  // A place alone ("weather in Miami") is not a people question.
  if (!population && criteria.length === 1 && criteria[0] === 'city') return undefined;
  // Without a question word, require the phrase to be mostly about people ("hot buyers in Miami").
  if (!listLike && !/^(?:(?:my|all|the|meus|minhas|mis|todos? (?:os|as|los|las)?|los|las|os|as)\s+)?(?:hot|warm|cold|nurture|new|recent|pre[- ]?approved|active|current|past|former|buyers?|sellers?|leads?|clients?|contacts?|people|investors?|renters?|tenants?|prospects?|listings?|home anniversar\w*|house anniversar\w*|birthdays?|compradore?s?|compradoras?|vendedore?s?|vendedoras?|clientes?|contatos?|contactos?|aniversar\w*|cumplea\w*|quentes?|calientes?|mornos?|novos?|novas?|nuevos?|nuevas?|sphere|esfera|inquilinos?|investidore?s?)\b/u.test(folded)) return undefined;
  // A bare "my clients"/"my leads" still counts as a list request.
  return filter;
}
