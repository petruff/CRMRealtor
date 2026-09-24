import type { Contact } from './contact.ts';
import type { QuickTextKind, QuickTextLanguage } from './quick-texts.ts';
import { interpretSegmentQuestion, segmentQuery } from './omnix-segment.ts';

/**
 * Plain-language understanding for the Omnix assistant (English, Spanish and
 * Portuguese). It turns everyday wording into either a canonical read-only
 * copilot query or an action preview. Nothing here reads or writes data.
 */
export type RecapWindow = 'today' | 'yesterday' | 'week' | 'month';

export type OmnixActionRequest =
  | Readonly<{ type: 'draft-text'; kind: QuickTextKind; language: QuickTextLanguage }>
  | Readonly<{ type: 'create-task'; verb: 'call' | 'text' | 'email' | 'follow-up' | 'meet'; due: OmnixDueSpec; detail?: string }>
  | Readonly<{ type: 'log-note'; body: string }>;

export type OmnixDueSpec = Readonly<{ days: number; weekday?: number; hour?: number; minute?: number }>;

export type OmnixUnderstanding =
  | Readonly<{ kind: 'query'; query: string }>
  | Readonly<{ kind: 'action'; action: OmnixActionRequest }>;

export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase()
    .replace(/[?!¿¡'’"“”]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

const PRONOUN = /\b(?:she|he|her|him|his|them|their|they|this client|this contact|this person|ela|ele|dela|dele|esse cliente|essa cliente|este cliente|esta cliente|ella|el|su|sus)\b/u;

export function mentionsSelectedContact(question: string): boolean {
  return PRONOUN.test(foldText(question));
}

function looksSpanish(folded: string): boolean {
  return /\b(?:en espanol|in spanish|em espanhol|mensaje|escribe|escribir|mandale|enviale|hola|que|para el|para ella|cita|llamar|manana)\b/u.test(folded)
    && !/\b(?:in english|em ingles|en ingles)\b/u.test(folded);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAYS: readonly [RegExp, number][] = [
  [/\b(?:sunday|domingo)\b/u, 0], [/\b(?:monday|segunda(?:-feira)?|lunes)\b/u, 1], [/\b(?:tuesday|terca(?:-feira)?|martes)\b/u, 2],
  [/\b(?:wednesday|quarta(?:-feira)?|miercoles)\b/u, 3], [/\b(?:thursday|quinta(?:-feira)?|jueves)\b/u, 4],
  [/\b(?:friday|sexta(?:-feira)?|viernes)\b/u, 5], [/\b(?:saturday|sabado)\b/u, 6],
];

export function parseDueSpec(folded: string): OmnixDueSpec {
  let hour: number | undefined; let minute: number | undefined;
  const time = /\b(?:at|as|a las|a la)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m|p\.m|h)?\b/u.exec(folded) ?? /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/u.exec(folded);
  if (time?.[1]) {
    hour = Number(time[1]) % 24; minute = time[2] ? Number(time[2]) : 0;
    if (time[3]?.startsWith('p') && hour < 12) hour += 12;
    if (time[3]?.startsWith('a') && hour === 12) hour = 0;
    if (!time[3] && hour >= 1 && hour <= 7) hour += 12; // "at 3" means the afternoon for a realtor
  }
  const withTime = (spec: OmnixDueSpec): OmnixDueSpec => (hour === undefined ? spec : { ...spec, hour, minute: minute ?? 0 });
  if (/\b(?:today|tonight|hoje|hoy|esta noche|hoje a noite)\b/u.test(folded)) return withTime({ days: 0 });
  if (/\b(?:day after tomorrow|depois de amanha|pasado manana)\b/u.test(folded)) return withTime({ days: 2 });
  if (/\b(?:tomorrow|amanha|manana)\b/u.test(folded)) return withTime({ days: 1 });
  const inDays = /\b(?:in|em|en|daqui a|dentro de)\s+(\d{1,3}|a|one|two|three|um|uma|dois|tres|un|una|dos)\s+(days?|dias?|weeks?|semanas?)\b/u.exec(folded);
  if (inDays?.[1] && inDays[2]) {
    const words: Record<string, number> = { a: 1, one: 1, um: 1, uma: 1, un: 1, una: 1, two: 2, dois: 2, dos: 2, three: 3, tres: 3 };
    const count = words[inDays[1]] ?? Number(inDays[1]);
    return withTime({ days: Math.min(365, count * (/^(?:weeks?|semanas?)$/u.test(inDays[2]) ? 7 : 1)) });
  }
  if (/\b(?:next week|semana que vem|proxima semana|la proxima semana|la semana que viene)\b/u.test(folded)) return withTime({ days: 7, weekday: 1 });
  for (const [pattern, weekday] of WEEKDAYS) if (pattern.test(folded)) return withTime({ days: -1, weekday });
  return withTime({ days: 1 });
}

/** Resolves a due spec to a local calendar date (YYYY-MM-DD) from `today`. */
export function dueDate(spec: OmnixDueSpec, today: string): string {
  const base = new Date(`${today}T12:00:00Z`);
  if (spec.weekday !== undefined) {
    const current = base.getUTCDay();
    let delta = (spec.weekday - current + 7) % 7;
    if (delta === 0) delta = 7;
    if (spec.days === 7 && spec.weekday === 1) delta = ((1 - current + 7) % 7) || 7;
    base.setUTCDate(base.getUTCDate() + delta);
  } else {
    base.setUTCDate(base.getUTCDate() + spec.days);
  }
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Contact mentions
// ---------------------------------------------------------------------------

export interface ContactMention {
  readonly matches: readonly Contact[];
  /** True when only first names matched (ask the realtor to pick). */
  readonly ambiguous: boolean;
}

/** Finds which stored contacts a sentence names, preferring full names. */
export function findContactMentions(question: string, contacts: readonly Contact[]): ContactMention {
  const folded = ` ${foldText(question).replace(/[,:;.]/gu, ' ')} `;
  const full: Contact[] = []; const first: Contact[] = []; const last: Contact[] = [];
  for (const contact of contacts) {
    if (contact.archivedAt) continue;
    const firstNames = [contact.firstName, contact.preferredName].filter((value): value is string => Boolean(value?.trim())).map(foldText);
    const lastName = foldText(contact.lastName ?? '');
    if (lastName && firstNames.some((name) => folded.includes(` ${name} ${lastName} `))) { full.push(contact); continue; }
    if (firstNames.some((name) => name.length >= 3 && folded.includes(` ${name} `))) first.push(contact);
    else if (lastName.length >= 4 && folded.includes(` ${lastName} `)) last.push(contact);
  }
  if (full.length) return { matches: full, ambiguous: full.length > 1 };
  if (first.length) return { matches: first.slice(0, 6), ambiguous: first.length > 1 };
  return { matches: last.slice(0, 6), ambiguous: last.length > 1 };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const NAME = '([\\p{L}][\\p{L} .\'-]{1,60}?)';

function namedQuery(question: string): string | undefined {
  const text = question.trim().replace(/[?!.]+$/u, '').replace(/^(?:hey |hi |ok |okay |omnix,? )/iu, '');
  const patterns: readonly [RegExp, 'profile' | 'status'][] = [
    [new RegExp(`^(?:tell me (?:about|more about)|what do (?:i|we) know about|who is|who's|details (?:for|on|about)|info(?:rmation)? (?:on|about|for)|look up|pull up|open|fale (?:sobre|de)|me fale (?:sobre|de)|quem [eé]|o que (?:eu )?sei sobre|detalhes (?:de|do|da|sobre)|h[aá]blame de|qui[eé]n es|qu[eé] s[eé] de|informaci[oó]n de|detalles de) ${NAME}$`, 'iu'), 'profile'],
    [new RegExp(`^(?:what(?:'s| is) )?${NAME}(?:'s|’s) (?:phone(?: number)?|number|cell|email|e-mail|address|birthday|info|details|contact info)$`, 'iu'), 'profile'],
    [new RegExp(`^(?:what(?:'s| is) the )?(?:phone(?: number)?|number|cell|email|e-mail|address|birthday) (?:for|of) ${NAME}$`, 'iu'), 'profile'],
    [new RegExp(`^(?:qual (?:[eé] )?o )?(?:telefone|celular|e-?mail|endere[cç]o|anivers[aá]rio|n[uú]mero) (?:do|da|de) ${NAME}$`, 'iu'), 'profile'],
    [new RegExp(`^(?:cu[aá]l es (?:el|la) )?(?:tel[eé]fono|celular|correo|e-?mail|direcci[oó]n|cumplea[nñ]os|n[uú]mero) de ${NAME}$`, 'iu'), 'profile'],
    [new RegExp(`^(?:when did (?:i|we) last (?:talk|speak|meet|connect) (?:to|with)|last time (?:i|we) (?:talked|spoke) (?:to|with)|when was (?:my|the) last (?:call|conversation|contact) with|quando (?:eu )?falei (?:por [uú]ltimo |pela [uú]ltima vez )?com|[uú]ltima vez que falei com|cu[aá]ndo habl[eé] (?:por [uú]ltima vez )?con|[uú]ltima vez que habl[eé] con) ${NAME}$`, 'iu'), 'profile'],
    [new RegExp(`^(?:how(?:'s| is) ${NAME} doing|update on ${NAME}|where (?:are we|am i|do we stand) with ${NAME}|what(?:'s| is) (?:going on|happening|next) with ${NAME}|como (?:est[aá]|anda) (?:o |a )?${NAME}|novidades (?:de|do|da|sobre) ${NAME}|c[oó]mo va ${NAME}|qu[eé] hay de ${NAME})$`, 'iu'), 'status'],
  ];
  for (const [pattern, kind] of patterns) {
    const match = pattern.exec(text);
    const name = match?.slice(1).find(Boolean)?.trim();
    if (!name || /^(?:my|the|a|an|me|you|it|this|that|today|tomorrow|she|he|her|him|they|them|o|a|meu|minha|mi|el|la|ela|ele|ella)$/iu.test(name)) continue;
    return kind === 'profile' ? `contact profile ${name}` : `client status ${name}`;
  }
  return undefined;
}

function pronounQuery(folded: string, selectedContactId: string): string | undefined {
  if (!PRONOUN.test(folded)) return undefined;
  if (/\b(?:phone|number|email|address|birthday|details|info|know about|tell me about|who is|last (?:talk|spoke|time|call)|telefone|endereco|aniversario|sobre ela|sobre ele|quem e|ultima vez|telefono|direccion|cumpleanos|quien es|hablame)\b/u.test(folded)) {
    return `contact profile ${selectedContactId}`;
  }
  if (/\b(?:status|doing|update|next|deal|transaction|going on|como esta|como va|novidades|negocio)\b/u.test(folded)) return `client status ${selectedContactId}`;
  return undefined;
}

function recapQuery(folded: string): string | undefined {
  if (!/\b(?:what happened|what did i (?:do|get done)|recap|summar(?:y|ize|ise)|review my|o que aconteceu|resumo|resuma|resumen|resume|que paso|que hice|o que eu fiz)\b/u.test(folded)) return undefined;
  if (/\b(?:crm|workspace)\b/u.test(folded)) return undefined;
  if (/\b(?:yesterday|ontem|ayer)\b/u.test(folded)) return 'recap yesterday';
  if (/\b(?:month|mes)\b/u.test(folded)) return 'recap month';
  if (/\b(?:week|semana|weekly|semanal)\b/u.test(folded)) return 'recap week';
  if (/\b(?:today|day|hoje|dia|hoy)\b/u.test(folded)) return 'recap today';
  return undefined;
}

const SIMPLE: readonly [RegExp, string][] = [
  [/^(?:what should i do today|what are my priorities(?: today)?|who should i (?:call|contact|reach out to)(?: first| today| now)?|who do i call(?: first| today)?|what(?: s| is) on my plate(?: today)?|what do i have today|where do i start|plan my day|my day|what should i focus on(?: today)?|o que (?:eu )?(?:tenho|devo fazer) hoje|minhas prioridades(?: de hoje)?|prioridades de hoje|por onde comeco|para quem (?:devo )?ligar(?: hoje| primeiro)?|que tengo (?:para )?hoy|mis prioridades(?: de hoy)?|prioridades de hoy|a quien (?:debo )?llamar(?: hoy| primero)?|que debo hacer hoy)$/u, 'brief today'],
  [/^(?:who needs (?:my )?attention(?: today)?|quem precisa (?:de |da minha )?atencao(?: hoje)?|quien necesita (?:mi )?atencion(?: hoy)?|alertas(?: de hoje| de hoy)?)$/u, 'alerts today'],
  [/^(?:(?:show |what are |list )?(?:my )?overdue (?:tasks|follow ?ups|to ?dos)|what(?: s| is) overdue|tarefas atrasadas|pendencias atrasadas|tareas (?:vencidas|atrasadas)|que esta atrasado)$/u, 'tasks overdue'],
  [/^(?:(?:show |what are |list )?(?:my )?(?:tasks|to ?dos|follow ?ups) (?:for )?today|today s tasks|tarefas de hoje|tareas de hoy)$/u, 'tasks today'],
  [/^(?:(?:show |what are |list )?(?:my )?(?:upcoming|next) (?:tasks|follow ?ups)|proximas tarefas|proximas tareas)$/u, 'tasks upcoming'],
  [/^(?:(?:show |what are |any )?(?:my )?(?:deals|transactions|closings) (?:closing|that close|this month|soon|coming up)(?: this month| soon| this week)?|what(?: s| is) closing(?: soon| this month)?|upcoming closings|fechamentos(?: do mes)?|negocios (?:fechando|en cierre)|cierres(?: del mes)?)$/u, 'transactions'],
  [/^(?:(?:show |what(?: s| is) )?(?:my )?pipeline|(?:meu )?funil|(?:mi )?embudo)$/u, 'pipeline'],
  [/^(?:important dates|upcoming dates|datas importantes|fechas importantes)$/u, 'dates upcoming'],
];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function draftAction(folded: string): OmnixActionRequest | undefined {
  if (!/^(?:(?:please )?(?:draft|write|compose|prepare|send)(?: me)? (?:a |an )?(?:quick )?(?:text|message|sms|note to send|follow[- ]?up (?:text|message))|text (?!me\b)|message (?!me\b)|(?:escreva|prepare|mande|envie|redija)(?: uma)? (?:mensagem|sms|texto)|(?:escribe|prepara|manda|envia|redacta)(?: un)? (?:mensaje|texto|sms))/u.test(folded)) return undefined;
  const kind: QuickTextKind = /\b(?:new lead|welcome|just reached out|inquiry|novo lead|nuevo lead|boas vindas|bienvenida)\b/u.test(folded) ? 'new-lead'
    : /\b(?:feedback|comentarios|retorno da visita)\b/u.test(folded) ? 'showing-feedback'
      : /\b(?:confirm|confirmar|confirmando)\b/u.test(folded) ? 'showing-confirm'
        : /\b(?:after (?:the )?(?:showing|tour|visit)|showing|tour|visita|visitou)\b/u.test(folded) ? 'after-showing'
          : 'check-in';
  return { type: 'draft-text', kind, language: looksSpanish(folded) ? 'es' : 'en' };
}

function taskAction(folded: string): OmnixActionRequest | undefined {
  const match = /^(?:please )?(?:remind me to|reminder to|set a reminder to|create (?:a )?(?:task|follow ?up|reminder) to|add (?:a )?(?:task|follow ?up|reminder) to|schedule (?:a )?(?:call|follow ?up) (?:with|for)|follow up with|me lembre de|lembre me de|lembrete para|crie (?:uma )?tarefa (?:para|de)|agende (?:uma )?(?:ligacao|retorno) (?:com|para)|recuerdame|crea (?:una )?tarea (?:para|de)|agenda (?:una )?llamada con|recordatorio para)\b\s*(.*)$/u.exec(folded);
  if (!match) return undefined;
  const rest = match[1] ?? '';
  const verb: 'call' | 'text' | 'email' | 'follow-up' | 'meet' = /\b(?:call|ring|phone|ligar|ligacao|llamar|llamada)\b/u.test(folded) ? 'call'
    : /\b(?:text|sms|mandar mensagem|mensaje)\b/u.test(folded) ? 'text'
      : /\b(?:email|e-mail|correo)\b/u.test(folded) ? 'email'
        : /\b(?:meet|meeting|coffee|reuniao|reunion|cafe)\b/u.test(folded) ? 'meet' : 'follow-up';
  const about = /\b(?:about|sobre|acerca de|re)\s+(.{3,80})$/u.exec(rest)?.[1];
  const detail = about?.replace(/\b(?:today|tomorrow|next week|on \w+day|at \d.*|hoje|amanha|manana|hoy)\b.*$/u, '').trim();
  return { type: 'create-task', verb, due: parseDueSpec(folded), ...(detail ? { detail: detail.slice(0, 120) } : {}) };
}

function noteAction(question: string, folded: string): OmnixActionRequest | undefined {
  if (!/^(?:(?:add|log|save|write|record|make)(?: a)? note|note (?:for|to|on)|(?:adicione|anote|registre|salve)(?: uma)? (?:nota|anotacao)|anota(?: para| pra)?|(?:agrega|anota|registra|guarda)(?: una)? nota|nota para)\b/u.test(folded)) return undefined;
  const colon = question.indexOf(':');
  const body = colon >= 0 ? question.slice(colon + 1).trim()
    : /\b(?:that|saying|que|dizendo|diciendo)\s+(.+)$/iu.exec(question)?.[1]?.trim();
  if (!body || body.length < 2) return undefined;
  return { type: 'log-note', body: body.slice(0, 1000) };
}

/**
 * Understands a question. `selectedContactId` is the contact currently in
 * context (open record or chosen chip); pronouns resolve only to it.
 */
export function understandOmnixQuestion(question: string, selectedContactId?: string): OmnixUnderstanding | undefined {
  const folded = foldText(question);
  const action = noteAction(question, folded) ?? taskAction(folded) ?? draftAction(folded);
  if (action) return { kind: 'action', action };
  for (const [pattern, query] of SIMPLE) if (pattern.test(folded)) return { kind: 'query', query };
  const recap = recapQuery(folded);
  if (recap) return { kind: 'query', query: recap };
  if (selectedContactId) {
    const pronoun = pronounQuery(folded, selectedContactId);
    if (pronoun) return { kind: 'query', query: pronoun };
  }
  const named = namedQuery(question);
  if (named) return { kind: 'query', query: named };
  const segment = interpretSegmentQuestion(question);
  if (segment) return { kind: 'query', query: segmentQuery(segment) };
  return undefined;
}
