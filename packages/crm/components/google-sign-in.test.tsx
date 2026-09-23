/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signInWithOAuth: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth }),
}));

import { GoogleSignIn } from '@/components/google-sign-in';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GoogleSignIn', () => {
  it('requires explicit account selection before starting the owner session', async () => {
    auth.signInWithOAuth.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<GoogleSignIn next="/connections" />);

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:3000/auth/callback?next=%2Fconnections',
        scopes: 'openid email profile',
        queryParams: { prompt: 'select_account' },
      },
    });
  });
});
