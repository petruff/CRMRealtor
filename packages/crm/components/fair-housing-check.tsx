'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { fairHousingCategoryLabel, lintFairHousing, type FairHousingFinding } from '@/lib/domain/fair-housing';

/**
 * Live Fair Housing check for the form it sits in. It reads the named fields
 * as the realtor types and explains any risky phrase with a safer alternative.
 * The server applies the same rules before anything is sent.
 */
export function FairHousingCheck({ fields }: { fields: readonly string[] }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [findings, setFindings] = useState<FairHousingFinding[]>([]);
  const [touched, setTouched] = useState(false);
  const key = fields.join('|');

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return undefined;
    const names = key.split('|');
    const run = () => {
      const text = names.map((name) => {
        const element = form.elements.namedItem(name);
        return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : '';
      }).join('\n');
      setTouched(text.trim().length > 0);
      setFindings(lintFairHousing(text));
    };
    run();
    form.addEventListener('input', run);
    return () => form.removeEventListener('input', run);
  }, [key]);

  const blocking = findings.filter((finding) => finding.severity === 'avoid').length;
  return (
    <div ref={anchor} className={`ox-fh ${findings.length ? (blocking ? 'is-avoid' : 'is-review') : 'is-clear'}`} aria-live="polite">
      <p className="ox-fh-status">
        {findings.length ? <AlertTriangle className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
        {findings.length
          ? `Fair Housing check · ${findings.length} ${findings.length === 1 ? 'phrase' : 'phrases'} to ${blocking ? 'rephrase' : 'review'}`
          : touched ? 'Fair Housing check · no risky phrases found' : 'Fair Housing check runs as you write'}
      </p>
      {findings.length ? (
        <ul className="ox-fh-list">
          {findings.slice(0, 6).map((finding) => (
            <li key={`${finding.index}-${finding.phrase}`}>
              <p><mark className={`is-${finding.severity}`}>{finding.phrase}</mark> <span className="ox-fh-category">{fairHousingCategoryLabel(finding.category)} · {finding.severity === 'avoid' ? 'must change' : 'consider changing'}</span></p>
              <p className="ox-fh-why">{finding.why} {finding.suggestion}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
