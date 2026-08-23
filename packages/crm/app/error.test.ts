import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AppError from './error';

describe('application error boundary', () => {
  it('uses page-neutral recovery copy', () => {
    const markup = renderToStaticMarkup(createElement(AppError, {
      error: new Error('hidden'),
      reset: vi.fn(),
    }));
    expect(markup).toContain('This page could not load');
    expect(markup).not.toContain('Today could not load');
    expect(markup).toContain('Try again or continue to another part of Omnix.');
    expect(markup).not.toContain('secure read');
    expect(markup).not.toContain('hidden');
  });
});
