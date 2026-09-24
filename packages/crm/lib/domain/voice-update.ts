import type { BuyerCriteria, Contact, Intent, LeadType, SellerCriteria } from './contact.ts';
import { dueDate, foldText, parseDueSpec } from './omnix-understanding.ts';

/**
 * Turns a spoken or typed update ("she's pre-approved for 450k, wants 3 beds
 * in Coral Gables, call her Friday") into a reviewable set of CRM changes.
 * Deterministic: every change quotes the words it came from, and nothing is
 * saved until the realtor confirms.
 */
export type VoiceChangeField =
  | 'priceMin' | 'priceMax' | 'beds' | 'baths' | 'areas' | 'preApproved' | 'lender' | 'mortgageType'
  | 'desiredPropertyType' | 'buyerTimeline' | 'targetPrice' | 'sellerTimeline' | 'propertyAddress'
  | 'leadType' | 'intent' | 'nextTouchAt' | 'talked';

export interface VoiceChange {
  readonly field: VoiceChangeField;
  readonly label: string;
  readonly before?: string;
  readonly after: string;
  /** Machine value applied on confirm. */
  readonly value: string | number | boolean | readonly string[];
  readonly evidence: string;
}

export interface VoiceUpdatePreview {
  readonly note: string;
  readonly changes: readonly VoiceChange[];
}

export const VOICE_UPDATE_MAX = 2000;

function money(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(value % 1_000_000 ? 2 : 0).replace(/\.?0+$/u, '')}M` : `$${Math.round(value / 1000)}k`;
}

/** "450k", "$1.2m", "450,000", "450 thousand" → dollars. Bare numbers under 10,000 are read as thousands. */
export function parseAmount(raw: string): number | undefined {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|mil|m|million|milh[aã]o|millones|mill[oó]n)?$/iu.exec(raw.trim());
  if (!match?.[1]) return undefined;
  const base = Number(match[1].replace(/,/gu, ''));
  const unit = match[2]?.toLowerCase();
  const value = unit === 'k' || unit === 'thousand' || unit === 'mil' ? base * 1000
    : unit ? base * 1_000_000
      : base < 10_000 ? base * 1000 : base;
  return value >= 25_000 && value <= 100_000_000 ? Math.round(value) : undefined;
}

const AMOUNT = String.raw`\$?\s*\d{1,3}(?:,\d{3})+|\$?\s*\d+(?:\.\d+)?\s*(?:million|mil|thousand|k|m)?`;

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, uno: 1, dos: 2, cuatro: 4 };

function count(raw: string): number | undefined {
  const value = /^\d+(?:\.5)?$/u.test(raw) ? Number(raw) : NUMBER_WORDS[raw.toLowerCase()];
  return value !== undefined && value > 0 && value <= 12 ? value : undefined;
}

export function extractVoiceUpdate(text: string, contact: Contact, today: string): VoiceUpdatePreview {
  const note = text.replace(/\r\n?/gu, '\n').trim().slice(0, VOICE_UPDATE_MAX);
  const folded = foldText(note);
  const changes: VoiceChange[] = [];
  const buyer: BuyerCriteria = contact.buyer ?? {};
  const seller: SellerCriteria = contact.seller ?? {};
  const add = (change: VoiceChange) => { if (!changes.some((item) => item.field === change.field)) changes.push(change); };
  const isSeller = /\b(?:sell|selling|list(?:ing)? (?:it|the house|their house|her house|his house)|vender|vendendo|venda|vendiendo)\b/u.test(folded);
  const isBuyer = /\b(?:buy|buying|looking for|budget|pre ?approved|beds?|bedrooms?|comprar|procurando|presupuesto|orcamento|quartos?)\b/u.test(folded);

  // Budget — "between 350 and 450k", "up to 500k", "budget is 450k", "around $1.2M"
  const range = new RegExp(String.raw`\b(?:between|from|entre|de)\s+(${AMOUNT})\s+(?:and|to|-|e|y|a)\s+(${AMOUNT})`, 'iu').exec(note);
  if (range?.[1] && range[2]) {
    let min = parseAmount(range[1].replace(/\s+/gu, ''));
    const max = parseAmount(range[2].replace(/\s+/gu, ''));
    if (min !== undefined && max !== undefined && min < 10_000_000 && /k|thousand/iu.test(range[2]) && !/k|thousand|m/iu.test(range[1])) min = parseAmount(`${range[1].replace(/\D/gu, '')}k`);
    if (min && max && min < max) {
      if (min !== buyer.priceMin) add({ field: 'priceMin', label: 'Budget from', ...(buyer.priceMin ? { before: money(buyer.priceMin) } : {}), after: money(min), value: min, evidence: range[0] });
      if (max !== buyer.priceMax) add({ field: 'priceMax', label: 'Budget up to', ...(buyer.priceMax ? { before: money(buyer.priceMax) } : {}), after: money(max), value: max, evidence: range[0] });
    }
  } else {
    const max = new RegExp(String.raw`\b(?:budget(?: is| of)?|up to|max(?:imum)?|under|no more than|around|about|(?:pre-?\s?)?approved(?:\s+(?:with|by|through)\s+[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})?\s+for|or[cç]amento(?: de)?|at[eé]|presupuesto(?: de)?|hasta)\s+(${AMOUNT})`, 'iu').exec(note);
    const amount = max?.[1] ? parseAmount(max[1].replace(/\s+/gu, '')) : undefined;
    if (max && amount && amount !== buyer.priceMax && !(isSeller && !isBuyer)) {
      add({ field: 'priceMax', label: 'Budget up to', ...(buyer.priceMax ? { before: money(buyer.priceMax) } : {}), after: money(amount), value: amount, evidence: max[0] });
    }
  }

  // Bedrooms / bathrooms
  const beds = /\b(\d|one|two|three|four|five|six|dois|tres|quatro|cinco|dos|cuatro)\+?\s*(?:or more\s+)?(?:bed(?:room)?s?|br|quartos?|dormit[oó]rios?|habitaciones|rec[aá]maras)\b/iu.exec(note);
  const bedCount = beds?.[1] ? count(beds[1]) : undefined;
  if (beds && bedCount && bedCount !== buyer.beds) add({ field: 'beds', label: 'Bedrooms', ...(buyer.beds ? { before: `${buyer.beds}+` } : {}), after: `${bedCount}+`, value: bedCount, evidence: beds[0] });
  const baths = /\b(\d(?:\.5)?|one|two|three|four|dois|tres|dos)\+?\s*(?:bath(?:room)?s?|ba|banheiros?|ba[nñ]os?)\b/iu.exec(note);
  const bathCount = baths?.[1] ? count(baths[1]) : undefined;
  if (baths && bathCount && bathCount !== buyer.baths) add({ field: 'baths', label: 'Bathrooms', ...(buyer.baths ? { before: `${buyer.baths}+` } : {}), after: `${bathCount}+`, value: bathCount, evidence: baths[0] });

  // Areas — capitalized place names after "in / around / near", e.g. "in Coral Gables or Coconut Grove"
  const areaMatch = /\b(?:in|around|near|close to|em|en|perto de|cerca de)\s+((?:[A-Z][\p{L}'-]+(?:[ ]+(?:[A-Z][\p{L}'-]+|de|del|la|las|los))*)(?:[ ]*(?:,|or|and|ou|e|o|y)[ ]+[A-Z][\p{L}'-]+(?:[ ]+[A-Z][\p{L}'-]+)*)*)/u.exec(note);
  if (areaMatch?.[1]) {
    const months = /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Spring|Summer|Fall|Winter)$/u;
    const areas = areaMatch[1].split(/\s*(?:,|\bor\b|\band\b|\bou\b|\be\b|\bo\b|\by\b)\s*/u).map((area) => area.trim()).filter((area) => area && !months.test(area)).slice(0, 6);
    const merged = [...new Set([...(buyer.areas ?? []), ...areas])];
    if (areas.length && merged.length !== (buyer.areas ?? []).length) {
      add({ field: 'areas', label: 'Areas', ...(buyer.areas?.length ? { before: buyer.areas.join(', ') } : {}), after: merged.join(', '), value: merged, evidence: areaMatch[0] });
    }
  }

  // Pre-approval, lender, loan type
  if (/\b(?:not (?:yet )?pre ?-?approved|isn t pre ?-?approved|no pre ?-?approval|needs? (?:a )?lender|nao (?:esta )?pre ?-?aprovad|sin pre ?-?aprobaci)/u.test(folded)) {
    if (buyer.preApproved !== false) add({ field: 'preApproved', label: 'Pre-approved', ...(buyer.preApproved ? { before: 'Yes' } : {}), after: 'Not yet', value: false, evidence: 'not pre-approved' });
  } else if (/\b(?:pre ?-?approved|pre ?-?aprovad\w*|pre ?-?aprobad\w*|preapproved)\b/u.test(folded)) {
    if (buyer.preApproved !== true) add({ field: 'preApproved', label: 'Pre-approved', ...(buyer.preApproved === false ? { before: 'Not yet' } : {}), after: 'Yes', value: true, evidence: 'pre-approved' });
    const lender = /\bpre-?\s?approved\s+(?:with|by|through)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/u.exec(note);
    if (lender?.[1] && lender[1] !== buyer.lender) add({ field: 'lender', label: 'Lender', ...(buyer.lender ? { before: buyer.lender } : {}), after: lender[1], value: lender[1], evidence: lender[0] });
  }
  const loan = /\b(fha|va|cash|conventional)\b(?:\s+(?:loan|buyer|offer))?/iu.exec(note);
  if (loan?.[1]) {
    const type = loan[1].toLowerCase() as NonNullable<BuyerCriteria['mortgageType']>;
    if (type !== buyer.mortgageType) add({ field: 'mortgageType', label: 'Financing', ...(buyer.mortgageType ? { before: buyer.mortgageType.toUpperCase() } : {}), after: type === 'cash' ? 'Cash' : type.toUpperCase(), value: type, evidence: loan[0] });
  }

  // Property type
  const type = /\b(single[- ]family(?: home)?|townhouse|townhome|condo|villa|duplex|multi[- ]family|land|lot|casa|apartamento|apartamento|departamento)\b/iu.exec(note);
  if (type?.[1] && !isSeller) {
    const normalized = titleCase(type[1].toLowerCase().replace(/townhome/u, 'townhouse').replace(/apartamento|departamento/u, 'condo').replace(/^casa$/u, 'single-family'));
    if (normalized !== buyer.desiredPropertyType) add({ field: 'desiredPropertyType', label: 'Home type', ...(buyer.desiredPropertyType ? { before: buyer.desiredPropertyType } : {}), after: normalized, value: normalized, evidence: type[0] });
  }

  // Timeline — "within 3 months", "by spring", "asap", "next year"
  const timeline = /\b(asap|right away|immediately|(?:within|in|in the next|em|en)\s+(?:\d+|a|one|two|three|six)\s+(?:weeks?|months?|meses|semanas)|by (?:the )?(?:spring|summer|fall|winter|end of (?:the )?year|january|february|march|april|may|june|july|august|september|october|november|december)|next (?:year|spring|summer|fall|winter)|this (?:spring|summer|fall|winter|year))\b/iu.exec(note);
  const followVerbBefore = timeline ? /\b(?:call|text|follow(?:[- ]?up)?|check (?:back|in)|reach out|touch base|ligar|retornar|llamar)\b[^.,;]{0,20}$/iu.test(note.slice(0, timeline.index)) : false;
  if (timeline?.[1] && !followVerbBefore) {
    const value = timeline[1].replace(/^(?:em|en)\s/iu, 'in ').toLowerCase();
    const field: VoiceChangeField = isSeller && !isBuyer ? 'sellerTimeline' : 'buyerTimeline';
    const before = field === 'sellerTimeline' ? seller.timeline : buyer.timeline;
    if (value !== before) add({ field, label: 'Timeline', ...(before ? { before } : {}), after: value, value, evidence: timeline[0] });
  }

  // Seller specifics — "list it for 650k", "wants 700k for the house", address
  if (isSeller) {
    const target = new RegExp(String.raw`\b(?:list(?:ing)?(?: it| the house)?(?: for| at)|asking|wants? to get|sell (?:it )?for|vender por|vender(?: a)? por)\s+(${AMOUNT})`, 'iu').exec(note);
    const amount = target?.[1] ? parseAmount(target[1].replace(/\s+/gu, '')) : undefined;
    if (target && amount && amount !== seller.targetPrice) add({ field: 'targetPrice', label: 'Target price', ...(seller.targetPrice ? { before: money(seller.targetPrice) } : {}), after: money(amount), value: amount, evidence: target[0] });
    const address = /\b(\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle)\b\.?)/u.exec(note);
    if (address?.[1] && address[1] !== seller.propertyAddress) add({ field: 'propertyAddress', label: 'Home to sell', ...(seller.propertyAddress ? { before: seller.propertyAddress } : {}), after: address[1], value: address[1], evidence: address[0] });
  }

  // Intent
  const nextIntent: Intent | undefined = isSeller && isBuyer && /\b(?:buy|buying|comprar)\b/u.test(folded) ? 'both' : isSeller && contact.intent !== 'seller' && contact.intent !== 'both' && !/\bsell(?:er)?s?\b.*\b(?:showed|showing)\b/u.test(folded) ? (contact.intent === 'buyer' ? 'both' : 'seller') : undefined;
  if (nextIntent && nextIntent !== contact.intent) add({ field: 'intent', label: 'Looking to', before: contact.intent, after: nextIntent, value: nextIntent, evidence: 'sell' });

  // Temperature
  const heat: LeadType | undefined = /\b(?:ready to (?:buy|sell|make an offer|move)|very motivated|wants to (?:move|write an offer) (?:fast|now|asap)|make an offer|pronto para comprar|muy motivad\w*|quiere ofertar)\b/u.test(folded) ? 'hot'
    : /\b(?:not in a (?:hurry|rush)|just (?:looking|browsing)|next year|no rush|sem pressa|sin prisa|solo mirando)\b/u.test(folded) ? 'nurture' : undefined;
  if (heat && heat !== contact.leadType) add({ field: 'leadType', label: 'Temperature', before: contact.leadType, after: heat, value: heat, evidence: heat === 'hot' ? 'ready to move' : 'no rush' });

  // Follow-up — "call her Friday", "follow up next week", "check back in 2 weeks"
  const follow = /\b(?:call|text|follow(?:[- ]?up)?|check (?:back|in)|reach out|touch base|ligar|retornar|falar|llamar|seguimiento)\b(?:\s+(?:with|to|on|com|con|a|para))?(?:\s+(?:her|him|them|ela|ele|ella|el))?\s+(?:back\s+)?((?:on\s+)?(?:today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in\s+\d+\s+(?:days?|weeks?)|amanha|hoje|semana que vem|segunda|terca|quarta|quinta|sexta|manana|lunes|martes|miercoles|jueves|viernes))/u.exec(folded);
  if (follow?.[1]) {
    const spec = parseDueSpec(follow[0]);
    const date = dueDate(spec, today);
    if (date !== contact.nextTouchAt) {
      const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
      add({ field: 'nextTouchAt', label: 'Next follow-up', ...(contact.nextTouchAt ? { before: contact.nextTouchAt } : {}), after: label, value: date, evidence: follow[0] });
    }
  }

  // Conversation happened — "talked to", "spoke with", "called", "met", "showed"
  if (/^(?:talked|spoke|called|met|showed|toured|had (?:a )?(?:call|meeting)|falei|conversei|liguei|hable|llame|nos reunimos)\b|\b(?:just (?:talked|spoke|called|met)|got off the phone|after (?:the|our) (?:call|showing|meeting))\b/u.test(folded)) {
    add({ field: 'talked', label: 'Conversation', after: 'Log as talked today', value: true, evidence: 'talked' });
  }
  return { note, changes };
}

export interface VoiceUpdatePatch {
  readonly patch: Partial<Contact>;
  readonly talked: boolean;
  readonly nextTouchAt?: string;
}

/** Builds the contact patch for the changes the realtor kept. */
export function voiceUpdatePatch(contact: Contact, changes: readonly VoiceChange[]): VoiceUpdatePatch {
  const buyer: Record<string, unknown> = { ...(contact.buyer ?? {}) };
  const seller: Record<string, unknown> = { ...(contact.seller ?? {}) };
  const patch: { -readonly [K in keyof Contact]?: Contact[K] } = {};
  let buyerTouched = false; let sellerTouched = false; let talked = false; let nextTouchAt: string | undefined;
  for (const change of changes) {
    switch (change.field) {
      case 'priceMin': case 'priceMax': case 'beds': case 'baths': case 'lender': case 'mortgageType': case 'desiredPropertyType':
        buyer[change.field] = change.value; buyerTouched = true; break;
      case 'areas': buyer.areas = [...(change.value as readonly string[])]; buyerTouched = true; break;
      case 'preApproved': buyer.preApproved = change.value; buyerTouched = true; break;
      case 'buyerTimeline': buyer.timeline = change.value; buyerTouched = true; break;
      case 'targetPrice': case 'propertyAddress': seller[change.field] = change.value; sellerTouched = true; break;
      case 'sellerTimeline': seller.timeline = change.value; sellerTouched = true; break;
      case 'leadType': patch.leadType = change.value as LeadType; break;
      case 'intent': patch.intent = change.value as Intent; break;
      case 'nextTouchAt': nextTouchAt = String(change.value); break;
      case 'talked': talked = change.value === true; break;
    }
  }
  if (buyerTouched) patch.buyer = buyer as BuyerCriteria;
  if (sellerTouched) patch.seller = seller as SellerCriteria;
  return { patch, talked, ...(nextTouchAt ? { nextTouchAt } : {}) };
}
