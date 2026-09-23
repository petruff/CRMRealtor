import { describe, expect, it } from 'vitest';
import { ClientPortalError, isPortalToken, linkIsActive, parsePortalSnapshot, portalExpiry, portalView, validateAudienceLabel, type ClientPortalSnapshot } from './client-portal.ts';

const NOW = new Date('2026-09-23T15:00:00.000Z');
const snapshot = (patch: Partial<ClientPortalSnapshot> = {}): ClientPortalSnapshot => ({
  audience: 'Linh', agentName: 'Paula Reyes', propertyAddress: '1408 Bayshore Dr, Tampa, FL', status: 'under-contract', side: 'buyer',
  expectedCloseDate: '2026-10-16', expiresAt: '2026-11-22T15:00:00.000Z',
  milestones: [
    { kind: 'inspection', label: 'Inspection period ends', dueAt: '2026-09-20T21:00:00.000Z', state: 'completed', timezone: 'America/New_York' },
    { kind: 'appraisal', label: 'Appraisal', dueAt: '2026-09-30T21:00:00.000Z', state: 'open', timezone: 'America/New_York' },
    { kind: 'flood', label: 'Flood insurance quote', dueAt: '2026-10-02T21:00:00.000Z', state: 'waived', timezone: 'America/New_York' },
  ],
  ...patch,
});

describe('client portal domain', () => {
  it('accepts only 256-bit base64url tokens', () => {
    expect(isPortalToken('a'.repeat(43))).toBe(true);
    expect(isPortalToken('a'.repeat(42))).toBe(false);
    expect(isPortalToken(`${'a'.repeat(42)}/`)).toBe(false);
  });

  it('validates audience and expiry choices', () => {
    expect(validateAudienceLabel('  Linh   Nguyen ')).toBe('Linh Nguyen');
    expect(() => validateAudienceLabel('')).toThrow(ClientPortalError);
    expect(portalExpiry('30', NOW)).toBe('2026-10-23T15:00:00.000Z');
    expect(() => portalExpiry('365', NOW)).toThrow(ClientPortalError);
    expect(linkIsActive({ expiresAt: '2026-09-24T00:00:00.000Z' }, NOW)).toBe(true);
    expect(linkIsActive({ expiresAt: '2026-09-24T00:00:00.000Z', revokedAt: '2026-09-22T00:00:00.000Z' }, NOW)).toBe(false);
    expect(linkIsActive({ expiresAt: '2026-09-22T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('parses only allowlisted fields from the RPC payload', () => {
    const parsed = parsePortalSnapshot({ ...snapshot(), grossCommissionCents: 1455000, title: 'Internal name', milestones: [{ label: 'x', dueAt: 'y', state: 'cancelled' }] });
    expect(parsed).not.toHaveProperty('grossCommissionCents');
    expect(parsed).not.toHaveProperty('title');
    expect(parsed?.milestones).toEqual([]);
    expect(parsePortalSnapshot(null)).toBeUndefined();
    expect(parsePortalSnapshot({ ...snapshot(), status: 'lost' })).toBeUndefined();
  });

  it('tells the story: countdown, next step and a closing day at the end', () => {
    const view = portalView(snapshot(), NOW);
    expect(view.headline).toBe('Under contract');
    expect(view.subline).toBe('Closing Fri, Oct 16');
    expect(view.daysToClose).toBe(23);
    expect(view.next?.label).toBe('Appraisal');
    expect(portalView(snapshot({ expectedCloseDate: '2026-09-23' }), NOW)).toMatchObject({ subline: 'Closing is today' });
    expect(portalView(snapshot({ expectedCloseDate: '2026-09-23' }), NOW).daysToClose).toBeUndefined();
    expect(view.steps.map((step) => [step.label, step.state])).toEqual([
      ['Inspection period ends', 'done'], ['Appraisal', 'current'], ['Flood insurance quote', 'skipped'], ['Closing day', 'upcoming'],
    ]);
  });

  it('celebrates a closed deal and speaks to sellers in their terms', () => {
    expect(portalView(snapshot({ status: 'closed', closedAt: '2026-10-16' }), NOW).headline).toBe('Welcome home — congratulations!');
    expect(portalView(snapshot({ status: 'closed', side: 'seller', closedAt: '2026-10-16' }), NOW).headline).toBe('Sold — congratulations!');
    expect(portalView(snapshot({ status: 'pending', side: 'seller', milestones: [], expectedCloseDate: undefined }), NOW)).toMatchObject({
      headline: 'Getting your home ready to sell', subline: 'Here is where everything stands.',
    });
  });
});
