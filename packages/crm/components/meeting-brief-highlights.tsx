'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import type { MeetingBriefNarrationEnvelope } from '@/lib/application/meeting-brief-narration';
import { BriefSourceLink } from './brief-source-link';

export type BriefHighlightAction = (contactId: string, snapshotId: string) => Promise<{ narration?: MeetingBriefNarrationEnvelope; error?: string }>;
export function MeetingBriefHighlights({ contactId, snapshotId, stale, action }: {
  contactId: string; snapshotId: string; stale: boolean; action: BriefHighlightAction;
}) {
  const [result, setResult] = useState<MeetingBriefNarrationEnvelope>();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const available = !stale && result?.state === 'available' && result.snapshotId === snapshotId;
  function generate() {
    setError('');
    startTransition(async () => {
      try {
        const response = await action(contactId, snapshotId);
        if (response.error) setError(response.error);
        else if (response.narration?.snapshotId === snapshotId) setResult(response.narration);
        else setError('Refresh the brief before requesting new highlights.');
      } catch { setError('AI highlights could not finish. Your cited brief remains available.'); }
    });
  }
  return <section className="brief-ai-highlights" aria-labelledby="ai-highlights-title">
    <h2 id="ai-highlights-title">AI conversation highlights</h2>
    <p className="mt-2 text-sm text-muted">Choose a few talking points from this brief’s cited records.</p>
    {available ? <div role="status"><p className="mt-4 font-medium">{result.summary?.text}</p>
      <div className="conversation-citations">{result.summary?.citationIds.map(id => <BriefSourceLink key={id} citationId={id}>Source</BriefSourceLink>)}</div>
      <ul className="mt-3 space-y-3">{result.talkingPoints.map((point, index) => <li key={index}><p>{point.text}</p><div className="conversation-citations">{point.citationIds.map(id => <BriefSourceLink key={id} citationId={id}>Source</BriefSourceLink>)}</div></li>)}</ul>
      <small>AI selected these recorded statements. Highlights apply to this snapshot and are not saved as contact facts.</small>
    </div> : <>
      <button type="button" className="sk-secondary-button mt-3" onClick={generate} disabled={pending || stale}><Sparkles className="size-4" aria-hidden />{pending ? 'Choosing highlights…' : 'Suggest talking points'}</button>
      {stale && <p className="mt-2 text-sm">Refresh this brief first so the highlights use current evidence.</p>}
      {result && <p className="capture-feedback" role="status">{result.reason === 'stale-evidence' ? 'The evidence changed. Refresh the brief and try again.' : 'AI highlights are unavailable for this request. The recorded context and conversation suggestions remain available.'}</p>}
    </>}
    {error && <p className="capture-feedback is-error" role="alert">{error}</p>}
  </section>;
}
