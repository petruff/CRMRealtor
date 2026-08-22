import { describe, expect, it } from 'vitest';
import { contactViewHref } from './contact-view-state';

describe('contact view state', () => {
  const state = {
    scope: 'clients' as const,
    query: 'Judith Serna',
    leadType: 'hot' as const,
    smartList: 'priority-list',
  };

  it('preserves unrelated filters when switching a scope or client subview', () => {
    expect(contactViewHref(state, { scope: 'past-clients' })).toBe(
      '/contacts?scope=past-clients&q=Judith+Serna&leadType=hot&smartList=priority-list',
    );
  });

  it('clears exactly one filter and emits the canonical default URL', () => {
    expect(contactViewHref(state, { query: undefined })).toContain('leadType=hot');
    expect(contactViewHref(state, { leadType: undefined })).toContain('q=Judith+Serna');
    expect(contactViewHref({ scope: 'leads' })).toBe('/contacts');
  });
});
