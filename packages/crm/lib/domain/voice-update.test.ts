import { describe, expect, it } from 'vitest';
import type { Contact } from './contact.ts';
import { extractVoiceUpdate, parseAmount, voiceUpdatePatch } from './voice-update.ts';

const ana: Contact = {
  id: 'c1', firstName: 'Ana', lastName: 'Silva', leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'website',
  pipelineStage: 'contacted', tags: [], createdAt: '2026-09-01T00:00:00.000Z', buyer: { priceMax: 400_000, areas: ['Miami'] },
};
const today = '2026-09-24';

function fields(text: string, contact: Contact = ana) {
  return Object.fromEntries(extractVoiceUpdate(text, contact, today).changes.map((change) => [change.field, change.after]));
}

describe('voice update', () => {
  it('reads money the way realtors say it', () => {
    expect(parseAmount('450k')).toBe(450_000);
    expect(parseAmount('$1.2m')).toBe(1_200_000);
    expect(parseAmount('450,000')).toBe(450_000);
    expect(parseAmount('500 mil')).toBe(500_000);
    expect(parseAmount('450')).toBe(450_000);
    expect(parseAmount('3')).toBeUndefined();
  });

  it('turns a spoken buyer update into reviewable changes', () => {
    expect(fields("Just talked to Ana. She's pre-approved with Chase for 450k, wants 3 beds 2 baths in Coral Gables or Coconut Grove, single family. Ready to make an offer. Call her Friday.")).toEqual({
      priceMax: '$450k', beds: '3+', baths: '2+', areas: 'Miami, Coral Gables, Coconut Grove', preApproved: 'Yes', lender: 'Chase',
      desiredPropertyType: 'Single Family', leadType: 'hot', nextTouchAt: 'Fri, Sep 25', talked: 'Log as talked today',
    });
  });

  it('understands ranges, financing and timelines', () => {
    expect(fields('Between 350 and 450k, condo, FHA, within 3 months. Follow up next week.')).toEqual({
      priceMin: '$350k', priceMax: '$450k', mortgageType: 'FHA', desiredPropertyType: 'Condo', buyerTimeline: 'within 3 months', nextTouchAt: 'Mon, Sep 28',
    });
  });

  it('understands Portuguese and Spanish', () => {
    expect(fields('Falei com a Ana, orçamento até 500 mil, 3 quartos em Doral. Ligar amanhã.')).toMatchObject({ priceMax: '$500k', beds: '3+', areas: 'Miami, Doral', nextTouchAt: 'Fri, Sep 25' });
    expect(fields('Presupuesto hasta 600k, 4 habitaciones en Kendall.')).toMatchObject({ priceMax: '$600k', beds: '4+', areas: 'Miami, Kendall' });
  });

  it('handles sellers without touching buyer criteria', () => {
    expect(fields('They want to sell 1234 Palm Ave and list it for 650k by spring, not in a hurry.')).toEqual({
      sellerTimeline: 'by spring', targetPrice: '$650k', propertyAddress: '1234 Palm Ave', intent: 'both', leadType: 'nurture',
    });
  });

  it('does not confuse a follow-up delay with a move timeline', () => {
    expect(fields('Met at open house, not pre-approved yet, needs a lender. Check back in 2 weeks.')).toEqual({
      preApproved: 'Not yet', nextTouchAt: 'Thu, Oct 8', talked: 'Log as talked today',
    });
  });

  it('builds a patch from only the kept changes', () => {
    const preview = extractVoiceUpdate('Pre-approved for 450k, wants 3 beds in Doral. Call her Friday.', ana, today);
    const kept = preview.changes.filter((change) => change.field !== 'areas');
    const result = voiceUpdatePatch(ana, kept);
    expect(result.patch.buyer).toEqual({ priceMax: 450_000, areas: ['Miami'], beds: 3, preApproved: true });
    expect(result.nextTouchAt).toBe('2026-09-25');
    expect(result.talked).toBe(false);
  });
});
