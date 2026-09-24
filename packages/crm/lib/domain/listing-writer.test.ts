import { describe, expect, it } from 'vitest';
import { checkListingCopy, LISTING_FORMAT_LIMIT, LISTING_FORMATS, listingPrompt, ListingWriterError, parseListingFacts, parseListingFormat, parseListingLanguage, templateListingCopy } from './listing-writer.ts';

const base = { city: 'Doral', homeType: 'single-family home', beds: '4', baths: '3', squareFeet: '2,450', price: '$725,000', highlights: 'renovated kitchen, heated pool, impact windows, new roof 2023', area: '10 minutes to Dolphin Mall' };

describe('parseListingFacts', () => {
  it('parses numbers written the way realtors type them', () => {
    const facts = parseListingFacts(base);
    expect(facts).toMatchObject({ city: 'Doral', beds: 4, baths: 3, squareFeet: 2450, price: 725000 });
  });
  it('requires city and highlights', () => {
    expect(() => parseListingFacts({ ...base, city: '' })).toThrow(ListingWriterError);
    expect(() => parseListingFacts({ ...base, highlights: ' ' })).toThrow(/highlights/u);
  });
  it('rejects impossible numbers', () => {
    expect(() => parseListingFacts({ ...base, beds: '-1' })).toThrow(/bedrooms/u);
    expect(() => parseListingFacts({ ...base, yearBuilt: '1500' })).toThrow(/year built/u);
  });
  it('blocks Fair Housing violations before any copy is written', () => {
    try {
      parseListingFacts({ ...base, highlights: 'adults only, big yard' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ListingWriterError);
      expect((error as ListingWriterError).findings.length).toBeGreaterThan(0);
    }
  });
  it('falls back to safe defaults for format, language and home type', () => {
    expect(parseListingFormat('tiktok')).toBe('mls');
    expect(parseListingLanguage('pt')).toBe('en');
    expect(parseListingFacts({ ...base, homeType: 'castle' }).homeType).toBe('single-family home');
  });
});

describe('templateListingCopy', () => {
  const facts = parseListingFacts({ ...base, agentName: 'Judith', openHouse: 'Sat 1–4 PM' });
  it.each(LISTING_FORMATS.flatMap((format) => [[format, 'en'], [format, 'es']] as const))('%s in %s uses only the facts and passes Fair Housing', (format, language) => {
    const text = templateListingCopy(facts, format, language);
    expect(text.length).toBeLessThanOrEqual(Math.round(LISTING_FORMAT_LIMIT[format] * 1.15));
    expect(text).toContain('Doral');
    expect(checkListingCopy(text, format).findings.filter((f) => f.severity === 'avoid')).toEqual([]);
  });
  it('writes the email with a subject line and the open house time', () => {
    const text = templateListingCopy(facts, 'email', 'en');
    expect(text).toMatch(/^Subject: Just listed in Doral — \$725,000/u);
    expect(text).toContain('Sat 1–4 PM');
    expect(text).toContain('• Heated pool');
    expect(text).toContain('a new listing in Doral:');
    expect(templateListingCopy({ ...facts, address: '77 Alder Hollow' }, 'email', 'en')).toContain('a new listing at 77 Alder Hollow, Doral:');
  });
  it('writes Spanish copy', () => {
    expect(templateListingCopy(facts, 'mls', 'es')).toMatch(/^Casa unifamiliar en Doral con 4 habitaciones/u);
  });
});

describe('listingPrompt and checkListingCopy', () => {
  it('tells the model to use only the facts and follow Fair Housing', () => {
    const prompt = listingPrompt(parseListingFacts(base), 'instagram', 'es');
    expect(prompt.system).toMatch(/ONLY the facts/u);
    expect(prompt.system).toMatch(/Fair Housing/u);
    expect(prompt.system).toMatch(/Spanish/u);
    expect(JSON.parse(prompt.user).facts.city).toBe('Doral');
  });
  it('strips markdown and trims overlong output on a word boundary', () => {
    const checked = checkListingCopy(`## Title\n**Big** home ${'word '.repeat(400)}`, 'open-house');
    expect(checked.text.startsWith('Title\nBig home')).toBe(true);
    expect(checked.text.endsWith('…')).toBe(true);
    expect(checked.text.length).toBeLessThanOrEqual(Math.round(320 * 1.15) + 1);
  });
  it('keeps hashtags, even at the start of a line', () => {
    expect(checkListingCopy('Just listed\n\n#justlisted #realestate #Doral', 'instagram').text).toBe('Just listed\n\n#justlisted #realestate #Doral');
    expect(templateListingCopy(parseListingFacts(base), 'instagram', 'en')).toMatch(/\n#justlisted #realestate #Doral$/u);
  });
  it('flags discriminatory wording in model output', () => {
    expect(checkListingCopy('Adults only community near the park.', 'mls').findings.some((f) => f.severity === 'avoid')).toBe(true);
  });
});
