import { Eye, Share2 } from 'lucide-react';
import { ClientPortalShare } from '@/components/client-portal-share';
import { createPortalLinkAction, revokePortalLinkAction } from '@/app/transactions/portal-actions';
import { linkIsActive, type ClientPortalLink } from '@/lib/domain/client-portal';
import { formatSince } from '@/lib/presentation/us-dates';

const day = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));

/** Per-deal client portal: share a private, read-only page and see if it was opened. */
export function DealClientPortal({ transactionId, contactName, propertyAddress, links, now, timeZone }: {
  transactionId: string; contactName: string; propertyAddress: string; links: readonly ClientPortalLink[]; now: Date; timeZone: string;
}) {
  const active = links.filter((link) => linkIsActive(link, now));
  return (
    <details className="ox-portal">
      <summary className="ox-portal-summary">
        <Share2 className="size-4" aria-hidden />
        <span>Client page</span>
        <span className="ox-portal-summary-meta">{active.length ? `${active.length} active ${active.length === 1 ? 'link' : 'links'}` : 'Share progress privately'}</span>
      </summary>
      <div className="ox-portal-body">
        <p className="ox-portal-lede">A private, read-only page with the property, status and key dates — no commission, notes or documents. Links expire on their own and can be turned off anytime.</p>
        {active.length ? (
          <ul className="ox-portal-links">
            {active.map((link) => (
              <li key={link.id}>
                <div className="min-w-0 flex-1">
                  <p className="ox-row-title">{link.audienceLabel}</p>
                  <p className="ox-row-detail">
                    <Eye className="inline size-3.5 align-[-2px]" aria-hidden />{' '}
                    {link.viewCount ? `Opened ${link.viewCount} ${link.viewCount === 1 ? 'time' : 'times'}${link.lastViewedAt ? ` · last ${formatSince(link.lastViewedAt, now, timeZone).replace(/^Just now$/u, 'just now')}` : ''}` : 'Not opened yet'}
                    {' · '}Expires {day(link.expiresAt)}
                  </p>
                </div>
                <form action={revokePortalLinkAction}>
                  <input type="hidden" name="linkId" value={link.id} />
                  <button type="submit" className="ox-portal-revoke">Turn off</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <ClientPortalShare action={createPortalLinkAction.bind(null, transactionId)} defaultAudience={contactName} propertyAddress={propertyAddress} />
      </div>
    </details>
  );
}
