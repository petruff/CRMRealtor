'use client';

export function BriefSourceLink({ citationId, children }: { citationId: string; children: React.ReactNode }) {
  return <a href={`#evidence-${citationId}`} onClick={() => {
    const target = document.getElementById(`evidence-${citationId}`);
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
  }}>{children}</a>;
}
