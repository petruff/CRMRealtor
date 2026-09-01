// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ContactForm } from '@/components/contact-form';
import type { ContactActionState } from '@/lib/application/contact-action-state';

async function action(state: ContactActionState): Promise<ContactActionState> {
  return state;
}

describe('ContactForm relationship UX', () => {
  it('makes email optional and removes lead priority when Past client is selected', async () => {
    const user = userEvent.setup();
    render(
      <ContactForm
        action={action}
        referralOptions={[]}
        cancelHref="/contacts"
        submitLabel="Save contact"
      />,
    );

    expect((screen.getByRole('textbox', { name: /email \(optional\)/i }) as HTMLInputElement).required).toBe(false);
    expect((screen.getByRole('checkbox', { name: /subscribed to email/i }) as HTMLInputElement).disabled).toBe(true);
    const relationship = screen.getByRole('combobox', { name: /^relationship/i }) as HTMLSelectElement;
    const priority = screen.getByRole('combobox', { name: /follow-up priority/i }) as HTMLSelectElement;
    expect(priority.disabled).toBe(false);

    await user.selectOptions(relationship, 'past-client');

    expect(priority.disabled).toBe(true);
    expect(priority.value).toBe('');
    expect(screen.getByText(/kept in the client relationship list/i)).toBeTruthy();
  });

  it('offers a clear save-and-continue action during sequential review', () => {
    render(
      <ContactForm
        action={action}
        referralOptions={[]}
        cancelHref="/contacts/contact-a"
        submitLabel="Save changes"
        nextContactName="Bea Person"
      />,
    );

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    const saveNext = screen.getByRole('button', { name: 'Save & review next' }) as HTMLButtonElement;
    expect(saveNext.name).toBe('reviewAction');
    expect(saveNext.value).toBe('save-next');
    expect(screen.getByText('Next in this view: Bea Person')).toBeTruthy();
  });
});
