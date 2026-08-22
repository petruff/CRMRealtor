'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { CRM_COMMANDS, type CrmSearchResult } from '@/lib/domain/crm-search';
import { resolveCrmCommandAction, searchCrmAction } from '@/app/search/actions';

const TYPE_LABEL: Record<CrmSearchResult['entityType'], string> = {
  contact: 'Contact', task: 'Task', 'incomplete-record': 'Incomplete record',
  'smart-list': 'Smart List', mailer: 'Mailer', 'workspace-member': 'Member',
};

export function CrmCommandPalette({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly CrmSearchResult[]>([]);
  const [message, setMessage] = useState('Search contacts, tasks, lists, mailers, or members.');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const navigateCommand = (id: string) => startTransition(async () => {
    const response = await resolveCrmCommandAction(id);
    if (!response.ok) { setMessage(response.message); return; }
    setOpen(false); router.push(response.command.href);
  });
  const search = () => startTransition(async () => {
    const response = await searchCrmAction(query);
    if (!response.ok) { setResults([]); setMessage(response.message); return; }
    setResults(response.response.results);
    setMessage(response.response.count ? `${response.response.count} matching records.` : 'No matching records.');
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={compact ? 'sk-icon-button' : 'flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-sm text-muted hover:text-ink'} aria-label="Open global search and commands">
        <Search className="size-[18px]" aria-hidden />
        {!compact && <><span className="flex-1 text-left">Search Omnix</span><kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">⌘K</kbd></>}
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] grid items-start bg-ink/35 px-3 pt-[8vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="crm-search-title" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <div className="mx-auto max-h-[82vh] w-full max-w-2xl overflow-y-auto rounded-[var(--sk-card-radius)] border border-line bg-surface p-4 shadow-2xl sm:p-6">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1"><h2 id="crm-search-title" className="font-display text-2xl text-ink">Search and act</h2><p className="text-sm text-muted">Workspace-scoped results and allowlisted actions.</p></div>
              <button className="sk-icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close search"><X className="size-5" /></button>
            </div>
            <form className="mt-5 flex gap-2" onSubmit={(event) => { event.preventDefault(); search(); }}>
              <label className="sr-only" htmlFor="global-crm-search">Search Omnix</label>
              <input ref={inputRef} id="global-crm-search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} className="min-h-11 min-w-0 flex-1 rounded-[var(--sk-control-radius)] border border-line bg-surface-2 px-3 text-ink outline-none focus:border-accent" placeholder="Name, task, list, campaign…" />
              <button className="sk-button sk-button-primary" type="submit" disabled={pending || !query.trim()}>Search</button>
            </form>
            <p className="mt-2 text-xs text-muted" aria-live="polite">{pending ? 'Searching…' : message}</p>
            {results.length > 0 && <ul className="mt-4 grid gap-px overflow-hidden rounded-xl bg-line">{results.map((item) => <li key={`${item.entityType}:${item.recordId}`}><button type="button" className="flex min-h-14 w-full items-center gap-3 bg-surface px-4 text-left hover:bg-surface-2" onClick={() => { setOpen(false); router.push(item.href); }}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{item.label}</span><span className="block truncate text-xs text-muted">{item.detail}</span></span><span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">{TYPE_LABEL[item.entityType]}</span></button></li>)}</ul>}
            <div className="mt-6"><h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Quick actions</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{CRM_COMMANDS.map((command) => <button type="button" key={command.id} onClick={() => navigateCommand(command.id)} className="min-h-11 rounded-xl border border-line px-3 text-left text-sm font-medium text-ink hover:bg-surface-2">{command.label}</button>)}</div></div>
          </div>
        </div>
      )}
    </>
  );
}
