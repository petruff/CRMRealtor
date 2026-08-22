/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationshipQueue } from '@/components/relationship-queue';
import type { Contact } from '@/lib/domain/contact';
import { buildTriage } from '@/lib/domain/triage';

const AS_OF = new Date('2026-08-13T14:00:00.000Z');

function contact(index: number, overrides: Partial<Contact> = {}): Contact {
  return {
    id: `mounted-${index}`,
    firstName: `Mounted${index}`,
    lastName: 'Person',
    phone: `+1 410 555 ${String(index).padStart(4, '0')}`,
    email: `mounted${index}@example.com`,
    city: 'Baltimore',
    postalCode: '21201',
    tags: ['mounted-fixture'],
    leadType: index % 3 === 0 ? 'hot' : index % 3 === 1 ? 'warm' : 'nurture',
    relationship: 'lead',
    intent: 'buyer',
    source: 'open-house',
    pipelineStage: 'new',
    createdAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    ...overrides,
  };
}

function renderQueue(contacts: Contact[]) {
  return render(<RelationshipQueue contacts={contacts} buckets={buildTriage(contacts, AS_OF)} />);
}

function mountedCards(): HTMLElement[] {
  return screen.queryAllByRole('article');
}

function contactNames(): Array<string | null> {
  return mountedCards().map((card) => (
    within(card).getAllByRole('link').find((link) => link.getAttribute('href')?.startsWith('/contacts/'))
      ?.textContent ?? null
  ));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RelationshipQueue mounted interactions', () => {
  it('reveals populated batches 12 → 24 → 36 → final and focuses terminal status', async () => {
    const user = userEvent.setup();
    renderQueue(Array.from({ length: 37 }, (_, index) => contact(index)));

    expect(mountedCards()).toHaveLength(12);
    expect(screen.getByRole('status')).toHaveTextContent('Now, 37 results, showing 12.');

    await user.click(screen.getByRole('button', { name: 'Show next 12 (25 remaining)' }));
    expect(mountedCards()).toHaveLength(24);
    expect(screen.getByRole('status')).toHaveTextContent('Now, 37 results, showing 24.');

    await user.click(screen.getByRole('button', { name: 'Show next 12 (13 remaining)' }));
    expect(mountedCards()).toHaveLength(36);

    await user.click(screen.getByRole('button', { name: 'Show next 1 (1 remaining)' }));
    const terminal = await screen.findByText('All 37 shown');
    expect(mountedCards()).toHaveLength(37);
    expect(screen.queryByRole('button', { name: /Show next/ })).not.toBeInTheDocument();
    expect(terminal).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Now, 37 results, showing 37.');
  });

  it('reaches all 109 entries and resets to 12 after real lead, scope, and context clicks', async () => {
    const user = userEvent.setup();
    const contacts = Array.from({ length: 109 }, (_, index) => contact(index, {
      birthdate: index < 20 ? '1980-08-13' : undefined,
    }));
    renderQueue(contacts);

    for (let expected = 24; expected <= 108; expected += 12) {
      await user.click(screen.getByRole('button', { name: /Show next/ }));
      expect(mountedCards()).toHaveLength(expected);
    }
    await user.click(screen.getByRole('button', { name: /Show next 1/ }));
    expect(mountedCards()).toHaveLength(109);

    await user.click(screen.getByRole('button', { name: 'Warm' }));
    expect(mountedCards()).toHaveLength(12);

    await user.click(screen.getByRole('tab', { name: /Moments/ }));
    expect(mountedCards().length).toBeLessThanOrEqual(12);
    expect(screen.getByRole('button', { name: 'Warm' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Birthdays' }));
    expect(mountedCards().length).toBeLessThanOrEqual(12);
    expect(screen.getByRole('button', { name: 'Birthdays' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves last valid rendered results after invalid submit and exposes alert semantics', async () => {
    const user = userEvent.setup();
    renderQueue(Array.from({ length: 25 }, (_, index) => contact(index)));
    const search = screen.getByRole('textbox', { name: 'Search this queue' });

    await user.type(search, 'Mounted1');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const lastValidNames = contactNames();
    expect(lastValidNames.length).toBeGreaterThan(0);

    await user.clear(search);
    await user.click(search);
    await user.paste('x'.repeat(201));
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(search).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('200 characters or fewer');
    expect(contactNames()).toEqual(lastValidNames);
  });

  it('recovers populated no-results through Clear search and updates the live region', async () => {
    const user = userEvent.setup();
    renderQueue(Array.from({ length: 25 }, (_, index) => contact(index)));
    const search = screen.getByRole('textbox', { name: 'Search this queue' });

    await user.type(search, 'not-present');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(mountedCards()).toHaveLength(0);
    expect(screen.getByText('No matches in Now')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Now, 0 results, showing 0.');

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(mountedCards()).toHaveLength(12);
    expect(search).toHaveValue('');
    expect(screen.queryByText('No matches in Now')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Now, 25 results, showing 12.');
  });

  it('supports keyboard scope activation while every aria-controls target remains mounted', async () => {
    const user = userEvent.setup();
    renderQueue([contact(1, { birthdate: '1980-08-13' })]);
    const nowTab = screen.getByRole('tab', { name: /Now/ });

    nowTab.focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('tab', { name: /Moments/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'relationship-queue-panel');
    for (const tab of screen.getAllByRole('tab')) {
      expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).toBe(screen.getByRole('tabpanel'));
    }
  });
});
