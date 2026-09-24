import { describe, expect, it } from 'vitest';
import { parseOmnixCopilotQuestion } from './omnix-copilot.ts';
import { understandOmnixQuestion } from './omnix-understanding.ts';

/**
 * Evaluation set: everyday realtor wording (EN/ES/PT) must be understood
 * without AI. Each expectation is the canonical query or action type. Add a
 * row whenever a real question is missed.
 */
const QUERIES: readonly [string, string][] = [
  ['What should I do today?', 'brief today'],
  ['Who should I call first?', 'brief today'],
  ["What's on my plate today?", 'brief today'],
  ['Para quem devo ligar hoje?', 'brief today'],
  ['¿Qué tengo hoy?', 'brief today'],
  ['Quem precisa de atenção?', 'alerts today'],
  ['¿Quién necesita atención hoy?', 'alerts today'],
  ['overdue tasks', 'tasks overdue'],
  ['Tarefas atrasadas', 'tasks overdue'],
  ["What's closing this month?", 'transactions'],
  ['Show my pipeline', 'pipeline'],
  ['Who are my hot leads?', 'segment leadType=hot; relationship=lead'],
  ['Quem são meus leads quentes?', 'segment leadType=hot; relationship=lead'],
  ['¿Cuántos compradores calientes tengo?', 'segment leadType=hot; intent=buyer; count=yes'],
  ["Hot buyers I haven't talked to in a week", 'segment leadType=hot; intent=buyer; noContactDays=7'],
  ['Compradores sem contato há 2 semanas', 'segment intent=buyer; noContactDays=14'],
  ['Who has not been contacted in 30 days?', 'segment noContactDays=30'],
  ['Which leads went quiet?', 'segment relationship=lead; noContactDays=30'],
  ['leads I never contacted', 'segment relationship=lead; neverContacted=yes'],
  ['Show my new leads', 'segment relationship=lead; newWithinDays=14'],
  ['new leads this week', 'segment relationship=lead; newWithinDays=7'],
  ['Any birthdays this week?', 'segment birthdayWithinDays=7'],
  ['Aniversariantes do mês', 'segment birthdayWithinDays=30'],
  ['Home anniversaries this month', 'segment anniversaryWithinDays=30'],
  ['How many leads came from my website?', 'segment relationship=lead; source=website; count=yes'],
  ['Show buyers looking in Round Rock', 'segment intent=buyer; city=Round Rock'],
  ["Sellers in Miami Beach who I haven't talked to in 2 months", 'segment intent=seller; city=Miami Beach; noContactDays=60'],
  ['Show my past clients', 'segment relationship=past-client'],
  ['pre-approved buyers', 'segment intent=buyer; preApproved=yes'],
  ['Who needs a follow-up today?', 'segment followUpDue=yes'],
  ['Tell me about Alicia Monroe', 'contact profile Alicia Monroe'],
  ["What is Alicia Monroe's phone number?", 'contact profile Alicia Monroe'],
  ['phone number for Alicia', 'contact profile Alicia'],
  ['When did I last talk to Alicia Monroe?', 'contact profile Alicia Monroe'],
  ['Qual o telefone da Alicia?', 'contact profile Alicia'],
  ['Háblame de Alicia', 'contact profile Alicia'],
  ['How is Alicia doing?', 'client status Alicia'],
  ['What happened this week?', 'recap week'],
  ['Summarize my week', 'recap week'],
  ['Resumo da semana', 'recap week'],
  ['¿Qué pasó hoy?', 'recap today'],
  ['What happened yesterday?', 'recap yesterday'],
];

const ACTIONS: readonly [string, string][] = [
  ['Draft a text to Alicia Monroe', 'draft-text'],
  ['Write a follow-up message for Alicia after the showing', 'draft-text'],
  ['Text Alicia', 'draft-text'],
  ['Escribe un mensaje a Alicia', 'draft-text'],
  ['Remind me to call Alicia tomorrow at 3pm', 'create-task'],
  ['Follow up with Alicia next week', 'create-task'],
  ['Create a task to email Alicia on Friday about the inspection', 'create-task'],
  ['Me lembre de ligar para Alicia amanhã', 'create-task'],
  ['Recuérdame llamar a Alicia mañana', 'create-task'],
  ['Add a note for Alicia: prefers texts after 6pm', 'log-note'],
];

const NOT_UNDERSTOOD = ['Hi', 'What is the weather in Miami', 'Research my client Alicia', 'Write a poem'];

describe('Omnix understanding evaluation set', () => {
  it.each(QUERIES)('understands “%s”', (question, expected) => {
    const understood = understandOmnixQuestion(question);
    expect(understood).toEqual({ kind: 'query', query: expected });
    // Every canonical query is accepted by the strict grammar.
    expect(() => parseOmnixCopilotQuestion(expected)).not.toThrow();
  });

  it.each(ACTIONS)('prepares an action for “%s”', (question, type) => {
    const understood = understandOmnixQuestion(question);
    expect(understood?.kind).toBe('action');
    expect(understood?.kind === 'action' ? understood.action.type : undefined).toBe(type);
  });

  it.each(NOT_UNDERSTOOD)('leaves “%s” to the assistant fallback', (question) => {
    expect(understandOmnixQuestion(question)).toBeUndefined();
  });

  it('resolves pronouns only to the contact in context', () => {
    expect(understandOmnixQuestion('What is her phone?', 'c-1')).toEqual({ kind: 'query', query: 'contact profile c-1' });
    expect(understandOmnixQuestion('How is she doing?', 'c-1')).toEqual({ kind: 'query', query: 'client status c-1' });
    expect(understandOmnixQuestion('What is her phone?')).toBeUndefined();
  });

  it('understands dates and times for follow-ups', () => {
    const task = understandOmnixQuestion('Remind me to call Alicia tomorrow at 3pm');
    expect(task).toMatchObject({ action: { verb: 'call', due: { days: 1, hour: 15, minute: 0 } } });
    expect(understandOmnixQuestion('Follow up with Alicia on Friday')).toMatchObject({ action: { due: { weekday: 5 } } });
    expect(understandOmnixQuestion('Remind me to text Alicia in 3 days')).toMatchObject({ action: { verb: 'text', due: { days: 3 } } });
  });

  it('writes Spanish drafts when asked in Spanish', () => {
    expect(understandOmnixQuestion('Escribe un mensaje a Alicia')).toMatchObject({ action: { language: 'es' } });
    expect(understandOmnixQuestion('Draft a text to Alicia in Spanish')).toMatchObject({ action: { language: 'es' } });
    expect(understandOmnixQuestion('Draft a text to Alicia')).toMatchObject({ action: { language: 'en' } });
  });
});
