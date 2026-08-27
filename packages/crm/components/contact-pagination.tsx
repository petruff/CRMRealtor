import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ContactPaginationPage {
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly from: number;
  readonly to: number;
}

export function ContactPagination({
  page,
  hrefForPage,
}: {
  readonly page: ContactPaginationPage;
  readonly hrefForPage: (page: number) => string;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line pt-5 sm:flex-row">
      <p className="text-sm text-muted" aria-live="polite">
        Showing <strong className="text-ink">{page.from}–{page.to}</strong> of{' '}
        <strong className="text-ink">{page.total}</strong> exact contacts
      </p>
      <nav aria-label="Contact result pages" className="flex items-center gap-3">
        {page.page > 1 ? (
          <Link href={hrefForPage(page.page - 1)} className="sk-secondary-button min-h-11 px-4" rel="prev">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : <span className="sk-secondary-button min-h-11 px-4 opacity-50" aria-disabled="true"><ChevronLeft className="size-4" aria-hidden /> Previous</span>}
        <span className="text-sm text-muted">Page <strong className="text-ink">{page.page}</strong> of <strong className="text-ink">{page.pageCount}</strong></span>
        {page.page < page.pageCount ? (
          <Link href={hrefForPage(page.page + 1)} className="sk-secondary-button min-h-11 px-4" rel="next">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : <span className="sk-secondary-button min-h-11 px-4 opacity-50" aria-disabled="true">Next <ChevronRight className="size-4" aria-hidden /></span>}
      </nav>
    </div>
  );
}
