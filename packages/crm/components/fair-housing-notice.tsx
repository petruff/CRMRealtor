import { AlertTriangle } from 'lucide-react';
import { fairHousingCategoryLabel, lintFairHousing } from '@/lib/domain/fair-housing';

/** Static Fair Housing findings for AI-proposed copy; renders nothing when clean. */
export function FairHousingNotice({ texts }: { texts: readonly string[] }) {
  const findings = texts.flatMap((text) => lintFairHousing(text));
  if (!findings.length) return null;
  const blocking = findings.some((finding) => finding.severity === 'avoid');
  return (
    <div className={`ox-fh ${blocking ? 'is-avoid' : 'is-review'} mt-4`} role="note">
      <p className="ox-fh-status"><AlertTriangle className="size-4" aria-hidden />Fair Housing check · {findings.length} {findings.length === 1 ? 'phrase' : 'phrases'} to {blocking ? 'rephrase before sending' : 'review'}</p>
      <ul className="ox-fh-list">
        {findings.slice(0, 6).map((finding) => (
          <li key={`${finding.index}-${finding.phrase}`}>
            <p><mark className={`is-${finding.severity}`}>{finding.phrase}</mark> <span className="ox-fh-category">{fairHousingCategoryLabel(finding.category)}</span></p>
            <p className="ox-fh-why">{finding.why} {finding.suggestion}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
