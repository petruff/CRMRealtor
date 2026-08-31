'use client';

import Link from 'next/link';
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  CircleHelp,
  LoaderCircle,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import {
  isSafeInProductTarget,
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
  'What should I do today?',
  'Who needs attention?',
  "Show today's tasks",
  'Show upcoming dates',
  'Show pipeline',
] as const;

const INLINE_SOURCE_LIMIT = 3;
const SOURCE_BATCH_SIZE = 12;
const ATTENTION_BATCH_SIZE = 6;
const RESULT_BATCH_SIZE = 6;

function intentLabel(intent?: string): string {
  if (intent === 'alerts') return 'Attention brief';
  if (intent === 'brief') return 'Daily brief';
  return intent ?? '';
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
  return (
    <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-subtle">
      <span>CRM source:</span>
      {visibleSources.map((citation) => isSafeInProductTarget(citation.target) ? (
        <Link key={citation.id} href={citation.target} className="break-words text-accent hover:underline">
          {citation.displayLabel ?? evidenceEntityLabel(citation.entityType)}
        </Link>
      ) : null)}
      {remaining > 0 ? <span>+{remaining} more in the source list</span> : null}
    </p>
  );
}

function AssistantResult({ result }: { result: OmnixCopilotUiResult }) {
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
            {result.dataMode ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
                {result.dataMode === 'live' ? 'Live CRM' : 'Sample data'}
              </span>
            ) : null}
            {result.model?.narrated ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                <Sparkles className="size-3" aria-hidden /> AI grounded
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
              aria-labelledby={`${block.id}-title`}
            >
              {block.title ? (
                <h3 id={`${block.id}-title`} className="text-sm font-semibold text-ink">
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
              <CitationLinks ids={block.citationIds} citations={result.citations} />
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
              CRM checked {new Date(result.asOf).toLocaleString()} · Read-only response
            </p>
          ) : null}
          {result.model?.narrated ? (
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

function PendingResponse() {
  return (
    <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-surface p-4 text-sm text-muted" role="status">
      <span className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />
        Checking your CRM…
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
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const compact = mode === 'assistant';
  const questionId = compact ? 'omnix-assistant-question' : 'omnix-question';
  const conversationId = compact ? 'omnix-assistant-conversation' : 'omnix-page-conversation';

  const scrollToLatest = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    conversationEndRef.current?.scrollIntoView?.({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    if (!entries.length && !isPending) return;
    scrollToLatest();
  }, [entries.length, isPending]);

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
        const result = await action(nextQuestion);
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
              I check your CRM records behind each answer and show you where the information came from.
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
          id={conversationId}
          className={compact
            ? 'omnix-conversation-scroll min-w-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5'
            : 'omnix-conversation-scroll min-w-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:max-h-[38rem] sm:p-6'}
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
                Ask about today, people who need attention, tasks, dates or pipeline. I cite the records and never act without you.
              </p>
              <div className="mt-5 flex max-w-full flex-wrap justify-center gap-2" aria-label="Supported prompt examples">
                {SUPPORTED_PROMPTS.map((prompt) => (
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
              <AssistantResult key={entry.id} result={entry.result} />
            ) : null)
          )}
          {isPending ? <PendingResponse /> : null}
          <div ref={conversationEndRef} className="h-px" aria-hidden />
        </div>

        <form onSubmit={submit} className="omnix-copilot-composer border-t border-line bg-surface-2 p-4 sm:p-5" aria-busy={isPending}>
          <label htmlFor={questionId} className="sr-only">Ask Omnix a supported question</label>
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
              placeholder="Ask about today's priorities…"
              className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-ink outline-none placeholder:text-subtle disabled:cursor-wait"
              aria-invalid={composerError ? true : undefined}
              aria-describedby={composerError ? 'omnix-question-error' : 'omnix-question-help'}
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
              <p id="omnix-question-error" role="alert" className="text-xs text-hot">{composerError}</p>
            ) : (
              <p id="omnix-question-help" className="flex items-center gap-1.5 text-xs text-muted">
                <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                Private to this page · Nothing changes without you
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
