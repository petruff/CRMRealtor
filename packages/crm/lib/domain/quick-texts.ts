/**
 * One-tap text templates for everyday realtor moments. They open the
 * realtor's own Messages app pre-filled; nothing is sent by Omnix.
 * Wording is intentionally neutral (Fair Housing: no people, only homes).
 */
export type QuickTextLanguage = 'en' | 'es';
export type QuickTextKind = 'new-lead' | 'showing-confirm' | 'after-showing' | 'showing-feedback' | 'check-in';

export interface QuickText {
  readonly kind: QuickTextKind;
  readonly label: string;
  readonly body: string;
}

export const QUICK_TEXT_KINDS: readonly { readonly kind: QuickTextKind; readonly label: string; readonly hint: string }[] = [
  { kind: 'new-lead', label: 'Reply to a new lead', hint: 'Thank them and ask for a good time to talk' },
  { kind: 'showing-confirm', label: 'Confirm a showing', hint: 'Let them know you’re on the way' },
  { kind: 'after-showing', label: 'After a showing', hint: 'Ask which home stood out' },
  { kind: 'showing-feedback', label: 'Ask for showing feedback', hint: 'For the agent who showed your listing' },
  { kind: 'check-in', label: 'Friendly check-in', hint: 'For someone who went quiet' },
];

function greetingName(name: string | undefined): string {
  const clean = name?.trim();
  return clean ? ` ${clean}` : '';
}

function signOff(agent: string | undefined): string {
  const clean = agent?.trim();
  return clean ? ` — ${clean}` : '';
}

export function quickText(kind: QuickTextKind, language: QuickTextLanguage, input: { readonly firstName?: string; readonly agentName?: string } = {}): string {
  const name = greetingName(input.firstName);
  // Texts are personal: sign with the first name only ("Judith", not "Judith Smith").
  const agent = input.agentName?.trim().split(/\s+/u)[0];
  const me = agent ? (language === 'es' ? `, soy ${agent}` : `, this is ${agent}`) : '';
  const sign = signOff(agent);
  if (language === 'es') {
    switch (kind) {
      case 'new-lead': return `¡Hola${name}${me}! Gracias por escribirme. ¿Cuándo le queda bien una llamada rápida para conversar sobre lo que busca?`;
      case 'showing-confirm': return `Hola${name}, confirmo nuestra visita de hoy. Le aviso cuando vaya en camino.${sign}`;
      case 'after-showing': return `Hola${name}, ¡gracias por visitar las casas conmigo hoy! ¿Cuál le gustó más? Con gusto coordino una segunda visita.${sign}`;
      case 'showing-feedback': return `Hola${name}, gracias por mostrar mi propiedad hoy. ¿Me comparte los comentarios de sus clientes sobre el precio, el estado y su nivel de interés? Es de gran ayuda para mis vendedores.${sign}`;
      case 'check-in': return `Hola${name}, solo quería saludarle. ¿Sigue pensando en mudarse? Sin ninguna prisa — aquí estoy cuando esté listo(a).${sign}`;
    }
  }
  switch (kind) {
    case 'new-lead': return `Hi${name}${me}! Thanks for reaching out. When’s a good time for a quick call about what you’re looking for?`;
    case 'showing-confirm': return `Hi${name}, confirming our showing today. I’ll text you when I’m on my way.${sign}`;
    case 'after-showing': return `Hi${name}, thanks for touring homes with me today! Which one stood out? Happy to set up a second look.${sign}`;
    case 'showing-feedback': return `Hi${name}, thanks for showing my listing today. Could you share your buyers’ feedback on price, condition and interest level? It really helps my sellers.${sign}`;
    case 'check-in': return `Hi${name}, just checking in. Are you still thinking about a move? No rush — I’m here whenever you’re ready.${sign}`;
  }
}

/** `sms:` link that opens the phone's Messages app with the body filled in. */
export function quickTextHref(phone: string, body?: string): string | undefined {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return undefined;
  return body ? `sms:${digits}?&body=${encodeURIComponent(body)}` : `sms:${digits}`;
}
