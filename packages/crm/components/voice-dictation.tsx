'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

/**
 * On-device dictation for notes and conversation recaps.
 *
 * Uses the browser's built-in speech recognition (Safari/iOS, Chrome, Edge),
 * so there is no audio upload to Omnix, no API key and no per-minute cost.
 * Recognized text is appended to the target field; nothing is saved until the
 * realtor presses the form's own save button. Browsers without speech support
 * simply do not show the control.
 */

interface RecognitionAlternative { readonly transcript: string }
interface RecognitionResult { readonly isFinal: boolean; readonly 0: RecognitionAlternative; readonly length: number }
interface RecognitionEvent { readonly resultIndex: number; readonly results: { readonly length: number; readonly [index: number]: RecognitionResult } }
interface RecognitionErrorEvent { readonly error: string }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
}

/** Joins dictated speech onto existing text with natural spacing and capitalization. */
export function appendDictation(existing: string, spoken: string): string {
  const clean = spoken.trim().replace(/\s+/g, ' ');
  if (!clean) return existing;
  const sentence = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (!existing.trim()) return sentence;
  const trimmed = existing.replace(/\s+$/u, '');
  if (/\n[ \t]*$/u.test(existing)) return `${trimmed}\n${sentence}`;
  if (/[.!?]$/u.test(trimmed)) return `${trimmed} ${sentence}`;
  return `${trimmed}. ${sentence}`;
}

function setNativeValue(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

const ERROR_COPY: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings to dictate.',
  'service-not-allowed': 'Dictation is turned off in this browser.',
  'no-speech': 'No speech was heard. Tap the mic and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Dictation needs a connection right now. Your typed text is safe.',
};

export function VoiceDictation({
  targetId,
  onAppend,
  lang = 'en-US',
  label = 'Dictate',
}: {
  /** Id of an uncontrolled textarea/input to append into. */
  targetId?: string;
  /** For controlled fields: receives each finalized phrase. */
  onAppend?: (spoken: string) => void;
  lang?: string;
  label?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string>();
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => { setSupported(Boolean(recognitionConstructor())); }, []);
  useEffect(() => () => recognition.current?.stop(), []);

  const deliver = useCallback((spoken: string) => {
    if (onAppend) { onAppend(spoken); return; }
    const element = targetId ? document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null : null;
    if (!element) return;
    setNativeValue(element, appendDictation(element.value, spoken));
  }, [onAppend, targetId]);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) return;
    setError(undefined);
    const instance = new Constructor();
    instance.lang = lang;
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = (event) => {
      let pending = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) deliver(result[0].transcript);
        else pending += result[0].transcript;
      }
      setInterim(pending);
    };
    instance.onerror = (event) => { if (event.error !== 'aborted') setError(ERROR_COPY[event.error] ?? 'Dictation stopped. Your text is safe.'); };
    instance.onend = () => { setListening(false); setInterim(''); recognition.current = null; };
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      setError('Dictation could not start. Try again.');
    }
  }, [deliver, lang]);

  if (!supported) return null;

  return (
    <div className="ox-dictation">
      <button
        type="button"
        className={`ox-dictation-button ${listening ? 'is-listening' : ''}`}
        onClick={listening ? stop : start}
        aria-pressed={listening}
        aria-label={listening ? 'Stop dictation' : label}
      >
        {listening ? <Square className="size-3.5" aria-hidden /> : <Mic className="size-4" aria-hidden />}
        <span>{listening ? 'Listening… tap to stop' : label}</span>
      </button>
      <span className="ox-dictation-status" aria-live="polite">
        {error ? <span className="text-hot">{error}</span> : interim ? <span className="italic text-muted">{interim}</span> : null}
      </span>
    </div>
  );
}
