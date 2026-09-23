// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceDictation, appendDictation } from '@/components/voice-dictation';

class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = ''; continuous = false; interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  constructor() { FakeRecognition.last = this; }
}

function speak(text: string, isFinal: boolean) {
  const result = Object.assign([{ transcript: text }], { isFinal });
  FakeRecognition.last!.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('appendDictation', () => {
  it('joins speech with natural punctuation and capitalization', () => {
    expect(appendDictation('', 'left a voicemail')).toBe('Left a voicemail');
    expect(appendDictation('Called Ruth', 'she wants a CMA')).toBe('Called Ruth. She wants a CMA');
    expect(appendDictation('Called Ruth.', 'she wants a CMA')).toBe('Called Ruth. She wants a CMA');
    expect(appendDictation('Line one\n', 'next line')).toBe('Line one\nNext line');
    expect(appendDictation('Keep', '   ')).toBe('Keep');
  });
});

describe('VoiceDictation', () => {
  it('hides itself where the browser has no speech recognition', () => {
    render(<VoiceDictation targetId="x" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('appends finalized speech to an uncontrolled field and shows interim words', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    render(<><textarea id="note" defaultValue="Called Ruth" /><VoiceDictation targetId="note" /></>);
    const button = screen.getByRole('button', { name: 'Dictate' });
    fireEvent.click(button);
    expect(FakeRecognition.last!.lang).toBe('en-US');
    expect(screen.getByRole('button', { name: 'Stop dictation' })).toHaveAttribute('aria-pressed', 'true');
    act(() => speak('wants to see', false));
    expect(screen.getByText('wants to see')).toBeInTheDocument();
    act(() => speak('wants to see homes by the water', true));
    expect((document.getElementById('note') as HTMLTextAreaElement).value).toBe('Called Ruth. Wants to see homes by the water');
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('explains a blocked microphone without losing typed text', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    const onAppend = vi.fn();
    render(<VoiceDictation onAppend={onAppend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(screen.getByText(/Microphone access is blocked/)).toBeInTheDocument();
    act(() => speak('hello', true));
    expect(onAppend).toHaveBeenCalledWith('hello');
  });
});
