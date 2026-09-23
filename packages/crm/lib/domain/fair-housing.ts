/**
 * Fair Housing copy check for marketing text (emails, mailers, listing copy).
 *
 * The federal Fair Housing Act (42 U.S.C. § 3604(c)) and the Florida Fair
 * Housing Act (Fla. Stat. § 760.23) prohibit advertising that indicates a
 * preference, limitation or discrimination based on race, color, national
 * origin, religion, sex, disability or familial status. Some Florida counties
 * and cities also protect source of income, sexual orientation and gender
 * identity. This linter flags phrases that commonly create that risk. It is a
 * writing aid, not a legal determination: "avoid" phrases are blocked from
 * marketing sends, "review" phrases are shown with a safer alternative.
 */

export type FairHousingSeverity = 'avoid' | 'review';
export type FairHousingCategory = 'familial-status' | 'religion' | 'race-national-origin' | 'disability' | 'sex' | 'source-of-income' | 'steering';

export interface FairHousingFinding {
  readonly phrase: string;
  readonly index: number;
  readonly severity: FairHousingSeverity;
  readonly category: FairHousingCategory;
  readonly why: string;
  readonly suggestion: string;
}

interface Rule {
  readonly pattern: RegExp;
  readonly severity: FairHousingSeverity;
  readonly category: FairHousingCategory;
  readonly why: string;
  readonly suggestion: string;
}

const CATEGORY_LABEL: Record<FairHousingCategory, string> = {
  'familial-status': 'Familial status',
  religion: 'Religion',
  'race-national-origin': 'Race or national origin',
  disability: 'Disability',
  sex: 'Sex',
  'source-of-income': 'Source of income',
  steering: 'Steering',
};

export function fairHousingCategoryLabel(category: FairHousingCategory): string {
  return CATEGORY_LABEL[category];
}

const RELIGIONS = 'christian|catholic|protestant|jewish|muslim|islamic|hindu|buddhist|mormon|evangelical';
const GROUPS = 'white|black|caucasian|african[- ]american|hispanic|latino|latina|latinx|asian|chinese|mexican|cuban|haitian|indian|korean|arab|european|american[- ]born';
const PLACES = 'neighborhood|neighbourhood|community|area|building|home|homes|buyers?|tenants?|residents?|families|family|people|owners?';

const RULES: readonly Rule[] = [
  { pattern: /\b(?:no|without)\s+(?:kids|children|minors|infants|babies)\b/giu, severity: 'avoid', category: 'familial-status', why: 'Excludes families with children.', suggestion: 'Describe the property, not who may live there.' },
  { pattern: /\badults?[- ]only\b/giu, severity: 'avoid', category: 'familial-status', why: 'Excludes families with children (only lawful for qualified 55+/62+ housing).', suggestion: 'If the community is a qualified 55+ community, say “55+ community” and confirm HOPA status.' },
  { pattern: /\b(?:perfect|ideal|great)\s+for\s+(?:a\s+)?(?:young\s+)?(?:famil(?:y|ies)|couples?|singles?|bachelors?|young professionals|retirees|empty[- ]nesters|newlyweds|students)\b/giu, severity: 'review', category: 'familial-status', why: 'Suggests a preferred kind of household.', suggestion: 'Describe features instead, e.g. “three bedrooms and a fenced yard”.' },
  { pattern: /\bfamily[- ]friendly\b/giu, severity: 'review', category: 'familial-status', why: 'Can read as a preference for households with children.', suggestion: 'Name the amenity: “near parks and playgrounds”.' },
  { pattern: /\b(?:bachelor|bachelorette)\s+pad\b/giu, severity: 'review', category: 'sex', why: 'Suggests a preferred sex or household type.', suggestion: 'Try “low-maintenance condo” or describe the space.' },
  { pattern: /\b(?:empty[- ]nesters?|mature (?:couple|person|individuals?))\b/giu, severity: 'review', category: 'familial-status', why: 'Suggests a preferred age or household.', suggestion: 'Describe the property: “single-level living”, “low-maintenance yard”.' },
  { pattern: new RegExp(`\\b(?:${RELIGIONS})\\s+(?:${PLACES})\\b`, 'giu'), severity: 'avoid', category: 'religion', why: 'Indicates a religious preference.', suggestion: 'Remove the religious description of the people or area.' },
  { pattern: new RegExp(`\\b(?:${GROUPS})\\s+(?:${PLACES})\\b`, 'giu'), severity: 'avoid', category: 'race-national-origin', why: 'Indicates a racial, ethnic or national-origin preference.', suggestion: 'Remove descriptions of who lives in the area.' },
  { pattern: /\b(?:english[- ]speak(?:ing|ers?)\s+only|must\s+speak\s+english)\b/giu, severity: 'avoid', category: 'race-national-origin', why: 'Can discriminate by national origin.', suggestion: 'Remove language requirements.' },
  { pattern: /\b(?:no\s+(?:wheelchairs?|handicapped|disabled)|able[- ]bodied|must\s+be\s+able\s+to\s+(?:climb|walk)|physically\s+fit\s+only|no\s+service\s+animals|mentally\s+(?:ill|stable)|healthy\s+only)\b/giu, severity: 'avoid', category: 'disability', why: 'Excludes people with disabilities.', suggestion: 'Describe accessibility factually, e.g. “second-floor unit, no elevator”.' },
  { pattern: /\b(?:no\s+section\s*8|section\s*8\s+not\s+accepted|no\s+(?:vouchers|housing\s+assistance))\b/giu, severity: 'avoid', category: 'source-of-income', why: 'Source of income is protected in Miami-Dade, Broward and other Florida localities.', suggestion: 'Remove it; screen every applicant with the same written criteria.' },
  { pattern: /\b(?:exclusive|restricted|private)\s+(?:neighborhood|neighbourhood|community|enclave)\b/giu, severity: 'review', category: 'steering', why: '“Exclusive” or “restricted” areas have historically signaled who is unwelcome.', suggestion: 'Try “gated community” or name the amenities.' },
  { pattern: /\b(?:safe|good|nice|quiet)\s+(?:neighborhood|neighbourhood|area|part of town)\b|\bcrime[- ]free\b/giu, severity: 'review', category: 'steering', why: 'Subjective safety claims can steer buyers; let them research crime data themselves.', suggestion: 'Point to facts: “0.3 miles to the park, 10 minutes to downtown”.' },
  { pattern: /\b(?:integrated|segregated|ethnic)\s+(?:neighborhood|neighbourhood|community|area)\b/giu, severity: 'avoid', category: 'race-national-origin', why: 'Describes the racial or ethnic makeup of an area.', suggestion: 'Remove it and describe the property and amenities.' },
  { pattern: /\b(?:gentlem[ae]n'?s|men only|women only|female only|male only|ladies only)\b/giu, severity: 'avoid', category: 'sex', why: 'Indicates a preference based on sex.', suggestion: 'Remove it.' },
];

/** Returns every risky phrase in reading order, without duplicates. */
export function lintFairHousing(text: string): FairHousingFinding[] {
  if (!text) return [];
  const findings: FairHousingFinding[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      const key = `${index}:${match[0].toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ phrase: match[0], index, severity: rule.severity, category: rule.category, why: rule.why, suggestion: rule.suggestion });
    }
  }
  return findings.sort((left, right) => left.index - right.index);
}

export function blockingFairHousingFindings(...texts: readonly string[]): FairHousingFinding[] {
  return texts.flatMap((text) => lintFairHousing(text)).filter((finding) => finding.severity === 'avoid');
}

export function fairHousingBlockMessage(findings: readonly FairHousingFinding[]): string {
  const phrases = [...new Set(findings.map((finding) => `“${finding.phrase}”`))].slice(0, 3).join(', ');
  return `Fair Housing check: please rephrase ${phrases} before this goes out.`;
}
