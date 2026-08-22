/**
 * Seed data.
 *
 * Generated relative to "today" so the triage view is always populated and every
 * bucket is exercised — including the dormant case that must NOT appear.
 *
 * Sources mirror her real channels (cold calling, open houses, referrals, social
 * media). Notes are written the way an agent actually writes them: the detail
 * that makes the next conversation easy.
 */

import type { Contact, Note } from '../domain/contact.ts';
import { addDays, formatDateOnly, toDateOnly } from '../domain/dates.ts';

interface SeedSpec {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  leadType: Contact['leadType'];
  relationship: Contact['relationship'];
  intent: Contact['intent'];
  source: Contact['source'];
  pipelineStage: Contact['pipelineStage'];
  /** Days ago the record was created. */
  createdDaysAgo: number;
  /** Days ago of the last conversation. Omit for never-contacted. */
  lastContactedDaysAgo?: number;
  /** Offset for the next touch: negative = overdue, 0 = today. */
  nextTouchInDays?: number;
  /** Month/day for birthday, offset in days from today. */
  birthdayInDays?: number;
  /** Homeaversary offset in days from today; years ago sets the ordinal. */
  homeaversaryInDays?: number;
  homeaversaryYearsAgo?: number;
  buyer?: Contact['buyer'];
  seller?: Contact['seller'];
  tags?: string[];
  notes?: string[];
}

const SPECS: SeedSpec[] = [
  {
    id: 'c-monroe',
    firstName: 'Alicia',
    lastName: 'Monroe',
    phone: '(512) 555-0142',
    email: 'alicia.monroe@example.com',
    city: 'Round Rock',
    state: 'TX',
    leadType: 'hot',
    relationship: 'lead',
    intent: 'buyer',
    source: 'open-house',
    pipelineStage: 'new',
    createdDaysAgo: 3,
    buyer: {
      priceMin: 420_000,
      priceMax: 510_000,
      areas: ['Round Rock', 'Pflugerville'],
      beds: 3,
      timeline: 'wants to be in before the school year',
      preApproved: false,
    },
    tags: ['open-house-oct'],
    notes: ['Signed in at the Willow Creek open house. Relocating from Denver, husband starts a new job in six weeks. Not pre-approved yet — needs a lender intro.'],
  },
  {
    id: 'c-okafor',
    firstName: 'Daniel',
    lastName: 'Okafor',
    phone: '(512) 555-0198',
    email: 'd.okafor@example.com',
    leadType: 'hot',
    relationship: 'lead',
    intent: 'seller',
    source: 'social-media',
    pipelineStage: 'new',
    createdDaysAgo: 6,
    seller: {
      propertyAddress: '1408 Bracken Ridge Dr',
      targetPrice: 675_000,
      timeline: 'listing in the spring',
      motivation: 'downsizing now the kids have moved out',
    },
    notes: ['DM on Instagram asking what his place is worth. Wants a CMA. Has not spoken to another agent yet.'],
  },
  {
    id: 'c-reyes',
    firstName: 'Marisol',
    lastName: 'Reyes',
    phone: '(512) 555-0233',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'buyer',
    source: 'cold-call',
    pipelineStage: 'new',
    createdDaysAgo: 1,
    buyer: { priceMax: 380_000, timeline: 'sometime next year', preApproved: false },
    notes: ['Answered the call, was polite but busy. Said to try again in a couple of weeks.'],
  },
  {
    id: 'c-whitfield',
    firstName: 'Gregory',
    lastName: 'Whitfield',
    preferredName: 'Greg',
    phone: '(512) 555-0311',
    email: 'greg.whitfield@example.com',
    leadType: 'hot',
    relationship: 'active-client',
    intent: 'buyer',
    source: 'referral',
    pipelineStage: 'active',
    createdDaysAgo: 74,
    lastContactedDaysAgo: 19,
    nextTouchInDays: -12,
    buyer: {
      priceMin: 550_000,
      priceMax: 640_000,
      areas: ['Cedar Park', 'Leander'],
      beds: 4,
      timeline: 'actively touring',
      preApproved: true,
      lender: 'Summit Mortgage — Dana Pryor',
    },
    tags: ['pre-approved'],
    notes: [
      'Referred by the Hendersons. Pre-approved to 640k with Summit.',
      'Toured three in Cedar Park. Loved the Foxglove listing, hated the road noise. Wants a cul-de-sac.',
    ],
  },
  {
    id: 'c-baptiste',
    firstName: 'Nadine',
    lastName: 'Baptiste',
    phone: '(512) 555-0377',
    email: 'nadine.b@example.com',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'both',
    source: 'referral',
    pipelineStage: 'contacted',
    createdDaysAgo: 51,
    lastContactedDaysAgo: 11,
    nextTouchInDays: -4,
    notes: ['Needs to sell before she can buy. Worried about carrying two mortgages — walk her through a bridge scenario.'],
  },
  {
    id: 'c-hollings',
    firstName: 'Ruth',
    lastName: 'Hollings',
    phone: '(512) 555-0420',
    email: 'ruthholl@example.com',
    leadType: 'nurture',
    relationship: 'sphere',
    intent: 'unknown',
    source: 'referral',
    pipelineStage: 'contacted',
    createdDaysAgo: 400,
    lastContactedDaysAgo: 50,
    nextTouchInDays: -20,
    birthdayInDays: 3,
    tags: ['book-club'],
    notes: ['Not moving, but knows everyone in the neighbourhood. Sent two referrals in 2025.'],
  },
  {
    id: 'c-ferraro',
    firstName: 'Luca',
    lastName: 'Ferraro',
    phone: '(512) 555-0455',
    email: 'luca.ferraro@example.com',
    leadType: 'hot',
    relationship: 'active-client',
    intent: 'buyer',
    source: 'website',
    pipelineStage: 'under-contract',
    createdDaysAgo: 88,
    lastContactedDaysAgo: 7,
    nextTouchInDays: 0,
    buyer: { priceMax: 495_000, timeline: 'closing in three weeks', preApproved: true },
    tags: ['under-contract'],
    notes: ['Option period ends Friday. Inspection flagged the water heater — negotiating a credit.'],
  },
  {
    id: 'c-abernathy',
    firstName: 'Joyce',
    lastName: 'Abernathy',
    phone: '(512) 555-0512',
    leadType: 'nurture',
    relationship: 'past-client',
    intent: 'unknown',
    source: 'open-house',
    pipelineStage: 'contacted',
    createdDaysAgo: 1_180,
    lastContactedDaysAgo: 30,
    nextTouchInDays: 0,
    homeaversaryInDays: 11,
    homeaversaryYearsAgo: 3,
    notes: ['Bought the Marbury Lane place in 2023. Mentioned a kitchen remodel — good excuse to check in.'],
  },
  {
    id: 'c-nakamura',
    firstName: 'Kenji',
    lastName: 'Nakamura',
    phone: '(512) 555-0588',
    email: 'k.nakamura@example.com',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'investor',
    source: 'social-media',
    pipelineStage: 'appointment-set',
    createdDaysAgo: 40,
    lastContactedDaysAgo: 4,
    nextTouchInDays: 3,
    buyer: { priceMax: 320_000, areas: ['East Austin'], timeline: 'buying two this year' },
    notes: ['Looking for duplexes under 320k. Cash for the first one. Coffee Thursday 9am.'],
  },
  {
    id: 'c-delacroix',
    firstName: 'Simone',
    lastName: 'Delacroix',
    phone: '(512) 555-0604',
    email: 'simone.d@example.com',
    leadType: 'hot',
    relationship: 'lead',
    intent: 'seller',
    source: 'mailer',
    pipelineStage: 'contacted',
    createdDaysAgo: 22,
    lastContactedDaysAgo: 1,
    nextTouchInDays: 6,
    seller: { propertyAddress: '77 Alder Hollow', timeline: 'undecided', motivation: 'job transfer to Phoenix, not yet confirmed' },
    notes: ['Responded to the Alder Hollow postcard. Transfer is not confirmed — do not push, just stay close.'],
  },
  {
    id: 'c-pryor',
    firstName: 'Marcus',
    lastName: 'Pryor',
    phone: '(512) 555-0671',
    leadType: 'nurture',
    relationship: 'past-client',
    intent: 'unknown',
    source: 'referral',
    pipelineStage: 'closed',
    createdDaysAgo: 900,
    lastContactedDaysAgo: 120,
    notes: ['Closed and quiet. Deliberately dormant — should not appear in triage.'],
  },
];

function isoAgo(now: Date, days: number): string {
  return addDays(toDateOnly(now), -days).toISOString();
}

export function seedContacts(now: Date = new Date()): Contact[] {
  const today = toDateOnly(now);

  return SPECS.map((spec) => {
    const birthdate =
      spec.birthdayInDays === undefined
        ? undefined
        : formatDateOnly(
            new Date(
              Date.UTC(
                1979,
                addDays(today, spec.birthdayInDays).getUTCMonth(),
                addDays(today, spec.birthdayInDays).getUTCDate(),
              ),
            ),
          );

    const homePurchaseDate =
      spec.homeaversaryInDays === undefined
        ? undefined
        : formatDateOnly(
            new Date(
              Date.UTC(
                today.getUTCFullYear() - (spec.homeaversaryYearsAgo ?? 1),
                addDays(today, spec.homeaversaryInDays).getUTCMonth(),
                addDays(today, spec.homeaversaryInDays).getUTCDate(),
              ),
            ),
          );

    return {
      id: spec.id,
      firstName: spec.firstName,
      lastName: spec.lastName,
      preferredName: spec.preferredName,
      phone: spec.phone,
      email: spec.email,
      city: spec.city,
      state: spec.state,
      birthdate,
      homePurchaseDate,
      leadType: spec.leadType,
      relationship: spec.relationship,
      intent: spec.intent,
      source: spec.source,
      pipelineStage: spec.pipelineStage,
      buyer: spec.buyer,
      seller: spec.seller,
      lastContactedAt:
        spec.lastContactedDaysAgo === undefined ? undefined : isoAgo(now, spec.lastContactedDaysAgo),
      nextTouchAt:
        spec.nextTouchInDays === undefined
          ? undefined
          : formatDateOnly(addDays(today, spec.nextTouchInDays)),
      tags: spec.tags ?? [],
      createdAt: isoAgo(now, spec.createdDaysAgo),
      emailSubscribed: true,
    } satisfies Contact;
  });
}

export function seedNotes(now: Date = new Date()): Note[] {
  const notes: Note[] = [];
  SPECS.forEach((spec) => {
    (spec.notes ?? []).forEach((body, index) => {
      notes.push({
        id: `${spec.id}-n${index}`,
        contactId: spec.id,
        body,
        createdAt: isoAgo(now, Math.max(0, spec.createdDaysAgo - index * 7)),
      });
    });
  });
  return notes;
}
