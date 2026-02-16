/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { supabaseClient } from '../../lib/supabaseClient';
import { apiFetch } from '../../lib/apiClient';

jest.mock('../../lib/supabaseClient', () => ({
  supabaseClient: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('../../lib/apiClient', () => ({
  apiFetch: jest.fn(),
}));

function Harness() {
  const auth = useAuth();

  return (
    <div>
      <span data-testid="user-id">{auth.user?.id || 'none'}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <button onClick={() => auth.signIn({ email: 'a@b.com', password: 'pw', mode: 'signin' })}>signin</button>
      <button onClick={() => auth.signIn({ email: 'a@b.com', password: 'pw', mode: 'signup' })}>signup</button>
      <button onClick={() => auth.signOut()}>signout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabaseClient.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    supabaseClient.auth.signInWithPassword.mockResolvedValue({ error: null });
    supabaseClient.auth.signUp.mockResolvedValue({ error: null });
    supabaseClient.auth.signOut.mockResolvedValue({ error: null });
    apiFetch.mockResolvedValue({ claimed: true, migrated: 1 });
  });

  test('bootstraps session and claims trial runs when token exists', async () => {
    supabaseClient.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-1',
          user: { id: 'user-1' },
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('user-id').textContent).toBe('user-1');
    expect(apiFetch).toHaveBeenCalledWith('/api/trial/claim', {
      method: 'POST',
      token: 'token-1',
    });
  });

  test('signIn/signUp/signOut delegate to supabase client', async () => {
    supabaseClient.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    await act(async () => {
      fireEvent.click(screen.getByText('signin'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('signup'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('signout'));
    });

    expect(supabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw',
    });
    expect(supabaseClient.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw',
    });
    expect(supabaseClient.auth.signOut).toHaveBeenCalled();
  });
});
