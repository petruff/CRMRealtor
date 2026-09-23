import { anniversaryOrdinal, daysUntilAnniversary } from '../domain/dates.ts';
import { displayName, initials, type Contact } from '../domain/contact.ts';

/**
 * Referral engine: the past clients and sphere who send a realtor most of her
 * business, the personal moments worth a message, and a ready-to-send draft for
 * each (English and Spanish). Drafts are personal 1:1 notes the realtor sends
 * from her own phone or inbox — never bulk marketing.
 */

export type SphereMomentKind = 'homeaversary' | 'birthday' | 'check-in';
export type DraftLanguage = 'en' | 'es';

export interface MessageDraft {
  readonly sms: string;
  readonly emailSubject: string;
  readonly emailBody: string;
}

export interface SphereMoment {
  readonly id: string;
  readonly kind: SphereMomentKind;
  readonly contactId: string;
  readonly name: string;
  readonly firstName: string;
  readonly initials: string;
  readonly relationship: Contact['relationship'];
  readonly leadType: Contact['leadType'];
  readonly phone?: string;
  readonly email?: string;
  /** Days until the moment (0 = today); for check-ins, days since last touch. */
  readonly days: number;
  readonly label: string;
  readonly drafts: Readonly<Record<DraftLanguage, MessageDraft>>;
}

export interface Referrer {
  readonly contactId: string;
  readonly name: string;
  readonly initials: string;
  readonly referrals: number;
  readonly referredNames: readonly string[];
  readonly drafts: Readonly<Record<DraftLanguage, MessageDraft>>;
}

export interface SpherePulse {
  readonly size: number;
  readonly touchedRecently: number;
  readonly touchedShare: number;
  readonly referralsReceived: number;
}

export interface ReferralEngine {
  readonly pulse: SpherePulse;
  readonly moments: readonly SphereMoment[];
  readonly checkIns: readonly SphereMoment[];
  readonly referrers: readonly Referrer[];
}

const DAY_MS = 86_400_000;
const QUIET_DAYS = 90;
const MOMENT_HORIZON = 30;

export function isSphere(contact: Contact): boolean {
  return !contact.archivedAt && (contact.relationship === 'past-client' || contact.relationship === 'sphere');
}

function firstName(contact: Contact): string {
  return (contact.preferredName ?? contact.firstName).trim() || 'there';
}

function ordinalEn(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th'}`;
}

function sign(agent?: string): string {
  return agent ? `\n\n${agent}` : '';
}

export function draftMessage(kind: SphereMomentKind | 'thank-you', contact: Contact, language: DraftLanguage, options: { agentName?: string; years?: number; referredNames?: readonly string[] } = {}): MessageDraft {
  const name = firstName(contact);
  const agent = options.agentName?.trim();
  const years = options.years ?? 1;
  const referred = options.referredNames?.[0];
  if (language === 'es') {
    switch (kind) {
      case 'homeaversary': return {
        sms: `¡Hola ${name}! Hoy se cumple${years === 1 ? '' : 'n'} ${years} ${years === 1 ? 'año' : 'años'} en su casa. 🏡 Espero que la estén disfrutando mucho. Si conocen a alguien que piense comprar o vender, me encantaría ayudarle como les ayudé a ustedes.`,
        emailSubject: `¡Feliz aniversario en su hogar, ${name}!`,
        emailBody: `Hola ${name}:\n\nHoy se cumple${years === 1 ? '' : 'n'} ${years} ${years === 1 ? 'año' : 'años'} desde que recibieron las llaves. Fue un gusto acompañarles en ese momento.\n\nSi quieren saber cuánto vale su casa hoy, con gusto les preparo un análisis sin compromiso. Y si alguien cercano piensa comprar o vender, me encantaría ayudarle.${sign(agent)}`,
      };
      case 'birthday': return {
        sms: `¡Feliz cumpleaños, ${name}! 🎉 Que tengas un día maravilloso.`,
        emailSubject: `¡Feliz cumpleaños, ${name}!`,
        emailBody: `Hola ${name}:\n\nSolo quería desearte un muy feliz cumpleaños. ¡Que este año venga lleno de cosas buenas!${sign(agent)}`,
      };
      case 'check-in': return {
        sms: `Hola ${name}, ¡hace tiempo que no hablamos! ¿Cómo va todo con la casa? Si te interesa saber cómo está el mercado en tu zona, con gusto te envío un resumen.`,
        emailSubject: `¿Cómo va todo, ${name}?`,
        emailBody: `Hola ${name}:\n\nPensaba en ti y quería saludarte. Si te interesa saber cómo están los precios en tu vecindario, puedo enviarte un resumen rápido.\n\nY si alguien que conoces está pensando en comprar o vender, con gusto le ayudaré.${sign(agent)}`,
      };
      case 'thank-you': return {
        sms: `${name}, ¡mil gracias por recomendarme${referred ? ` a ${referred}` : ''}! Significa mucho para mí. Te mantendré al tanto.`,
        emailSubject: `Gracias, ${name}`,
        emailBody: `Hola ${name}:\n\nGracias de corazón por recomendarme${referred ? ` a ${referred}` : ''}. Tu confianza es el mayor cumplido que puedo recibir, y cuidaré muy bien de ${referred ? 'esa relación' : 'cada recomendación'}.${sign(agent)}`,
      };
    }
  }
  switch (kind) {
    case 'homeaversary': return {
      sms: `Hi ${name}! Happy ${ordinalEn(years)} home anniversary 🏡 Hope you're loving it. If anyone you know is thinking of buying or selling, I'd love to help them the way I helped you.`,
      emailSubject: `Happy ${ordinalEn(years)} home anniversary, ${name}!`,
      emailBody: `Hi ${name},\n\nIt's been ${years} ${years === 1 ? 'year' : 'years'} since you got the keys — congratulations! It was a joy to be part of that day.\n\nIf you're ever curious what your home is worth today, I'm happy to put together a quick, no-pressure value update. And if someone close to you is thinking about buying or selling, I'd love to help.${sign(agent)}`,
    };
    case 'birthday': return {
      sms: `Happy birthday, ${name}! 🎉 Hope it's a great one.`,
      emailSubject: `Happy birthday, ${name}!`,
      emailBody: `Hi ${name},\n\nJust wanted to wish you a very happy birthday. Here's to a wonderful year ahead!${sign(agent)}`,
    };
    case 'check-in': return {
      sms: `Hi ${name}, it's been a while! How's everything with the house? Happy to send a quick update on what homes near you are selling for, if you're curious.`,
      emailSubject: `How's everything, ${name}?`,
      emailBody: `Hi ${name},\n\nYou crossed my mind and I wanted to say hello. If you'd like a quick snapshot of what homes in your neighborhood are selling for, just reply and I'll send one over.\n\nAnd if anyone you know is thinking about a move, I'd be honored to help.${sign(agent)}`,
    };
    case 'thank-you': return {
      sms: `${name}, thank you so much for referring ${referred ?? 'a friend'} to me! It means the world. I'll take great care of them.`,
      emailSubject: `Thank you, ${name}`,
      emailBody: `Hi ${name},\n\nThank you for referring ${referred ?? 'someone you care about'} to me. A referral is the highest compliment I can receive, and I'll take great care of ${referred ? 'them' : 'every introduction'}.${sign(agent)}`,
    };
  }
}

function both(kind: SphereMomentKind | 'thank-you', contact: Contact, options: Parameters<typeof draftMessage>[3]): Record<DraftLanguage, MessageDraft> {
  return { en: draftMessage(kind, contact, 'en', options), es: draftMessage(kind, contact, 'es', options) };
}

function inPhrase(days: number): string {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

function base(contact: Contact) {
  return {
    contactId: contact.id, name: displayName(contact), firstName: firstName(contact), initials: initials(contact),
    relationship: contact.relationship, leadType: contact.leadType,
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(contact.email ? { email: contact.email } : {}),
  };
}

export function buildReferralEngine(contacts: readonly Contact[], now: Date, agentName?: string): ReferralEngine {
  const sphere = contacts.filter(isSphere);
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const quietSince = (contact: Contact) => contact.lastContactedAt ? Math.floor((now.getTime() - Date.parse(contact.lastContactedAt)) / DAY_MS) : Number.POSITIVE_INFINITY;

  const moments: SphereMoment[] = [];
  for (const contact of sphere) {
    if (contact.homePurchaseDate) {
      const days = daysUntilAnniversary(contact.homePurchaseDate, now);
      const years = anniversaryOrdinal(contact.homePurchaseDate, now);
      if (days <= MOMENT_HORIZON && years >= 1) {
        moments.push({ ...base(contact), id: `homeaversary:${contact.id}`, kind: 'homeaversary', days, label: `${ordinalEn(years)} home anniversary ${inPhrase(days)}`, drafts: both('homeaversary', contact, { agentName, years }) });
      }
    }
    if (contact.birthdate) {
      const days = daysUntilAnniversary(contact.birthdate, now);
      if (days <= MOMENT_HORIZON) {
        moments.push({ ...base(contact), id: `birthday:${contact.id}`, kind: 'birthday', days, label: `Birthday ${inPhrase(days)}`, drafts: both('birthday', contact, { agentName }) });
      }
    }
  }
  moments.sort((left, right) => left.days - right.days || left.name.localeCompare(right.name));

  const withMoment = new Set(moments.map((moment) => moment.contactId));
  const checkIns = sphere
    .filter((contact) => contact.relationship === 'past-client' && !withMoment.has(contact.id) && quietSince(contact) >= QUIET_DAYS)
    .sort((left, right) => quietSince(right) - quietSince(left) || displayName(left).localeCompare(displayName(right)))
    .slice(0, 12)
    .map((contact): SphereMoment => {
      const days = quietSince(contact);
      return {
        ...base(contact), id: `check-in:${contact.id}`, kind: 'check-in', days: Number.isFinite(days) ? days : -1,
        label: Number.isFinite(days) ? `Quiet for ${Math.floor(days / 30)} months` : 'No conversation logged yet',
        drafts: both('check-in', contact, { agentName }),
      };
    });

  const referralsBy = new Map<string, Contact[]>();
  for (const contact of contacts) {
    if (!contact.referredById || contact.archivedAt) continue;
    const referrer = byId.get(contact.referredById);
    if (!referrer || referrer.archivedAt) continue;
    referralsBy.set(referrer.id, [...(referralsBy.get(referrer.id) ?? []), contact]);
  }
  const referrers = [...referralsBy.entries()]
    .map(([referrerId, referred]): Referrer => {
      const referrer = byId.get(referrerId) as Contact;
      const referredNames = referred.map((person) => (person.preferredName ?? person.firstName).trim()).filter(Boolean);
      return {
        contactId: referrerId, name: displayName(referrer), initials: initials(referrer), referrals: referred.length, referredNames,
        drafts: both('thank-you', referrer, { agentName, referredNames }),
      };
    })
    .sort((left, right) => right.referrals - left.referrals || left.name.localeCompare(right.name))
    .slice(0, 5);

  const touchedRecently = sphere.filter((contact) => quietSince(contact) < QUIET_DAYS).length;
  return {
    pulse: {
      size: sphere.length,
      touchedRecently,
      touchedShare: sphere.length ? Math.round((touchedRecently / sphere.length) * 100) : 0,
      referralsReceived: [...referralsBy.values()].reduce((sum, list) => sum + list.length, 0),
    },
    moments,
    checkIns,
    referrers,
  };
}

/** One-tap links for a personal message from the realtor's own phone or inbox. */
export function smsHref(phone: string | undefined, body: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, '');
  return digits ? `sms:${digits}?&body=${encodeURIComponent(body)}` : undefined;
}

export function mailtoHref(email: string | undefined, subject: string, body: string): string | undefined {
  if (!email) return undefined;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
