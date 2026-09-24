import { describe, expect, it } from 'vitest';
import { contactHint, extractMemoryFacts } from './relationship-memory.ts';

const notes = [
  { id: 'n1', createdAt: '2026-09-20T10:00:00.000Z', body: 'Called Ana. Relocating from Denver, husband Marco starts a new job at Baptist Health in November. They have two kids and a dog named Luna. Prefers texts, best to text after 6 pm. Loves pickleball.' },
  { id: 'n2', createdAt: '2026-09-10T10:00:00.000Z', body: 'Going through a divorce, needs to sell fast. Works at Publix. Need more space — outgrew the condo. Their lease ends in March.' },
  { id: 'n3', createdAt: '2026-09-01T10:00:00.000Z', body: 'Prefers calls. Speaks Spanish.' },
  { id: 'n4', createdAt: '2026-09-21T10:00:00.000Z', body: 'Dog named Rex', archivedAt: '2026-09-22T00:00:00.000Z' },
];

describe('relationship memory', () => {
  it('pulls personal details from notes with their source, newest first', () => {
    const facts = extractMemoryFacts(notes);
    expect(facts.map((fact) => fact.text)).toEqual(expect.arrayContaining([
      'Moving from Denver', 'Husband: Marco', 'New job at Baptist Health', 'Dog named Luna', 'Two kids', 'Prefers texts',
      'Best reached after 6 pm', 'Loves pickleball', 'Works at Publix', 'Need more space', 'Outgrew the condo', 'Lease ends in March',
    ]));
    expect(facts.find((fact) => fact.text === 'Dog named Luna')).toMatchObject({ kind: 'pet', noteId: 'n1', shareable: true });
    expect(facts.find((fact) => fact.text === 'Two kids')).toMatchObject({ kind: 'family', shareable: false });
  });

  it('never keeps sensitive sentences or archived notes, and keeps only the newest channel preference', () => {
    const texts = extractMemoryFacts(notes, 30).map((fact) => fact.text.toLowerCase());
    expect(texts.some((text) => text.includes('divorce') || text.includes('sell fast'))).toBe(false);
    expect(texts).not.toContain('dog named rex');
    expect(texts).not.toContain('prefers calls');
    expect(texts).toContain('speaks spanish');
  });

  it('summarizes how to reach someone', () => {
    expect(contactHint(extractMemoryFacts(notes))).toBe('Prefers texts · Best reached after 6 pm');
    expect(contactHint([])).toBeUndefined();
  });
});
