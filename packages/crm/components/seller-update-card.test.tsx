/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SellerUpdateCard } from './seller-update-card';
import type { ReadyItem } from '@/lib/application/ready-to-send';

afterEach(() => cleanup());

const item: ReadyItem = {
  id: 'seller-update:s1', contactId: 's1', name: 'Maria Lopez', firstName: 'Maria', initials: 'ML', leadType: 'hot', relationship: 'active-client',
  kind: 'seller-update', reason: 'Friday seller update — keep your seller in the loop', hint: 'From your notes: 2 showings in your notes this week',
  phone: '(305) 555-0100', body: 'Hi Maria, your weekly update on 123 Palm Ave: this week we had 2 showings.', href: 'sms:+13055550100?&body=x',
};

describe('SellerUpdateCard', () => {
  it('opens Messages, then logs the update when she taps Mark sent', async () => {
    const markSent = vi.fn(async () => ({ status: 'sent' as const }));
    render(<SellerUpdateCard item={item} markSent={markSent} lastSentLabel="Sep 18" />);
    expect(screen.getByText(/Last update: Sep 18/u)).toBeInTheDocument();
    expect(screen.getByText('Seller update')).toBeInTheDocument();
    expect(screen.getByText(/2 showings in your notes/u)).toBeInTheDocument();
    const send = screen.getByRole('link', { name: /Send in Messages/u });
    send.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(send);
    await userEvent.click(screen.getByRole('button', { name: /Mark sent/u }));
    expect(markSent).toHaveBeenCalledWith('s1', item.body);
    expect(await screen.findByRole('status')).toHaveTextContent('Logged');
  });
});
