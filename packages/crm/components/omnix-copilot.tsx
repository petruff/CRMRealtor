'use client';

import Link from 'next/link';
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  CircleHelp,
  Database,
  Globe2,
  LoaderCircle,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import {
  isSafeInProductTarget,
  isSafeExternalSourceTarget,
  validateCopilotQuestion,
  type OmnixCopilotAction,
  type OmnixCopilotCitationView,
  type OmnixCopilotUiResult,
} from './omnix-copilot-view-model';
import {
  alertCategoryLabel,
  evidenceEntityLabel,
  evidenceEntityLinkLabel,
  evidenceFactSummary,
  evidenceTimestamp,
} from '@/lib/presentation/crm-evidence';

const SUPPORTED_PROMPTS = [
  'Workspace overview',
  'What should I do today?',
  'Who needs attention?',
  'Organize my CRM',
  'Show transactions',
  'Show properties',
  'Show nurture plans',
] as const;
const WEB_PROMPTS = ['Research current Florida real estate trends', 'Compare public homebuyer resources'] as const;

const INLINE_SOURCE_LIMIT = 3;
const SOURCE_BATCH_SIZE = 12;
const ATTENTION_BATCH_SIZE = 6;
const RESULT_BATCH_SIZE = 6;

function intentLabel(intent?: string): string {
  if (intent === 'alerts') return 'Attention brief';
  if (intent === 'brief') return 'Daily brief';
  if (intent === 'web-research') return 'Web research';
  return intent?.replaceAll('-', ' ') ?? '';
}

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  question?: string;
  result?: OmnixCopilotUiResult;
}

function CitationLinks({
  ids,
  citations,
}: {
  ids: readonly string[];
  citations: readonly OmnixCopilotCitationView[];
}) {
  const sources = ids
    .map((id) => citations.find((citation) => citation.id === id))
    .filter((citation): citation is OmnixCopilotCitationView => Boolean(citation));
  if (!sources.length) return null;
  const visibleSources = sources.slice(0, INLINE_SOURCE_LIMIT);
  const remaining = sources.length - visibleSources.length;
  const sourceKind = visibleSources.some((citation) => citation.entityType === 'web') ? 'Web source:' : 'CRM source:';
  return (
    <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-subtle">
      <span>{sourceKind}</span>
      {visibleSources.map((citation) => citation.entityType === 'web'
        ? isSafeExternalSourceTarget(citation.target) ? (
          <a key={citation.id} href={citation.target} target="_blank" rel="noopener noreferrer" className="break-words text-accent hover:underline">
            {citation.displayLabel ?? 'Public source'}
          </a>
        ) : null
        : isSafeInProductTarget(citation.target) ? (
          <Link key={citation.id} href={citation.target} className="break-words text-accent hover:underline">
            {citation.displayLabel ?? evidenceEntityLabel(citation.entityType)}
          </Link>
        ) : null)}
      {remaining > 0 ? <span>+{remaining} more in the source list</span> : null}
    </p>
  );
}

function AssistantResult({ result }: { result: OmnixCopilotUiResult }) {
  const responseId = useId();
  const [visibleSourceCount, setVisibleSourceCount] = useState(SOURCE_BATCH_SIZE);
  const [visibleAttentionCount, setVisibleAttentionCount] = useState(ATTENTION_BATCH_SIZE);
  const [visibleAlertCount, setVisibleAlertCount] = useState(RESULT_BATCH_SIZE);
  const [visibleBlockCounts, setVisibleBlockCounts] = useState<Record<string, number>>({});
  const isProblem = result.status === 'error';
  const isLimited = result.status === 'unsupported' || result.status === 'unavailable';
  const Icon = isProblem ? CircleAlert : isLimited ? CircleHelp : Sparkles;
  const itemIds = new Set(result.answerBlocks.flatMap((block) => block.items.map((item) => item.id)));
  const availableAlerts = result.alerts.filter((alert) => !itemIds.has(alert.id));
  const visibleAlerts = availableAlerts.slice(0, visibleAlertCount);
  const remainingAlerts = Math.max(0, availableAlerts.length - visibleAlerts.length);
  const visibleCitations = result.citations.slice(0, visibleSourceCount);
  const remainingSources = result.citations.length - visibleCitations.length;
  const attentionItems = result.answerBlocks
    .filter((block) => block.kind === 'list' && block.id.startsWith('attention-'))
    .flatMap((block) => block.items);
  const visibleAttentionIds = new Set(attentionItems
    .slice(0, visibleAttentionCount)
    .map((item) => item.id));
  const remainingAttention = Math.max(0, attentionItems.length - visibleAttentionCount);

  return (
    <article
      className="max-w-[94%] rounded-2xl rounded-tl-md border border-line bg-surface p-4 sm:max-w-[88%] sm:p-5"
      aria-label="Omnix response"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {result.intent ? `Omnix · ${intentLabel(result.intent)}` : 'Omnix'}
            </p>
            {result.dataMode && !result.model?.researched ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
                {result.dataMode === 'live' ? 'Live CRM' : 'Sample data'}
              </span>
            ) : null}
            {result.model?.narrated ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                <Sparkles className="size-3" aria-hidden /> AI grounded
              </span>
            ) : null}
            {result.model?.researched ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                <BookOpen className="size-3" aria-hidden /> Web researched
              </span>
            ) : null}
          </div>
          {result.message ? (
            <p className={`mt-1 text-sm leading-relaxed ${isProblem ? 'text-hot' : 'text-ink'}`}>
              {result.message}
            </p>
          ) : null}
          {result.answerBlocks.map((block) => {
            const isAttentionList = block.kind === 'list' && block.id.startsWith('attention-');
            const visibleBlockCount = visibleBlockCounts[block.id] ?? RESULT_BATCH_SIZE;
            const visibleItems = isAttentionList
              ? block.items.filter((item) => visibleAttentionIds.has(item.id))
              : block.items.slice(0, visibleBlockCount);
            const remainingBlockItems = isAttentionList
              ? 0
              : Math.max(0, block.items.length - visibleItems.length);
            if (isAttentionList && !visibleItems.length) return null;
            return (
            <section
              key={block.id}
              className={block.id === 'attention-summary'
                ? 'mt-3 rounded-2xl border border-line bg-surface-2 p-4 first:mt-1'
                : 'mt-4 first:mt-1'}
              aria-labelledby={`${responseId}-${block.id}-title`}
            >
              {block.title ? (
                <h3 id={`${responseId}-${block.id}-title`} className="text-sm font-semibold text-ink">
                  {block.title}
                </h3>
              ) : null}
              <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-muted">
                {block.detail}
              </p>
              {visibleItems.length ? (
                <ul className={`mt-3 grid gap-2 ${block.kind === 'metric' ? 'grid-cols-2 sm:grid-cols-3' : ''}`}>
                  {visibleItems.map((item) => (
                    <li key={item.id} className={`min-w-0 rounded-xl p-3 ${block.kind === 'metric' ? 'border border-line bg-surface' : 'bg-surface-2'}`}>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <p className="break-words text-sm font-medium text-ink">{item.label}</p>
                        {item.value !== undefined ? (
                          <span className="tabular rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink">
                            {item.value}
                          </span>
                        ) : null}
                      </div>
                      {item.detail ? (
                        <p className="mt-1 break-words text-xs leading-relaxed text-muted">{item.detail}</p>
                      ) : null}
                      {item.href && isSafeInProductTarget(item.href) ? (
                        <Link
                          href={item.href}
                          className="sk-secondary-button mt-2 max-w-full text-xs"
                          aria-label={`Open ${item.label}`}
                        >
                          <span className="truncate">Open {item.label}</span>
                          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                        </Link>
                      ) : null}
                      <CitationLinks ids={item.citationIds} citations={result.citations} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <CitationLinks ids={block.citationIds.filter((id) => !visibleItems.some((item) => item.citationIds.includes(id)))} citations={result.citations} />
              {!isAttentionList && block.items.length > RESULT_BATCH_SIZE ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                  <button
                    type="button"
                    className="sk-secondary-button text-xs"
                    aria-disabled={remainingBlockItems === 0}
                    onClick={() => {
                      if (!remainingBlockItems) return;
                      setVisibleBlockCounts((current) => ({
                        ...current,
                        [block.id]: Math.min(
                          (current[block.id] ?? RESULT_BATCH_SIZE) + RESULT_BATCH_SIZE,
                          block.items.length,
                        ),
                      }));
                    }}
                  >
                    {remainingBlockItems > 0
                      ? `Show next ${Math.min(RESULT_BATCH_SIZE, remainingBlockItems)}`
                      : 'All items shown'}
                  </button>
                  <span className="text-[11px] text-subtle">
                    Showing {visibleItems.length} of {block.items.length}
                  </span>
                </div>
              ) : null}
            </section>
            );
          })}

          {attentionItems.length > ATTENTION_BATCH_SIZE ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <button
                type="button"
                className="sk-secondary-button text-xs"
                aria-disabled={remainingAttention === 0}
                onClick={() => {
                  if (!remainingAttention) return;
                  setVisibleAttentionCount((current) => Math.min(
                    current + ATTENTION_BATCH_SIZE,
                    attentionItems.length,
                  ));
                }}
              >
                {remainingAttention > 0
                  ? `Show next ${Math.min(ATTENTION_BATCH_SIZE, remainingAttention)}`
                  : 'All attention items shown'}
              </button>
              <span className="text-[11px] text-subtle">
                Showing {Math.min(visibleAttentionCount, attentionItems.length)} of {attentionItems.length} attention items
              </span>
            </div>
          ) : null}

          {result.status === 'empty' && !result.message && !result.answerBlocks.length ? (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              I couldn’t find a matching record in this CRM.
            </p>
          ) : null}

          {visibleAlerts.length ? (
            <section className="mt-4 border-t border-line pt-3" aria-label="Deterministic alerts">
              <p className="text-xs font-medium text-muted">Alerts from stored CRM dates</p>
              <ul className="mt-2 grid gap-2">
                {visibleAlerts.map((alert) => (
                  <li key={alert.id} className="min-w-0 rounded-xl bg-surface-2 p-3">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <p className="break-words text-sm font-medium text-ink">{alert.reason}</p>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {alert.priority}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-[11px] text-subtle">
                      {alertCategoryLabel(alert.category)} · Saved in CRM
                    </p>
                    {isSafeInProductTarget(alert.href) ? (
                      <Link href={alert.href} className="sk-secondary-button mt-2 text-xs">
                        Review record <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    ) : null}
                    <CitationLinks ids={alert.citationIds} citations={result.citations} />
                  </li>
                ))}
              </ul>
              {availableAlerts.length > RESULT_BATCH_SIZE ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="sk-secondary-button text-xs"
                    aria-disabled={remainingAlerts === 0}
                    onClick={() => {
                      if (!remainingAlerts) return;
                      setVisibleAlertCount((current) => Math.min(
                        current + RESULT_BATCH_SIZE,
                        availableAlerts.length,
                      ));
                    }}
                  >
                    {remainingAlerts > 0
                      ? `Show next ${Math.min(RESULT_BATCH_SIZE, remainingAlerts)} alerts`
                      : 'All alerts shown'}
                  </button>
                  <span className="text-[11px] text-subtle">
                    Showing {visibleAlerts.length} of {availableAlerts.length} alerts
                  </span>
                </div>
              ) : null}
            </section>
          ) : null}

          {result.citations.length ? (
            <details className="mt-4 border-t border-line pt-3">
              <summary className="inline-flex min-h-9 cursor-pointer items-center text-xs font-medium text-accent">
                View {result.citations.length === 1 ? 'source' : 'sources'} ({result.citations.length})
              </summary>
              <ul className="mt-3 grid gap-2" aria-label="Answer sources">
                {visibleCitations.map((citation) => {
                  if (citation.entityType === 'web') {
                    return (
                      <li key={citation.id} className="min-w-0 rounded-xl bg-surface-2 p-3">
                        <p className="break-words text-xs font-medium text-ink">{citation.displayLabel ?? 'Public web source'}</p>
                        <p className="mt-1 break-words text-[11px] leading-relaxed text-muted">
                          Public source returned by Gemini Google Search grounding.
                        </p>
                        {isSafeExternalSourceTarget(citation.target) ? (
                          <a href={citation.target} target="_blank" rel="noopener noreferrer" className="sk-secondary-button mt-2 text-xs">
                            Open source <ArrowUpRight className="size-3.5" aria-hidden />
                          </a>
                        ) : null}
                      </li>
                    );
                  }
                  const updatedAt = evidenceTimestamp(citation.sourceTimestamp);
                  return (
                    <li key={citation.id} className="min-w-0 rounded-xl bg-surface-2 p-3">
                      <p className="break-words text-xs font-medium text-ink">
                        {citation.displayLabel ?? evidenceEntityLabel(citation.entityType)}
                      </p>
                      <p className="mt-1 break-words text-[11px] leading-relaxed text-muted">
                        Based on {evidenceFactSummary(citation.factKeys) || 'stored CRM details'}.
                        {updatedAt ? ` Updated ${updatedAt}.` : ''}
                      </p>
                      {isSafeInProductTarget(citation.target) ? (
                        <Link href={citation.target} className="sk-secondary-button mt-2 text-xs">
                          {citation.displayLabel ? `Open ${citation.displayLabel}` : evidenceEntityLinkLabel(citation.entityType)}
                          <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {remainingSources > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="sk-secondary-button text-xs"
                    onClick={() => setVisibleSourceCount((current) => Math.min(current + SOURCE_BATCH_SIZE, result.citations.length))}
                  >
                    Show {Math.min(SOURCE_BATCH_SIZE, remainingSources)} more
                  </button>
                  <span className="text-[11px] text-subtle">
                    Showing {visibleCitations.length} of {result.citations.length}
                  </span>
                </div>
              ) : result.citations.length > SOURCE_BATCH_SIZE ? (
                <p className="mt-3 text-[11px] text-subtle">All {result.citations.length} sources shown</p>
              ) : null}
            </details>
          ) : null}

          {result.suggestions.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-medium text-muted">Suggested next steps</p>
              <ul className="mt-2 grid gap-2">
                {result.suggestions.map((suggestion) => (
                  <li key={suggestion.id} className="min-w-0 rounded-xl bg-surface-2 p-3">
                    <p className="text-sm font-medium text-ink">{suggestion.label}</p>
                    {suggestion.detail ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{suggestion.detail}</p>
                    ) : null}
                    {suggestion.commandPreview ? (
                      <code className="mt-2 block overflow-x-auto rounded-lg bg-surface px-2.5 py-2 text-[11px] text-muted">
                        {suggestion.commandPreview}
                      </code>
                    ) : null}
                    {suggestion.href && isSafeInProductTarget(suggestion.href) ? (
                      <Link href={suggestion.href} className="sk-secondary-button mt-2 text-xs">
                        Open next step <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    ) : null}
                    <CitationLinks ids={suggestion.citationIds} citations={result.citations} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.warnings.length ? (
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-warm" aria-label="Response limitations">
              {result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          ) : null}

          {result.asOf ? (
            <p className="mt-3 text-[11px] text-subtle">
              {result.model?.researched ? 'Web researched' : 'CRM checked'} {new Date(result.asOf).toLocaleString()} · Read-only response
            </p>
          ) : null}
          {result.model?.researched ? (
            <p className="mt-2 text-[11px] text-subtle" role="status">
              Gemini researched public sources. Web content cannot change CRM records or authorize actions · {result.model.policyVersion}
            </p>
          ) : result.model?.narrated ? (
            <p className="mt-2 text-[11px] text-subtle" role="status">
              Gemini organized the answer from the cited CRM records · {result.model.policyVersion}
            </p>
          ) : result.model?.routed ? (
            <p className="mt-2 text-[11px] text-subtle" role="status">
              I understood the question and checked the matching CRM records.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function PendingResponse({ source }: { source: 'crm' | 'public-web' }) {
  return (
    <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-surface p-4 text-sm text-muted" role="status">
      <span className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />
        {source === 'crm' ? 'Checking the latest CRM records…' : 'Researching public sources…'}
      </span>
    </div>
  );
}

export function OmnixCopilot({
  action,
  mode = 'page',
  greetingName,
}: {
  action: OmnixCopilotAction;
  mode?: 'page' | 'assistant';
  greetingName?: string;
}) {
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [source, setSource] = useState<'crm' | 'public-web'>('crm');
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string } | undefined>();
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const sequence = useRef(0);
  const compact = mode === 'assistant';
  const questionId = compact ? 'omnix-assistant-question' : 'omnix-question';
  const conversationId = compact ? 'omnix-assistant-conversation' : 'omnix-page-conversation';

  const scrollToLatest = useCallback(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const behavior = reduceMotion ? 'auto' : 'smooth';
    conversationRef.current?.scrollTo?.({ top: conversationRef.current.scrollHeight, behavior });
    if (!compact) composerRef.current?.scrollIntoView?.({ block: 'end', behavior: 'instant' });
  }, [compact]);

  useEffect(() => {
    if (!entries.length && !isPending) return;
    scrollToLatest();
  }, [entries.length, isPending, scrollToLatest]);

  const sendQuestion = (rawQuestion: string) => {
    const nextQuestion = rawQuestion.trim();
    const validationError = validateCopilotQuestion(nextQuestion);
    if (validationError) {
      setComposerError(validationError);
      inputRef.current?.focus();
      return;
    }

    setComposerError(null);
    setQuestion('');
    sequence.current += 1;
    const userEntryId = `user-${sequence.current}`;
    setEntries((current) => [
      ...current,
      { id: userEntryId, role: 'user', question: nextQuestion },
    ]);

    startTransition(async () => {
      try {
        const result = await action(nextQuestion, { source, ...(source === 'crm' && selectedContact ? { contactId: selectedContact.id } : {}) });
        if (result.selectedContact) setSelectedContact(result.selectedContact);
        sequence.current += 1;
        setEntries((current) => [
          ...current,
          { id: `assistant-${sequence.current}`, role: 'assistant', result },
        ]);
      } catch {
        sequence.current += 1;
        setEntries((current) => [
          ...current,
          {
            id: `assistant-${sequence.current}`,
            role: 'assistant',
            result: {
              status: 'error',
              question: nextQuestion,
              answerBlocks: [],
              citations: [],
              suggestions: [],
              alerts: [],
              warnings: [],
              message: "Omnix couldn't read the CRM right now. Nothing was changed.",
            },
          },
        ]);
      }
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isPending) sendQuestion(question);
  };

  const clearSession = () => {
    setEntries([]);
    setQuestion('');
    setComposerError(null);
    setSelectedContact(undefined);
    inputRef.current?.focus();
  };

  return (
    <section
      className={compact
        ? 'flex h-full min-h-0 flex-col overflow-hidden bg-surface'
        : 'mt-8 overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-surface'}
      aria-labelledby={compact ? 'omnix-assistant-copilot-title' : 'copilot-title'}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-surface-2 p-5 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-white">
            <MessageCircle className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={compact ? 'omnix-assistant-copilot-title' : 'copilot-title'} className="font-display text-2xl text-ink">
              {compact && greetingName ? `Hi ${greetingName}, I'm Omnix` : 'Ask Omnix'}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Find client details, understand deal status, and prepare your next steps. Every answer links to its sources.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entries.length ? (
            <button
              type="button"
              onClick={scrollToLatest}
              className="sk-icon-button"
              aria-label="Jump to latest message"
              aria-controls={conversationId}
              title="Jump to latest"
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={clearSession}
            disabled={!entries.length || isPending}
            className="sk-icon-button disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Clear this page session"
            title="Clear session"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className={compact ? 'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden' : 'grid min-h-[24rem] grid-rows-[minmax(0,1fr)_auto] overflow-hidden'}>
        <div
          ref={conversationRef}
          id={conversationId}
          className={compact
            ? 'omnix-conversation-scroll min-w-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5'
            : 'omnix-conversation-scroll max-h-[min(38rem,55dvh)] min-w-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6'}
          tabIndex={0}
          role={entries.length || isPending ? 'log' : undefined}
          aria-live={entries.length || isPending ? 'polite' : undefined}
          aria-relevant={entries.length || isPending ? 'additions' : undefined}
          aria-busy={isPending}
          aria-label="Omnix conversation"
        >
          {!entries.length ? (
            <div className="mx-auto flex min-h-72 max-w-2xl flex-col items-center justify-center text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
                <BookOpen className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-xl text-ink">
                {greetingName ? `What should we focus on, ${greetingName}?` : 'What should we focus on?'}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                {source === 'crm'
                  ? 'Your clients, transactions, properties, and follow-up plans in one conversation. Choose a client from an answer to keep the next question in context.'
                  : 'Ask a public research question. Client context stays in CRM mode.'}
              </p>
              <div className="mt-5 flex max-w-full flex-wrap justify-center gap-2" aria-label="Supported prompt examples">
                {(source === 'crm' ? SUPPORTED_PROMPTS : WEB_PROMPTS).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendQuestion(prompt)}
                    disabled={isPending}
                    className="min-h-11 max-w-full rounded-full border border-line bg-surface px-4 py-2 text-left text-sm text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="break-words">{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            entries.map((entry) => entry.role === 'user' ? (
              <article key={entry.id} className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-accent px-4 py-3 text-sm leading-relaxed text-white sm:max-w-[82%]" aria-label="Your question">
                <p className="break-words">{entry.question}</p>
              </article>
            ) : entry.result ? (
              <div key={entry.id}>
                <AssistantResult result={entry.result} />
                {entry.result.citations.some((citation) => citation.entityType === 'contact') ? (
                  <div className="mt-3 flex flex-wrap gap-2 pl-1" aria-label="Choose a client for follow-up questions">
                    {entry.result.citations.filter((citation, index, all) => citation.entityType === 'contact'
                      && all.findIndex((other) => other.entityType === 'contact' && other.recordId === citation.recordId) === index).slice(0, 6).map((citation) => (
                      <button key={citation.recordId} type="button" disabled={isPending} className="sk-secondary-button min-h-11 text-xs"
                        onClick={() => { setSource('crm'); setSelectedContact({ id: citation.recordId, name: citation.displayLabel ?? 'Selected client' }); inputRef.current?.focus(); }}>
                        Ask about {citation.displayLabel ?? 'this client'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null)
          )}
          {isPending ? <PendingResponse source={source} /> : null}
        </div>

        <form ref={composerRef} onSubmit={submit} className="omnix-copilot-composer scroll-mb-28 scroll-mt-24 border-t border-line bg-surface-2 p-4 sm:p-5" aria-busy={isPending}>
          <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Answer source">
            {([{ value: 'crm', label: 'CRM', icon: Database }, { value: 'public-web', label: 'Public web', icon: Globe2 }] as const).map((item) => (
              <button key={item.value} type="button" aria-pressed={source === item.value} disabled={isPending}
                onClick={() => { setSource(item.value); setComposerError(null); if (item.value === 'public-web') setSelectedContact(undefined); }}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-medium ${source === item.value ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted'}`}>
                <item.icon className="size-3.5" aria-hidden />{item.label}
              </button>
            ))}
            {source === 'crm' && selectedContact ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface pl-3 text-xs text-ink">
                <span className="max-w-48 truncate">{selectedContact.name}</span>
                <button type="button" disabled={isPending} onClick={() => setSelectedContact(undefined)} className="sk-icon-button" aria-label="Clear selected client"><X className="size-3.5" aria-hidden /></button>
              </span>
            ) : null}
          </div>
          {source === 'crm' && selectedContact ? <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <button type="button" className="sk-secondary-button min-h-11" disabled={isPending} onClick={() => sendQuestion('Show this client status')}>Client status</button>
            <Link className="sk-secondary-button min-h-11" href={`/contacts/${encodeURIComponent(selectedContact.id)}/outcome`}>Organize notes & next steps<ArrowUpRight className="size-3.5" aria-hidden /></Link>
          </div> : null}
          <label htmlFor={questionId} className="sr-only">Ask Omnix about the CRM or research a topic</label>
          <div className="flex min-w-0 items-center gap-2 rounded-[1.15rem] border border-line bg-surface p-2 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
            <input
              ref={inputRef}
              id={questionId}
              name="question"
              type="text"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                if (composerError) setComposerError(null);
              }}
              maxLength={200}
              disabled={isPending}
              autoComplete="off"
              placeholder={source === 'crm' ? 'Ask about a client, a deal, or your next steps…' : 'Ask a public research question…'}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-ink outline-none placeholder:text-subtle disabled:cursor-wait"
              aria-invalid={composerError ? true : undefined}
              aria-describedby={composerError ? `${questionId}-error` : `${questionId}-help`}
            />
            <button
              type="submit"
              disabled={isPending || !question.trim()}
              className="sk-primary-button size-11 shrink-0 px-0 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={isPending ? 'Omnix is checking records' : 'Ask Omnix'}
            >
              {isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            </button>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1 px-1">
            {composerError ? (
              <p id={`${questionId}-error`} role="alert" className="text-xs text-hot">{composerError}</p>
            ) : (
              <p id={`${questionId}-help`} className="flex items-center gap-1.5 text-xs text-muted">
                <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                {source === 'crm' ? 'Latest CRM records · Review before changes' : 'Public sources only · Keep client details in CRM'}
              </p>
            )}
            <p className="tabular text-xs text-subtle" aria-label={`${question.length} of 200 characters`}>
              {question.length}/200
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}
