import type { LeadSource, LeadType } from '../domain/contact.ts';
import type { ContactScope } from './contact-query.ts';

export interface ContactViewState {
  readonly scope: ContactScope;
  readonly query?: string;
  readonly leadType?: LeadType;
  readonly source?: LeadSource;
  readonly smartList?: string;
  readonly page?: number;
}

type ContactViewChange = Partial<{
  scope: ContactScope;
  query: string | undefined;
  leadType: LeadType | undefined;
  source: LeadSource | undefined;
  smartList: string | undefined;
  page: number | undefined;
}>;

/** Builds canonical active-contact URLs while preserving every unchanged filter. */
export function contactViewHref(
  current: ContactViewState,
  change: ContactViewChange = {},
): string {
  const changesPageOnly = Object.keys(change).every((key) => key === 'page');
  const next = { ...current, ...(!changesPageOnly ? { page: undefined } : {}), ...change };
  const params = new URLSearchParams();
  if (next.scope !== 'leads') params.set('scope', next.scope);
  if (next.query) params.set('q', next.query);
  if (next.leadType) params.set('leadType', next.leadType);
  if (next.source) params.set('source', next.source);
  if (next.smartList) params.set('smartList', next.smartList);
  if (next.page && next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return `/contacts${query ? `?${query}` : ''}`;
}
