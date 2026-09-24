import { blockingFairHousingFindings, lintFairHousing, type FairHousingFinding } from './fair-housing.ts';

/**
 * Listing writer: MLS remarks, social posts, an email blast and an open-house
 * text from the facts the realtor enters. Copy describes the property and
 * place — never the people who should live there (Fair Housing).
 */
export const LISTING_FORMATS = ['mls', 'instagram', 'facebook', 'email', 'open-house'] as const;
export type ListingFormat = (typeof LISTING_FORMATS)[number];
export type ListingLanguage = 'en' | 'es';

export const LISTING_FORMAT_LABEL: Record<ListingFormat, string> = {
  mls: 'MLS description', instagram: 'Instagram', facebook: 'Facebook', email: 'Email blast', 'open-house': 'Open house text',
};

/** Rough length targets; MLS remarks are commonly capped around 1,000 characters. */
export const LISTING_FORMAT_LIMIT: Record<ListingFormat, number> = {
  mls: 1000, instagram: 900, facebook: 1200, email: 1600, 'open-house': 320,
};

export const LISTING_HOME_TYPES = ['single-family home', 'condo', 'townhouse', 'villa', 'multifamily', 'land'] as const;

export interface ListingFacts {
  readonly address?: string;
  readonly city: string;
  readonly homeType: (typeof LISTING_HOME_TYPES)[number];
  readonly beds?: number;
  readonly baths?: number;
  readonly squareFeet?: number;
  readonly price?: number;
  readonly yearBuilt?: number;
  /** Features in the realtor's own words: "renovated kitchen, pool, impact windows". */
  readonly highlights: string;
  /** Nearby places and amenities (not people): "10 min to the beach, near Dadeland". */
  readonly area?: string;
  readonly openHouse?: string;
  readonly agentName?: string;
}

export class ListingWriterError extends Error {
  readonly findings: readonly FairHousingFinding[];
  constructor(message: string, findings: readonly FairHousingFinding[] = []) {
    super(message);
    this.name = 'ListingWriterError';
    this.findings = findings;
  }
}

function text(value: unknown, max: number, label: string, required = false): string | undefined {
  const raw = typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '').trim() : '';
  if (!raw) { if (required) throw new ListingWriterError(`Add the ${label}.`); return undefined; }
  if (raw.length > max) throw new ListingWriterError(`Keep the ${label} under ${max} characters.`);
  return raw;
}

function number(value: unknown, min: number, max: number, label: string, integer = true): number | undefined {
  const raw = typeof value === 'string' ? value.replace(/[$,\s]/gu, '') : value;
  if (raw === '' || raw === undefined || raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) throw new ListingWriterError(`Check the ${label}.`);
  return parsed;
}

export function parseListingFacts(input: Record<string, unknown>): ListingFacts {
  const homeType = typeof input.homeType === 'string' && (LISTING_HOME_TYPES as readonly string[]).includes(input.homeType)
    ? input.homeType as ListingFacts['homeType'] : 'single-family home';
  const facts: ListingFacts = {
    ...(text(input.address, 120, 'address') ? { address: text(input.address, 120, 'address') } : {}),
    city: text(input.city, 60, 'city or neighborhood', true)!,
    homeType,
    ...(number(input.beds, 0, 20, 'bedrooms') !== undefined ? { beds: number(input.beds, 0, 20, 'bedrooms') } : {}),
    ...(number(input.baths, 0, 20, 'bathrooms', false) !== undefined ? { baths: number(input.baths, 0, 20, 'bathrooms', false) } : {}),
    ...(number(input.squareFeet, 100, 100_000, 'square feet') !== undefined ? { squareFeet: number(input.squareFeet, 100, 100_000, 'square feet') } : {}),
    ...(number(input.price, 1_000, 500_000_000, 'price') !== undefined ? { price: number(input.price, 1_000, 500_000_000, 'price') } : {}),
    ...(number(input.yearBuilt, 1800, 2100, 'year built') !== undefined ? { yearBuilt: number(input.yearBuilt, 1800, 2100, 'year built') } : {}),
    highlights: text(input.highlights, 800, 'highlights', true)!,
    ...(text(input.area, 400, 'area notes') ? { area: text(input.area, 400, 'area notes') } : {}),
    ...(text(input.openHouse, 80, 'open house time') ? { openHouse: text(input.openHouse, 80, 'open house time') } : {}),
    ...(text(input.agentName, 80, 'agent name') ? { agentName: text(input.agentName, 80, 'agent name') } : {}),
  };
  const blocking = blockingFairHousingFindings(facts.highlights, facts.area ?? '');
  if (blocking.length) throw new ListingWriterError('Some words describe who should live there instead of the home. Rephrase them before writing.', blocking);
  return facts;
}

export function parseListingFormat(value: unknown): ListingFormat {
  return (LISTING_FORMATS as readonly unknown[]).includes(value) ? value as ListingFormat : 'mls';
}

export function parseListingLanguage(value: unknown): ListingLanguage {
  return value === 'es' ? 'es' : 'en';
}

// ---------------------------------------------------------------------------
// Deterministic copy (always available, no AI needed)
// ---------------------------------------------------------------------------

function price(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

function features(highlights: string): string[] {
  return highlights.split(/\s*(?:,|;|\n|•|·| - )\s*/u).map((item) => item.trim().replace(/\.$/u, '')).filter((item) => item.length > 1).slice(0, 8);
}

function specs(facts: ListingFacts, language: ListingLanguage): string {
  const es = language === 'es';
  return [
    facts.beds !== undefined ? `${facts.beds} ${es ? (facts.beds === 1 ? 'habitación' : 'habitaciones') : facts.beds === 1 ? 'bed' : 'beds'}` : undefined,
    facts.baths !== undefined ? `${facts.baths} ${es ? (facts.baths === 1 ? 'baño' : 'baños') : facts.baths === 1 ? 'bath' : 'baths'}` : undefined,
    facts.squareFeet ? `${facts.squareFeet.toLocaleString('en-US')} ${es ? 'pies²' : 'sq ft'}` : undefined,
    facts.yearBuilt ? `${es ? 'construida en' : 'built'} ${facts.yearBuilt}` : undefined,
  ].filter(Boolean).join(' · ');
}

const HOME_ES: Record<ListingFacts['homeType'], string> = {
  'single-family home': 'casa unifamiliar', condo: 'condominio', townhouse: 'townhouse', villa: 'villa', multifamily: 'propiedad multifamiliar', land: 'terreno',
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function templateListingCopy(facts: ListingFacts, format: ListingFormat, language: ListingLanguage): string {
  const es = language === 'es';
  const home = es ? HOME_ES[facts.homeType] : facts.homeType;
  const where = facts.address ? `${facts.address}, ${facts.city}` : facts.city;
  const atWhere = facts.address ? `at ${where}` : `in ${facts.city}`;
  const list = features(facts.highlights);
  const spec = specs(facts, language);
  const cost = facts.price ? price(facts.price) : undefined;
  const sign = facts.agentName ? `\n\n${facts.agentName}` : '';
  const featureLine = list.length ? list.map(capitalize).join(', ') : capitalize(facts.highlights);
  if (es) {
    switch (format) {
      case 'mls': return `${capitalize(home)} en ${facts.city}${spec ? ` con ${spec}` : ''}. ${featureLine}.${facts.area ? ` Ubicación: ${facts.area}.` : ''}${cost ? ` Precio: ${cost}.` : ''} Agende su visita hoy.`.slice(0, LISTING_FORMAT_LIMIT.mls);
      case 'instagram': return `✨ Nueva propiedad en ${facts.city}\n🏡 ${capitalize(home)}${spec ? ` · ${spec}` : ''}\n${list.slice(0, 5).map((item) => `• ${capitalize(item)}`).join('\n')}${cost ? `\n💲 ${cost}` : ''}\n\nEscríbeme para una visita privada.\n\n#bienesraices #${facts.city.replace(/\s+/gu, '')} #casaenventa`;
      case 'facebook': return `¡Nueva propiedad en ${where}! ${capitalize(home)}${spec ? ` con ${spec}` : ''}.\n\n${list.map((item) => `✔ ${capitalize(item)}`).join('\n')}${facts.area ? `\n\n📍 ${facts.area}` : ''}${cost ? `\n\nPrecio: ${cost}` : ''}\n\nEnvíame un mensaje para más detalles o una visita.${sign}`;
      case 'email': return `Asunto: Nueva propiedad en ${facts.city}${cost ? ` — ${cost}` : ''}\n\nHola,\n\nQuería compartir una nueva propiedad en ${where}: ${home}${spec ? ` con ${spec}` : ''}.\n\nLo más destacado:\n${list.map((item) => `• ${capitalize(item)}`).join('\n')}${facts.area ? `\n\nUbicación: ${facts.area}` : ''}${facts.openHouse ? `\n\nOpen house: ${facts.openHouse}` : ''}\n\nResponda a este correo para agendar una visita.${sign}`;
      case 'open-house': return `Open house ${facts.openHouse ? facts.openHouse : 'este fin de semana'} en ${where}: ${home}${spec ? `, ${spec}` : ''}. ${list.slice(0, 2).map(capitalize).join(', ')}. ¡Los espero!`.slice(0, LISTING_FORMAT_LIMIT['open-house']);
    }
  }
  switch (format) {
    case 'mls': return `Welcome to this ${home} in ${facts.city}${spec ? ` offering ${spec}` : ''}. ${featureLine}.${facts.area ? ` Location: ${facts.area}.` : ''}${cost ? ` Offered at ${cost}.` : ''} Schedule your private showing today.`.slice(0, LISTING_FORMAT_LIMIT.mls);
    case 'instagram': return `✨ Just listed in ${facts.city}\n🏡 ${capitalize(home)}${spec ? ` · ${spec}` : ''}\n${list.slice(0, 5).map((item) => `• ${capitalize(item)}`).join('\n')}${cost ? `\n💲 ${cost}` : ''}\n\nDM me for a private tour.\n\n#justlisted #realestate #${facts.city.replace(/\s+/gu, '')}`;
    case 'facebook': return `Just listed: ${where}! ${capitalize(home)}${spec ? ` with ${spec}` : ''}.\n\n${list.map((item) => `✔ ${capitalize(item)}`).join('\n')}${facts.area ? `\n\n📍 ${facts.area}` : ''}${cost ? `\n\nOffered at ${cost}` : ''}\n\nMessage me for details or a private showing.${sign}`;
    case 'email': return `Subject: Just listed in ${facts.city}${cost ? ` — ${cost}` : ''}\n\nHi there,\n\nI wanted to share a new listing ${atWhere}: a ${home}${spec ? ` with ${spec}` : ''}.\n\nHighlights:\n${list.map((item) => `• ${capitalize(item)}`).join('\n')}${facts.area ? `\n\nLocation: ${facts.area}` : ''}${facts.openHouse ? `\n\nOpen house: ${facts.openHouse}` : ''}\n\nReply to this email to set up a showing.${sign}`;
    case 'open-house': return `Open house ${facts.openHouse ? facts.openHouse : 'this weekend'} ${atWhere}: ${home}${spec ? `, ${spec}` : ''}. ${list.slice(0, 2).map(capitalize).join(', ')}. Hope to see you there!`.slice(0, LISTING_FORMAT_LIMIT['open-house']);
  }
}

// ---------------------------------------------------------------------------
// AI prompt and output checks
// ---------------------------------------------------------------------------

const FORMAT_BRIEF: Record<ListingFormat, string> = {
  mls: 'MLS public remarks: one flowing paragraph, 600-900 characters, no emojis, no hashtags, no ALL CAPS, no phone numbers or URLs.',
  instagram: 'Instagram caption: a hook line, 3-5 short feature lines, a call to action, then 3-5 relevant hashtags. Tasteful emojis allowed. Under 900 characters.',
  facebook: 'Facebook post: friendly, 2 short paragraphs plus a checkmark feature list and a call to message the agent. Under 1,200 characters.',
  email: 'Email blast: start with "Subject: ..." on the first line, then a short greeting, 2 short paragraphs, a bullet list of highlights and a call to reply for a showing. Under 1,600 characters.',
  'open-house': 'Open house text message: one or two sentences, under 300 characters, friendly, includes the date/time if given.',
};

export function listingPrompt(facts: ListingFacts, format: ListingFormat, language: ListingLanguage): { readonly system: string; readonly user: string } {
  return {
    system: [
      'You are an expert US real estate copywriter writing for a Florida realtor.',
      `Write in ${language === 'es' ? 'Spanish (neutral Latin American)' : 'American English'}.`,
      FORMAT_BRIEF[format],
      'Use ONLY the facts provided. Never invent features, measurements, views, schools, prices, HOA details or awards.',
      'Fair Housing: describe the property and places, never people. Do not mention or imply who should live there (no family, children, couples, singles, retirees, age, religion, race, national origin, disability, sex or income source). Avoid words like "perfect for families", "bachelor pad", "walking distance to church", "exclusive", "safe neighborhood", "master bedroom" (use "primary bedroom").',
      'Return only the final copy as plain text, no markdown headings, no quotes around it.',
    ].join('\n'),
    user: JSON.stringify({ facts, format }),
  };
}

export interface CheckedCopy {
  readonly text: string;
  readonly findings: readonly FairHousingFinding[];
}

/** Cleans model output and runs the Fair Housing linter on it. */
export function checkListingCopy(raw: string, format: ListingFormat): CheckedCopy {
  const cleaned = raw.replace(/^```[a-z]*\n?|```$/giu, '').replace(/^#{1,6}[ \t]+/gmu, '').replace(/\*\*(.+?)\*\*/gu, '$1').replace(/\r\n?/gu, '\n').trim();
  const limit = Math.round(LISTING_FORMAT_LIMIT[format] * 1.15);
  const text = cleaned.length > limit ? `${cleaned.slice(0, limit).replace(/\s+\S*$/u, '')}…` : cleaned;
  return { text, findings: lintFairHousing(text) };
}
