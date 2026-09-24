import type { Note } from './contact.ts';

/**
 * "What matters to them": small personal facts pulled from the realtor's own
 * notes, each linked to the note it came from. Deterministic and transparent —
 * nothing is inferred beyond the words she wrote.
 *
 * Sensitive topics (health, divorce, religion, finances beyond the home search,
 * immigration…) are never extracted. Family facts are shown to the realtor for
 * rapport but are never used to pick homes or write marketing (Fair Housing).
 */
export type MemoryKind = 'pet' | 'family' | 'work' | 'move' | 'preference' | 'interest' | 'motivation' | 'milestone';

export interface MemoryFact {
  readonly kind: MemoryKind;
  readonly text: string;
  readonly noteId: string;
  readonly noteDate: string;
  /** Safe to mention in a friendly message (pets, interests, moves, work). */
  readonly shareable: boolean;
}

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  pet: 'Pets', family: 'Family', work: 'Work', move: 'Move', preference: 'How to reach them',
  interest: 'Interests', motivation: 'Why they’re moving', milestone: 'Coming up',
};

const SENSITIVE = /\b(?:divorc\w*|separat\w*|cancer|chemo|surgery|hospital|sick|illness|diagnos\w*|pregnan\w*|miscarriage|funeral|passed away|died|death|religio\w*|church|mosque|synagogue|immigra\w*|visa|green card|deport\w*|bankrupt\w*|foreclos\w*|debt|arrest\w*|lawsuit|disab\w*|therap\w*|rehab)\b/iu;

const NAME = "([A-Z][a-zA-Z'-]{1,20}(?: [A-Z][a-zA-Z'-]{1,20})?)";

interface Rule {
  readonly kind: MemoryKind;
  readonly pattern: RegExp;
  readonly render: (match: RegExpExecArray) => string | undefined;
  readonly shareable: boolean;
}

function clean(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, ' ').replace(/[.,;:!?]+$/u, '').trim();
  return text && text.length <= 80 ? text : undefined;
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const RULES: readonly Rule[] = [
  { kind: 'pet', shareable: true, pattern: new RegExp(`\\b(dog|puppy|cat|kitten)\\s+(?:named|called)\\s+${NAME}`, 'gu'), render: (m) => `${cap(m[1]!)} named ${m[2]}` },
  { kind: 'pet', shareable: true, pattern: new RegExp(`\\b(?:their|her|his)\\s+(dog|puppy|cat|kitten),?\\s+${NAME}`, 'gu'), render: (m) => `${cap(m[1]!)} named ${m[2]}` },
  { kind: 'pet', shareable: true, pattern: /\b(?:has|have|with)\s+(?:a\s+|an\s+|two\s+|2\s+|three\s+|3\s+)?(?:big\s+|small\s+|large\s+)?(dogs?|cats?|puppy|golden retriever|lab|labrador|german shepherd)\b/giu, render: (m) => `Has ${m[1]!.toLowerCase()}` },
  { kind: 'family', shareable: false, pattern: new RegExp(`\\b(husband|wife|partner|fianc[eé]e?|spouse)(?:'s name is|,| is| named)?\\s+${NAME}`, 'gu'), render: (m) => `${cap(m[1]!.toLowerCase())}: ${m[2]}` },
  { kind: 'family', shareable: false, pattern: /\b(\d|two|three|four|five)\s+(kids|children|boys|girls)\b/giu, render: (m) => cap(`${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`) },
  { kind: 'family', shareable: false, pattern: new RegExp(`\\b(daughter|son)\\s+${NAME}`, 'gu'), render: (m) => `${cap(m[1]!)} ${m[2]}` },
  { kind: 'work', shareable: true, pattern: /\b(?:[Ww]orks?|[Ww]orking)\s+(?:at|for)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/gu, render: (m) => `Works at ${m[1]}` },
  { kind: 'work', shareable: true, pattern: /\b(?:is|she's|he's|they're)\s+an?\s+(nurse|teacher|doctor|pilot|engineer|firefighter|police officer|lawyer|attorney|accountant|contractor|realtor|developer|designer|chef|dentist|pharmacist|professor|pastor|veterinarian|vet|consultant|business owner|small business owner)\b/giu, render: (m) => cap(m[1]!.toLowerCase()) },
  { kind: 'work', shareable: true, pattern: /\b[Nn]ew job\s+(?:at|with|in)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/gu, render: (m) => `New job at ${m[1]}` },
  { kind: 'move', shareable: true, pattern: /\b(?:[Rr]elocating|[Mm]oving|[Cc]oming)\s+from\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})/gu, render: (m) => `Moving from ${m[1]}` },
  { kind: 'preference', shareable: false, pattern: /\bprefers?\s+(texts?|texting|email|emails|calls?|phone calls|whatsapp)\b/giu, render: (m) => `Prefers ${m[1]!.toLowerCase().replace(/^texting$/u, 'texts')}` },
  { kind: 'preference', shareable: false, pattern: /\b(?:best|only)\s+(?:to\s+)?(?:call|text|reach)(?:\s+\w+){0,2}\s+(after|before|in the)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|morning|evening|afternoon|weekends?)/giu, render: (m) => `Best reached ${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}` },
  { kind: 'preference', shareable: false, pattern: /\b(?:call|text|reach)\s+(?:her|him|them)\s+(after|before)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/giu, render: (m) => `Best reached ${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}` },
  { kind: 'preference', shareable: false, pattern: /\bspeaks?\s+(spanish|portuguese|creole|french)\b/giu, render: (m) => `Speaks ${cap(m[1]!.toLowerCase())}` },
  { kind: 'interest', shareable: true, pattern: /\b(?:loves?|enjoys?|into|big fan of|huge fan of)\s+(golf|golfing|fishing|boating|sailing|tennis|pickleball|the beach|beaches|gardening|cooking|surfing|running|biking|cycling|hiking|wine|coffee|baseball|football|soccer|basketball|the (?:heat|dolphins|marlins|panthers|inter miami|lightning|buccaneers|bucs|magic|jaguars|rays))\b/giu, render: (m) => `Loves ${m[1]!.replace(/\b(the )?(heat|dolphins|marlins|panthers|inter miami|lightning|buccaneers|bucs|magic|jaguars|rays)\b/giu, (_all, the = '', team: string) => `${the}${cap(team)}`)}` },
  { kind: 'motivation', shareable: false, pattern: /\b(need(?:s)? more space|outgr(?:ew|own) (?:the|their|her|his) \w+|downsiz\w*|upsiz\w*|closer to (?:work|family|the beach|school)|first[- ]time (?:home ?)?buyers?|investment property|retir\w*|empty nest\w*)\b/giu, render: (m) => cap(m[1]!.toLowerCase()) },
  { kind: 'milestone', shareable: false, pattern: /\b(lease (?:ends|is up)(?: in| on)?\s+(?:[A-Za-z]+|\d+)(?:\s+(?:weeks?|months?|days?|\d{1,2}))?|graduat\w+\s+in\s+[A-Za-z]+|starts? (?:a )?new job (?:in|on)\s+(?:[A-Za-z]+|\d+)(?:\s+(?:weeks?|months?|days?|\d{1,2}))?)/giu, render: (m) => cap(m[1]!) },
];

/** Pulls personal facts from notes, newest first, one per distinct fact. */
export function extractMemoryFacts(notes: readonly Pick<Note, 'id' | 'body' | 'createdAt' | 'archivedAt'>[], limit = 12): MemoryFact[] {
  const facts: MemoryFact[] = [];
  const seen = new Set<string>();
  const ordered = [...notes].filter((note) => !note.archivedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const note of ordered) {
    // Sentence by sentence, so one sensitive sentence never blocks the rest of a note.
    for (const sentence of note.body.split(/(?<=[.!?\n])\s+/u)) {
      if (SENSITIVE.test(sentence)) continue;
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rule.pattern.exec(sentence))) {
          const text = clean(rule.render(match));
          if (!text) continue;
          const key = `${rule.kind}:${text.toLowerCase()}`;
          if (seen.has(key)) continue;
          // Keep only the newest fact of a single-valued kind like "prefers texts" vs "prefers calls".
          if (rule.kind === 'preference' && /^Prefers /u.test(text) && facts.some((fact) => fact.kind === 'preference' && /^Prefers /u.test(fact.text))) continue;
          seen.add(key);
          facts.push({ kind: rule.kind, text, noteId: note.id, noteDate: note.createdAt, shareable: rule.shareable });
        }
      }
    }
  }
  return facts.slice(0, limit);
}

/** A short hint for timing or channel, e.g. "Prefers texts · best reached after 6 pm". */
export function contactHint(facts: readonly MemoryFact[]): string | undefined {
  const hints = facts.filter((fact) => fact.kind === 'preference').map((fact) => fact.text);
  return hints.length ? hints.slice(0, 2).join(' · ') : undefined;
}
