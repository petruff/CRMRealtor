import { Heart } from 'lucide-react';
import { MEMORY_KIND_LABEL, type MemoryFact } from '@/lib/domain/relationship-memory';

/** "What matters to them" — personal details pulled from her own notes, with where each came from. */
export function RelationshipMemoryCard({ facts, firstName }: { facts: readonly MemoryFact[]; firstName: string }) {
  if (!facts.length) return null;
  return (
    <section className="ox-memory-card" aria-labelledby="memory-title">
      <header className="flex items-center gap-2">
        <span className="ox-icon-chip ox-tone-alert"><Heart className="size-4" aria-hidden /></span>
        <h2 id="memory-title" className="text-sm font-semibold text-ink">What matters to {firstName}</h2>
      </header>
      <ul className="ox-memory-list">
        {facts.map((fact) => (
          <li key={`${fact.kind}-${fact.text}`} title={`From your note on ${new Date(fact.noteDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}>
            <span className="ox-memory-kind">{MEMORY_KIND_LABEL[fact.kind]}</span>
            <span className="ox-memory-text">{fact.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-subtle">Pulled from your notes. <a href="#notes" className="underline underline-offset-2">See notes</a></p>
    </section>
  );
}
